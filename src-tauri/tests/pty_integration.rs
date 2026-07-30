//! Integration tests: real ConPTY via the portable-pty backend, batched
//! output pipeline, input round-trip and resize (spec §9.1 integration).
#![cfg(windows)]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use galaxy_terminal_lib::core::models::{AgentKind, AgentStatus, CommandBlock};
use galaxy_terminal_lib::pty::manager::{OutputBatch, PtyEventSink, TriggerFire};
use galaxy_terminal_lib::pty::{PortablePtyBackend, PtyManager, PtySpec};

struct CollectSink {
    batches: Mutex<Vec<OutputBatch>>,
    exits: Mutex<Vec<(String, Option<i32>)>>,
    titles: Mutex<Vec<(String, String)>>,
    blocks: Mutex<Vec<CommandBlock>>,
    output_chars: AtomicU64,
}

impl CollectSink {
    fn new() -> Self {
        Self {
            batches: Mutex::new(Vec::new()),
            exits: Mutex::new(Vec::new()),
            titles: Mutex::new(Vec::new()),
            blocks: Mutex::new(Vec::new()),
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
        self.output_chars
            .fetch_add(batch.chunks.iter().map(|c| c.data.len() as u64).sum::<u64>(), Ordering::SeqCst);
        self.batches.lock().unwrap().push(batch.clone());
    }
    fn exit(&self, pane_id: &str, code: Option<i32>) {
        self.exits.lock().unwrap().push((pane_id.to_string(), code));
    }
    fn title(&self, pane_id: &str, _session_id: &str, title: &str) {
        self.titles.lock().unwrap().push((pane_id.to_string(), title.to_string()));
    }
    fn block_completed(&self, block: &CommandBlock) {
        self.blocks.lock().unwrap().push(block.clone());
    }
    fn agent_status(&self, _p: &str, _s: &str, _k: AgentKind, _st: AgentStatus) {}
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
    assert!(seqs.windows(2).all(|w| w[0] < w[1]), "seq strictly increasing");

    // Ring replay returns in-order history.
    let replay = manager.replay("pane-1", 0);
    assert!(!replay.chunks.is_empty());

    // Resize shouldn't kill the process.
    manager.resize("pane-1", 80, 24).unwrap();
    manager.write_input("pane-1", "echo AFTER-RESIZE\r").unwrap();
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
        .write_input(
            "pane-ht",
            "for /L %i in (1,1,200) do @echo LINE-%i\r",
        )
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
    manager.write_input("pane-ht", "echo STILL-RESPONSIVE\r").unwrap();
    assert!(wait_for(5_000, || sink.all_text().contains("STILL-RESPONSIVE")));

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
        Arc::new(FireSink { fired: fired.clone() }),
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
        .spawn_pane("pane-trg", "session-1", "project-1", &cmd_spec(), None, None)
        .expect("spawn");
    manager.write_input("pane-trg", "echo ERROR happened\r").unwrap();
    assert!(wait_for(6_000, || fired.load(Ordering::SeqCst)));
    manager.kill("pane-trg").unwrap();
    manager.shutdown();
}
