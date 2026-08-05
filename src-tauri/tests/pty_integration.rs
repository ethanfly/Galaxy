//! Integration tests: real ConPTY via the portable-pty backend, batched
//! output pipeline, input round-trip and resize (spec §9.1 integration).
#![cfg(windows)]

use std::collections::VecDeque;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use galaxy_terminal_lib::core::models::{AgentKind, AgentStatus, CommandBlock};
use galaxy_terminal_lib::error::AppError;
use galaxy_terminal_lib::pty::manager::{OutputBatch, PtyEventSink, TriggerFire};
use galaxy_terminal_lib::pty::{PortablePtyBackend, PtyBackend, PtyManager, PtyProcess, PtySpec};

#[derive(Debug, Clone, PartialEq, Eq)]
enum CollectedAgentEvent {
    Detected(AgentKind),
    Status(AgentStatus),
}

struct CollectSink {
    batches: Mutex<Vec<OutputBatch>>,
    exits: Mutex<Vec<(String, Option<i32>)>>,
    titles: Mutex<Vec<(String, String)>>,
    blocks: Mutex<Vec<CommandBlock>>,
    agent_events: Mutex<Vec<CollectedAgentEvent>>,
    output_chars: AtomicU64,
}

impl CollectSink {
    fn new() -> Self {
        Self {
            batches: Mutex::new(Vec::new()),
            exits: Mutex::new(Vec::new()),
            titles: Mutex::new(Vec::new()),
            blocks: Mutex::new(Vec::new()),
            agent_events: Mutex::new(Vec::new()),
            output_chars: AtomicU64::new(0),
        }
    }
    fn all_text(&self) -> String {
        self.batches
            .lock()
            .unwrap()
            .iter()
            .flat_map(|b| b.chunks.iter().map(|c| c.data.clone()))
            .collect()
    }
}

impl PtyEventSink for CollectSink {
    fn output(&self, batch: &OutputBatch) {
        self.output_chars.fetch_add(
            batch
                .chunks
                .iter()
                .map(|c| c.data.len() as u64)
                .sum::<u64>(),
            Ordering::SeqCst,
        );
        self.batches.lock().unwrap().push(batch.clone());
    }
    fn exit(&self, pane_id: &str, code: Option<i32>) {
        self.exits.lock().unwrap().push((pane_id.to_string(), code));
    }
    fn title(&self, pane_id: &str, _session_id: &str, title: &str) {
        self.titles
            .lock()
            .unwrap()
            .push((pane_id.to_string(), title.to_string()));
    }
    fn block_completed(&self, block: &CommandBlock) {
        self.blocks.lock().unwrap().push(block.clone());
    }
    fn agent_detected(&self, _p: &str, _s: &str, kind: AgentKind) {
        self.agent_events
            .lock()
            .unwrap()
            .push(CollectedAgentEvent::Detected(kind));
    }
    fn agent_status(&self, _p: &str, _s: &str, _k: AgentKind, status: AgentStatus) {
        self.agent_events
            .lock()
            .unwrap()
            .push(CollectedAgentEvent::Status(status));
    }
    fn trigger_fired(&self, _f: &TriggerFire) {}
    fn pty_error(&self, _p: &str, _m: &str) {}
}

fn cmd_spec() -> PtySpec {
    PtySpec {
        program: "cmd.exe".into(),
        args: vec!["/Q".into()],
        env: Default::default(),
        cwd: std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()),
        cols: 100,
        rows: 30,
    }
}

fn wait_for(deadline_ms: u64, mut cond: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(deadline_ms) {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

fn observe_latest_screen(
    manager: &PtyManager,
    pane_id: &str,
    screen: String,
) -> Result<(), AppError> {
    let replay = manager.replay(pane_id, 0);
    let rendered_seq = replay.chunks.last().map(|chunk| chunk.seq).unwrap_or(0);
    manager.observe_screen(pane_id, screen, replay.generation, rendered_seq)
}

#[derive(Default)]
struct BlockingIoState {
    write_started: (Mutex<bool>, Condvar),
    release_write: (Mutex<bool>, Condvar),
    release_reader: (Mutex<bool>, Condvar),
    killed: AtomicBool,
    transport_closed: AtomicBool,
    report_exit: AtomicBool,
}

impl BlockingIoState {
    fn set(pair: &(Mutex<bool>, Condvar)) {
        *pair.0.lock().unwrap() = true;
        pair.1.notify_all();
    }

    fn wait(pair: &(Mutex<bool>, Condvar)) {
        let mut ready = pair.0.lock().unwrap();
        while !*ready {
            ready = pair.1.wait(ready).unwrap();
        }
    }
}

struct BlockingReader(Arc<BlockingIoState>);

impl Read for BlockingReader {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        BlockingIoState::wait(&self.0.release_reader);
        Ok(0)
    }
}

struct BlockingProcess(Arc<BlockingIoState>);

impl PtyProcess for BlockingProcess {
    fn take_reader(&self) -> Result<Box<dyn Read + Send>, AppError> {
        Ok(Box::new(BlockingReader(self.0.clone())))
    }

    fn write(&self, _data: &[u8]) -> Result<(), AppError> {
        BlockingIoState::set(&self.0.write_started);
        BlockingIoState::wait(&self.0.release_write);
        Ok(())
    }

    fn resize(&self, _cols: u16, _rows: u16) -> Result<(), AppError> {
        Ok(())
    }

    fn kill(&self) -> Result<(), AppError> {
        self.0.killed.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn close_transport(&self) -> Result<(), AppError> {
        self.0.transport_closed.store(true, Ordering::SeqCst);
        BlockingIoState::set(&self.0.release_reader);
        Ok(())
    }

    fn try_wait(&self) -> Result<Option<i32>, AppError> {
        Ok(self.0.report_exit.load(Ordering::SeqCst).then_some(9))
    }

    fn pid(&self) -> Option<u32> {
        None
    }
}

struct BlockingBackend(Arc<BlockingIoState>);

impl PtyBackend for BlockingBackend {
    fn name(&self) -> &'static str {
        "blocking-test"
    }

    fn spawn(&self, _spec: &PtySpec) -> Result<Box<dyn PtyProcess>, AppError> {
        Ok(Box::new(BlockingProcess(self.0.clone())))
    }
}

struct OutputChannelReader {
    receiver: mpsc::Receiver<Vec<u8>>,
    pending: VecDeque<u8>,
}

impl Read for OutputChannelReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        while self.pending.is_empty() {
            let next = self
                .receiver
                .recv()
                .map_err(|_| std::io::Error::from(std::io::ErrorKind::UnexpectedEof))?;
            if next.is_empty() {
                return Ok(0);
            }
            self.pending.extend(next);
        }
        let len = buf.len().min(self.pending.len());
        for slot in &mut buf[..len] {
            *slot = self.pending.pop_front().expect("pending output byte");
        }
        Ok(len)
    }
}

struct OutputChannelState {
    receiver: Mutex<Option<mpsc::Receiver<Vec<u8>>>>,
    sender: mpsc::Sender<Vec<u8>>,
}

impl OutputChannelState {
    fn new() -> Arc<Self> {
        let (sender, receiver) = mpsc::channel();
        Arc::new(Self {
            receiver: Mutex::new(Some(receiver)),
            sender,
        })
    }
}

struct OutputChannelProcess(Arc<OutputChannelState>);

impl PtyProcess for OutputChannelProcess {
    fn take_reader(&self) -> Result<Box<dyn Read + Send>, AppError> {
        let receiver = self
            .0
            .receiver
            .lock()
            .unwrap()
            .take()
            .ok_or_else(|| AppError::Pty("test reader already taken".into()))?;
        Ok(Box::new(OutputChannelReader {
            receiver,
            pending: VecDeque::new(),
        }))
    }

    fn write(&self, _data: &[u8]) -> Result<(), AppError> {
        Ok(())
    }

    fn resize(&self, _cols: u16, _rows: u16) -> Result<(), AppError> {
        Ok(())
    }

    fn kill(&self) -> Result<(), AppError> {
        let _ = self.0.sender.send(Vec::new());
        Ok(())
    }

    fn close_transport(&self) -> Result<(), AppError> {
        let _ = self.0.sender.send(Vec::new());
        Ok(())
    }

    fn try_wait(&self) -> Result<Option<i32>, AppError> {
        Ok(None)
    }

    fn pid(&self) -> Option<u32> {
        None
    }
}

struct OutputChannelBackend(Arc<OutputChannelState>);

impl PtyBackend for OutputChannelBackend {
    fn name(&self) -> &'static str {
        "output-channel-test"
    }

    fn spawn(&self, _spec: &PtySpec) -> Result<Box<dyn PtyProcess>, AppError> {
        Ok(Box::new(OutputChannelProcess(self.0.clone())))
    }
}

struct DelayedTailReader {
    data: Vec<u8>,
    delay: Duration,
    delivered: bool,
}

impl Read for DelayedTailReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.delivered {
            return Ok(0);
        }
        std::thread::sleep(self.delay);
        let len = self.data.len().min(buf.len());
        buf[..len].copy_from_slice(&self.data[..len]);
        self.delivered = true;
        Ok(len)
    }
}

struct ImmediateExitProcess {
    data: Vec<u8>,
    delay: Duration,
    exit_code: i32,
}

impl PtyProcess for ImmediateExitProcess {
    fn take_reader(&self) -> Result<Box<dyn Read + Send>, AppError> {
        Ok(Box::new(DelayedTailReader {
            data: self.data.clone(),
            delay: self.delay,
            delivered: false,
        }))
    }

    fn write(&self, _data: &[u8]) -> Result<(), AppError> {
        Ok(())
    }

    fn resize(&self, _cols: u16, _rows: u16) -> Result<(), AppError> {
        Ok(())
    }

    fn kill(&self) -> Result<(), AppError> {
        Ok(())
    }

    fn try_wait(&self) -> Result<Option<i32>, AppError> {
        Ok(Some(self.exit_code))
    }

    fn pid(&self) -> Option<u32> {
        None
    }
}

struct ImmediateExitBackend {
    data: Vec<u8>,
    delay: Duration,
    exit_code: i32,
}

struct ImmediateEofReader;

impl Read for ImmediateEofReader {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(0)
    }
}

struct DelayedStatusProcess {
    polls: Arc<AtomicU64>,
}

impl PtyProcess for DelayedStatusProcess {
    fn take_reader(&self) -> Result<Box<dyn Read + Send>, AppError> {
        Ok(Box::new(ImmediateEofReader))
    }

    fn write(&self, _data: &[u8]) -> Result<(), AppError> {
        Ok(())
    }

    fn resize(&self, _cols: u16, _rows: u16) -> Result<(), AppError> {
        Ok(())
    }

    fn kill(&self) -> Result<(), AppError> {
        Ok(())
    }

    fn try_wait(&self) -> Result<Option<i32>, AppError> {
        let poll = self.polls.fetch_add(1, Ordering::SeqCst);
        Ok((poll >= 3).then_some(23))
    }

    fn pid(&self) -> Option<u32> {
        None
    }
}

struct DelayedStatusBackend {
    polls: Arc<AtomicU64>,
}

impl PtyBackend for DelayedStatusBackend {
    fn name(&self) -> &'static str {
        "delayed-status-test"
    }

    fn spawn(&self, _spec: &PtySpec) -> Result<Box<dyn PtyProcess>, AppError> {
        Ok(Box::new(DelayedStatusProcess {
            polls: self.polls.clone(),
        }))
    }
}

impl PtyBackend for ImmediateExitBackend {
    fn name(&self) -> &'static str {
        "immediate-exit-test"
    }

    fn spawn(&self, _spec: &PtySpec) -> Result<Box<dyn PtyProcess>, AppError> {
        Ok(Box::new(ImmediateExitProcess {
            data: self.data.clone(),
            delay: self.delay,
            exit_code: self.exit_code,
        }))
    }
}

struct OrderedSink {
    events: Mutex<Vec<&'static str>>,
}

impl PtyEventSink for OrderedSink {
    fn output(&self, batch: &OutputBatch) {
        if batch
            .chunks
            .iter()
            .any(|chunk| chunk.data.contains("FINAL-TAIL"))
        {
            self.events.lock().unwrap().push("output");
        }
    }
    fn exit(&self, _pane_id: &str, _code: Option<i32>) {
        self.events.lock().unwrap().push("exit");
    }
    fn title(&self, _pane_id: &str, _session_id: &str, _title: &str) {}
    fn block_completed(&self, _block: &CommandBlock) {}
    fn agent_status(&self, _p: &str, _s: &str, _k: AgentKind, _st: AgentStatus) {}
    fn trigger_fired(&self, _f: &TriggerFire) {}
    fn pty_error(&self, _p: &str, _m: &str) {}
}

#[derive(Default)]
struct GatedReaderState {
    release_reader: (Mutex<bool>, Condvar),
    reader_returned: AtomicBool,
    killed: AtomicBool,
}

struct GatedReader(Arc<GatedReaderState>);

impl Read for GatedReader {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        BlockingIoState::wait(&self.0.release_reader);
        self.0.reader_returned.store(true, Ordering::SeqCst);
        Ok(0)
    }
}

struct GatedProcess(Arc<GatedReaderState>);

impl PtyProcess for GatedProcess {
    fn take_reader(&self) -> Result<Box<dyn Read + Send>, AppError> {
        Ok(Box::new(GatedReader(self.0.clone())))
    }

    fn write(&self, _data: &[u8]) -> Result<(), AppError> {
        Ok(())
    }

    fn resize(&self, _cols: u16, _rows: u16) -> Result<(), AppError> {
        Ok(())
    }

    fn kill(&self) -> Result<(), AppError> {
        self.0.killed.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn try_wait(&self) -> Result<Option<i32>, AppError> {
        Ok(None)
    }

    fn pid(&self) -> Option<u32> {
        None
    }
}

struct GatedBackend(Mutex<VecDeque<Arc<GatedReaderState>>>);

impl PtyBackend for GatedBackend {
    fn name(&self) -> &'static str {
        "gated-test"
    }

    fn spawn(&self, _spec: &PtySpec) -> Result<Box<dyn PtyProcess>, AppError> {
        let state = self
            .0
            .lock()
            .unwrap()
            .pop_front()
            .expect("test backend exhausted");
        Ok(Box::new(GatedProcess(state)))
    }
}

/// Sink callbacks are an external boundary. They must never run while the
/// manager holds its pane-state lock, because an app callback may re-enter a
/// read-only manager API (diagnostics, replay, status queries).
struct ReentrantSink {
    manager: Mutex<Option<std::sync::Weak<PtyManager>>>,
    callback_done: mpsc::Sender<()>,
}

impl PtyEventSink for ReentrantSink {
    fn output(&self, _batch: &OutputBatch) {}
    fn exit(&self, _pane_id: &str, _code: Option<i32>) {}
    fn title(&self, pane_id: &str, _session_id: &str, _title: &str) {
        if let Some(manager) = self
            .manager
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|m| m.upgrade())
        {
            let _ = manager.pane_tail(pane_id);
            let _ = self.callback_done.send(());
        }
    }
    fn block_completed(&self, _block: &CommandBlock) {}
    fn agent_status(&self, _p: &str, _s: &str, _k: AgentKind, _st: AgentStatus) {}
    fn trigger_fired(&self, _f: &TriggerFire) {}
    fn pty_error(&self, _p: &str, _m: &str) {}
}

struct PanicsOnceSink {
    output_calls: AtomicU64,
    panic_next: AtomicBool,
    exited: AtomicBool,
}

impl PtyEventSink for PanicsOnceSink {
    fn output(&self, _batch: &OutputBatch) {
        self.output_calls.fetch_add(1, Ordering::SeqCst);
        if self.panic_next.swap(false, Ordering::SeqCst) {
            panic!("simulated event sink failure");
        }
    }
    fn exit(&self, _pane_id: &str, _code: Option<i32>) {
        self.exited.store(true, Ordering::SeqCst);
    }
    fn title(&self, _pane_id: &str, _session_id: &str, _title: &str) {}
    fn block_completed(&self, _block: &CommandBlock) {}
    fn agent_status(&self, _p: &str, _s: &str, _k: AgentKind, _st: AgentStatus) {}
    fn trigger_fired(&self, _f: &TriggerFire) {}
    fn pty_error(&self, _p: &str, _m: &str) {}
}

struct PanicsTitleSink {
    output_calls: AtomicU64,
}

impl PtyEventSink for PanicsTitleSink {
    fn output(&self, _batch: &OutputBatch) {
        self.output_calls.fetch_add(1, Ordering::SeqCst);
    }
    fn exit(&self, _pane_id: &str, _code: Option<i32>) {}
    fn title(&self, _pane_id: &str, _session_id: &str, _title: &str) {
        panic!("simulated title callback failure");
    }
    fn block_completed(&self, _block: &CommandBlock) {}
    fn agent_status(&self, _p: &str, _s: &str, _k: AgentKind, _st: AgentStatus) {}
    fn trigger_fired(&self, _f: &TriggerFire) {}
    fn pty_error(&self, _p: &str, _m: &str) {}
}

#[test]
fn agent_status_observation_validates_pane_kind_and_size() {
    let reader = Arc::new(GatedReaderState::default());
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(
        Arc::new(GatedBackend(Mutex::new(VecDeque::from([reader.clone()])))),
        sink.clone(),
    );

    assert!(matches!(
        observe_latest_screen(&manager, "missing", ">>".into()),
        Err(AppError::NotFound(_))
    ));
    manager
        .spawn_pane(
            "pane-shell",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn non-Agent pane");
    observe_latest_screen(&manager, "pane-shell", ">>".into())
        .expect("non-Agent observations are ignored");
    assert!(matches!(
        observe_latest_screen(&manager, "pane-shell", "x".repeat(4097)),
        Err(AppError::InvalidInput(_))
    ));
    std::thread::sleep(Duration::from_millis(50));
    assert!(sink.agent_events.lock().unwrap().is_empty());

    manager.shutdown();
    BlockingIoState::set(&reader.release_reader);
}

#[test]
fn agent_status_observations_confirm_idle_and_dedupe_working_epochs() {
    let io = Arc::new(BlockingIoState::default());
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(BlockingBackend(io.clone())), sink.clone());
    manager
        .spawn_pane(
            "pane-agent-status",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .expect("spawn Agent pane");

    let working = ">> Run /review\n* Working (2s * esc to interrupt)";
    observe_latest_screen(&manager, "pane-agent-status", working.into()).unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .contains(&CollectedAgentEvent::Status(AgentStatus::Working))));
    assert!(matches!(
        observe_latest_screen(&manager, "pane-agent-status", "x".repeat(4097)),
        Err(AppError::InvalidInput(_))
    ));

    observe_latest_screen(&manager, "pane-agent-status", ">>".into()).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(
        sink.agent_events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Idle))
            .count(),
        0
    );
    std::thread::sleep(Duration::from_millis(450));
    observe_latest_screen(&manager, "pane-agent-status", ">>".into()).unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Idle))
        .count()
        == 1));

    observe_latest_screen(&manager, "pane-agent-status", ">>".into()).unwrap();
    observe_latest_screen(&manager, "pane-agent-status", working.into()).unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Working))
        .count()
        == 2));
    observe_latest_screen(&manager, "pane-agent-status", ">>".into()).unwrap();
    std::thread::sleep(Duration::from_millis(550));
    observe_latest_screen(&manager, "pane-agent-status", ">>".into()).unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Idle))
        .count()
        == 2));

    manager.shutdown();
}

#[test]
fn completed_agent_does_not_replay_stale_stream_working_evidence() {
    let io = OutputChannelState::new();
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(OutputChannelBackend(io.clone())), sink.clone());
    manager
        .spawn_pane(
            "pane-stale-agent-status",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .expect("spawn Agent pane");

    observe_latest_screen(
        &manager,
        "pane-stale-agent-status",
        "* Working (2s * esc to interrupt)".into(),
    )
    .unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Working))
        .count()
        == 1));

    let output_before = sink.output_chars.load(Ordering::SeqCst);
    io.sender.send(b"baseline output\r\n".to_vec()).unwrap();
    assert!(wait_for(1_000, || sink.output_chars.load(Ordering::SeqCst)
        > output_before));

    io.sender
        .send(b"* Working (stale throttled evidence * esc to interrupt)\r\n".to_vec())
        .unwrap();
    assert!(wait_for(1_000, || manager
        .pane_tail("pane-stale-agent-status")
        .contains("Working")));

    observe_latest_screen(&manager, "pane-stale-agent-status", ">>".into()).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    io.sender
        .send(b"ordinary output flushes the throttle window\r\n".to_vec())
        .unwrap();
    assert!(wait_for(1_000, || manager
        .pane_tail("pane-stale-agent-status")
        .is_empty()));
    std::thread::sleep(Duration::from_millis(300));
    observe_latest_screen(&manager, "pane-stale-agent-status", ">>".into()).unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Idle))
        .count()
        == 1));

    io.sender
        .send(b"ordinary later output\r\n".to_vec())
        .unwrap();
    assert!(
        !wait_for(1_000, || sink
            .agent_events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Working))
            .count()
            > 1),
        "old stream text started a duplicate Working epoch: {:?}",
        *sink.agent_events.lock().unwrap()
    );

    manager.shutdown();
}

#[test]
fn split_agent_status_line_survives_stream_throttle_boundaries() {
    let io = OutputChannelState::new();
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(OutputChannelBackend(io.clone())), sink.clone());
    manager
        .spawn_pane(
            "pane-split-agent-status",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .expect("spawn Agent pane");

    let output_before = sink.output_chars.load(Ordering::SeqCst);
    io.sender.send(b"* Work".to_vec()).unwrap();
    assert!(wait_for(1_000, || sink.output_chars.load(Ordering::SeqCst)
        > output_before));

    io.sender
        .send(b"ing (2s * esc to interrupt)\r\n".to_vec())
        .unwrap();
    std::thread::sleep(Duration::from_millis(300));
    io.sender.send(b"ordinary output\r\n".to_vec()).unwrap();

    assert!(
        wait_for(1_000, || sink.agent_events.lock().unwrap().iter().any(
            |event| *event == CollectedAgentEvent::Status(AgentStatus::Working)
        )),
        "split Working status was lost at a throttle boundary: {:?}",
        *sink.agent_events.lock().unwrap()
    );

    manager.shutdown();
}

#[test]
fn blocked_screen_discards_older_throttled_working_evidence() {
    let io = OutputChannelState::new();
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(OutputChannelBackend(io.clone())), sink.clone());
    manager
        .spawn_pane(
            "pane-blocked-agent-status",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .expect("spawn Agent pane");

    observe_latest_screen(
        &manager,
        "pane-blocked-agent-status",
        "* Working (2s * esc to interrupt)".into(),
    )
    .unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .any(
            |event| *event == CollectedAgentEvent::Status(AgentStatus::Working)
        )));

    let output_before = sink.output_chars.load(Ordering::SeqCst);
    io.sender.send(b"baseline output\r\n".to_vec()).unwrap();
    assert!(wait_for(1_000, || sink.output_chars.load(Ordering::SeqCst)
        > output_before));
    io.sender
        .send(b"* Working (stale throttled evidence * esc to interrupt)\r\n".to_vec())
        .unwrap();
    assert!(wait_for(1_000, || manager
        .pane_tail("pane-blocked-agent-status")
        .contains("Working")));

    observe_latest_screen(
        &manager,
        "pane-blocked-agent-status",
        "Allow command? [y/N]".into(),
    )
    .unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .any(
            |event| *event == CollectedAgentEvent::Status(AgentStatus::Blocked)
        )));

    std::thread::sleep(Duration::from_millis(300));
    io.sender.send(b"ordinary output\r\n".to_vec()).unwrap();
    assert!(
        !wait_for(1_000, || sink
            .agent_events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Working))
            .count()
            > 1),
        "old stream text incorrectly resumed a blocked Agent: {:?}",
        *sink.agent_events.lock().unwrap()
    );

    manager.shutdown();
}

#[test]
fn screen_before_new_output_preserves_causal_agent_status_order() {
    let io = OutputChannelState::new();
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(OutputChannelBackend(io.clone())), sink.clone());
    manager
        .spawn_pane(
            "pane-causal-agent-status",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .expect("spawn Agent pane");

    observe_latest_screen(
        &manager,
        "pane-causal-agent-status",
        "* Working (2s * esc to interrupt)".into(),
    )
    .unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .any(
            |event| *event == CollectedAgentEvent::Status(AgentStatus::Working)
        )));

    let output_before = sink.output_chars.load(Ordering::SeqCst);
    observe_latest_screen(&manager, "pane-causal-agent-status", ">>".into()).unwrap();
    io.sender
        .send(b"* Working (newer output * esc to interrupt)\r\n".to_vec())
        .unwrap();
    assert!(wait_for(1_000, || sink.output_chars.load(Ordering::SeqCst)
        > output_before));

    std::thread::sleep(Duration::from_millis(550));
    observe_latest_screen(&manager, "pane-causal-agent-status", ">>".into()).unwrap();
    assert!(
        !wait_for(1_000, || sink.agent_events.lock().unwrap().iter().any(
            |event| *event == CollectedAgentEvent::Status(AgentStatus::Idle)
        )),
        "a screen snapshot overrode newer output from the same batch: {:?}",
        *sink.agent_events.lock().unwrap()
    );

    manager.shutdown();
}

#[test]
fn stale_screen_watermark_cannot_complete_newer_working_output() {
    let io = OutputChannelState::new();
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(OutputChannelBackend(io.clone())), sink.clone());
    manager
        .spawn_pane(
            "pane-screen-watermark",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .expect("spawn Agent pane");

    observe_latest_screen(
        &manager,
        "pane-screen-watermark",
        "* Working (2s * esc to interrupt)".into(),
    )
    .unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .any(
            |event| *event == CollectedAgentEvent::Status(AgentStatus::Working)
        )));

    let output_before = sink.output_chars.load(Ordering::SeqCst);
    io.sender
        .send(b"newer ordinary output\r\n".to_vec())
        .unwrap();
    assert!(wait_for(1_000, || sink.output_chars.load(Ordering::SeqCst)
        > output_before));

    let generation = manager.replay("pane-screen-watermark", 0).generation;
    manager
        .observe_screen("pane-screen-watermark", ">>".into(), generation, 0)
        .unwrap();
    std::thread::sleep(Duration::from_millis(550));
    manager
        .observe_screen("pane-screen-watermark", ">>".into(), generation, 0)
        .unwrap();
    assert!(
        !wait_for(1_000, || sink.agent_events.lock().unwrap().iter().any(
            |event| *event == CollectedAgentEvent::Status(AgentStatus::Idle)
        )),
        "a stale rendered screen completed newer work: {:?}",
        *sink.agent_events.lock().unwrap()
    );

    manager.shutdown();
}

#[test]
fn agent_status_detection_is_serialized_before_newer_working_status() {
    let reader = Arc::new(GatedReaderState::default());
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(
        Arc::new(GatedBackend(Mutex::new(VecDeque::from([reader.clone()])))),
        sink.clone(),
    );
    manager
        .spawn_pane(
            "pane-detected-agent",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .unwrap();

    manager
        .write_input("pane-detected-agent", "codex\r")
        .unwrap();
    observe_latest_screen(
        &manager,
        "pane-detected-agent",
        ">> Continue\n* Working (1s * esc to interrupt)".into(),
    )
    .unwrap();
    assert!(wait_for(1_000, || sink.agent_events.lock().unwrap().len() >= 2));
    assert_eq!(
        *sink.agent_events.lock().unwrap(),
        vec![
            CollectedAgentEvent::Detected(AgentKind::Codex),
            CollectedAgentEvent::Status(AgentStatus::Working),
        ]
    );

    manager.shutdown();
    BlockingIoState::set(&reader.release_reader);
}

#[test]
fn agent_status_process_exit_emits_done_once() {
    let io = Arc::new(BlockingIoState::default());
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(BlockingBackend(io.clone())), sink.clone());
    manager
        .spawn_pane(
            "pane-agent-exit",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .unwrap();
    observe_latest_screen(
        &manager,
        "pane-agent-exit",
        ">> Continue\n* Working (1s * esc to interrupt)".into(),
    )
    .unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .contains(&CollectedAgentEvent::Status(AgentStatus::Working))));

    io.report_exit.store(true, Ordering::SeqCst);
    assert!(wait_for(2_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Done))
        .count()
        == 1));
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(
        sink.agent_events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| **event == CollectedAgentEvent::Status(AgentStatus::Done))
            .count(),
        1
    );
    manager.shutdown();
}

#[test]
fn final_output_is_emitted_before_process_exit() {
    let sink = Arc::new(OrderedSink {
        events: Mutex::new(Vec::new()),
    });
    let manager = PtyManager::new(
        Arc::new(ImmediateExitBackend {
            data: b"FINAL-TAIL".to_vec(),
            delay: Duration::from_millis(200),
            exit_code: 7,
        }),
        sink.clone(),
    );
    manager
        .spawn_pane(
            "pane-delayed-tail",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn delayed-tail PTY");

    assert!(wait_for(2_000, || sink.events.lock().unwrap().len() >= 2));
    assert_eq!(*sink.events.lock().unwrap(), vec!["output", "exit"]);
    manager.shutdown();
}

#[test]
fn reader_eof_waits_for_the_real_process_exit_code() {
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(
        Arc::new(DelayedStatusBackend {
            polls: Arc::new(AtomicU64::new(0)),
        }),
        sink.clone(),
    );
    manager
        .spawn_pane(
            "pane-delayed-status",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn delayed-status PTY");

    assert!(
        wait_for(2_000, || sink.exits.lock().unwrap().iter().any(
            |(pane_id, code)| pane_id == "pane-delayed-status" && *code == Some(23)
        )),
        "reader EOF published before the watcher observed the real exit code: {:?}",
        *sink.exits.lock().unwrap()
    );
    manager.shutdown();
}

#[test]
fn stale_reader_eof_cannot_remove_a_restarted_pane() {
    let first = Arc::new(GatedReaderState::default());
    let second = Arc::new(GatedReaderState::default());
    let backend = Arc::new(GatedBackend(Mutex::new(VecDeque::from([
        first.clone(),
        second.clone(),
    ]))));
    let manager = PtyManager::new(backend, Arc::new(CollectSink::new()));

    manager
        .spawn_pane(
            "pane-reused",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn first generation");
    manager.unregister("pane-reused");
    assert!(wait_for(1_000, || first.killed.load(Ordering::SeqCst)));
    manager
        .spawn_pane(
            "pane-reused",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn second generation");

    BlockingIoState::set(&first.release_reader);
    assert!(wait_for(1_000, || first
        .reader_returned
        .load(Ordering::SeqCst)));
    std::thread::sleep(Duration::from_millis(100));
    let second_generation_alive = manager.is_alive("pane-reused");

    manager.shutdown();
    BlockingIoState::set(&second.release_reader);
    assert!(
        second_generation_alive,
        "a delayed EOF from the old reader removed the replacement process"
    );
}

#[test]
fn stale_rendered_screen_from_an_old_generation_is_ignored() {
    let first = Arc::new(GatedReaderState::default());
    let second = Arc::new(GatedReaderState::default());
    let backend = Arc::new(GatedBackend(Mutex::new(VecDeque::from([
        first.clone(),
        second.clone(),
    ]))));
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(backend, sink.clone());

    manager
        .spawn_pane(
            "pane-screen-generation",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .expect("spawn first generation");
    let old_generation = manager.replay("pane-screen-generation", 0).generation;
    manager.unregister("pane-screen-generation");
    assert!(wait_for(1_000, || first.killed.load(Ordering::SeqCst)));

    manager
        .spawn_pane(
            "pane-screen-generation",
            "session-1",
            "project-1",
            &cmd_spec(),
            Some(AgentKind::Codex),
            None,
        )
        .expect("spawn replacement generation");
    let new_generation = manager.replay("pane-screen-generation", 0).generation;
    assert_ne!(old_generation, new_generation);
    assert!(manager
        .replay_generation("pane-screen-generation", 0, old_generation)
        .is_err());
    assert_eq!(
        manager
            .replay_generation("pane-screen-generation", 0, new_generation)
            .unwrap()
            .generation,
        new_generation
    );

    manager
        .observe_screen(
            "pane-screen-generation",
            "* Working (1s * esc to interrupt)".into(),
            old_generation,
            0,
        )
        .unwrap();
    std::thread::sleep(Duration::from_millis(100));
    assert!(!sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .any(|event| *event == CollectedAgentEvent::Status(AgentStatus::Working)));

    manager
        .observe_screen(
            "pane-screen-generation",
            "* Working (1s * esc to interrupt)".into(),
            new_generation,
            0,
        )
        .unwrap();
    assert!(wait_for(1_000, || sink
        .agent_events
        .lock()
        .unwrap()
        .iter()
        .any(
            |event| *event == CollectedAgentEvent::Status(AgentStatus::Working)
        )));

    manager.shutdown();
    BlockingIoState::set(&first.release_reader);
    BlockingIoState::set(&second.release_reader);
}

#[test]
fn side_effect_panic_does_not_suppress_terminal_output() {
    let sink = Arc::new(PanicsTitleSink {
        output_calls: AtomicU64::new(0),
    });
    let manager = PtyManager::new(
        Arc::new(ImmediateExitBackend {
            data: b"\x1b]0;PANIC-TITLE\x07VISIBLE-OUTPUT".to_vec(),
            delay: Duration::from_millis(50),
            exit_code: 0,
        }),
        sink.clone(),
    );
    manager
        .spawn_pane(
            "pane-title-panic",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn title-panic PTY");

    assert!(
        wait_for(1_000, || sink.output_calls.load(Ordering::SeqCst) >= 1),
        "a panicking title callback swallowed the terminal output batch"
    );
    manager.shutdown();
}

#[test]
fn aggregator_survives_a_panicking_event_sink() {
    let sink = Arc::new(PanicsOnceSink {
        output_calls: AtomicU64::new(0),
        panic_next: AtomicBool::new(true),
        exited: AtomicBool::new(false),
    });
    let manager = PtyManager::new(Arc::new(PortablePtyBackend::default()), sink.clone());
    manager
        .spawn_pane(
            "pane-panicking-sink",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn cmd");

    assert!(wait_for(5_000, || sink.output_calls.load(Ordering::SeqCst) >= 1));
    manager
        .write_input("pane-panicking-sink", "echo AFTER-SINK-PANIC\r")
        .unwrap();
    assert!(
        wait_for(5_000, || sink.output_calls.load(Ordering::SeqCst) >= 2),
        "the shared PTY aggregator stopped after one sink callback panicked"
    );

    manager.kill("pane-panicking-sink").unwrap();
    manager.shutdown();
}

#[test]
fn eof_cleanup_survives_a_panicking_output_sink() {
    let sink = Arc::new(PanicsOnceSink {
        output_calls: AtomicU64::new(0),
        panic_next: AtomicBool::new(false),
        exited: AtomicBool::new(false),
    });
    let manager = PtyManager::new(Arc::new(PortablePtyBackend::default()), sink.clone());
    manager
        .spawn_pane(
            "pane-panicking-eof",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn one-shot cmd");

    assert!(wait_for(5_000, || sink.output_calls.load(Ordering::SeqCst) >= 1));
    sink.panic_next.store(true, Ordering::SeqCst);
    manager
        .write_input("pane-panicking-eof", "echo OUTPUT-BEFORE-EXIT & exit\r")
        .unwrap();
    assert!(wait_for(5_000, || sink.output_calls.load(Ordering::SeqCst) >= 2));
    assert!(
        wait_for(5_000, || sink.exited.load(Ordering::SeqCst)),
        "EOF and exit were discarded with the panicking output batch"
    );
    assert!(!manager.is_alive("pane-panicking-eof"));
    manager.shutdown();
}

#[test]
fn shell_exit_emits_exit_and_removes_the_process() {
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(PortablePtyBackend::default()), sink.clone());
    manager
        .spawn_pane(
            "pane-normal-exit",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn cmd");
    manager.write_input("pane-normal-exit", "exit\r").unwrap();

    assert!(
        wait_for(5_000, || sink
            .exits
            .lock()
            .unwrap()
            .iter()
            .any(|(pane_id, _)| pane_id == "pane-normal-exit")),
        "normal shell exit did not emit a PTY exit event; output: {:?}",
        sink.all_text()
    );
    assert!(!manager.is_alive("pane-normal-exit"));
    manager.shutdown();
}

#[test]
fn shutdown_does_not_wait_for_a_blocked_pty_write() {
    let state = Arc::new(BlockingIoState::default());
    let manager = Arc::new(PtyManager::new(
        Arc::new(BlockingBackend(state.clone())),
        Arc::new(CollectSink::new()),
    ));
    manager
        .spawn_pane(
            "pane-blocked-write",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn test PTY");

    let writer_manager = manager.clone();
    let writer =
        std::thread::spawn(move || writer_manager.write_input("pane-blocked-write", "large paste"));
    BlockingIoState::wait(&state.write_started);

    let shutdown_manager = manager.clone();
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    std::thread::spawn(move || {
        shutdown_manager.shutdown();
        let _ = shutdown_tx.send(());
    });

    let returned_without_waiting = shutdown_rx.recv_timeout(Duration::from_millis(250)).is_ok();
    let killed_while_write_blocked = wait_for(500, || state.killed.load(Ordering::SeqCst));
    let transport_closed_while_write_blocked =
        wait_for(500, || state.transport_closed.load(Ordering::SeqCst));
    if !returned_without_waiting {
        assert!(shutdown_rx.recv_timeout(Duration::from_secs(2)).is_ok());
    }
    BlockingIoState::set(&state.release_write);
    writer.join().expect("writer thread panicked").unwrap();
    assert!(wait_for(2_000, || state.killed.load(Ordering::SeqCst)));
    assert!(
        returned_without_waiting,
        "shutdown blocked behind an in-progress PTY write"
    );
    assert!(
        killed_while_write_blocked,
        "PTY termination waited for a permanently blocked writer lock"
    );
    assert!(
        transport_closed_while_write_blocked,
        "PTY transport close waited for a permanently blocked writer"
    );
}

#[test]
fn shutdown_does_not_wait_for_a_blocked_resume_injection() {
    let state = Arc::new(BlockingIoState::default());
    let manager = Arc::new(PtyManager::new(
        Arc::new(BlockingBackend(state.clone())),
        Arc::new(CollectSink::new()),
    ));
    manager
        .spawn_pane(
            "pane-blocked-resume",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            Some("resume-command".into()),
        )
        .expect("spawn test PTY");

    assert!(
        wait_for(2_000, || *state.write_started.0.lock().unwrap()),
        "resume injection did not reach the test PTY"
    );
    let shutdown_manager = manager.clone();
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    std::thread::spawn(move || {
        shutdown_manager.shutdown();
        let _ = shutdown_tx.send(());
    });

    let returned_without_waiting = shutdown_rx.recv_timeout(Duration::from_millis(250)).is_ok();
    let killed_while_write_blocked = wait_for(500, || state.killed.load(Ordering::SeqCst));
    let transport_closed_while_write_blocked =
        wait_for(500, || state.transport_closed.load(Ordering::SeqCst));
    if !returned_without_waiting {
        assert!(shutdown_rx.recv_timeout(Duration::from_secs(2)).is_ok());
    }
    BlockingIoState::set(&state.release_write);
    assert!(wait_for(2_000, || state.killed.load(Ordering::SeqCst)));
    assert!(
        returned_without_waiting,
        "shutdown blocked behind the aggregator's resume injection"
    );
    assert!(
        killed_while_write_blocked,
        "PTY termination waited for a permanently blocked resume write"
    );
    assert!(
        transport_closed_while_write_blocked,
        "PTY transport close waited for a permanently blocked resume write"
    );
}

#[test]
fn process_exit_closes_transport_while_a_write_remains_blocked() {
    let state = Arc::new(BlockingIoState::default());
    let sink = Arc::new(CollectSink::new());
    let manager = Arc::new(PtyManager::new(
        Arc::new(BlockingBackend(state.clone())),
        sink.clone(),
    ));
    manager
        .spawn_pane(
            "pane-blocked-exit",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn test PTY");

    let writer_manager = manager.clone();
    let writer = std::thread::spawn(move || {
        writer_manager.write_input("pane-blocked-exit", "permanently blocked paste")
    });
    BlockingIoState::wait(&state.write_started);
    state.report_exit.store(true, Ordering::SeqCst);

    let exited_while_write_blocked = wait_for(1_500, || {
        sink.exits
            .lock()
            .unwrap()
            .iter()
            .any(|(pane_id, code)| pane_id == "pane-blocked-exit" && *code == Some(9))
    });
    let transport_closed = state.transport_closed.load(Ordering::SeqCst);
    let write_was_still_blocked = !*state.release_write.0.lock().unwrap();

    // Cleanup happens only after observing convergence; it is not what allows
    // ReaderEof or the UI exit event to complete.
    BlockingIoState::set(&state.release_write);
    BlockingIoState::set(&state.release_reader);
    writer.join().expect("writer thread panicked").unwrap();
    manager.shutdown();

    assert!(
        transport_closed,
        "process exit did not independently close the PTY transport"
    );
    assert!(
        write_was_still_blocked,
        "the test write unexpectedly completed"
    );
    assert!(
        exited_while_write_blocked,
        "ReaderEof and UI exit waited for the blocked writer's process Arc"
    );
}

#[test]
fn sink_callback_can_reenter_manager_without_deadlock() {
    let (callback_tx, callback_rx) = mpsc::channel();
    let sink = Arc::new(ReentrantSink {
        manager: Mutex::new(None),
        callback_done: callback_tx,
    });
    let manager = Arc::new(PtyManager::new(
        Arc::new(PortablePtyBackend::default()),
        sink.clone(),
    ));
    *sink.manager.lock().unwrap() = Some(Arc::downgrade(&manager));
    manager
        .spawn_pane(
            "pane-reentrant",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn cmd");
    manager
        .write_input("pane-reentrant", "title GALAXY-REENTRANT\r")
        .unwrap();

    assert!(
        callback_rx.recv_timeout(Duration::from_secs(3)).is_ok(),
        "OSC title callback was not observed after re-entering pane state"
    );
    manager.kill("pane-reentrant").unwrap();
    manager.shutdown();
}

#[test]
fn conpty_spawns_and_streams_batched_output() {
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(PortablePtyBackend::default()), sink.clone());
    manager.set_triggers(vec![]);

    manager
        .spawn_pane("pane-1", "session-1", "project-1", &cmd_spec(), None, None)
        .expect("spawn cmd");

    assert!(wait_for(5_000, || manager.is_alive("pane-1")), "pty alive");

    // Input is direct/unbatched; echo marker round-trips through ConPTY.
    manager.write_input("pane-1", "echo GALAXY-MARK\r").unwrap();
    assert!(
        wait_for(5_000, || sink.all_text().contains("GALAXY-MARK")),
        "echo output observed, got: {}",
        sink.all_text().chars().take(400).collect::<String>()
    );

    // Seq numbers are monotonically increasing per pane (§3.2).
    let seqs: Vec<u64> = sink
        .batches
        .lock()
        .unwrap()
        .iter()
        .flat_map(|b| b.chunks.iter().map(|c| c.seq))
        .collect();
    let mut sorted = seqs.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(seqs.len(), sorted.len(), "seq unique per pane");
    assert!(
        seqs.windows(2).all(|w| w[0] < w[1]),
        "seq strictly increasing"
    );

    // Ring replay returns in-order history.
    let replay = manager.replay("pane-1", 0);
    assert!(!replay.chunks.is_empty());

    // Resize shouldn't kill the process.
    manager.resize("pane-1", 80, 24).unwrap();
    manager
        .write_input("pane-1", "echo AFTER-RESIZE\r")
        .unwrap();
    assert!(wait_for(5_000, || sink.all_text().contains("AFTER-RESIZE")));

    manager.kill("pane-1").unwrap();
    manager.shutdown();
}

#[test]
fn conpty_high_throughput_does_not_drop_chunks() {
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(PortablePtyBackend::default()), sink.clone());
    manager.set_triggers(vec![]);
    manager
        .spawn_pane("pane-ht", "session-1", "project-1", &cmd_spec(), None, None)
        .expect("spawn");

    // Produce ~200 lines of deterministic output.
    manager
        .write_input("pane-ht", "for /L %i in (1,1,200) do @echo LINE-%i\r")
        .unwrap();
    assert!(
        wait_for(10_000, || sink.all_text().contains("LINE-200")),
        "all lines received within 10s"
    );

    // Replay the whole history via the ring: counts must match the received
    // set for the buffered region (loss checks happen via seq continuity).
    let replay = manager.replay("pane-ht", 0);
    let replayed_text: String = replay.chunks.iter().map(|c| c.data.as_str()).collect();
    assert!(replayed_text.contains("LINE-200"));

    // Input latency: interactive echo works right after the storm.
    manager
        .write_input("pane-ht", "echo STILL-RESPONSIVE\r")
        .unwrap();
    assert!(wait_for(5_000, || sink
        .all_text()
        .contains("STILL-RESPONSIVE")));

    manager.kill("pane-ht").unwrap();
    manager.shutdown();
}

#[test]
fn powershell_and_profile_env_work() {
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let ps = format!("{sysroot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    if !std::path::Path::new(&ps).exists() {
        return; // environment guard
    }
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(PortablePtyBackend::default()), sink.clone());
    manager.set_triggers(vec![]);
    let mut env = std::collections::BTreeMap::new();
    env.insert("GALAXY_TEST".to_string(), "42".to_string());
    manager
        .spawn_pane(
            "pane-ps",
            "session-1",
            "project-1",
            &PtySpec {
                program: ps,
                args: vec!["-NoProfile".into(), "-NoLogo".into()],
                env,
                cwd: sysroot.clone(),
                cols: 100,
                rows: 30,
            },
            None,
            None,
        )
        .expect("spawn powershell");
    manager
        .write_input("pane-ps", "echo \"PS-$env:GALAXY_TEST-MARK\"\r")
        .unwrap();
    assert!(
        wait_for(8_000, || sink.all_text().contains("PS-42-MARK")),
        "powershell env + io, got {}",
        sink.all_text().chars().take(400).collect::<String>()
    );
    manager.kill("pane-ps").unwrap();
    manager.shutdown();
}

#[test]
fn resume_injection_writes_command_after_ready() {
    let sink = Arc::new(CollectSink::new());
    let manager = PtyManager::new(Arc::new(PortablePtyBackend::default()), sink.clone());
    manager.set_triggers(vec![]);
    // The injected command doesn't exist but must visibly arrive as input.
    let injected_marker = "echo INJECTED-RESUME";
    manager
        .spawn_pane(
            "pane-inj",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            Some(injected_marker.to_string()),
        )
        .expect("spawn");
    assert!(
        wait_for(6_000, || sink.all_text().contains("INJECTED-RESUME")),
        "resume command injected: {}",
        sink.all_text().chars().take(500).collect::<String>()
    );
    manager.kill("pane-inj").unwrap();
    manager.shutdown();
}

#[test]
fn trigger_engine_fires_with_cooldown() {
    use galaxy_terminal_lib::core::trigger::{Trigger, TriggerAction};
    let fired = Arc::new(AtomicBool::new(false));
    struct FireSink {
        fired: Arc<AtomicBool>,
    }
    impl PtyEventSink for FireSink {
        fn output(&self, _b: &OutputBatch) {}
        fn exit(&self, _p: &str, _c: Option<i32>) {}
        fn title(&self, _p: &str, _s: &str, _t: &str) {}
        fn block_completed(&self, _b: &CommandBlock) {}
        fn agent_status(&self, _p: &str, _s: &str, _k: AgentKind, _st: AgentStatus) {}
        fn trigger_fired(&self, f: &TriggerFire) {
            assert!(f.snippet.contains("ERROR"));
            self.fired.store(true, Ordering::SeqCst);
        }
        fn pty_error(&self, _p: &str, _m: &str) {}
    }
    let manager = PtyManager::new(
        Arc::new(PortablePtyBackend::default()),
        Arc::new(FireSink {
            fired: fired.clone(),
        }),
    );
    let mut trigger = Trigger {
        name: "err".into(),
        pattern: "ERROR".into(),
        actions: vec![TriggerAction::Notify],
        cooldown_ms: 3_000,
        ..Default::default()
    };
    trigger.id = "t-err".into();
    manager.set_triggers(vec![trigger]);
    manager
        .spawn_pane(
            "pane-trg",
            "session-1",
            "project-1",
            &cmd_spec(),
            None,
            None,
        )
        .expect("spawn");
    manager
        .write_input("pane-trg", "echo ERROR happened\r")
        .unwrap();
    assert!(wait_for(6_000, || fired.load(Ordering::SeqCst)));
    manager.kill("pane-trg").unwrap();
    manager.shutdown();
}
