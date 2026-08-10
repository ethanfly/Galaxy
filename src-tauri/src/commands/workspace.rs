//! Projects, sessions, tabs, split layout and templates (spec §5.1, §5.2).
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::State;

use crate::core::config::LayoutTemplate;
use crate::core::models::{
    new_id, now_rfc3339, LayoutNode, Pane, Project, Session, ShellProfile, SplitDirection, Store,
    DEFAULT_PROJECT_COLOR,
};
use crate::error::{AppError, CmdError, CmdResult, IntoCmd};
use crate::pty::PtySpec;
use crate::state::AppState;

// ----------------------------------------------------------------- helpers

pub fn normalize_fs_path(path: &str) -> Result<String, AppError> {
    let trimmed = path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("路径不能为空".into()));
    }
    let p = PathBuf::from(trimmed);
    let p = if p.is_absolute() {
        p
    } else {
        std::env::current_dir()
            .map_err(|e| AppError::InvalidInput(format!("无法解析相对路径: {e}")))?
            .join(p)
    };
    if !p.is_dir() {
        return Err(AppError::InvalidInput(format!("目录不存在: {trimmed}")));
    }
    let normalized = dunce_canonicalize(&p);
    Ok(normalized)
}

/// std::fs::canonicalize without the UNC prefix on Windows.
fn dunce_canonicalize(p: &std::path::Path) -> String {
    let s = std::fs::canonicalize(p)
        .map(|c| c.to_string_lossy().to_string())
        .unwrap_or_else(|_| p.to_string_lossy().to_string());
    s.strip_prefix("\\\\?\\").map(String::from).unwrap_or(s)
}

fn resolve_profile(
    state: &AppState,
    profile_id: Option<&str>,
    project: Option<&Project>,
) -> Result<ShellProfile, AppError> {
    let profiles = state.profiles.read();
    let cfg = state.store.read().config.clone();
    let pick_id = profile_id
        .map(String::from)
        .or_else(|| project.and_then(|p| p.default_profile_id.clone()))
        .or(cfg.default_profile_id);
    if let Some(id) = pick_id {
        if let Some(p) = profiles.iter().find(|p| p.id == id) {
            return Ok(p.clone());
        }
    }
    profiles.first().cloned().ok_or_else(|| {
        AppError::InvalidInput("未检测到可用 Shell；请在设置中添加自定义 Profile".into())
    })
}

/// Spawn a PTY for a pane that was just added to the store. Failures mark
/// the pane but never fail the whole operation (§5.1 restore semantics).
pub fn spawn_pane_process(state: &AppState, project_id: &str, session_id: &str, pane: &Pane) {
    let spec = PtySpec {
        program: pane.profile.program.clone(),
        args: pane.profile.args.clone(),
        env: pane.profile.env.clone(),
        cwd: pane.cwd.clone(),
        cols: pane.cols,
        rows: pane.rows,
    };
    let resume_cmd = pane
        .resume
        .as_ref()
        .filter(|r| !r.injected)
        .map(|r| r.resume_command.clone());
    let res = state.pty().spawn_pane(
        &pane.id,
        session_id,
        project_id,
        &spec,
        pane.agent_kind,
        resume_cmd,
    );
    // A fresh process must not inherit the previous process's agent status.
    state.agent_status.write().remove(&pane.id);
    // Mark resume as injected so a restart doesn't double-inject.
    if pane.resume.is_some() {
        if let Some(session) = state
            .store
            .write()
            .sessions
            .iter_mut()
            .find(|s| s.id == session_id)
        {
            if let Some(p) = session.layout.find_pane_mut(&pane.id) {
                if let Some(r) = &mut p.resume {
                    r.injected = res.is_ok();
                }
            }
        }
    }
    if let Err(e) = res {
        tracing::error!(
            "pane 启动失败: {}",
            crate::services::logging::redact(&e.to_string())
        );
        if let Some(session) = state
            .store
            .write()
            .sessions
            .iter_mut()
            .find(|s| s.id == session_id)
        {
            if let Some(p) = session.layout.find_pane_mut(&pane.id) {
                p.exit_code = Some(-1);
            }
        }
    }
}

fn next_sort_order(store: &Store) -> i64 {
    store
        .sessions
        .iter()
        .map(|s| s.sort_order)
        .max()
        .unwrap_or(-1)
        + 1
}

// ---------------------------------------------------------------- projects

#[tauri::command]
pub async fn project_list(state: State<'_, Arc<AppState>>) -> CmdResult<Vec<Project>> {
    Ok(state.store.read().projects.clone())
}

#[tauri::command]
pub async fn project_add(
    state: State<'_, Arc<AppState>>,
    path: String,
    name: Option<String>,
    color: Option<String>,
) -> CmdResult<Project> {
    let normalized = normalize_fs_path(&path).cmd()?;
    let existing = {
        let store = state.store.read();
        store
            .projects
            .iter()
            .find(|p| crate::services::agents::path_matches(&p.path, &normalized))
            .cloned()
    };
    if let Some(mut project) = existing {
        project.last_accessed_at = now_rfc3339();
        project_update_internal(&state, &project)?;
        // Re-arm the watcher (e.g. this project predates this run, so it was
        // never watched: branch/status changes would go unnoticed).
        watch_project_git_for(&state, &project);
        return Ok(project);
    }
    let project = Project {
        id: new_id(),
        name: name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| {
            normalized
                .trim_end_matches('\\')
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or("项目")
                .to_string()
        }),
        path: normalized.clone(),
        color: color.unwrap_or_else(|| DEFAULT_PROJECT_COLOR.into()),
        default_profile_id: None,
        created_at: now_rfc3339(),
        last_accessed_at: now_rfc3339(),
    };
    state.store.write().projects.push(project.clone());
    state.persist().cmd()?;
    watch_project_git_for(&state, &project);
    Ok(project)
}

/// Arm the `.git` watcher for one project; the callback emits `git://changed`.
/// Idempotent — re-watching an already-watched project is a no-op.
fn watch_project_git_for(state: &State<Arc<AppState>>, project: &Project) {
    let app_handle = state.app.clone();
    let proj_path = PathBuf::from(&project.path);
    let proj_id = project.id.clone();
    let _ = state.git.watch_repo(
        &proj_path,
        &proj_id,
        Arc::new(move |pid| {
            let _ = tauri::Emitter::emit(
                &app_handle,
                crate::state::events::GIT_CHANGED,
                serde_json::json!({ "projectId": pid }),
            );
        }),
    );
}

fn project_update_internal(state: &State<Arc<AppState>>, project: &Project) -> CmdResult<()> {
    {
        let mut store = state.store.write();
        let Some(p) = store.projects.iter_mut().find(|p| p.id == project.id) else {
            return Err(CmdError::new("NOT_FOUND", "项目不存在"));
        };
        *p = project.clone();
    }
    state.persist().cmd()?;
    Ok(())
}

#[tauri::command]
pub async fn project_update(
    state: State<'_, Arc<AppState>>,
    mut project: Project,
) -> CmdResult<Project> {
    project.path = normalize_fs_path(&project.path).cmd()?;
    project_update_internal(&state, &project)?;
    Ok(project)
}

/// Removing a project never deletes directories on disk. Sessions that are
/// still running require explicit confirmation (`force`).
#[tauri::command]
pub async fn project_remove(
    state: State<'_, Arc<AppState>>,
    id: String,
    force: bool,
) -> CmdResult<()> {
    let running: Vec<String> = {
        let store = state.store.read();
        store
            .sessions
            .iter()
            .filter(|s| s.project_id == id)
            .flat_map(|s| s.layout.panes().into_iter().map(|p| p.id.clone()))
            .filter(|pid| state.pty().is_alive(pid))
            .collect()
    };
    if !running.is_empty() && !force {
        return Err(CmdError::new(
            "PROJECT_HAS_RUNNING_SESSIONS",
            format!(
                "该项目有 {} 个终端仍在运行，确认后将一并关闭",
                running.len()
            ),
        ));
    }
    let path = {
        let mut store = state.store.write();
        let Some(pos) = store.projects.iter().position(|p| p.id == id) else {
            return Err(CmdError::new("NOT_FOUND", "项目不存在"));
        };
        let project = store.projects.remove(pos);
        let session_ids: Vec<String> = store
            .sessions
            .iter()
            .filter(|s| s.project_id == id)
            .map(|s| s.id.clone())
            .collect();
        store.sessions.retain(|s| s.project_id != id);
        for sid in &session_ids {
            let _ = state.blocks.remove_for_session(sid);
        }
        project.path
    };
    for pane_id in running {
        let _ = state.pty().kill(&pane_id);
        state.pty().unregister(&pane_id);
        state.agent_status.write().remove(&pane_id);
    }
    state.git.unwatch(PathBuf::from(&path).as_path());
    state.persist().cmd()?;
    Ok(())
}

// ---------------------------------------------------------------- sessions

#[tauri::command]
pub async fn session_list(state: State<'_, Arc<AppState>>) -> CmdResult<Vec<Session>> {
    Ok(state.store.read().sessions.clone())
}

#[tauri::command]
pub async fn session_create(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    title: Option<String>,
    profile_id: Option<String>,
    cwd: Option<String>,
) -> CmdResult<Session> {
    let project = {
        let store = state.store.read();
        let Some(p) = store.projects.iter().find(|p| p.id == project_id).cloned() else {
            return Err(CmdError::new("NOT_FOUND", "项目不存在"));
        };
        p
    };
    let profile = resolve_profile(&state, profile_id.as_deref(), Some(&project)).cmd()?;
    let pane_cwd = cwd
        .map(|c| normalize_fs_path(&c))
        .transpose()
        .cmd()?
        .unwrap_or_else(|| project.path.clone());
    let pane = Pane::new(pane_cwd, profile);
    let session = Session {
        id: new_id(),
        project_id: project_id.clone(),
        title: title.unwrap_or_else(|| {
            format!("终端 {}", {
                state
                    .store
                    .read()
                    .sessions
                    .iter()
                    .filter(|s| s.project_id == project_id)
                    .count()
                    + 1
            })
        }),
        sort_order: next_sort_order(&state.store.read()),
        agent_kind: None,
        layout: LayoutNode::new_pane(pane.clone()),
        sync_input: false,
        created_at: now_rfc3339(),
    };
    state.store.write().sessions.push(session.clone());
    {
        let mut store = state.store.write();
        if let Some(p) = store.projects.iter_mut().find(|p| p.id == project_id) {
            p.last_accessed_at = now_rfc3339();
        }
    }
    spawn_pane_process(&state, &project_id, &session.id, &pane);
    state.persist().cmd()?;
    Ok(session)
}

#[tauri::command]
pub async fn session_close(state: State<'_, Arc<AppState>>, id: String) -> CmdResult<()> {
    let session = {
        let mut store = state.store.write();
        let Some(pos) = store.sessions.iter().position(|s| s.id == id) else {
            return Err(CmdError::new("NOT_FOUND", "会话不存在"));
        };
        store.sessions.remove(pos)
    };
    for pane in session.layout.panes() {
        state.pty().unregister(&pane.id);
        state.agent_status.write().remove(&pane.id);
    }
    state.persist().cmd()?;
    Ok(())
}

#[tauri::command]
pub async fn session_rename(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: String,
) -> CmdResult<Session> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(CmdError::new("INVALID_INPUT", "标题不能为空"));
    }
    let session = {
        let mut store = state.store.write();
        let Some(s) = store.sessions.iter_mut().find(|s| s.id == id) else {
            return Err(CmdError::new("NOT_FOUND", "会话不存在"));
        };
        s.title = title;
        s.clone()
    };
    state.persist().cmd()?;
    Ok(session)
}

#[tauri::command]
pub async fn session_reorder(state: State<'_, Arc<AppState>>, ids: Vec<String>) -> CmdResult<()> {
    {
        let mut store = state.store.write();
        for (i, id) in ids.iter().enumerate() {
            if let Some(s) = store.sessions.iter_mut().find(|s| &s.id == id) {
                s.sort_order = i as i64;
            }
        }
    }
    state.persist().cmd()?;
    Ok(())
}

#[tauri::command]
pub async fn session_set_sync_input(
    state: State<'_, Arc<AppState>>,
    id: String,
    sync: bool,
) -> CmdResult<Session> {
    let session = {
        let mut store = state.store.write();
        let Some(s) = store.sessions.iter_mut().find(|s| s.id == id) else {
            return Err(CmdError::new("NOT_FOUND", "会话不存在"));
        };
        s.sync_input = sync;
        s.clone()
    };
    state.persist().cmd()?;
    Ok(session)
}

// ---------------------------------------------------------------- layout

fn commit_pane_split(
    store: &mut Store,
    session_id: &str,
    pane_id: &str,
    direction: SplitDirection,
    new_pane: Pane,
) -> CmdResult<Session> {
    let Some(s) = store.sessions.iter_mut().find(|s| s.id == session_id) else {
        return Err(CmdError::new("NOT_FOUND", "会话不存在"));
    };
    if !s.layout.split(pane_id, direction, new_pane.clone()) {
        return Err(CmdError::new("INVARIANT", "无法在布局中分割该 Pane"));
    }
    if let Err(e) = s.layout.validate() {
        return Err(CmdError::new("INVARIANT", e.to_string()));
    }
    // Focus moves to the new pane.
    let pane_ids: Vec<String> = s.layout.panes().into_iter().map(|p| p.id.clone()).collect();
    for id in pane_ids {
        if let Some(pane) = s.layout.find_pane_mut(&id) {
            pane.active = id == new_pane.id;
        }
    }
    Ok(s.clone())
}

#[tauri::command]
pub async fn pane_split(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    direction: SplitDirection,
    profile_id: Option<String>,
) -> CmdResult<Session> {
    let (session_id, project_id, cwd) = {
        let store = state.store.read();
        let Some(s) = store
            .sessions
            .iter()
            .find(|s| s.layout.contains_pane(&pane_id))
        else {
            return Err(CmdError::new("NOT_FOUND", "Pane 不存在"));
        };
        let Some(src) = s.layout.find_pane(&pane_id) else {
            return Err(CmdError::new("NOT_FOUND", "Pane 不存在"));
        };
        (s.id.clone(), s.project_id.clone(), src.cwd.clone())
    };
    let project = state
        .store
        .read()
        .projects
        .iter()
        .find(|p| p.id == project_id)
        .cloned();
    let profile = resolve_profile(&state, profile_id.as_deref(), project.as_ref()).cmd()?;
    let new_pane = Pane::new(cwd, profile);
    let session = {
        let mut store = state.store.write();
        commit_pane_split(
            &mut store,
            &session_id,
            &pane_id,
            direction,
            new_pane.clone(),
        )?
    };
    spawn_pane_process(&state, &project_id, &session_id, &new_pane);
    state.persist().cmd()?;
    let _ = tauri::Emitter::emit(
        &state.app,
        crate::state::events::LAYOUT_CHANGED,
        serde_json::json!({ "sessionId": session_id }),
    );
    Ok(session)
}

fn commit_pane_close(store: &mut Store, session_id: &str, pane_id: &str) -> CmdResult<bool> {
    let Some(session_idx) = store.sessions.iter().position(|s| s.id == session_id) else {
        return Err(CmdError::new("NOT_FOUND", "会话不存在"));
    };
    if !store.sessions[session_idx].layout.contains_pane(pane_id) {
        return Err(CmdError::new("NOT_FOUND", "Pane 不存在"));
    }
    if store.sessions[session_idx].layout.pane_count() == 1 {
        store.sessions.remove(session_idx);
        return Ok(true);
    }
    store.sessions[session_idx]
        .layout
        .remove_pane(pane_id)
        .ok_or_else(|| CmdError::new("INVARIANT", "无法从布局中移除 Pane"))?;
    Ok(false)
}

#[tauri::command]
pub async fn pane_close(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
) -> CmdResult<Option<String>> {
    // Returns Some(session_id) if the session still exists, None if closing
    // the pane removed the session.
    let session_id = {
        let store = state.store.read();
        store
            .sessions
            .iter()
            .find(|s| s.layout.contains_pane(&pane_id))
            .map(|s| s.id.clone())
    };
    let Some(session_id) = session_id else {
        return Err(CmdError::new("NOT_FOUND", "Pane 不存在"));
    };
    let removed_session = {
        let mut store = state.store.write();
        commit_pane_close(&mut store, &session_id, &pane_id)?
    };
    state.pty().unregister(&pane_id);
    // Drop stale runtime agent status so a re-created pane with the same id
    // starts from Idle instead of inheriting the closed pane's state.
    state.agent_status.write().remove(&pane_id);
    state.persist().cmd()?;
    Ok(if removed_session {
        None
    } else {
        Some(session_id)
    })
}

/// Transactional cross-tab move: if the target tree refuses the pane, the
/// source keeps it (§4.2 invariant).
#[tauri::command]
pub async fn pane_move_to_session(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    target_session_id: String,
) -> CmdResult<()> {
    // 1. Detach from source (keeps Pane so a failed adopt can roll back).
    let (source_session_id, detached) = {
        let mut store = state.store.write();
        let Some(src_idx) = store
            .sessions
            .iter()
            .position(|s| s.layout.contains_pane(&pane_id))
        else {
            return Err(CmdError::new("NOT_FOUND", "Pane 不存在"));
        };
        if store.sessions[src_idx].id == target_session_id {
            return Ok(());
        }
        if store.sessions[src_idx].layout.pane_count() <= 1 {
            return Err(CmdError::new(
                "INVARIANT",
                "源会话只剩一个 Pane，请直接关闭或合并会话",
            ));
        }
        let detached = store.sessions[src_idx]
            .layout
            .detach_pane(&pane_id)
            .ok_or_else(|| CmdError::new("INVARIANT", "无法从源布局分离 Pane"))?;
        (store.sessions[src_idx].id.clone(), detached)
    };
    // 2. Adopt into the target; on validation failure roll back.
    let adopt_result = {
        let mut store = state.store.write();
        match store
            .sessions
            .iter_mut()
            .find(|s| s.id == target_session_id)
        {
            Some(t) => {
                let anchor = t.layout.panes().first().map(|p| p.id.clone());
                Some(match anchor {
                    Some(anchor) => t.layout.adopt_pane(&anchor, detached.clone()),
                    None => false,
                })
            }
            None => None,
        }
    };
    match adopt_result {
        Some(true) => {
            state.persist().cmd()?;
            Ok(())
        }
        _ => {
            // Roll back: put the pane back into the source session.
            let mut store = state.store.write();
            if let Some(src) = store
                .sessions
                .iter_mut()
                .find(|s| s.id == source_session_id)
            {
                let anchor = src.layout.panes().first().map(|p| p.id.clone());
                if let Some(anchor) = anchor {
                    let _ = src.layout.adopt_pane(&anchor, detached);
                } else {
                    // Source somehow empty — rebuild as single pane tree.
                    src.layout = LayoutNode::new_pane(detached);
                }
            }
            Err(CmdError::new(
                "INVARIANT",
                "目标会话无法接受该 Pane，已保留在源会话",
            ))
        }
    }
}

#[tauri::command]
pub async fn layout_set_ratio(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    path: Vec<bool>,
    ratio: f64,
) -> CmdResult<()> {
    {
        let mut store = state.store.write();
        let Some(s) = store.sessions.iter_mut().find(|s| s.id == session_id) else {
            return Err(CmdError::new("NOT_FOUND", "会话不存在"));
        };
        if !s.layout.set_ratio_at_path(&path, ratio) {
            return Err(CmdError::new("INVALID_INPUT", "分割路径无效"));
        }
        s.layout.validate().cmd()?;
    }
    // Persist debounced: divider drags produce many updates.
    state.persist_debounced();
    Ok(())
}

// ---------------------------------------------------------------- templates

#[tauri::command]
pub async fn template_save(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    name: String,
) -> CmdResult<LayoutTemplate> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(CmdError::new("INVALID_INPUT", "模板名称不能为空"));
    }
    let template = {
        let store = state.store.read();
        let Some(session) = store.sessions.iter().find(|s| s.id == session_id) else {
            return Err(CmdError::new("NOT_FOUND", "会话不存在"));
        };
        fn to_template(node: &LayoutNode) -> crate::core::config::TemplateNode {
            match node {
                LayoutNode::Pane { .. } => crate::core::config::TemplateNode::Slot,
                LayoutNode::Split {
                    direction,
                    ratio,
                    first,
                    second,
                } => crate::core::config::TemplateNode::Split {
                    direction: *direction,
                    ratio: *ratio,
                    first: Box::new(to_template(first)),
                    second: Box::new(to_template(second)),
                },
            }
        }
        LayoutTemplate {
            id: new_id(),
            name,
            created_at: now_rfc3339(),
            node: to_template(&session.layout),
        }
    };
    {
        let mut store = state.store.write();
        store
            .config
            .layout_templates
            .retain(|t| t.name != template.name);
        store.config.layout_templates.push(template.clone());
    }
    state.persist().cmd()?;
    Ok(template)
}

/// Applying a template reuses existing panes where possible and creates panes
/// for gaps; extra existing panes are closed (§5.2).
#[tauri::command]
pub async fn template_apply(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    template_id: String,
) -> CmdResult<Session> {
    let template = {
        let store = state.store.read();
        store
            .config
            .layout_templates
            .iter()
            .find(|t| t.id == template_id)
            .cloned()
            .ok_or_else(|| CmdError::new("NOT_FOUND", "布局模板不存在"))?
    };
    let (project_id, existing_panes, cwd_source) = {
        let store = state.store.read();
        let Some(s) = store.sessions.iter().find(|s| s.id == session_id) else {
            return Err(CmdError::new("NOT_FOUND", "会话不存在"));
        };
        let panes: Vec<Pane> = s.layout.panes().into_iter().cloned().collect();
        let project = store
            .projects
            .iter()
            .find(|p| p.id == s.project_id)
            .cloned();
        (s.project_id.clone(), panes, project.map(|p| p.path))
    };

    let profile = resolve_profile(&state, None, None).cmd()?;
    let mut reused: Vec<Pane> = existing_panes.clone();
    let default_cwd = reused
        .first()
        .map(|p| p.cwd.clone())
        .or(cwd_source)
        .unwrap_or_else(|| ".".into());

    fn build(
        node: &crate::core::config::TemplateNode,
        reused: &mut Vec<Pane>,
        profile: &ShellProfile,
        default_cwd: &str,
    ) -> (LayoutNode, Vec<Pane>) {
        match node {
            crate::core::config::TemplateNode::Slot => {
                let pane = if reused.is_empty() {
                    Pane::new(default_cwd.to_string(), profile.clone())
                } else {
                    reused.remove(0)
                };
                (LayoutNode::new_pane(pane.clone()), vec![pane])
            }
            crate::core::config::TemplateNode::Split {
                direction,
                ratio,
                first,
                second,
            } => {
                let (f, mut pf) = build(first, reused, profile, default_cwd);
                let (s, ps) = build(second, reused, profile, default_cwd);
                pf.extend(ps);
                (
                    LayoutNode::Split {
                        direction: *direction,
                        ratio: *ratio,
                        first: Box::new(f),
                        second: Box::new(s),
                    },
                    pf,
                )
            }
        }
    }

    let (new_layout, _wanted) = build(&template.node, &mut reused, &profile, &default_cwd);
    let leftover: Vec<Pane> = reused; // existing panes not reused → close their PTYs

    let session = {
        let mut store = state.store.write();
        let Some(s) = store.sessions.iter_mut().find(|s| s.id == session_id) else {
            return Err(CmdError::new("NOT_FOUND", "会话不存在"));
        };
        s.layout = new_layout;
        s.layout.validate().cmd()?;
        s.clone()
    };
    // Kill leftover PTYs, spawn PTYs for panes that don't have a process.
    for pane in leftover {
        state.pty().unregister(&pane.id);
        state.agent_status.write().remove(&pane.id);
    }
    for pane in session.layout.panes() {
        if !state.pty().is_alive(&pane.id) {
            spawn_pane_process(&state, &project_id, &session_id, pane);
        }
    }
    state.persist().cmd()?;
    Ok(session)
}

#[tauri::command]
pub async fn template_delete(state: State<'_, Arc<AppState>>, id: String) -> CmdResult<()> {
    {
        let mut store = state.store.write();
        store.config.layout_templates.retain(|t| t.id != id);
    }
    state.persist().cmd()?;
    Ok(())
}

// ---------------------------------------------------------------- restore

/// Order sessions so the focused / first-visible session restores before the rest.
/// Pure helper — unit-tested without spawning PTYs.
pub fn order_sessions_for_restore<'a>(
    sessions: &'a [Session],
    priority_session_id: Option<&str>,
) -> Vec<&'a Session> {
    let mut ordered: Vec<&Session> = Vec::with_capacity(sessions.len());
    if let Some(id) = priority_session_id {
        if let Some(s) = sessions.iter().find(|s| s.id == id) {
            ordered.push(s);
        }
    }
    for s in sessions {
        if priority_session_id.is_some_and(|id| id == s.id) {
            continue;
        }
        ordered.push(s);
    }
    ordered
}

/// Restore panes for one session. When `task_generation` is set, aborts (and
/// unregisters any pane just spawned in this call) if a newer restore wave
/// or clean-start has cancelled deferred work.
fn restore_session_panes_with_generation(
    state: &AppState,
    session: &Session,
    task_generation: Option<u64>,
) -> bool {
    let still_active = |s: &AppState| match task_generation {
        Some(gen) => crate::state::restore_task_active(s.restore_generation(), gen),
        None => true,
    };

    if !still_active(state) {
        return false;
    }
    if session.layout.panes().is_empty() {
        return false;
    }
    // Skip sessions already live (e.g. hot reload).
    if session
        .layout
        .panes()
        .iter()
        .all(|p| state.pty().is_alive(&p.id))
    {
        return true;
    }
    let mut any_ok = false;
    for pane in session.layout.panes() {
        if !still_active(state) {
            return any_ok;
        }
        if state.pty().is_alive(&pane.id) {
            any_ok = true;
            continue;
        }
        spawn_pane_process(state, &session.project_id, &session.id, pane);
        if !still_active(state) {
            // Cancel landed mid-spawn: tear down the orphan we just created.
            state.pty().unregister(&pane.id);
            state.agent_status.write().remove(&pane.id);
            return any_ok;
        }
        any_ok = any_ok || state.pty().is_alive(&pane.id);
    }
    any_ok
}

/// Rebuild PTYs after app start (§5.1).
///
/// Restores the priority session (current UI tab) synchronously so the user
/// gets an interactive terminal quickly; remaining sessions spawn on a
/// background task and never gate first paint / `loadState: ready`.
/// Background work is generation-scoped and cancelled by
/// [`recovery_clean_start`] or a newer restore call.
#[tauri::command]
pub async fn workspace_restore(
    state: State<'_, Arc<AppState>>,
    priority_session_id: Option<String>,
) -> CmdResult<usize> {
    let task_gen = state.begin_restore_generation();
    let sessions: Vec<Session> = state.store.read().sessions.clone();
    let ordered = order_sessions_for_restore(&sessions, priority_session_id.as_deref());

    let mut restored = 0usize;
    let mut rest: Vec<Session> = Vec::new();

    for (i, session) in ordered.into_iter().enumerate() {
        if i == 0 {
            if restore_session_panes_with_generation(&state, session, Some(task_gen)) {
                restored += 1;
            }
        } else {
            rest.push(session.clone());
        }
    }

    // Persist after the priority session so pane exit markers land on disk.
    let _ = state.persist();

    if !rest.is_empty() {
        let state_bg = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut n = 0usize;
            for session in rest {
                if !crate::state::restore_task_active(state_bg.restore_generation(), task_gen) {
                    tracing::info!("后台会话恢复已取消 (generation={task_gen})");
                    return;
                }
                // Skip sessions removed by clean-start or other store edits.
                let still_present = state_bg
                    .store
                    .read()
                    .sessions
                    .iter()
                    .any(|s| s.id == session.id);
                if !still_present {
                    continue;
                }
                if restore_session_panes_with_generation(&state_bg, &session, Some(task_gen)) {
                    n += 1;
                }
            }
            if crate::state::restore_task_active(state_bg.restore_generation(), task_gen) {
                let _ = state_bg.persist();
                tracing::info!("后台恢复其余会话完成: {n}");
            }
        });
    }

    Ok(restored)
}

/// Clean-start choice after a crash: sessions are dropped but the raw
/// recovery file is preserved (§8).
#[tauri::command]
pub async fn recovery_clean_start(state: State<'_, Arc<AppState>>) -> CmdResult<()> {
    // Invalidate any deferred multi-session restore before tearing down PTYs.
    state.cancel_deferred_restore();

    // Preserve the pre-clean store alongside the backups.
    let paths = state.data_paths().clone();
    if paths.store.exists() {
        let keep = paths.backups.join(format!(
            "store.recovery-{}.json",
            time::OffsetDateTime::now_utc().unix_timestamp()
        ));
        let _ = std::fs::copy(&paths.store, keep);
    }
    // Unregister PTYs, drop sessions.
    let pane_ids: Vec<String> = {
        let store = state.store.read();
        store
            .sessions
            .iter()
            .flat_map(|s| s.layout.panes().into_iter().map(|p| p.id.clone()))
            .collect()
    };
    for id in pane_ids {
        state.pty().unregister(&id);
    }
    // Clean start drops every pane's runtime agent status too.
    state.agent_status.write().clear();
    state.store.write().sessions.clear();
    state.recovered_from_crash.store(false, Ordering::SeqCst);
    state.persist().cmd()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::ProfileSource;

    #[test]
    fn default_project_color_matches_the_monochrome_theme() {
        assert_eq!(DEFAULT_PROJECT_COLOR, "#f5f6f7");
    }

    fn pane(id: &str) -> Pane {
        let profile = ShellProfile {
            id: "profile-1".into(),
            name: "Test shell".into(),
            program: "cmd.exe".into(),
            args: Vec::new(),
            icon: None,
            env: Default::default(),
            source: ProfileSource::Detected,
        };
        let mut pane = Pane::new("C:\\workspace".into(), profile);
        pane.id = id.into();
        pane
    }

    fn store_with_session() -> Store {
        let mut store = Store::default();
        store.sessions.push(Session {
            id: "session-1".into(),
            project_id: "project-1".into(),
            title: "Session".into(),
            sort_order: 0,
            agent_kind: None,
            layout: LayoutNode::new_pane(pane("pane-1")),
            sync_input: false,
            created_at: "2026-08-03T00:00:00Z".into(),
        });
        store
    }

    #[test]
    fn pane_split_commit_returns_not_found_if_session_disappeared_after_lookup() {
        let mut store = store_with_session();
        store.sessions.clear();

        let err = commit_pane_split(
            &mut store,
            "session-1",
            "pane-1",
            SplitDirection::Row,
            pane("pane-2"),
        )
        .expect_err("a concurrently removed session must return an error");

        assert_eq!(err.code, "NOT_FOUND");
        assert_eq!(err.message, "会话不存在");
    }

    #[test]
    fn pane_close_commit_returns_not_found_if_session_disappeared_after_lookup() {
        let mut store = store_with_session();
        store.sessions.clear();

        let err = commit_pane_close(&mut store, "session-1", "pane-1")
            .expect_err("a concurrently removed session must return an error");

        assert_eq!(err.code, "NOT_FOUND");
        assert_eq!(err.message, "会话不存在");
    }

    #[test]
    fn pane_close_commit_removes_session_when_closing_its_only_pane() {
        let mut store = store_with_session();

        let removed_session = commit_pane_close(&mut store, "session-1", "pane-1")
            .expect("closing the only pane should succeed");

        assert!(removed_session);
        assert!(store.sessions.is_empty());
    }

    #[test]
    fn pane_close_commit_rejects_stale_source_after_pane_moves() {
        let mut store = store_with_session();
        assert!(store.sessions[0].layout.split(
            "pane-1",
            SplitDirection::Row,
            pane("source-survivor"),
        ));
        store.sessions.push(Session {
            id: "session-2".into(),
            project_id: "project-1".into(),
            title: "Target session".into(),
            sort_order: 1,
            agent_kind: None,
            layout: LayoutNode::new_pane(pane("target-anchor")),
            sync_input: false,
            created_at: "2026-08-03T00:00:00Z".into(),
        });

        let stale_session_id = store.sessions[0].id.clone();
        let moved = store.sessions[0]
            .layout
            .detach_pane("pane-1")
            .expect("the move should detach the requested pane");
        assert!(store.sessions[1].layout.adopt_pane("target-anchor", moved));

        let err = commit_pane_close(&mut store, &stale_session_id, "pane-1")
            .expect_err("a close must not commit against the pane's stale source session");

        assert_eq!(err.code, "NOT_FOUND");
        let source = store
            .sessions
            .iter()
            .find(|session| session.id == "session-1")
            .expect("the stale source session must remain");
        assert!(source.layout.contains_pane("source-survivor"));
        let target = store
            .sessions
            .iter()
            .find(|session| session.id == "session-2")
            .expect("the target session must remain");
        assert!(target.layout.contains_pane("pane-1"));
    }

    fn stub_session(id: &str, sort: i64) -> Session {
        Session {
            id: id.into(),
            project_id: "p".into(),
            title: id.into(),
            sort_order: sort,
            agent_kind: None,
            layout: LayoutNode::new_pane(pane(&format!("{id}-pane"))),
            sync_input: false,
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn restore_order_puts_priority_session_first() {
        let sessions = vec![
            stub_session("a", 0),
            stub_session("b", 1),
            stub_session("c", 2),
        ];
        let ordered = order_sessions_for_restore(&sessions, Some("c"));
        assert_eq!(
            ordered.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["c", "a", "b"]
        );
    }

    #[test]
    fn restore_order_without_priority_keeps_store_order() {
        let sessions = vec![stub_session("a", 0), stub_session("b", 1)];
        let ordered = order_sessions_for_restore(&sessions, None);
        assert_eq!(
            ordered.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }

    #[test]
    fn restore_order_ignores_unknown_priority_id() {
        let sessions = vec![stub_session("a", 0), stub_session("b", 1)];
        let ordered = order_sessions_for_restore(&sessions, Some("missing"));
        assert_eq!(
            ordered.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }
}
