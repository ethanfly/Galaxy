//! PTY I/O commands. Input/resize/signals are direct — never batched.
use std::sync::Arc;

use tauri::State;

use crate::error::{CmdError, CmdResult, IntoCmd};
use crate::pty::manager::ReplayDto;
use crate::state::AppState;

/// Direct PTY input. Kept synchronous so keystrokes and mouse reports (DOWN
/// then UP) are not reordered by the async runtime's blocking pool.
#[tauri::command]
pub fn pty_write(state: State<'_, Arc<AppState>>, pane_id: String, data: String) -> CmdResult<()> {
    state.pty().write_input(&pane_id, &data).cmd()
}

/// Raw bytes from xterm `onBinary` (DEFAULT mouse encoding). Values are 0–255
/// latin1 code units — must not pass through UTF-8 string re-encoding.
#[tauri::command]
pub fn pty_write_bytes(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    bytes: Vec<u8>,
) -> CmdResult<()> {
    state.pty().write_input_bytes(&pane_id, &bytes, None).cmd()
}

/// Synchronized input broadcast: write to every pane of the session (§5.2).
#[tauri::command]
pub fn pty_broadcast(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    data: String,
) -> CmdResult<()> {
    let pane_ids: Vec<String> = {
        let store = state.store.read();
        let Some(s) = store.sessions.iter().find(|s| s.id == session_id) else {
            return Err(CmdError::new("NOT_FOUND", "会话不存在"));
        };
        s.layout.panes().into_iter().map(|p| p.id.clone()).collect()
    };
    for id in pane_ids {
        let _ = state.pty().write_input(&id, &data);
    }
    Ok(())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> CmdResult<()> {
    // Persist new size in the pane model.
    {
        let mut store = state.store.write();
        for s in store.sessions.iter_mut() {
            if let Some(p) = s.layout.find_pane_mut(&pane_id) {
                p.cols = cols;
                p.rows = rows;
                break;
            }
        }
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.pty().resize(&pane_id, cols, rows))
        .await
        .map_err(|e| CmdError::new("INTERNAL", format!("尺寸调整任务失败: {e}")))?
        .cmd()
}

#[tauri::command]
pub async fn pty_replay(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    after_seq: u64,
    expected_generation: u64,
) -> CmdResult<ReplayDto> {
    state
        .pty()
        .replay_generation(&pane_id, after_seq, expected_generation)
        .cmd()
}

#[tauri::command]
pub async fn pty_observe_screen(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    screen: String,
    rendered_generation: u64,
    rendered_seq: u64,
) -> CmdResult<()> {
    state
        .pty()
        .observe_screen(&pane_id, screen, rendered_generation, rendered_seq)
        .cmd()
}

#[tauri::command]
pub async fn pty_kill(state: State<'_, Arc<AppState>>, pane_id: String) -> CmdResult<()> {
    state.pty().kill(&pane_id).cmd()
}
