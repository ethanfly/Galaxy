//! Window state memory (spec §5.7): position / size / maximized persisted
//! in AppConfig, clamped back into the visible monitor area after display
//! changes.
use tauri::{Manager, WebviewWindow};

use crate::core::config::WindowState;

pub fn clamp_to_monitors(window: &WebviewWindow, mut state: WindowState) -> WindowState {
    let default_w = state.width.max(800);
    let default_h = state.height.max(520);
    let (Some(x), Some(y)) = (state.x, state.y) else {
        return WindowState { width: default_w, height: default_h, ..state };
    };
    // Is the top-left corner visible on any monitor?
    let Ok(monitors) = window.app_handle().available_monitors() else {
        return WindowState { width: default_w, height: default_h, ..state };
    };
    let visible = monitors.iter().any(|m| {
        let pos = m.position();
        let size = m.size();
        x >= pos.x
            && y >= pos.y
            && x < pos.x + size.width as i32
            && y < pos.y + size.height as i32
    });
    if !visible {
        state.x = None;
        state.y = None;
    }
    state.width = default_w;
    state.height = default_h;
    state
}

pub fn apply(window: &WebviewWindow, state: &WindowState) {
    use tauri::{PhysicalPosition, PhysicalSize};
    if state.width > 0 && state.height > 0 {
        let _ = window.set_size(PhysicalSize::new(state.width, state.height));
    }
    if let (Some(x), Some(y)) = (state.x, state.y) {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    if state.maximized {
        let _ = window.maximize();
    }
}

pub fn capture(window: &WebviewWindow) -> WindowState {
    let maximized = window.is_maximized().unwrap_or(false);
    let (mut x, mut y) = (None, None);
    let (mut w, mut h) = (0, 0);
    if let Ok(pos) = window.outer_position() {
        x = Some(pos.x);
        y = Some(pos.y);
    }
    if let Ok(size) = window.outer_size() {
        w = size.width;
        h = size.height;
    }
    WindowState { x, y, width: w, height: h, maximized }
}
