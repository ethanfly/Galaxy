//! Settings, diagnostics, system integration commands (spec §5.6, §5.7).
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::State;

use crate::core::config::{default_shortcuts, AppConfig, WindowState};
use crate::core::models::ShellProfile;
use crate::error::{CmdError, CmdResult, IntoCmd};
use crate::services::diagnostics::{Diagnostics, DiagnosticsInfo};
use crate::state::{validate_external_path, validate_external_url, AppState};

// ---------------------------------------------------------------- config

#[tauri::command]
pub async fn config_get(state: State<'_, Arc<AppState>>) -> CmdResult<AppConfig> {
    Ok(state.store.read().config.clone())
}

/// Validate + apply a new config. Shortcut conflicts block the save, exactly
/// like the UI requires (§5.6).
#[tauri::command]
pub async fn config_update(
    state: State<'_, Arc<AppState>>,
    config: AppConfig,
) -> CmdResult<AppConfig> {
    validate_config(&config)?;
    {
        let mut store = state.store.write();
        store.config = config.clone();
    }
    // Reconcile side effects.
    state.refresh_triggers();
    // Merge custom profiles into the runtime list.
    {
        let mut profiles = state.profiles.write();
        for cp in &config.custom_profiles {
            if !cp.program.trim().is_empty() && profiles.iter().all(|p| p.id != cp.id) {
                profiles.push(cp.clone());
            }
        }
        let ids: HashSet<&str> = config.custom_profiles.iter().map(|p| p.id.as_str()).collect();
        let existing_custom: Vec<String> = crate::services::shell_detect::detect_profiles()
            .into_iter()
            .map(|p| p.id)
            .collect();
        profiles.retain(|p| {
            existing_custom.contains(&p.id) || ids.contains(p.id.as_str())
        });
    }
    #[cfg(windows)]
    {
        if let Ok(exe) = std::env::current_exe() {
            if config.context_menu_enabled != crate::platform::registry::is_registered() {
                let res = if config.context_menu_enabled {
                    crate::platform::registry::register_context_menu(&exe.to_string_lossy())
                } else {
                    crate::platform::registry::unregister_context_menu()
                };
                if let Err(e) = res {
                    tracing::warn!("右键菜单同步失败: {}", crate::services::logging::redact(&e.to_string()));
                }
            }
        }
    }
    state.persist().cmd()?;
    Ok(config)
}

pub fn validate_config(config: &AppConfig) -> CmdResult<()> {
    let mut seen: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
    for s in &config.shortcuts {
        if !s.enabled || s.keys.trim().is_empty() {
            continue;
        }
        if let Some(prev) = seen.insert(s.keys.as_str(), s.command.as_str()) {
            return Err(
                CmdError::new(
                    "SHORTCUT_CONFLICT",
                    format!("快捷键 {} 冲突", s.keys),
                )
                .with_detail(format!("\"{}\" 与 \"{}\" 使用了相同按键", prev, s.command)),
            );
        }
    }
    if config.terminal_font_size < 8 || config.terminal_font_size > 32 {
        return Err(CmdError::new("INVALID_INPUT", "终端字号需介于 8-32"));
    }
    if config.ui_font_size < 8 || config.ui_font_size > 24 {
        return Err(CmdError::new("INVALID_INPUT", "界面字号需介于 8-24"));
    }
    if !matches!(config.language.as_str(), "zh-CN" | "en-US") {
        return Err(CmdError::new("INVALID_INPUT", "不支持的语言"));
    }
    for t in &config.triggers {
        t.validate().cmd()?;
    }
    for w in &config.workflows {
        if w.command_template.trim().is_empty() {
            return Err(CmdError::new("INVALID_INPUT", format!("Workflow {} 缺少命令模板", w.name)));
        }
        for p in &w.params {
            if let Some(def) = &p.default {
                crate::core::workflow::validate_value(p, def).cmd()?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn config_reset_shortcuts(state: State<'_, Arc<AppState>>) -> CmdResult<AppConfig> {
    let config = {
        let mut store = state.store.write();
        store.config.shortcuts = default_shortcuts();
        store.config.clone()
    };
    state.persist().cmd()?;
    Ok(config)
}

// ---------------------------------------------------------------- profiles

#[tauri::command]
pub async fn profiles_list(state: State<'_, Arc<AppState>>) -> CmdResult<Vec<ShellProfile>> {
    Ok(state.profiles.read().clone())
}

#[tauri::command]
pub async fn profiles_redetect(state: State<'_, Arc<AppState>>) -> CmdResult<Vec<ShellProfile>> {
    let detected = crate::services::shell_detect::detect_profiles();
    let custom: Vec<ShellProfile> = state
        .profiles
        .read()
        .iter()
        .filter(|p| p.source == crate::core::models::ProfileSource::Custom)
        .cloned()
        .collect();
    let merged: Vec<ShellProfile> = detected.into_iter().chain(custom).collect();
    *state.profiles.write() = merged.clone();
    Ok(merged)
}

// ---------------------------------------------------------------- diagnostics

#[tauri::command]
pub async fn diagnostics_info(state: State<'_, Arc<AppState>>) -> CmdResult<DiagnosticsInfo> {
    Ok(build_diagnostics_info(&state))
}

fn build_diagnostics_info(state: &AppState) -> DiagnosticsInfo {
    let store = state.store.read();
    let profiles = state.profiles.read();
    let paths = state.data_paths();
    let flags = &store.config.feature_flags;
    DiagnosticsInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: crate::services::diagnostics::os_description(),
        arch: std::env::consts::ARCH.to_string(),
        pty_backend: state.pty().backend_name().to_string(),
        config_path: paths.store.to_string_lossy().to_string(),
        data_dir: paths.root.to_string_lossy().to_string(),
        log_dir: paths.logs.to_string_lossy().to_string(),
        shells: profiles
            .iter()
            .map(|p| format!("{} → {}", p.name, p.program))
            .collect(),
        feature_flags: [
            (flags.command_blocks, "command-blocks"),
            (flags.agent_panel, "agent-panel"),
            (flags.git_panel, "git-panel"),
            (flags.workflows, "workflows"),
            (flags.triggers, "triggers"),
        ]
        .iter()
        .filter(|(on, _)| *on)
        .map(|(_, n)| n.to_string())
        .collect(),
        captures_screen_mode: std::env::var("CAPTURE_SCREEN").is_ok(),
        git_available: state.git.is_available(),
        schema_version: store.schema_version,
        profile_count: profiles.len(),
        gpu_acceleration: store.config.hardware_acceleration,
    }
}

#[tauri::command]
pub async fn diagnostics_report(state: State<'_, Arc<AppState>>) -> CmdResult<String> {
    let info = build_diagnostics_info(&state);
    let report = Diagnostics { info }.report();
    // Also write a copy into the logs dir so the user can attach it.
    let log_dir = state.data_paths().logs.clone();
    let file = log_dir.join(format!(
        "diagnostics-{}.md",
        time::OffsetDateTime::now_utc().unix_timestamp()
    ));
    let _ = std::fs::write(&file, &report);
    Ok(format!("{report}\n\n> 已保存副本: {}", crate::services::logging::redact(&file.to_string_lossy())))
}

// ---------------------------------------------------------------- externals

#[tauri::command]
pub async fn system_open_external(_state: State<'_, Arc<AppState>>, url: String) -> CmdResult<()> {
    validate_external_url(&url).cmd()?;
    tauri::async_runtime::spawn_blocking(move || {
        open::that(&url).map_err(|e| CmdError::new("PLATFORM", format!("打开链接失败: {e}")))
    })
    .await
    .map_err(|e| CmdError::new("INTERNAL", format!("打开链接失败: {e}")))?
    .map(|_| ())
}

#[tauri::command]
pub async fn system_open_path(_state: State<'_, Arc<AppState>>, path: String) -> CmdResult<()> {
    let path = validate_external_path(&path).cmd()?;
    if !path.exists() {
        return Err(CmdError::new("INVALID_INPUT", "路径不存在"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        open::that(&path).map_err(|e| CmdError::new("PLATFORM", format!("打开路径失败: {e}")))
    })
    .await
    .map_err(|e| CmdError::new("INTERNAL", format!("打开路径失败: {e}")))?
    .map(|_| ())
}

// ---------------------------------------------------------------- window state

#[tauri::command]
pub async fn window_save_state(
    state: State<'_, Arc<AppState>>,
    window_state: WindowState,
) -> CmdResult<()> {
    {
        let mut store = state.store.write();
        store.config.window_state = window_state;
    }
    state.persist_debounced();
    Ok(())
}

// ---------------------------------------------------------------- boot info

#[tauri::command]
pub async fn system_pending_open_here(state: State<'_, Arc<AppState>>) -> CmdResult<Vec<String>> {
    Ok(state.drain_open_here())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    pub recovered_from_crash: bool,
    pub read_only: bool,
    pub data_dir: String,
}

#[tauri::command]
pub async fn boot_info(state: State<'_, Arc<AppState>>) -> CmdResult<BootInfo> {
    Ok(BootInfo {
        recovered_from_crash: state.recovered_from_crash.load(Ordering::SeqCst),
        read_only: state.read_only.load(Ordering::SeqCst),
        data_dir: state.data_paths().root.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------- updater

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn updater_check(_state: State<'_, Arc<AppState>>) -> CmdResult<UpdateInfo> {
    // The updater plugin is configured in production builds. In dev we report
    // "no update" so the settings page stays functional.
    #[cfg(not(debug_assertions))]
    {
        Ok(UpdateInfo { available: false, version: None, notes: None })
    }
    #[cfg(debug_assertions)]
    {
        Ok(UpdateInfo { available: false, version: None, notes: Some("开发构建跳过更新检查".into()) })
    }
}

// ---------------------------------------------------------------- context menu

#[tauri::command]
pub async fn context_menu_set(
    state: State<'_, Arc<AppState>>,
    enabled: bool,
) -> CmdResult<()> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe()
            .map_err(|e| CmdError::new("PLATFORM", format!("无法获取程序路径: {e}")))?;
        if enabled {
            crate::platform::registry::register_context_menu(&exe.to_string_lossy()).cmd()?;
        } else {
            crate::platform::registry::unregister_context_menu().cmd()?;
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
    }
    {
        let mut store = state.store.write();
        store.config.context_menu_enabled = enabled;
    }
    state.persist().cmd()?;
    Ok(())
}

// minimal `open` implementation — spawn explorer/xdg-open as arg arrays
#[cfg(windows)]
mod open {
    pub fn that(target: impl AsRef<std::ffi::OsStr>) -> std::io::Result<std::process::ExitStatus> {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler"])
            .arg(target.as_ref())
            .spawn()?
            .wait()
    }
}
#[cfg(not(windows))]
mod open {
    pub fn that(target: impl AsRef<std::ffi::OsStr>) -> std::io::Result<std::process::ExitStatus> {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener).arg(target.as_ref()).spawn()?.wait()
    }
}
