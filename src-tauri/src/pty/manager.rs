//! PTY lifecycle manager. Owns pane runtime state, reader threads and the
//! batching aggregator that merges same-window PTY output into one IPC
//! event per scheduling window (spec §3.2). Keyboard input, resize and
//! signals bypass batching and are written directly.
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    fn agent_status(&self, pane_id: &str, session_id: &str, kind: AgentKind, status: AgentStatus);
    fn trigger_fired(&self, fire: &TriggerFire);
    fn pty_error(&self, pane_id: &str, message: &str);
}

struct PaneCtx {
    generation: u64,
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
    generation: u64,
    /// Process methods synchronize their own independent resources, so a
    /// blocked writer never prevents the child handle from being terminated.
    process: Arc<dyn PtyProcess>,
}

enum PtyMsg {
    Output {
        pane_id: String,
        generation: u64,
        data: String,
    },
    ReaderEof {
        pane_id: String,
        generation: u64,
    },
    ProcessExited {
        pane_id: String,
        generation: u64,
        exit_code: Option<i32>,
    },
    Inject {
        pane_id: String,
        generation: u64,
        data: String,
    },
}

enum PaneSideEffect {
    Title {
        pane_id: String,
        session_id: String,
        title: String,
    },
    Block(crate::core::models::CommandBlock),
    Agent {
        pane_id: String,
        session_id: String,
        kind: AgentKind,
        status: AgentStatus,
    },
    Trigger(TriggerFire),
}

pub struct PtyManager {
    backend: Arc<dyn PtyBackend>,
    sink: Arc<dyn PtyEventSink>,
    panes: Arc<Mutex<HashMap<String, PaneCtx>>>,
    processes: Arc<Mutex<HashMap<String, ProcessEntry>>>,
    tx: std::sync::mpsc::Sender<PtyMsg>,
    next_generation: AtomicU64,
    shutdown: Arc<AtomicBool>,
    triggers: Arc<Mutex<Vec<(Trigger, regex::Regex)>>>,
    _aggregator: JoinHandle<()>,
}

impl PtyManager {
    pub fn new(backend: Arc<dyn PtyBackend>, sink: Arc<dyn PtyEventSink>) -> Self {
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
                .spawn(move || Self::aggregate_loop(rx, sink, panes, processes, triggers, shutdown))
                .expect("spawn aggregator")
        };

        Self {
            backend,
            sink,
            panes,
            processes,
            tx,
            next_generation: AtomicU64::new(1),
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
        let process = self.backend.spawn(spec)?;
        let mut reader = process.take_reader()?;
        let process: Arc<dyn PtyProcess> = process.into();
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);

        self.panes.lock().insert(
            pane_id.to_string(),
            PaneCtx {
                generation,
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

        // Publish the process before either observer can report its exit. A
        // short-lived command must not race its EOF ahead of this entry.
        let replaced = self.processes.lock().insert(
            pane_id.to_string(),
            ProcessEntry {
                generation,
                process: process.clone(),
            },
        );
        if let Some(replaced) = replaced {
            Self::request_process_kill(replaced.process);
        }

        let tx = self.tx.clone();
        let pane_for_thread = pane_id.to_string();
        let reader_result = std::thread::Builder::new()
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
                                    generation,
                                    data: tail,
                                });
                            }
                            let _ = tx.send(PtyMsg::ReaderEof {
                                pane_id: pane_for_thread.clone(),
                                generation,
                            });
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
                                    generation,
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
                                    generation,
                                    data: tail,
                                });
                            }
                            let _ = tx.send(PtyMsg::ReaderEof {
                                pane_id: pane_for_thread.clone(),
                                generation,
                            });
                            break;
                        }
                    }
                }
            });
        if let Err(error) = reader_result {
            let entry = Self::take_process_entry(&self.processes, pane_id, generation);
            Self::remove_pane_generation(&self.panes, pane_id, generation);
            if let Some(entry) = entry {
                Self::request_process_kill(entry.process);
            }
            return Err(AppError::Pty(format!("启动读取线程失败: {error}")));
        }

        // ConPTY can keep its output pipe open while ProcessEntry owns the
        // master handle. Poll the child independently instead of treating
        // reader EOF as the only lifecycle signal.
        let tx = self.tx.clone();
        let pane_for_waiter = pane_id.to_string();
        let process_for_waiter = Arc::downgrade(&process);
        let shutdown = self.shutdown.clone();
        let waiter_result = std::thread::Builder::new()
            .name(format!("pty-wait-{}", &pane_id[..pane_id.len().min(8)]))
            .spawn(move || {
                while !shutdown.load(Ordering::SeqCst) {
                    let Some(process) = process_for_waiter.upgrade() else {
                        break;
                    };
                    let poll = process.try_wait();
                    drop(process);
                    match poll {
                        Ok(Some(exit_code)) => {
                            let _ = tx.send(PtyMsg::ProcessExited {
                                pane_id: pane_for_waiter.clone(),
                                generation,
                                exit_code: Some(exit_code),
                            });
                            break;
                        }
                        Err(error) => {
                            tracing::warn!(
                                pane = %pane_for_waiter,
                                "PTY exit polling failed: {error}"
                            );
                            let _ = tx.send(PtyMsg::ProcessExited {
                                pane_id: pane_for_waiter.clone(),
                                generation,
                                exit_code: None,
                            });
                            break;
                        }
                        _ => {}
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            });
        if let Err(error) = waiter_result {
            let entry = Self::take_process_entry(&self.processes, pane_id, generation);
            Self::remove_pane_generation(&self.panes, pane_id, generation);
            if let Some(entry) = entry {
                Self::request_process_kill(entry.process);
            }
            return Err(AppError::Pty(format!("启动进程监测线程失败: {error}")));
        }

        // Resume command injection: after the PTY shows its first output (or a
        // short grace period), type the adapter-generated command.
        if let Some(cmd) = resume_command {
            let tx = self.tx.clone();
            let pane = pane_id.to_string();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(900));
                let _ = tx.send(PtyMsg::Inject {
                    pane_id: pane,
                    generation,
                    data: format!("{cmd}\r"),
                });
            });
        }
        Ok(())
    }

    /// Keyboard input — direct, never batched. Input is also tracked so
    /// command blocks and title fallbacks can attribute commands.
    pub fn write_input(&self, pane_id: &str, data: &str) -> Result<(), AppError> {
        // 1) Deliver bytes to the PTY first so Enter is never delayed/blocked
        //    by history / agent side-effects (and never hold the processes map
        //    lock across a potentially blocking write).
        let proc = {
            let processes = self.processes.lock();
            processes
                .get(pane_id)
                .map(|e| e.process.clone())
                .ok_or_else(|| AppError::Pty("pane 对应的终端进程不存在".into()))?
        };
        proc.write(data.as_bytes())?;

        // 2) Update command-line tracking; collect side effects without holding
        //    panes across sink callbacks (those may lock store / persist).
        let mut sides: Vec<PaneSideEffect> = Vec::new();
        {
            let mut panes = self.panes.lock();
            let Some(ctx) = panes.get_mut(pane_id) else {
                return Ok(());
            };
            // Parse the full chunk once so CSI sequences (focus in/out
            // ESC[I / ESC[O, arrows, etc.) never leak into history.
            if let Some(line) = ctx.input.feed(data) {
                ctx.tracker.touch();
                if let Some(kind) = super::tracker::detect_agent_kind(&line) {
                    if ctx.agent_kind != Some(kind) {
                        ctx.agent_kind = Some(kind);
                        sides.push(PaneSideEffect::Agent {
                            pane_id: pane_id.to_string(),
                            kind,
                            session_id: ctx.session_id.clone(),
                            status: ctx.last_status,
                        });
                    }
                }
                if ctx.tracker.shell_integration {
                    ctx.tracker.note_input_submission(Some(line));
                } else {
                    if let Some((cmd, out, code)) = ctx.tracker.close_block(None) {
                        if !out.is_empty() || !cmd.is_empty() {
                            sides.push(PaneSideEffect::Block(make_block(
                                &ctx.project_id,
                                &ctx.session_id,
                                pane_id,
                                cmd,
                                out,
                                code,
                                ctx.agent_kind,
                            )));
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
        Self::dispatch_side_effects(&self.sink, sides);
        Ok(())
    }

    pub fn resize(&self, pane_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let proc = {
            let processes = self.processes.lock();
            processes.get(pane_id).map(|e| e.process.clone())
        };
        if let Some(proc) = proc {
            proc.resize(cols, rows)?;
        }
        Ok(())
    }

    pub fn kill(&self, pane_id: &str) -> Result<(), AppError> {
        let entry = self.processes.lock().remove(pane_id);
        if let Some(entry) = entry {
            Self::request_process_kill(entry.process);
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
            return ReplayDto {
                pane_id: pane_id.into(),
                truncated: false,
                from_seq: None,
                chunks: vec![],
            };
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
            .map(|c| PaneChunk {
                pane_id: pane_id.to_string(),
                seq: c.seq,
                data: c.data,
            })
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
                Self::contain_aggregator_panic("agent exit callback", || {
                    self.sink
                        .agent_status(pane_id, &sid, kind, AgentStatus::Done);
                });
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
        let mut pending_exits: HashMap<(String, u64), Option<i32>> = HashMap::new();
        let mut reader_eofs: HashSet<(String, u64)> = HashSet::new();
        while !shutdown.load(Ordering::SeqCst) {
            let first = match rx.recv_timeout(HEURISTIC_IDLE_FLUSH) {
                Ok(m) => m,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    Self::contain_aggregator_panic("idle block flush", || {
                        Self::flush_idle_heuristic_blocks(&sink, &panes);
                    });
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
            Self::process_window(
                &msgs,
                &sink,
                &panes,
                &processes,
                &triggers,
                &mut pending_exits,
                &mut reader_eofs,
            );
            Self::contain_aggregator_panic("idle block flush", || {
                Self::flush_idle_heuristic_blocks(&sink, &panes);
            });
        }
    }

    fn contain_aggregator_panic(label: &'static str, action: impl FnOnce()) {
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(action)).is_err() {
            tracing::error!(operation = label, "PTY aggregator recovered from a panic");
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
                        ctx.agent_kind,
                    );
                    completed.push((pane_id.clone(), block));
                }
            }
        }
        for (_pane_id, block) in completed {
            Self::contain_aggregator_panic("idle block callback", || {
                sink.block_completed(&block);
            });
        }
    }

    fn process_window(
        msgs: &[PtyMsg],
        sink: &Arc<dyn PtyEventSink>,
        panes: &Arc<Mutex<HashMap<String, PaneCtx>>>,
        processes: &Arc<Mutex<HashMap<String, ProcessEntry>>>,
        triggers: &Arc<Mutex<Vec<(Trigger, regex::Regex)>>>,
        pending_exits: &mut HashMap<(String, u64), Option<i32>>,
        reader_eofs: &mut HashSet<(String, u64)>,
    ) {
        enum Lifecycle {
            ReaderEof(String, u64),
            ProcessExited(String, u64, Option<i32>),
        }

        // Reader output and ReaderEof share one sender, so their FIFO order is
        // authoritative. ProcessExited only records the child status and
        // closes the master; it never publishes UI exit ahead of final output.
        let mut order: Vec<(String, u64)> = Vec::new();
        let mut grouped: HashMap<(String, u64), String> = HashMap::new();
        let mut lifecycle = Vec::new();
        let mut injects: Vec<(String, u64, String)> = Vec::new();
        for m in msgs {
            match m {
                PtyMsg::Output {
                    pane_id,
                    generation,
                    data,
                } => {
                    let key = (pane_id.clone(), *generation);
                    grouped
                        .entry(key.clone())
                        .and_modify(|_| {})
                        .or_insert_with(|| {
                            order.push(key);
                            String::new()
                        })
                        .push_str(data);
                }
                PtyMsg::ReaderEof {
                    pane_id,
                    generation,
                } => {
                    lifecycle.push(Lifecycle::ReaderEof(pane_id.clone(), *generation));
                }
                PtyMsg::ProcessExited {
                    pane_id,
                    generation,
                    exit_code,
                } => lifecycle.push(Lifecycle::ProcessExited(
                    pane_id.clone(),
                    *generation,
                    *exit_code,
                )),
                PtyMsg::Inject {
                    pane_id,
                    generation,
                    data,
                } => {
                    injects.push((pane_id.clone(), *generation, data.clone()));
                }
            }
        }

        // Output parsing and callbacks may be extension code. Contain failures
        // to this phase so injections and EOF cleanup below are never dropped.
        Self::contain_aggregator_panic("output batch", || {
            Self::process_output_batch(&order, &grouped, sink, panes, triggers);
        });

        // Injections (resume commands) bypass user-input tracking.
        for (pane_id, generation, data) in injects {
            let process = processes
                .lock()
                .get(&pane_id)
                .and_then(|entry| (entry.generation == generation).then(|| entry.process.clone()));
            if let Some(process) = process {
                Self::request_process_write(process, data.into_bytes());
            }
        }

        for event in lifecycle {
            match event {
                Lifecycle::ProcessExited(pane_id, generation, exit_code) => {
                    let key = (pane_id.clone(), generation);
                    let Some(entry) = Self::take_process_entry(processes, &pane_id, generation)
                    else {
                        pending_exits.remove(&key);
                        reader_eofs.remove(&key);
                        continue;
                    };
                    if exit_code.is_some() {
                        Self::request_process_finalize(entry.process);
                    } else {
                        Self::request_process_kill(entry.process);
                    }
                    if reader_eofs.remove(&key) {
                        Self::finalize_pane_exit(panes, sink, &pane_id, generation, exit_code);
                    } else {
                        pending_exits.insert(key, exit_code);
                    }
                }
                Lifecycle::ReaderEof(pane_id, generation) => {
                    let key = (pane_id.clone(), generation);
                    if let Some(code) = pending_exits.remove(&key) {
                        Self::finalize_pane_exit(panes, sink, &pane_id, generation, code);
                        continue;
                    }
                    let process = processes.lock().get(&pane_id).and_then(|entry| {
                        (entry.generation == generation).then(|| entry.process.clone())
                    });
                    let Some(process) = process else {
                        reader_eofs.remove(&key);
                        continue;
                    };

                    match process.try_wait() {
                        Ok(Some(code)) => {
                            if let Some(entry) =
                                Self::take_process_entry(processes, &pane_id, generation)
                            {
                                Self::request_process_finalize(entry.process);
                                Self::finalize_pane_exit(
                                    panes,
                                    sink,
                                    &pane_id,
                                    generation,
                                    Some(code),
                                );
                            }
                        }
                        Ok(None) => {
                            // Give the watcher one polling interval to observe
                            // a natural exit code before treating EOF as a
                            // transport failure and terminating the child.
                            reader_eofs.insert(key);
                            Self::request_process_kill_after(process, Duration::from_millis(75));
                        }
                        Err(error) => {
                            tracing::warn!(pane = %pane_id, "PTY EOF status check failed: {error}");
                            reader_eofs.insert(key);
                            Self::request_process_kill(process);
                        }
                    }
                }
            }
        }
    }

    fn process_output_batch(
        order: &[(String, u64)],
        grouped: &HashMap<(String, u64), String>,
        sink: &Arc<dyn PtyEventSink>,
        panes: &Arc<Mutex<HashMap<String, PaneCtx>>>,
        triggers: &Arc<Mutex<Vec<(Trigger, regex::Regex)>>>,
    ) {
        let mut batch = OutputBatch { chunks: Vec::new() };
        let mut sides = Vec::new();
        {
            let mut panes_guard = panes.lock();
            let trigger_list = triggers.lock().clone();
            for key in order {
                let (pane_id, generation) = key;
                let Some(ctx) = panes_guard.get_mut(pane_id) else {
                    continue;
                };
                if ctx.generation != *generation {
                    continue;
                }
                let Some(data) = grouped.get(key) else {
                    continue;
                };
                let chunk = ctx.ring.push(data.clone());
                batch.chunks.push(PaneChunk {
                    pane_id: pane_id.clone(),
                    seq: chunk.seq,
                    data: chunk.data.clone(),
                });

                let events = ctx.tracker.scan(&chunk.data);
                if let Some(title) = events.title {
                    sides.push(PaneSideEffect::Title {
                        pane_id: pane_id.clone(),
                        session_id: ctx.session_id.clone(),
                        title,
                    });
                }
                if let Some((cmd, out, code)) = events.completed_block {
                    if !out.is_empty() || !cmd.is_empty() {
                        sides.push(PaneSideEffect::Block(make_block(
                            &ctx.project_id,
                            &ctx.session_id,
                            pane_id,
                            cmd,
                            out,
                            code,
                            ctx.agent_kind,
                        )));
                    }
                }

                let plain = strip_ansi(&chunk.data);
                push_tail(&mut ctx.tail, &plain);
                if !trigger_list.is_empty() {
                    ctx.trigger_line.push_str(&plain);
                    Self::eval_triggers(pane_id, ctx, &trigger_list, &mut sides);
                }
                if let Some(kind) = ctx.agent_kind {
                    if ctx.last_status_at.elapsed() >= STATUS_THROTTLE {
                        ctx.last_status_at = Instant::now();
                        let status = infer_agent_status(kind, &ctx.tail);
                        if status != ctx.last_status {
                            ctx.last_status = status;
                            sides.push(PaneSideEffect::Agent {
                                pane_id: pane_id.clone(),
                                session_id: ctx.session_id.clone(),
                                kind,
                                status,
                            });
                        }
                    }
                }
            }
        }

        Self::dispatch_side_effects(sink, sides);
        if !batch.chunks.is_empty() {
            Self::contain_aggregator_panic("output callback", || {
                sink.output(&batch);
            });
        }
    }

    fn eval_triggers(
        pane_id: &str,
        ctx: &mut PaneCtx,
        trigger_list: &[(Trigger, regex::Regex)],
        sides: &mut Vec<PaneSideEffect>,
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
                if last
                    .map(|t| now.duration_since(*t).as_millis() as u64)
                    .map(|ms| ms < trigger.cooldown_ms)
                    .unwrap_or(false)
                {
                    continue;
                }
                ctx.trigger_cooldowns.insert(trigger.id.clone(), now);
                sides.push(PaneSideEffect::Trigger(TriggerFire {
                    pane_id: pane_id.to_string(),
                    session_id: ctx.session_id.clone(),
                    project_id: ctx.project_id.clone(),
                    trigger_id: trigger.id.clone(),
                    trigger_name: trigger.name.clone(),
                    actions: trigger.actions.clone(),
                    snippet: line.trim().chars().take(200).collect(),
                }));
            }
        }
        if ctx.trigger_line.len() > 4096 {
            ctx.trigger_line.clear();
        }
    }

    fn dispatch_side_effects(sink: &Arc<dyn PtyEventSink>, sides: Vec<PaneSideEffect>) {
        for side in sides {
            match side {
                PaneSideEffect::Title {
                    pane_id,
                    session_id,
                    title,
                } => {
                    Self::contain_aggregator_panic("title callback", || {
                        sink.title(&pane_id, &session_id, &title);
                    });
                }
                PaneSideEffect::Block(block) => {
                    Self::contain_aggregator_panic("block callback", || {
                        sink.block_completed(&block);
                    });
                }
                PaneSideEffect::Agent {
                    pane_id,
                    session_id,
                    kind,
                    status,
                } => {
                    Self::contain_aggregator_panic("agent callback", || {
                        sink.agent_status(&pane_id, &session_id, kind, status);
                    });
                }
                PaneSideEffect::Trigger(fire) => {
                    Self::contain_aggregator_panic("trigger callback", || {
                        sink.trigger_fired(&fire);
                    });
                }
            }
        }
    }

    fn take_process_entry(
        processes: &Arc<Mutex<HashMap<String, ProcessEntry>>>,
        pane_id: &str,
        generation: u64,
    ) -> Option<ProcessEntry> {
        let mut processes = processes.lock();
        let matches = processes
            .get(pane_id)
            .map(|entry| entry.generation == generation)
            .unwrap_or(false);
        matches.then(|| processes.remove(pane_id)).flatten()
    }

    fn remove_pane_generation(
        panes: &Arc<Mutex<HashMap<String, PaneCtx>>>,
        pane_id: &str,
        generation: u64,
    ) {
        let mut panes = panes.lock();
        let matches = panes
            .get(pane_id)
            .map(|ctx| ctx.generation == generation)
            .unwrap_or(false);
        if matches {
            panes.remove(pane_id);
        }
    }

    fn finalize_pane_exit(
        panes: &Arc<Mutex<HashMap<String, PaneCtx>>>,
        sink: &Arc<dyn PtyEventSink>,
        pane_id: &str,
        generation: u64,
        code: Option<i32>,
    ) {
        let completed = {
            let mut panes = panes.lock();
            let Some(ctx) = panes.get_mut(pane_id) else {
                return;
            };
            if ctx.generation != generation {
                return;
            }
            ctx.exit_code = code;
            ctx.tracker.close_block(code).and_then(|(cmd, out, _)| {
                (!out.is_empty() || !cmd.is_empty())
                    .then(|| {
                        make_block(
                            &ctx.project_id,
                            &ctx.session_id,
                            pane_id,
                            cmd,
                            out,
                            code,
                            ctx.agent_kind,
                        )
                    })
            })
        };
        if let Some(block) = completed {
            Self::contain_aggregator_panic("EOF block callback", || {
                sink.block_completed(&block);
            });
        }
        Self::contain_aggregator_panic("exit callback", || {
            sink.exit(pane_id, code);
        });
    }

    fn request_process_kill(process: Arc<dyn PtyProcess>) {
        // Child termination uses its own lock, independent from writer/master
        // backpressure, and process destruction stays off the aggregator.
        let result = std::thread::Builder::new()
            .name("pty-kill".into())
            .spawn(move || {
                let _ = process.kill();
                let _ = process.close_transport();
            });
        if let Err(error) = result {
            tracing::error!(%error, "failed to schedule PTY termination");
        }
    }

    fn request_process_finalize(process: Arc<dyn PtyProcess>) {
        let result = std::thread::Builder::new()
            .name("pty-finalize".into())
            .spawn(move || {
                let _ = process.close_transport();
            });
        if let Err(error) = result {
            tracing::error!(%error, "failed to schedule PTY finalization");
        }
    }

    fn request_process_kill_after(process: Arc<dyn PtyProcess>, delay: Duration) {
        let result = std::thread::Builder::new()
            .name("pty-kill-delayed".into())
            .spawn(move || {
                std::thread::sleep(delay);
                let _ = process.kill();
                let _ = process.close_transport();
            });
        if let Err(error) = result {
            tracing::error!(%error, "failed to schedule delayed PTY termination");
        }
    }

    fn request_process_write(process: Arc<dyn PtyProcess>, data: Vec<u8>) {
        let result = std::thread::Builder::new()
            .name("pty-inject".into())
            .spawn(move || {
                let _ = process.write(&data);
            });
        if let Err(error) = result {
            tracing::error!(%error, "failed to schedule PTY injection");
        }
    }

    pub fn shutdown(&self) {
        // Idempotent: CloseRequested + Destroyed + Drop may all call this.
        if self.shutdown.swap(true, Ordering::SeqCst) {
            return;
        }
        let processes: Vec<_> = self
            .processes
            .lock()
            .drain()
            .map(|(_, entry)| entry.process)
            .collect();
        for process in processes {
            Self::request_process_kill(process);
        }
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}
