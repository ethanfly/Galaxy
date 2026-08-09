//! Productivity features: command blocks, agent adapters, Git, workflows,
//! notifications (spec §5.3–§5.6).
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::State;

use crate::commands::workspace::{normalize_fs_path, spawn_pane_process};
use crate::core::models::{
    new_id, now_rfc3339, AgentConversation, AgentKind, AgentMessage, AgentStatus, CommandBlock,
    GitBranch, GitStatus, ResumeMeta,
};
use crate::core::workflow::{ResolvedWorkflow, Workflow};
use crate::error::{AppError, CmdError, CmdResult, IntoCmd};
use crate::services::agents::AgentAvailability;
use crate::services::blocks::BlockListResult;
use crate::services::insights::{aggregate, InsightsQuery, InsightsRange, InsightsSummary};
use crate::state::AppState;

// ---------------------------------------------------------------- blocks

#[tauri::command]
pub async fn block_list(
    state: State<'_, Arc<AppState>>,
    session_id: Option<String>,
) -> CmdResult<BlockListResult> {
    Ok(state.blocks.list(session_id.as_deref()))
}

#[tauri::command]
pub async fn block_search(
    state: State<'_, Arc<AppState>>,
    query: String,
    favorites_only: Option<bool>,
) -> CmdResult<Vec<CommandBlock>> {
    Ok(state.blocks.search(&query, favorites_only.unwrap_or(false)))
}

#[tauri::command]
pub async fn block_set_favorite(
    state: State<'_, Arc<AppState>>,
    id: String,
    favorite: bool,
) -> CmdResult<Option<CommandBlock>> {
    state.blocks.set_favorite(&id, favorite).cmd()
}

#[tauri::command]
pub async fn block_rerun(
    state: State<'_, Arc<AppState>>,
    id: String,
    pane_id: String,
) -> CmdResult<()> {
    let Some(block) = state.blocks.get(&id) else {
        return Err(CmdError::new("NOT_FOUND", "命令块不存在"));
    };
    if block.command.trim().is_empty() {
        return Err(CmdError::new("INVALID_INPUT", "该命令块没有可重跑的命令"));
    }
    let cmd = format!("{}\r", block.command);
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.pty().write_input(&pane_id, &cmd))
        .await
        .map_err(|e| CmdError::new("INTERNAL", format!("重跑失败: {e}")))?
        .cmd()
}

#[tauri::command]
pub async fn blocks_clear_non_favorites(state: State<'_, Arc<AppState>>) -> CmdResult<usize> {
    state.blocks.clear_non_favorites().cmd()
}

#[tauri::command]
pub async fn insights_summary(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
    range: InsightsRange,
    timezone_offset_minutes: i32,
) -> CmdResult<InsightsSummary> {
    let blocks = state.blocks.list(None).blocks;
    let projects = state.store.read().projects.clone();
    Ok(aggregate(
        &blocks,
        &projects,
        InsightsQuery {
            project_id,
            range,
            timezone_offset_minutes,
        },
        time::OffsetDateTime::now_utc(),
    ))
}

// ---------------------------------------------------------------- agents

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentScanResult {
    pub conversations: Vec<AgentConversation>,
    pub availability: Vec<AgentAvailability>,
}

#[tauri::command]
/// `full` (default true): ignore the incremental watermark and rebuild the
/// project cache so history cannot vanish when the panel re-scans.
pub async fn agent_scan(
    state: State<'_, Arc<AppState>>,
    project_path: String,
    full: Option<bool>,
) -> CmdResult<AgentScanResult> {
    // Cancel any in-flight scan so its watermark/cache commit is skipped.
    if let Some(prev) = state.scan_token.lock().as_ref() {
        prev.store(true, Ordering::SeqCst);
    }
    let state = state.inner().clone();
    let cancel: Arc<std::sync::atomic::AtomicBool> =
        Arc::new(std::sync::atomic::AtomicBool::new(false));
    *state.scan_token.lock() = Some(cancel.clone());
    let state2 = state.clone();
    let path = project_path.clone();
    // Default to full rescan: UI always replaces its list with the command
    // result, so incremental-only responses would hide prior history.
    let full = full.unwrap_or(true);
    let cancel_for_scan = cancel.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // catch_unwind so a single adapter bug cannot take down the whole app
        // when release uses panic=unwind (and never becomes a silent 闪退).
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if full {
                state2.agents.scan_project_full(&path, &cancel_for_scan)
            } else {
                state2.agents.scan_project(&path, &cancel_for_scan)
            }
        })) {
            Ok(r) => r,
            Err(_) => {
                tracing::error!("agent scan panicked; returning empty result");
                (Vec::new(), Vec::new())
            }
        }
    })
    .await
    .map_err(|e| CmdError::new("INTERNAL", format!("扫描任务失败: {e}")))?;
    // Clear the token only if it is still ours. A newer scan may have
    // replaced it while this one was finishing; clearing unconditionally
    // would orphan the new scan's token and make 取消 a no-op.
    {
        let mut guard = state.scan_token.lock();
        if guard
            .as_ref()
            .map(|t| Arc::ptr_eq(t, &cancel))
            .unwrap_or(false)
        {
            *guard = None;
        }
    }
    let _ = tauri::Emitter::emit(
        &state.app,
        crate::state::events::AGENT_SCAN_DONE,
        serde_json::json!({
            "projectPath": project_path,
            "count": result.0.len(),
        }),
    );
    Ok(AgentScanResult {
        conversations: result.0,
        availability: result.1,
    })
}

#[tauri::command]
pub async fn agent_scan_cancel(state: State<'_, Arc<AppState>>) -> CmdResult<()> {
    if let Some(token) = state.scan_token.lock().as_ref() {
        token.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_availability(
    state: State<'_, Arc<AppState>>,
) -> CmdResult<Vec<AgentAvailability>> {
    let state2 = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state2.agents.availability())
        .await
        .map_err(|e| CmdError::new("INTERNAL", format!("可用性检查失败: {e}")))
}

#[tauri::command]
pub async fn agent_messages(
    state: State<'_, Arc<AppState>>,
    conversation: AgentConversation,
    limit: Option<usize>,
) -> CmdResult<Vec<AgentMessage>> {
    let Some(adapter) = state.agents.adapter(conversation.agent_kind) else {
        return Err(CmdError::new("NOT_FOUND", "Agent 适配器不存在"));
    };
    tauri::async_runtime::spawn_blocking(move || {
        adapter.read_messages(&conversation, limit.unwrap_or(200))
    })
    .await
    .map_err(|e| CmdError::new("INTERNAL", format!("读取消息失败: {e}")))
}

/// One-click resume: create a terminal in the conversation's project and
/// inject the adapter-generated resume command once the PTY is ready (§5.4).
#[tauri::command]
pub async fn agent_open_conversation(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    conversation: AgentConversation,
) -> CmdResult<crate::core::models::Session> {
    let Some(adapter) = state.agents.adapter(conversation.agent_kind) else {
        return Err(CmdError::new("NOT_FOUND", "Agent 适配器不存在"));
    };
    let project = {
        let store = state.store.read();
        store
            .projects
            .iter()
            .find(|p| p.id == project_id)
            .cloned()
            .ok_or_else(|| CmdError::new("NOT_FOUND", "项目不存在"))?
    };
    let profile = {
        let profiles = state.profiles.read();
        let cfg = state.store.read().config.clone();
        profiles
            .iter()
            .find(|p| {
                Some(&p.id) == project.default_profile_id.as_ref()
                    || Some(&p.id) == cfg.default_profile_id.as_ref()
            })
            .or_else(|| profiles.first())
            .cloned()
            .ok_or_else(|| CmdError::new("INVALID_INPUT", "未检测到可用 Shell"))?
    };
    let resume_command = adapter.resume_command(&conversation);
    if resume_command.trim().is_empty() {
        return Err(CmdError::new("AGENT", "该会话无法生成恢复命令"));
    }
    let mut pane = crate::core::models::Pane::new(project.path.clone(), profile);
    pane.agent_kind = Some(conversation.agent_kind);
    pane.resume = Some(ResumeMeta {
        agent_kind: conversation.agent_kind,
        external_id: conversation.external_id.clone(),
        resume_command,
        injected: false,
    });
    pane.title = conversation.summary.chars().take(24).collect::<String>();
    let session = crate::core::models::Session {
        id: new_id(),
        project_id: project_id.clone(),
        title: format!("{} · {}", conversation.agent_kind.label(), pane.title),
        sort_order: state
            .store
            .read()
            .sessions
            .iter()
            .map(|s| s.sort_order)
            .max()
            .unwrap_or(-1)
            + 1,
        agent_kind: Some(conversation.agent_kind),
        layout: crate::core::models::LayoutNode::new_pane(pane.clone()),
        sync_input: false,
        created_at: now_rfc3339(),
    };
    state.store.write().sessions.push(session.clone());
    spawn_pane_process(&state, &project_id, &session.id, &pane);
    state.persist().cmd()?;
    Ok(session)
}

#[tauri::command]
pub async fn agent_status_map(
    state: State<'_, Arc<AppState>>,
) -> CmdResult<std::collections::HashMap<String, AgentStatus>> {
    Ok(state.agent_status.read().clone())
}

// ---------------------------------------------------------------- git

#[tauri::command]
pub async fn git_status(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> CmdResult<GitStatus> {
    let path = project_path(&state, &project_id)?;
    let state2 = state.inner().clone();
    let status = tauri::async_runtime::spawn_blocking(move || state2.git.status(&path))
        .await
        .map_err(|e| CmdError::new("INTERNAL", format!("Git 状态任务失败: {e}")))?;
    Ok(status)
}

#[tauri::command]
pub async fn git_branches(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> CmdResult<Vec<GitBranch>> {
    let path = project_path(&state, &project_id)?;
    let state2 = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state2.git.branches(&path))
        .await
        .map_err(|e| CmdError::new("INTERNAL", format!("Git 分支任务失败: {e}")))?
        .cmd()
}

#[tauri::command]
pub async fn git_checkout(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    branch: String,
) -> CmdResult<()> {
    let path = project_path(&state, &project_id)?;
    if branch.trim().is_empty() || branch.starts_with('-') {
        return Err(CmdError::new("INVALID_INPUT", "非法分支名"));
    }
    let state2 = state.inner().clone();
    let branch_name = branch.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || state2.git.checkout(&path, &branch_name))
        .await
        .map_err(|e| CmdError::new("INTERNAL", format!("Git 切换任务失败: {e}")))?
        .map_err(|e| match e {
            AppError::Git(m) => CmdError::new("GIT_CHECKOUT", "切换分支失败").with_detail(m),
            other => other.to_cmd(),
        })
}

#[tauri::command]
pub async fn git_refresh(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> CmdResult<GitStatus> {
    git_status(state, project_id).await
}

fn project_path(state: &State<Arc<AppState>>, project_id: &str) -> CmdResult<PathBuf> {
    let store = state.store.read();
    store
        .projects
        .iter()
        .find(|p| p.id == project_id)
        .map(|p| PathBuf::from(p.path.clone()))
        .ok_or_else(|| CmdError::new("NOT_FOUND", "项目不存在"))
}

// ---------------------------------------------------------------- workflows

#[tauri::command]
pub async fn workflow_list(state: State<'_, Arc<AppState>>) -> CmdResult<Vec<Workflow>> {
    Ok(state.store.read().config.workflows.clone())
}

#[tauri::command]
pub async fn workflow_resolve(
    state: State<'_, Arc<AppState>>,
    id: String,
    values: std::collections::HashMap<String, String>,
    cwd: Option<String>,
) -> CmdResult<ResolvedWorkflow> {
    let wf = {
        let store = state.store.read();
        store
            .config
            .workflows
            .iter()
            .find(|w| w.id == id)
            .cloned()
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Workflow 不存在"))?
    };
    let cwd = cwd.map(|c| normalize_fs_path(&c)).transpose().cmd()?;
    wf.resolve(&values, cwd).cmd()
}

#[tauri::command]
pub async fn workflow_run(
    state: State<'_, Arc<AppState>>,
    workflow_id: String,
    values: std::collections::HashMap<String, String>,
    target_pane_id: String,
    cwd: Option<String>,
) -> CmdResult<()> {
    let state = state.inner().clone();
    let resolved = workflow_resolve_inner(&state, workflow_id, values, cwd.as_deref())?;
    let cmd = format!("{}\r", resolved.command);
    tauri::async_runtime::spawn_blocking(move || state.pty().write_input(&target_pane_id, &cmd))
        .await
        .map_err(|e| CmdError::new("INTERNAL", format!("Workflow 执行失败: {e}")))?
        .cmd()
}

fn workflow_resolve_inner(
    state: &AppState,
    workflow_id: String,
    values: std::collections::HashMap<String, String>,
    cwd: Option<&str>,
) -> CmdResult<ResolvedWorkflow> {
    let wf = {
        let store = state.store.read();
        store
            .config
            .workflows
            .iter()
            .find(|w| w.id == workflow_id)
            .cloned()
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Workflow 不存在"))?
    };
    let cwd = cwd.map(normalize_fs_path).transpose().cmd()?;
    wf.resolve(&values, cwd).cmd()
}

// ---------------------------------------------------------------- notifications

#[tauri::command]
pub async fn notification_list(
    state: State<'_, Arc<AppState>>,
) -> CmdResult<Vec<crate::core::models::NotificationItem>> {
    Ok(state.notifications())
}

#[tauri::command]
pub async fn notification_mark_read(
    state: State<'_, Arc<AppState>>,
    ids: Option<Vec<String>>,
) -> CmdResult<()> {
    state.mark_notifications_read(ids);
    Ok(())
}

#[allow(dead_code)]
fn _kind_of(k: AgentKind) -> &'static str {
    k.id()
}
