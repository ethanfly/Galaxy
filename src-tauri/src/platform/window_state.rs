//! Window state memory (spec §5.7): position / size / maximized persisted
//! in AppConfig as **logical DIPs**, clamped back into the visible monitor
//! area after display / OS scale changes (spec 2026-08-06).
use tauri::{Manager, WebviewWindow};

use crate::core::config::WindowState;

/// Convert a physical extent to logical DIPs using the given scale factor.
pub fn physical_to_logical_u32(value: u32, scale: f64) -> u32 {
    if scale <= 0.0 {
        return value;
    }
    ((value as f64) / scale).round().max(0.0) as u32
}

/// Convert a physical coordinate to logical DIPs.
pub fn physical_to_logical_i32(value: i32, scale: f64) -> i32 {
    if scale <= 0.0 {
        return value;
    }
    ((value as f64) / scale).round() as i32
}

pub fn clamp_to_monitors(window: &WebviewWindow, mut state: WindowState) -> WindowState {
    let default_w = state.width.max(800);
    let default_h = state.height.max(520);
    let (Some(x), Some(y)) = (state.x, state.y) else {
        return WindowState {
            width: default_w,
            height: default_h,
            ..state
        };
    };
    let Ok(monitors) = window.app_handle().available_monitors() else {
        return WindowState {
            width: default_w,
            height: default_h,
            ..state
        };
    };
    // Stored x/y are logical; monitor APIs return physical — convert per monitor.
    let visible = monitors.iter().any(|m| {
        let scale = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let mx = physical_to_logical_i32(pos.x, scale);
        let my = physical_to_logical_i32(pos.y, scale);
        let mw = physical_to_logical_u32(size.width, scale) as i32;
        let mh = physical_to_logical_u32(size.height, scale) as i32;
        x >= mx && y >= my && x < mx + mw && y < my + mh
    });
    if !visible {
        state.x = None;
        state.y = None;
    }
    // Cap logical size to the largest monitor so legacy physical-pixel
    // values (from pre-DIP storage) do not restore as enormous windows.
    let max_w = monitors
        .iter()
        .map(|m| physical_to_logical_u32(m.size().width, m.scale_factor()))
        .max()
        .unwrap_or(default_w)
        .max(800);
    let max_h = monitors
        .iter()
        .map(|m| physical_to_logical_u32(m.size().height, m.scale_factor()))
        .max()
        .unwrap_or(default_h)
        .max(520);
    state.width = default_w.min(max_w);
    state.height = default_h.min(max_h);
    state
}

pub fn apply(window: &WebviewWindow, state: &WindowState) {
    use tauri::{LogicalPosition, LogicalSize};
    if state.width > 0 && state.height > 0 {
        let _ = window.set_size(LogicalSize::new(state.width, state.height));
    }
    if let (Some(x), Some(y)) = (state.x, state.y) {
        let _ = window.set_position(LogicalPosition::new(x, y));
    }
    if state.maximized {
        let _ = window.maximize();
    }
}

pub fn capture(window: &WebviewWindow) -> WindowState {
    let maximized = window.is_maximized().unwrap_or(false);
    let scale = window.scale_factor().unwrap_or(1.0);
    let (mut x, mut y) = (None, None);
    let (mut w, mut h) = (0u32, 0u32);
    if let Ok(pos) = window.outer_position() {
        x = Some(physical_to_logical_i32(pos.x, scale));
        y = Some(physical_to_logical_i32(pos.y, scale));
    }
    if let Ok(size) = window.outer_size() {
        w = physical_to_logical_u32(size.width, scale);
        h = physical_to_logical_u32(size.height, scale);
    }
    WindowState {
        x,
        y,
        width: w,
        height: h,
        maximized,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physical_to_logical_divides_by_scale() {
        assert_eq!(physical_to_logical_u32(2160, 1.5), 1440);
        assert_eq!(physical_to_logical_u32(1440, 1.0), 1440);
        assert_eq!(physical_to_logical_i32(150, 1.5), 100);
        assert_eq!(physical_to_logical_u32(100, 0.0), 100);
    }
}
