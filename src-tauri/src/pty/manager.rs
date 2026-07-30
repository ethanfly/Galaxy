//! PTY lifecycle manager. Owns pane runtime state, reader threads and the
//! batching aggregator that merges same-window PTY output into one IPC
//! event per scheduling window (spec §3.2). Keyboard input, resize and
//! signals bypass batching and are written directly.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;

use super::backend::{PtyBackend, PtyProcess, PtySpec};
use super::decode::StreamDecoder;
use super::ring::{Replay, RingBuffer, RingChunk};
use super::tracker::{
    infer_agent_status, make_block, push_tail, strip_ansi, InputLineTracker, PaneTracker,
};
use crate::core::models::{AgentKind, AgentStatus};
use crate::core::trigger::{Trigger, TriggerAction};
use crate::error::AppError;

const RING_BYTE_CAP: usize = 1024 * 1024;
const RING_CHUNK_CAP: usize = 2048;
const BATCH_WINDOW: Duration = Duration::from_millis(8);
const STATUS_THROTTLE: Duration = Duration::from_millis(250);
const MAX_DRAIN_PER_WINDOW: usize = 256;
/// Without OSC 133, finalize a quiet command block after this idle window so
/// history records the last command without waiting for the next Enter.
const HEURISTIC_IDLE_FLUSH: Duration = Duration::from_millis(900);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneChunk {
    pub pane_id: String,
    pub seq: u64,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputBatch {
    pub chunks: Vec<PaneChunk>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayDto {
    pub pane_id: String,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_seq: Option<u64>,
    pub chunks: Vec<PaneChunk>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerFire {
    pub pane_id: String,
    pub session_id: String,
    pub project_id: String,
    pub trigger_id: String,
    pub trigger_name: String,
    pub actions: Vec<TriggerAction>,
    pub snippet: String,
}

/// Side-effect surface implemented by the app state (event emission,
/// persistence, notifications).
pub trait PtyEventSink: Send + Sync {
    fn output(&self, batch: &OutputBatch);
    fn exit(&self, pane_id: &str, code: Option<i32>);
    fn title(&self, pane_id: &str, session_id: &str, title: &str);
    fn block_completed(&self, block: &crate::core::models::CommandBlock);
    fn agent_status(
        &self,
        pane_id: &str,
        session_id: &str,
        kind: AgentKind,
        status: AgentStatus,
    );
    fn trigger_fired(&self, fire: &TriggerFire);
    fn pty_error(&self, pane_id: &str, message: &str);
}

struct PaneCtx {
    session_id: String,
    project_id: String,
    agent_kind: Option<AgentKind>,
    ring: RingBuffer,
    tracker: PaneTracker,
    tail: String,
    trigger_line: String,
    /// Typed command buffer; ignores focus/CSI sequences from xterm onData.
    input: InputLineTracker,
    last_status: AgentStatus,
    last_status_at: Instant,
    trigger_cooldowns: HashMap<String, Instant>,
    exit_code: Option<i32>,
}

struct ProcessEntry {
    process: Mutex<Box<dyn PtyProcess>>,
    _reader: JoinHandle<()>,
}

enum PtyMsg {
    Output { pane_id: String, data: String },
    Eof { pane_id: String },
    Inject { pane_id: String, data: String },
}

pub struct PtyManager {
    backend: Arc<dyn PtyBackend>,
    sink: Arc<dyn PtyEventSink>,
    panes: Arc<Mutex<HashMap<String, PaneCtx>>>,
    processes: Arc<Mutex<HashMap<String, ProcessEntry>>>,
    tx: std::sync::mpsc::Sender<PtyMsg>,
    shutdown: Arc<AtomicBool>,
    triggers: Arc<Mutex<Vec<(Trigger, regex::Regex)>>>,
    _aggregator: JoinHandle<()>,
}

impl PtyManager {
    pub fn new(
        backend: Arc<dyn PtyBackend>,
        sink: Arc<dyn PtyEventSink>,
    ) -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<PtyMsg>();
        let shutdown = Arc::new(AtomicBool::new(false));
        let panes: Arc<Mutex<HashMap<String, PaneCtx>>> = Arc::new(Mutex::new(HashMap::new()));
        let processes: Arc<Mutex<HashMap<String, ProcessEntry>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let triggers: Arc<Mutex<Vec<(Trigger, regex::Regex)>>> = Arc::new(Mutex::new(Vec::new()));

        let aggregator = {
            let sink = sink.clone();
            let panes = panes.clone();
            let processes = processes.clone();
            let shutdown = shutdown.clone();
            let triggers = triggers.clone();
            std::thread::Builder::new()
                .name("pty-aggregator".into())
                .spawn(move || {
                    Self::aggregate_loop(rx, sink, panes, processes, triggers, shutdown)
                })
                .expect("spawn aggregator")
        };

        Self {
            backend,
            sink,
            panes,
            processes,
            tx,
            shutdown,
            triggers,
            _aggregator: aggregator,
        }
    }

    pub fn backend_name(&self) -> &'static str {
        self.backend.name()
    }

    /// Replace compiled trigger set (called when config changes).
    pub fn set_triggers(&self, list: Vec<Trigger>) {
        let compiled = list
            .into_iter()
            .filter(|t| t.enabled)
            .filter_map(|t| match t.compile() {
                Ok(re) => Some((t, re)),
                Err(e) => {
                    tracing::warn!(pattern = %t.pattern, "trigger regex invalid, skipped: {e}");
                    None
                }
            })
            .collect();
        *self.triggers.lock() = compiled;
    }

    pub fn spawn_pane(
        &self,
        pane_id: &str,
        session_id: &str,
        project_id: &str,
        spec: &PtySpec,
        agent_kind: Option<AgentKind>,
        resume_command: Option<String>,
    ) -> Result<(), AppError> {
        let mut process = self.backend.spawn(spec)?;
        let mut reader = process.take_reader()?;

        self.panes.lock().insert(
            pane_id.to_string(),
            PaneCtx {
                session_id: session_id.to_string(),
                project_id: project_id.to_string(),
                agent_kind,
                ring: RingBuffer::new(RING_BYTE_CAP, RING_CHUNK_CAP),
                tracker: PaneTracker::default(),
                tail: String::new(),
                trigger_line: String::new(),
                input: InputLineTracker::default(),
                last_status: AgentStatus::Idle,
                last_status_at: Instant::now(),
                trigger_cooldowns: HashMap::new(),
                exit_code: None,
            },
        );

        let tx = self.tx.clone();
        let pane_for_thread = pane_id.to_string();
        let reader_handle = std::thread::Builder::new()
            .name(format!("pty-read-{}", &pane_id[..pane_id.len().min(8)]))
            .spawn(move || {
                let mut buf = [0u8; 64 * 1024];
                // Streaming decoder: preserves multi-byte CJK across read()
                // boundaries and falls back to GBK when the shell is not UTF-8.
                let mut decoder = StreamDecoder::new();
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            let tail = decoder.finish();
                            if !tail.is_empty() {
                                let _ = tx.send(PtyMsg::Output {
                                    pane_id: pane_for_thread.clone(),
                                    data: tail,
                                });
                            }
                            let _ = tx.send(PtyMsg::Eof { pane_id: pane_for_thread.clone() });
                            break;
                        }
                        Ok(n) => {
                            let text = decoder.push(&buf[..n]);
                            if text.is_empty() {
                                continue;
                            }
                            if tx
                                .send(PtyMsg::Output {
                                    pane_id: pane_for_thread.clone(),
                                    data: text,
                                })
                                .is_err()
                            {
                                break;
                            }
                        }
                        Err(e) => {
                            tracing::debug!(pane = %pane_for_thread, "pty reader ended: {e}");
                            let tail = decoder.finish();
                            if !tail.is_empty() {
                                let _ = tx.send(PtyMsg::Output {
                                    pane_id: pane_for_thread.clone(),
                                    data: tail,
                                });
                            }
                            let _ = tx.send(PtyMsg::Eof { pane_id: pane_for_thread.clone() });
                            break;
                        }
                    }
                }
            })
            .map_err(|e| AppError::Pty(format!("启动读取线程失败: {e}")))?;

        self.processes.lock().insert(
            pane_id.to_string(),
            ProcessEntry { process: Mutex::new(process), _reader: reader_handle },
        );

        // Resume command injection: after the PTY shows its first output (or a
        // short grace period), type the adapter-generated command.
        if let Some(cmd) = resume_command {
            let tx = self.tx.clone();
            let pane = pane_id.to_string();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(900));
                let _ = tx.send(PtyMsg::Inject { pane_id: pane, data: format!("{cmd}\r") });
            });
        }
        Ok(())
    }

    /// Keyboard input — direct, never batched. Input is also tracked so
    /// command blocks and title fallbacks can attribute commands.
    pub fn write_input(&self, pane_id: &str, data: &str) -> Result<(), AppError> {
        {
            let mut panes = self.panes.lock();
            if let Some(ctx) = panes.get_mut(pane_id) {
                // Parse the full chunk once so CSI sequences (focus in/out
                // ESC[I / ESC[O, arrows, etc.) never leak into history.
                if let Some(line) = ctx.input.feed(data) {
                    ctx.tracker.touch();
                    // Agent badge: recognize agent executables.
                    if let Some(kind) = super::tracker::detect_agent_kind(&line) {
                        if ctx.agent_kind != Some(kind) {
                            ctx.agent_kind = Some(kind);
                            let sid = ctx.session_id.clone();
                            let status = ctx.last_status;
                            self.sink.agent_status(pane_id, &sid, kind, status);
                        }
                    }
                    if ctx.tracker.shell_integration {
                        // OSC 133 B/C/D will open/close blocks; just stash the line.
                        ctx.tracker.note_input_submission(Some(line));
                    } else {
                        // Heuristic path (PowerShell/cmd without shell integration):
                        // 1) close previous block (if any)
                        // 2) open a new block with this command text
                        if let Some((cmd, out, code)) = ctx.tracker.close_block(None) {
                            if !out.is_empty() || !cmd.is_empty() {
                                let block = make_block(
                                    &ctx.project_id,
                                    &ctx.session_id,
                                    pane_id,
                                    cmd,
                                    out,
                                    code,
                                );
                                self.sink.block_completed(&block);
                            }
                        }
                        if !line.trim().is_empty() {
                            ctx.tracker.begin_heuristic_block(line);
                        }
                    }
                } else if !data.is_empty() {
                    ctx.tracker.touch();
                }
            }
        }
        let processes = self.processes.lock();
        let entry = processes
            .get(pane_id)
            .ok_or_else(|| AppError::Pty("pane 对应的终端进程不存在".into()))?;
        let mut guard = entry.process.lock();
        guard.write(data.as_bytes())
    }

    pub fn resize(&self, pane_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let processes = self.processes.lock();
        if let Some(entry) = processes.get(pane_id) {
            entry.process.lock().resize(cols, rows)?;
        }
        Ok(())
    }

    pub fn kill(&self, pane_id: &str) -> Result<(), AppError> {
        let entry = self.processes.lock().remove(pane_id);
        if let Some(entry) = entry {
            let mut proc = entry.process.lock();
            let _ = proc.kill();
        }
        Ok(())
    }

    pub fn unregister(&self, pane_id: &str) {
        let _ = self.kill(pane_id);
        self.panes.lock().remove(pane_id);
    }

    pub fn replay(&self, pane_id: &str, after_seq: u64) -> ReplayDto {
        let panes = self.panes.lock();
        let Some(ctx) = panes.get(pane_id) else {
            return ReplayDto { pane_id: pane_id.into(), truncated: false, from_seq: None, chunks: vec![] };
        };
        match ctx.ring.replay(after_seq) {
            Replay::Chunks(chunks) => ReplayDto {
                pane_id: pane_id.into(),
                truncated: false,
                from_seq: None,
                chunks: Self::to_dto(pane_id, chunks),
            },
            Replay::Truncated { from_seq, chunks } => ReplayDto {
                pane_id: pane_id.into(),
                truncated: true,
                from_seq: Some(from_seq),
                chunks: Self::to_dto(pane_id, chunks),
            },
        }
    }

    fn to_dto(pane_id: &str, chunks: Vec<RingChunk>) -> Vec<PaneChunk> {
        chunks
            .into_iter()
            .map(|c| PaneChunk { pane_id: pane_id.to_string(), seq: c.seq, data: c.data })
            .collect()
    }

    pub fn pane_tail(&self, pane_id: &str) -> String {
        self.panes
            .lock()
            .get(pane_id)
            .map(|c| c.tail.clone())
            .unwrap_or_default()
    }

    pub fn is_alive(&self, pane_id: &str) -> bool {
        self.processes.lock().contains_key(pane_id)
    }

    pub fn mark_exit(&self, pane_id: &str, code: Option<i32>) {
        let mut panes = self.panes.lock();
        if let Some(ctx) = panes.get_mut(pane_id) {
            ctx.exit_code = code;
            if let Some(kind) = ctx.agent_kind {
                let sid = ctx.session_id.clone();
                ctx.last_status = AgentStatus::Done;
                drop(panes);
                self.sink.agent_status(pane_id, &sid, kind, AgentStatus::Done);
            }
        }
    }

    fn aggregate_loop(
        rx: std::sync::mpsc::Receiver<PtyMsg>,
        sink: Arc<dyn PtyEventSink>,
        panes: Arc<Mutex<HashMap<String, PaneCtx>>>,
        processes: Arc<Mutex<HashMap<String, ProcessEntry>>>,
        triggers: Arc<Mutex<Vec<(Trigger, regex::Regex)>>>,
        shutdown: Arc<AtomicBool>,
    ) {
        while !shutdown.load(Ordering::SeqCst) {
            let first = match rx.recv_timeout(HEURISTIC_IDLE_FLUSH) {
                Ok(m) => m,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    Self::flush_idle_heuristic_blocks(&sink, &panes);
                    continue;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            };
            let mut msgs = vec![first];
            // Same scheduling window: drain everything that arrived together.
            let window_start = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(m) => {
                        msgs.push(m);
                        if msgs.len() >= MAX_DRAIN_PER_WINDOW {
                            break;
                        }
                    }
                    Err(_) => {
                        if window_start.elapsed() >= BATCH_WINDOW {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(1));
                    }
                }
            }
            Self::process_window(&msgs, &sink, &panes, &processes, &triggers);
            Self::flush_idle_heuristic_blocks(&sink, &panes);
        }
    }

    /// Finalize quiet heuristic blocks so a single command appears in history
    /// without waiting for the next Enter.
    fn flush_idle_heuristic_blocks(
        sink: &Arc<dyn PtyEventSink>,
        panes: &Arc<Mutex<HashMap<String, PaneCtx>>>,
    ) {
        let mut completed: Vec<(String, crate::core::models::CommandBlock)> = Vec::new();
        {
            let mut panes_guard = panes.lock();
            for (pane_id, ctx) in panes_guard.iter_mut() {
                if !ctx.tracker.idle_block_ready(HEURISTIC_IDLE_FLUSH) {
                    continue;
                }
                if let Some((cmd, out, code)) = ctx.tracker.close_block(None) {
                    if out.is_empty() && cmd.is_empty() {
                        continue;
                    }
                    let block = make_block(
                        &ctx.project_id,
                        &ctx.session_id,
                        pane_id,
                        cmd,
                        out,
                        code,
                    );
                    completed.push((pane_id.clone(), block));
                }
            }
        }
        for (_pane_id, block) in completed {
            sink.block_completed(&block);
        }
    }

    fn process_window(
        msgs: &[PtyMsg],
        sink: &Arc<dyn PtyEventSink>,
        panes: &Arc<Mutex<HashMap<String, PaneCtx>>>,
        processes: &Arc<Mutex<HashMap<String, ProcessEntry>>>,
        triggers: &Arc<Mutex<Vec<(Trigger, regex::Regex)>>>,
    ) {
        // Group output per pane, preserving arrival order (FIFO across panes).
        let mut order: Vec<String> = Vec::new();
        let mut grouped: HashMap<String, String> = HashMap::new();
        let mut eofs: Vec<String> = Vec::new();
        let mut injects: Vec<(String, String)> = Vec::new();
        for m in msgs {
            match m {
                PtyMsg::Output { pane_id, data } => {
                    grouped
                        .entry(pane_id.clone())
                        .and_modify(|_| {})
                        .or_insert_with(|| {
                            order.push(pane_id.clone());
                            String::new()
                        })
                        .push_str(data);
                }
                PtyMsg::Eof { pane_id } => eofs.push(pane_id.clone()),
                PtyMsg::Inject { pane_id, data } => injects.push((pane_id.clone(), data.clone())),
            }
        }

        let mut batch = OutputBatch { chunks: Vec::new() };
        {
            let mut panes_guard = panes.lock();
            // Snapshot triggers outside the loop to avoid lock churn.
            let trigger_list = triggers.lock().clone();
            for pane_id in &order {
                let Some(ctx) = panes_guard.get_mut(pane_id) else { continue };
                let data = grouped.get(pane_id).unwrap();
                let chunk = ctx.ring.push(data.clone());
                batch.chunks.push(PaneChunk {
                    pane_id: pane_id.clone(),
                    seq: chunk.seq,
                    data: chunk.data.clone(),
                });

                // titles + command blocks
                let events = ctx.tracker.scan(&chunk.data);
                if let Some(title) = events.title {
                    sink.title(pane_id, &ctx.session_id, &title);
                }
                if let Some((cmd, out, code)) = events.completed_block {
                    if !out.is_empty() || !cmd.is_empty() {
                        let block = make_block(
                            &ctx.project_id,
                            &ctx.session_id,
                            pane_id,
                            cmd,
                            out,
                            code,
                        );
                        sink.block_completed(&block);
                    }
                }

                // plain tail for heuristics
                let plain = strip_ansi(&chunk.data);
                push_tail(&mut ctx.tail, &plain);

                // triggers (line oriented, cooldown per trigger+pane)
                if !trigger_list.is_empty() {
                    ctx.trigger_line.push_str(&plain);
                    Self::eval_triggers(pane_id, ctx, &trigger_list, sink);
                }

                // agent status (throttled)
                if let Some(kind) = ctx.agent_kind {
                    if ctx.last_status_at.elapsed() >= STATUS_THROTTLE {
                        ctx.last_status_at = Instant::now();
                        let status = infer_agent_status(kind, &ctx.tail);
                        if status != ctx.last_status {
                            ctx.last_status = status;
                            sink.agent_status(pane_id, &ctx.session_id, kind, status);
                        }
                    }
                }
            }
        }

        if !batch.chunks.is_empty() {
            sink.output(&batch);
        }

        // Injections (resume commands) bypass user-input tracking.
        for (pane_id, data) in injects {
            let procs = processes.lock();
            if let Some(entry) = procs.get(&pane_id) {
                let mut p = entry.process.lock();
                let _ = p.write(data.as_bytes());
            }
        }

        for pane_id in eofs {
            std::thread::sleep(Duration::from_millis(10));
            let code = {
                let procs = processes.lock();
                procs
                    .get(&pane_id)
                    .and_then(|e| e.process.lock().try_wait().ok().flatten())
            };
            if let Some(ctx) = panes.lock().get_mut(&pane_id) {
                ctx.exit_code = code;
                // Flush any open command block on process exit.
                if let Some((cmd, out, _)) = ctx.tracker.close_block(code) {
                    if !out.is_empty() || !cmd.is_empty() {
                        let block = make_block(
                            &ctx.project_id,
                            &ctx.session_id,
                            &pane_id,
                            cmd,
                            out,
                            code,
                        );
                        sink.block_completed(&block);
                    }
                }
            }
            processes.lock().remove(&pane_id);
            sink.exit(&pane_id, code);
        }
    }

    fn eval_triggers(
        pane_id: &str,
        ctx: &mut PaneCtx,
        trigger_list: &[(Trigger, regex::Regex)],
        sink: &Arc<dyn PtyEventSink>,
    ) {
        // Process complete lines; keep the partial remainder.
        while let Some(pos) = ctx.trigger_line.find('\n') {
            let line: String = ctx.trigger_line.drain(..=pos).collect();
            for (trigger, re) in trigger_list {
                if !trigger.matches_scope(&ctx.project_id, &ctx.session_id, pane_id) {
                    continue;
                }
                if !re.is_match(&line) {
                    continue;
                }
                let now = Instant::now();
                let last = ctx.trigger_cooldowns.get(&trigger.id);
                if last.map(|t| now.duration_since(*t).as_millis() as u64)
                    .map(|ms| ms < trigger.cooldown_ms)
                    .unwrap_or(false)
                {
                    continue;
                }
                ctx.trigger_cooldowns.insert(trigger.id.clone(), now);
                sink.trigger_fired(&TriggerFire {
                    pane_id: pane_id.to_string(),
                    session_id: ctx.session_id.clone(),
                    project_id: ctx.project_id.clone(),
                    trigger_id: trigger.id.clone(),
                    trigger_name: trigger.name.clone(),
                    actions: trigger.actions.clone(),
                    snippet: line.trim().chars().take(200).collect(),
                });
            }
        }
        if ctx.trigger_line.len() > 4096 {
            ctx.trigger_line.clear();
        }
    }

    pub fn shutdown(&self) {
        // Idempotent: CloseRequested + Destroyed + Drop may all call this.
        if self.shutdown.swap(true, Ordering::SeqCst) {
            return;
        }
        let mut processes = self.processes.lock();
        for (_, entry) in processes.drain() {
            let mut p = entry.process.lock();
            let _ = p.kill();
        }
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}
