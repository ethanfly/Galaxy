//! Application configuration: schema-versioned, persisted inside store.json.
//! Covers general settings, shortcuts, workflows, triggers, layout templates,
//! window state and feature flags (spec §4.1 AppConfig, §5.6).
use serde::{Deserialize, Serialize};

use super::models::ShellProfile;

pub const CONFIG_SCHEMA_VERSION: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    #[serde(default = "default_language")]
    pub language: String, // "zh-CN" | "en-US"
    #[serde(default = "default_terminal_font_size")]
    pub terminal_font_size: u16,
    #[serde(default = "default_ui_font_size")]
    pub ui_font_size: u16,
    /// Theme is always "dark" in the commercial release.
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_profile_id: Option<String>,
    #[serde(default)]
    pub custom_profiles: Vec<ShellProfile>,
    #[serde(default)]
    pub global_hotkey: Option<String>,
    #[serde(default = "default_true")]
    pub context_menu_enabled: bool,
    #[serde(default = "default_true")]
    pub agent_notifications: bool,
    #[serde(default = "default_true")]
    pub trigger_notifications: bool,
    /// When true, check for app updates shortly after startup (default on).
    #[serde(default = "default_true")]
    pub auto_check_update: bool,
    #[serde(default = "default_shortcuts")]
    pub shortcuts: Vec<ShortcutBinding>,
    #[serde(default = "default_statusbar")]
    pub statusbar_components: Vec<String>,
    #[serde(default)]
    pub window_state: WindowState,
    #[serde(default)]
    pub layout_templates: Vec<LayoutTemplate>,
    #[serde(default)]
    pub workflows: Vec<super::workflow::Workflow>,
    #[serde(default)]
    pub triggers: Vec<super::trigger::Trigger>,
    #[serde(default)]
    pub feature_flags: FeatureFlags,
    #[serde(default = "default_true")]
    pub hardware_acceleration: bool,
}

fn default_language() -> String {
    "zh-CN".to_string()
}
fn default_terminal_font_size() -> u16 {
    14
}
fn default_ui_font_size() -> u16 {
    13
}
fn default_theme() -> String {
    "dark".to_string()
}
fn default_true() -> bool {
    true
}
fn default_statusbar() -> Vec<String> {
    vec!["git", "cwd", "sessions", "agent", "notifications", "clock"]
        .into_iter()
        .map(String::from)
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlags {
    #[serde(default = "default_true")]
    pub command_blocks: bool,
    #[serde(default = "default_true")]
    pub agent_panel: bool,
    #[serde(default = "default_true")]
    pub git_panel: bool,
    #[serde(default = "default_true")]
    pub workflows: bool,
    #[serde(default = "default_true")]
    pub triggers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    /// Stable command id (e.g. "tab.close", "pane.splitRight").
    pub command: String,
    /// "Ctrl+Shift+F" style chord; empty = disabled.
    pub keys: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// Outer window geometry in **logical DIPs** (not physical pixels).
/// Capture/apply convert via the window scale factor so OS display scaling
/// does not silently shrink or enlarge the restored window (spec 2026-08-06).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

/// Named layout template saved from a session tree (spec §5.2).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutTemplate {
    pub id: String,
    pub name: String,
    pub created_at: String,
    /// Structural snapshot only (panes become slots; profile data ignored).
    pub node: TemplateNode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TemplateNode {
    Slot,
    Split {
        direction: super::models::SplitDirection,
        ratio: f64,
        first: Box<TemplateNode>,
        second: Box<TemplateNode>,
    },
}

impl TemplateNode {
    pub fn slot_count(&self) -> usize {
        match self {
            TemplateNode::Slot => 1,
            TemplateNode::Split { first, second, .. } => {
                first.slot_count() + second.slot_count()
            }
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            language: default_language(),
            terminal_font_size: default_terminal_font_size(),
            ui_font_size: default_ui_font_size(),
            theme: default_theme(),
            default_profile_id: None,
            custom_profiles: Vec::new(),
            global_hotkey: None,
            context_menu_enabled: true,
            agent_notifications: true,
            trigger_notifications: true,
            auto_check_update: true,
            shortcuts: default_shortcuts(),
            statusbar_components: default_statusbar(),
            window_state: WindowState::default(),
            layout_templates: Vec::new(),
            workflows: Vec::new(),
            triggers: Vec::new(),
            feature_flags: FeatureFlags::default(),
            hardware_acceleration: true,
        }
    }
}

#[cfg(test)]
mod auto_check_update_tests {
    use super::*;

    #[test]
    fn missing_auto_check_update_defaults_to_true() {
        let json = r#"{"schemaVersion":3,"language":"zh-CN"}"#;
        let cfg: AppConfig = serde_json::from_str(json).expect("parse");
        assert!(cfg.auto_check_update);
    }

    #[test]
    fn default_config_enables_auto_check_update() {
        assert!(AppConfig::default().auto_check_update);
    }
}

/// The default shortcut table (spec §5.6, root doc tables).
pub fn default_shortcuts() -> Vec<ShortcutBinding> {
    use ShortcutBinding as S;
    fn b(command: &str, keys: &str) -> S {
        S { command: command.into(), keys: keys.into(), enabled: true }
    }
    vec![
        b("terminal.new", "Ctrl+Shift+T"),
        b("tab.close", "Ctrl+W"),
        b("tab.rename", "Ctrl+Shift+R"),
        b("pane.splitRight", "Ctrl+Shift+D"),
        b("pane.splitDown", "Ctrl+Shift+E"),
        b("pane.close", "Ctrl+Shift+W"),
        b("pane.focusLeft", "Alt+ArrowLeft"),
        b("pane.focusRight", "Alt+ArrowRight"),
        b("pane.focusUp", "Alt+ArrowUp"),
        b("pane.focusDown", "Alt+ArrowDown"),
        b("pane.resizeLeft", "Alt+Shift+ArrowLeft"),
        b("pane.resizeRight", "Alt+Shift+ArrowRight"),
        b("pane.resizeUp", "Alt+Shift+ArrowUp"),
        b("pane.resizeDown", "Alt+Shift+ArrowDown"),
        b("pane.syncInput", "Ctrl+Shift+I"),
        b("search.find", "Ctrl+F"),
        b("search.blocks", "Ctrl+Shift+F"),
        b("search.history", "Ctrl+R"),
        b("command.palette", "Ctrl+P"),
        b("settings.open", "Ctrl+,"),
        b("panel.agent", "Ctrl+Shift+A"),
        b("panel.git", "Ctrl+Shift+G"),
        b("panel.notifications", "Ctrl+Shift+N"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcuts_have_no_conflicts() {
        let mut seen = std::collections::HashSet::new();
        for s in default_shortcuts() {
            assert!(s.enabled && !s.keys.is_empty());
            assert!(seen.insert(s.keys.clone()), "duplicate chord {}", s.keys);
        }
    }

    #[test]
    fn config_roundtrips_with_defaults() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let back: AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg, back);
    }

    #[test]
    fn partial_config_falls_back_to_defaults() {
        let back: AppConfig =
            serde_json::from_str(r#"{"schemaVersion": 1, "terminalFontSize": 18}"#).unwrap();
        assert_eq!(back.terminal_font_size, 18);
        assert_eq!(back.language, "zh-CN");
        assert!(!back.shortcuts.is_empty());
    }
}
