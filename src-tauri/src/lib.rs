//! Galaxy Terminal backend — Tauri 2 application assembly.
pub mod commands;
pub mod core;
pub mod error;
pub mod platform;
pub mod pty;
pub mod services;
pub mod state;

use std::sync::Arc;

use state::AppState;
use tauri::Manager;

/// Entry used by main.rs on desktop platforms.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Log panics before abort/unwind so WER "闪退" has a trail in logs/.
    install_panic_hook();

    // CAPTURE_SCREEN screenshot mode: force software rendering so automated
    // screenshots are stable (spec §5.7).
    let capture_screen = std::env::var("CAPTURE_SCREEN").is_ok();

    let initial_args = platform::args::parse(std::env::args());

    let mut builder = tauri::Builder::default();

    if capture_screen {
        // WebView2 honors this env var when the app starts; harmless elsewhere.
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu --disable-gpu-compositing",
        );
        tracing::info!("CAPTURE_SCREEN 模式：切换到软件渲染");
    }

    builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Second launch: focus existing window and forward --open-here.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let args = platform::args::parse(argv);
            if let Some(path) = args.open_here {
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    // Warm path: UI is already listening — emit only.
                    // Do not also queue: that would double-create a session if
                    // anything later drained pending_open_here again.
                    state.emit_open_here(&path);
                }
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder = builder.setup(move |app| {
        let handle = app.handle().clone();
        let built = state::build_state(handle.clone()).map_err(|e| {
            // App-level error: cannot initialize core storage → refuse to
            // enter the main UI (spec §8).
            e
        })?;
        app.manage(built.state.clone());

        // Re-arm `.git` watchers for persisted projects (the status bar's
        // branch/status refresh depends on git://changed events).
        state::watch_project_git(&built.state);

        // Cold start --open-here: queue only. The UI drains via
        // system_pending_open_here after init. Emitting as well would create
        // a second terminal tab for the same Explorer right-click.
        if let Some(path) = &initial_args.open_here {
            built.state.queue_open_here(path);
        }

        // Register configured global hotkey (cheap; keep before show so the
        // hotkey works as soon as the window appears).
        let hotkey = built.state.store.read().config.global_hotkey.clone();
        if let Err(e) = apply_global_hotkey(&handle, &hotkey) {
            tracing::warn!("全局热键注册失败: {}", e.message);
        }

        // Restore window geometry, clamped into visible monitors.
        let window = handle.get_webview_window("main").expect("main window");
        let ws = {
            let store = built.state.store.read();
            store.config.window_state.clone()
        };
        let ws = platform::window_state::clamp_to_monitors(&window, ws);
        platform::window_state::apply(&window, &ws);

        // Window lifecycle → persistence.
        let state_for_events = built.state.clone();
        window.on_window_event(move |event| {
            use tauri::WindowEvent as W;
            match event {
                // Prefer CloseRequested for a single clean shutdown; Destroyed
                // is a safety net if the window is torn down without a close.
                W::CloseRequested { .. } => {
                    state::shutdown(&state_for_events);
                }
                W::Destroyed => {
                    state::shutdown(&state_for_events);
                }
                W::Moved(_) | W::Resized(_) => {
                    // Capture debounced window state.
                    if let Some(w) = state_for_events.app.get_webview_window("main") {
                        let ws = platform::window_state::capture(&w);
                        state_for_events.save_window_state_debounced(ws);
                    }
                }
                _ => {}
            }
        });

        // First interactive paint: show before PATH-walk shell re-detect.
        let _ = window.show();

        // Deferred: full shell profile detection (pwsh / git-bash / wsl + PATH).
        state::refresh_profiles_in_background(built.state.clone());

        Ok(())
    });

    let app = builder
        .invoke_handler(commands::all_commands!())
        .build(tauri::generate_context!())
        .expect("error while running Galaxy Terminal");

    app.run(|_app, _event| {});
}

/// Best-effort panic trail for support/debug. Prefer `panic = "unwind"` in
/// release so worker-thread panics do not become Windows 0xc0000409 aborts.
fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed");
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".into()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".into());
        let msg = format!("PANIC in thread '{name}' at {location}: {payload}");
        // tracing may not be initialized yet — always try stderr + a log file.
        eprintln!("{msg}");
        if let Some(dir) = directories::BaseDirs::new()
            .map(|d| d.data_dir().join("com.galaxyterminal.app").join("logs"))
        {
            let _ = std::fs::create_dir_all(&dir);
            let path = dir.join("panic.log");
            let line = format!(
                "{} {msg}\n",
                time::OffsetDateTime::now_utc()
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            );
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .and_then(|mut f| {
                    use std::io::Write;
                    f.write_all(line.as_bytes())
                });
        }
        default(info);
    }));
}

pub(crate) fn apply_global_hotkey(
    handle: &tauri::AppHandle,
    hotkey: &Option<String>,
) -> error::CmdResult<()> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    handle
        .global_shortcut()
        .unregister_all()
        .map_err(|e| error::CmdError::new("GLOBAL_HOTKEY", format!("清除旧全局热键失败: {e}")))?;
    let Some(hotkey) = hotkey.as_deref().filter(|h| !h.trim().is_empty()) else {
        return Ok(());
    };
    let handle2 = handle.clone();
    handle
        .global_shortcut()
        .on_shortcut(hotkey, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(window) = handle2.get_webview_window("main") {
                    toggle_main_window_for_global_hotkey(&window);
                }
            }
        })
        .map_err(|e| {
            error::CmdError::new("GLOBAL_HOTKEY", format!("全局热键无效或已被占用: {e}"))
        })?;
    Ok(())
}

/// Hide only when the main window is already in the foreground.
/// Minimized / unfocused / hidden windows must be brought forward — matching
/// the single-instance focus path (`unminimize` + `show` + `set_focus`).
pub(crate) fn global_hotkey_should_hide(visible: bool, focused: bool, minimized: bool) -> bool {
    visible && focused && !minimized
}

fn toggle_main_window_for_global_hotkey(window: &tauri::WebviewWindow) {
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if global_hotkey_should_hide(visible, focused, minimized) {
        let _ = window.hide();
        return;
    }
    // Same restore order as the single-instance second-launch handler.
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(test)]
mod global_hotkey_toggle_tests {
    use super::global_hotkey_should_hide;

    #[test]
    fn hides_only_when_foreground_and_not_minimized() {
        assert!(global_hotkey_should_hide(true, true, false));
        assert!(!global_hotkey_should_hide(true, true, true));
        assert!(!global_hotkey_should_hide(true, false, false));
        assert!(!global_hotkey_should_hide(false, false, false));
        assert!(!global_hotkey_should_hide(false, false, true));
        assert!(!global_hotkey_should_hide(true, false, true));
    }
}
