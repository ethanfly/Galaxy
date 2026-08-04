//! Central application state. The Rust backend is the single source of truth
//! for persisted state; AppState also translates PTY pipeline events into
//! Tauri events, persistence and notifications via `PtyEventSink`.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use parking_lot::RwLock;
use tauri::{AppHandle, Emitter, Manager};

use crate::core::models::{
    new_id, now_rfc3339, AgentKind, AgentStatus, CommandBlock, NotificationItem, ShellProfile,
    Store,
};
use crate::core::trigger::TriggerAction;
use crate::error::AppError;
use crate::pty::manager::{OutputBatch, PtyEventSink, TriggerFire};
use crate::pty::{PortablePtyBackend, PtyManager};
use crate::services::agents::AgentRegistry;
use crate::services::blocks::BlockStore;
use crate::services::git::GitService;
use crate::services::logging;
use crate::services::paths::DataPaths;
use crate::services::persistence::{write_run_state, Persistence};

pub mod events {
    pub const PTY_OUTPUT: &str = "pty://output";
    pub const PTY_EXIT: &str = "pty://exit";
    pub const PTY_ERROR: &str = "pty://error";
    pub const SESSION_TITLE: &str = "session://title";
    pub const BLOCKS_UPDATED: &str = "blocks://updated";
    pub const AGENT_STATUS: &str = "agent://status";
    pub const TRIGGER_FIRE: &str = "trigger://fire";
    pub const NOTIFICATION_NEW: &str = "notification://new";
    pub const GIT_CHANGED: &str = "git://changed";
    pub const OPEN_HERE: &str = "system://open-here";
    pub const RECOVERY_AVAILABLE: &str = "system://recovery";
    pub const STORE_CHANGED: &str = "store://changed";
    pub const AGENT_SCAN_DONE: &str = "agent://scan-done";
    pub const LAYOUT_CHANGED: &str = "layout://changed";
}

static NOTIFICATIONS: parking_lot::Mutex<Vec<NotificationItem>> =
    parking_lot::Mutex::new(Vec::new());

pub struct AppState {
    pub app: AppHandle,
    pub store: RwLock<Store>,
    pub persistence: Persistence,
    pty_cell: OnceLock<Arc<PtyManager>>,
    pub blocks: BlockStore,
    pub git: GitService,
    pub agents: AgentRegistry,
    pub profiles: RwLock<Vec<ShellProfile>>,
    /// pane_id → last inferred agent status.
    pub agent_status: RwLock<std::collections::HashMap<String, AgentStatus>>,
    /// Cancellation token of the in-flight agent scan (§5.4).
    pub scan_token: parking_lot::Mutex<Option<Arc<AtomicBool>>>,
    /// --open-here invocations waiting for the UI to drain.
    pub pending_open_here: parking_lot::Mutex<Vec<String>>,
    pub last_debounced_persist: parking_lot::Mutex<std::time::Instant>,
    pub recovered_from_crash: AtomicBool,
    pub read_only: AtomicBool,
}

impl AppState {
    pub fn pty(&self) -> &PtyManager {
        self.pty_cell.get().expect("pty manager initialized")
    }

    pub fn data_paths(&self) -> &DataPaths {
        self.persistence.paths()
    }

    /// Persist store.json. Failure flips the app into read-only warning mode
    /// (spec §8) instead of crashing.
    pub fn persist(&self) -> Result<(), AppError> {
        let store = self.store.read().clone();
        match self.persistence.save(&store) {
            Ok(()) => {
                self.read_only.store(false, Ordering::SeqCst);
                Ok(())
            }
            Err(e) => {
                self.read_only.store(true, Ordering::SeqCst);
                tracing::error!(
                    "持久化失败，进入只读警告状态: {}",
                    logging::redact(&e.to_string())
                );
                Err(e)
            }
        }
    }

    /// For high-frequency, low-risk updates (OSC titles, window state).
    pub fn persist_debounced(&self) {
        let mut last = self.last_debounced_persist.lock();
        if last.elapsed() >= std::time::Duration::from_millis(400) {
            *last = std::time::Instant::now();
            let _ = self.persist();
        }
    }

    /// Debounced window geometry persistence (§5.7).
    pub fn save_window_state_debounced(&self, window_state: crate::core::config::WindowState) {
        self.store.write().config.window_state = window_state;
        self.persist_debounced();
    }

    pub fn add_notification(
        &self,
        title: &str,
        body: &str,
        pane_id: Option<&str>,
        project_id: Option<&str>,
        system: bool,
    ) -> NotificationItem {
        let item = NotificationItem {
            id: new_id(),
            at: now_rfc3339(),
            title: title.to_string(),
            body: body.to_string(),
            read: false,
            project_id: project_id.map(String::from),
            pane_id: pane_id.map(String::from),
        };
        {
            let mut guard = NOTIFICATIONS.lock();
            guard.insert(0, item.clone());
            guard.truncate(200);
        }
        let _ = self.app.emit(events::NOTIFICATION_NEW, &item);
        if system {
            use tauri_plugin_notification::NotificationExt;
            let _ = self
                .app
                .notification()
                .builder()
                .title(title)
                .body(body)
                .show();
        }
        item
    }

    pub fn notifications(&self) -> Vec<NotificationItem> {
        NOTIFICATIONS.lock().clone()
    }

    pub fn mark_notifications_read(&self, ids: Option<Vec<String>>) {
        let mut guard = NOTIFICATIONS.lock();
        match ids {
            Some(ids) => {
                for n in guard.iter_mut() {
                    if ids.contains(&n.id) {
                        n.read = true;
                    }
                }
            }
            None => guard.iter_mut().for_each(|n| n.read = true),
        }
    }

    pub fn emit_open_here(&self, path: &str) {
        let _ = self
            .app
            .emit(events::OPEN_HERE, serde_json::json!({ "path": path }));
    }

    pub fn queue_open_here(&self, path: &str) {
        self.pending_open_here.lock().push(path.to_string());
    }

    pub fn drain_open_here(&self) -> Vec<String> {
        std::mem::take(&mut *self.pending_open_here.lock())
    }

    pub fn refresh_triggers(&self) {
        let triggers = self.store.read().config.triggers.clone();
        self.pty().set_triggers(triggers);
    }
}

// ------------------------------------------------------------------ sink

struct Sink {
    state: Arc<AppState>,
}

impl PtyEventSink for Sink {
    fn output(&self, batch: &OutputBatch) {
        let _ = self.state.app.emit(events::PTY_OUTPUT, batch);
    }

    fn exit(&self, pane_id: &str, code: Option<i32>) {
        self.state.pty().mark_exit(pane_id, code);
        {
            let mut store = self.state.store.write();
            for s in store.sessions.iter_mut() {
                if let Some(pane) = s.layout.find_pane_mut(pane_id) {
                    pane.exit_code = code;
                    break;
                }
            }
        }
        let _ = self.state.persist_debounced();
        let _ = self.state.app.emit(
            events::PTY_EXIT,
            serde_json::json!({ "paneId": pane_id, "exitCode": code }),
        );
    }

    fn title(&self, pane_id: &str, session_id: &str, title: &str) {
        {
            let mut store = self.state.store.write();
            for s in store.sessions.iter_mut() {
                if let Some(pane) = s.layout.find_pane_mut(pane_id) {
                    pane.title = title.to_string();
                    break;
                }
            }
        }
        self.state.persist_debounced();
        let _ = self.state.app.emit(
            events::SESSION_TITLE,
            serde_json::json!({ "paneId": pane_id, "sessionId": session_id, "title": title }),
        );
    }

    fn block_completed(&self, block: &CommandBlock) {
        if let Err(e) = self.state.blocks.append(block.clone()) {
            tracing::warn!("命令块写入失败: {}", logging::redact(&e.to_string()));
        }
        let _ = self.state.app.emit(
            events::BLOCKS_UPDATED,
            serde_json::json!({ "sessionId": block.session_id }),
        );
    }

    fn agent_status(&self, pane_id: &str, session_id: &str, kind: AgentKind, status: AgentStatus) {
        let prev = self
            .state
            .agent_status
            .read()
            .get(pane_id)
            .copied()
            .unwrap_or(AgentStatus::Idle);
        self.state
            .agent_status
            .write()
            .insert(pane_id.to_string(), status);
        // Agent badge detection also flows through here: keep the pane meta.
        // IMPORTANT: never call persist* while holding store.write() — persist
        // takes store.read() and parking_lot RwLock will deadlock (app freeze
        // after launching an agent command).
        let mut kind_changed = false;
        {
            let mut store = self.state.store.write();
            for s in store.sessions.iter_mut() {
                if let Some(pane) = s.layout.find_pane_mut(pane_id) {
                    if pane.agent_kind != Some(kind) {
                        pane.agent_kind = Some(kind);
                        kind_changed = true;
                    }
                    break;
                }
            }
        }
        if kind_changed {
            self.state.persist_debounced();
        }
        let _ = self.state.app.emit(
            events::AGENT_STATUS,
            serde_json::json!({
                "paneId": pane_id,
                "sessionId": session_id,
                "agentKind": kind,
                "status": status,
            }),
        );
        // Notify on working → idle/done or → blocked transitions (§5.4).
        let notify_enabled = self.state.store.read().config.agent_notifications;
        if notify_enabled {
            let (title, body) = match (prev, status) {
                (AgentStatus::Working, AgentStatus::Idle)
                | (AgentStatus::Working, AgentStatus::Done) => (
                    format!("{} 已完成", kind.label()),
                    "Agent 任务结束，可以查看结果".to_string(),
                ),
                (_, AgentStatus::Blocked) => (
                    format!("{} 等待确认", kind.label()),
                    "Agent 需要授权或输入后才能继续".to_string(),
                ),
                _ => (String::new(), String::new()),
            };
            if !title.is_empty() {
                let project_id = self
                    .state
                    .store
                    .read()
                    .sessions
                    .iter()
                    .find(|s| s.id == session_id)
                    .map(|s| s.project_id.clone());
                self.state.add_notification(
                    &title,
                    &body,
                    Some(pane_id),
                    project_id.as_deref(),
                    true,
                );
            }
        }
    }

    fn trigger_fired(&self, fire: &TriggerFire) {
        let _ = self.state.app.emit(events::TRIGGER_FIRE, fire);
        let cfg_enabled = self.state.store.read().config.trigger_notifications;
        if fire.actions.contains(&TriggerAction::Notify) && cfg_enabled {
            self.state.add_notification(
                &format!("触发器: {}", fire.trigger_name),
                &fire.snippet,
                Some(&fire.pane_id),
                Some(&fire.project_id),
                true,
            );
        }
    }

    fn pty_error(&self, pane_id: &str, message: &str) {
        let _ = self.state.app.emit(
            events::PTY_ERROR,
            serde_json::json!({ "paneId": pane_id, "message": logging::redact(message) }),
        );
    }
}

// ------------------------------------------------------------------ boot

pub struct BuiltState {
    pub state: Arc<AppState>,
    pub had_crash: bool,
}

fn init_tracing(log_dir: &Path) {
    let log_dir = log_dir.to_path_buf();
    let make_writer = move || -> logging::BoxedWriter {
        match logging::RollingLog::new(&log_dir) {
            Ok(rl) => rl.writer(),
            Err(_) => Box::new(std::io::sink()),
        }
    };
    let _ = tracing_subscriber::fmt()
        .with_writer(make_writer)
        .with_ansi(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .try_init();
}

/// Boot the full state from disk.
pub fn build_state(app: AppHandle) -> Result<BuiltState, AppError> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Persistence(format!("无法确定数据目录: {e}")))?;
    let paths = DataPaths::under(data_dir);
    paths.ensure_dirs()?;
    init_tracing(&paths.logs);

    // Crash detection: previous run didn't shut down cleanly.
    let had_crash = match crate::services::persistence::read_run_state(&paths.run_state) {
        Some(rs) => !rs.clean_shutdown,
        None => false,
    };
    if let Err(error) = write_run_state(&paths.run_state, false) {
        tracing::error!("写入启动状态失败: {}", logging::redact(&error.to_string()));
    }

    let persistence = Persistence::new(paths.clone())?;
    let (mut store, recovered) = persistence.load().unwrap_or_else(|e| {
        tracing::error!(
            "存储初始化失败，使用安全默认值: {}",
            logging::redact(&e.to_string())
        );
        (Store::default(), true)
    });
    for s in store.sessions.iter_mut() {
        s.layout.normalize();
    }
    if recovered {
        tracing::warn!("存储处于降级模式（备份/默认值）");
    }

    let blocks = BlockStore::load(&paths.blocks).map_err(|e| {
        AppError::Persistence(format!(
            "命令块存储初始化失败: {}",
            logging::redact(&e.to_string())
        ))
    })?;

    let git = GitService::new();
    let agents = AgentRegistry::new();

    let mut profiles = crate::services::shell_detect::detect_profiles();
    for cp in &store.config.custom_profiles {
        if profiles.iter().all(|p| p.id != cp.id) {
            profiles.push(cp.clone());
        }
    }

    let state = Arc::new(AppState {
        app: app.clone(),
        store: RwLock::new(store),
        persistence,
        pty_cell: OnceLock::new(),
        blocks,
        git,
        agents,
        profiles: RwLock::new(profiles),
        agent_status: RwLock::new(Default::default()),
        scan_token: parking_lot::Mutex::new(None),
        pending_open_here: parking_lot::Mutex::new(Vec::new()),
        last_debounced_persist: parking_lot::Mutex::new(std::time::Instant::now()),
        recovered_from_crash: AtomicBool::new(had_crash),
        read_only: AtomicBool::new(false),
    });

    let sink: Arc<dyn PtyEventSink> = Arc::new(Sink {
        state: state.clone(),
    });
    let manager = PtyManager::new(Arc::new(PortablePtyBackend::default()), sink);
    let _ = state.pty_cell.set(Arc::new(manager));
    state.refresh_triggers();

    if had_crash {
        let _ = state
            .app
            .emit(events::RECOVERY_AVAILABLE, serde_json::json!({}));
    }

    Ok(BuiltState { state, had_crash })
}

pub fn shutdown(state: &AppState) {
    // PTY shutdown is idempotent; persist + run_state may run twice (close + destroy).
    state.pty().shutdown();
    let _ = state.persist();
    if let Err(error) = write_run_state(&state.data_paths().run_state, true) {
        tracing::error!("写入关闭状态失败: {}", logging::redact(&error.to_string()));
    }
}

/// Path/link validation for opening externals (§3.3).
pub fn validate_external_path(target: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(target.trim_matches('"'));
    if !path.is_absolute() {
        return Err(AppError::InvalidInput("路径必须是绝对路径".into()));
    }
    Ok(path)
}

pub fn validate_external_url(url: &str) -> Result<(), AppError> {
    let lower = url.to_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
    {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("不允许的链接协议: {url}")))
    }
}
