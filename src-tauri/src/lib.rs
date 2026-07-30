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
                    state.queue_open_here(&path);
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

        // Queue the first --open-here (Explorer right-click cold start).
        if let Some(path) = &initial_args.open_here {
            built.state.queue_open_here(path);
            let st = built.state.clone();
            let path = path.clone();
            tauri::async_runtime::spawn(async move {
                // Give the UI a moment to subscribe before emitting.
                std::thread::sleep(std::time::Duration::from_millis(600));
                st.emit_open_here(&path);
            });
        }

        // Register configured global hotkey.
        register_global_hotkey(&handle);

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

        let _ = window.show();
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
        if let Some(dir) = directories::BaseDirs::new().map(|d| {
            d.data_dir()
                .join("com.galaxyterminal.app")
                .join("logs")
        }) {
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

fn register_global_hotkey(handle: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let Some(state) = handle.try_state::<Arc<AppState>>() else { return };
    let hotkey = state.store.read().config.global_hotkey.clone();
    let _ = handle.global_shortcut().unregister_all();
    let Some(hotkey) = hotkey.filter(|h| !h.trim().is_empty()) else { return };
    let handle2 = handle.clone();
    let res = handle.global_shortcut().on_shortcut(
        hotkey.as_str(),
        move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(window) = handle2.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false)
                    {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        },
    );
    if let Err(e) = res {
        tracing::warn!("全局热键注册失败: {e}");
    }
}
