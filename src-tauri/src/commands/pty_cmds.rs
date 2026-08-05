//! PTY I/O commands. Input/resize/signals are direct — never batched.
use std::sync::Arc;

use tauri::State;

use crate::error::{CmdError, CmdResult, IntoCmd};
use crate::pty::manager::ReplayDto;
use crate::state::AppState;

#[tauri::command]
pub async fn pty_write(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    data: String,
) -> CmdResult<()> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.pty().write_input(&pane_id, &data))
        .await
        .map_err(|e| CmdError::new("INTERNAL", format!("写入任务失败: {e}")))?
        .cmd()
}

/// Synchronized input broadcast: write to every pane of the session (§5.2).
#[tauri::command]
pub async fn pty_broadcast(
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
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        for id in pane_ids {
            let _ = state.pty().write_input(&id, &data);
        }
    })
    .await
    .map_err(|e| CmdError::new("INTERNAL", format!("写入任务失败: {e}")))?;
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
) -> CmdResult<ReplayDto> {
    Ok(state.pty().replay(&pane_id, after_seq))
}

#[tauri::command]
pub async fn pty_observe_screen(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    screen: String,
) -> CmdResult<()> {
    state.pty().observe_screen(&pane_id, screen).cmd()
}

#[tauri::command]
pub async fn pty_kill(state: State<'_, Arc<AppState>>, pane_id: String) -> CmdResult<()> {
    state.pty().kill(&pane_id).cmd()
}
