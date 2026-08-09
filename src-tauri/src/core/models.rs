//! Domain entities (`4.1` of the design spec) and DTOs shared with the UI.
//! The Rust backend is the single source of truth for all of these.
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

// ---------------------------------------------------------------- Project

pub const DEFAULT_PROJECT_COLOR: &str = "#f5f6f7";
pub const PREVIOUS_DEFAULT_PROJECT_COLOR: &str = "#39b98a";
pub const LEGACY_DEFAULT_PROJECT_COLOR: &str = "#694dc9";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    /// Normalized absolute path (canonical separators, no trailing slash).
    pub path: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_profile_id: Option<String>,
    pub created_at: String,
    pub last_accessed_at: String,
}

// ---------------------------------------------------------------- Agent kinds

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum AgentKind {
    ClaudeCode,
    Codex,
    OpenCode,
    Omp,
    Grok,
    Crush,
    /// Google Gemini CLI
    Gemini,
    /// GitHub Copilot CLI
    Copilot,
    /// Aider
    Aider,
    /// Block Goose
    Goose,
    /// Qwen Code
    Qwen,
    /// Kimi CLI
    Kimi,
    /// Cline (VS Code / CLI)
    Cline,
    /// Roo Code
    Roo,
    /// Continue.dev
    Continue,
    /// Cursor Agent
    Cursor,
    /// Pi coding agent (badlogic/pi-mono)
    Pi,
    /// Hermes Agent (Nous Research)
    Hermes,
    /// OpenClaw
    OpenClaw,
    /// Google Antigravity CLI
    Antigravity,
    /// Amp / Factory CLI
    Amp,
    /// Reasonix (DeepSeek coding agent)
    Reasonix,
}

impl AgentKind {
    pub const ALL: [AgentKind; 22] = [
        AgentKind::ClaudeCode,
        AgentKind::Codex,
        AgentKind::OpenCode,
        AgentKind::Omp,
        AgentKind::Grok,
        AgentKind::Crush,
        AgentKind::Gemini,
        AgentKind::Copilot,
        AgentKind::Aider,
        AgentKind::Goose,
        AgentKind::Qwen,
        AgentKind::Kimi,
        AgentKind::Cline,
        AgentKind::Roo,
        AgentKind::Continue,
        AgentKind::Cursor,
        AgentKind::Pi,
        AgentKind::Hermes,
        AgentKind::OpenClaw,
        AgentKind::Antigravity,
        AgentKind::Amp,
        AgentKind::Reasonix,
    ];

    pub fn id(self) -> &'static str {
        match self {
            AgentKind::ClaudeCode => "claude-code",
            AgentKind::Codex => "codex",
            AgentKind::OpenCode => "opencode",
            AgentKind::Omp => "omp",
            AgentKind::Grok => "grok",
            AgentKind::Crush => "crush",
            AgentKind::Gemini => "gemini",
            AgentKind::Copilot => "copilot",
            AgentKind::Aider => "aider",
            AgentKind::Goose => "goose",
            AgentKind::Qwen => "qwen",
            AgentKind::Kimi => "kimi",
            AgentKind::Cline => "cline",
            AgentKind::Roo => "roo",
            AgentKind::Continue => "continue",
            AgentKind::Cursor => "cursor",
            AgentKind::Pi => "pi",
            AgentKind::Hermes => "hermes",
            AgentKind::OpenClaw => "openclaw",
            AgentKind::Antigravity => "antigravity",
            AgentKind::Amp => "amp",
            AgentKind::Reasonix => "reasonix",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            AgentKind::ClaudeCode => "Claude Code",
            AgentKind::Codex => "Codex CLI",
            AgentKind::OpenCode => "OpenCode",
            AgentKind::Omp => "OMP",
            AgentKind::Grok => "Grok Build",
            AgentKind::Crush => "Crush",
            AgentKind::Gemini => "Gemini CLI",
            AgentKind::Copilot => "GitHub Copilot CLI",
            AgentKind::Aider => "Aider",
            AgentKind::Goose => "Goose",
            AgentKind::Qwen => "Qwen Code",
            AgentKind::Kimi => "Kimi CLI",
            AgentKind::Cline => "Cline",
            AgentKind::Roo => "Roo Code",
            AgentKind::Continue => "Continue",
            AgentKind::Cursor => "Cursor Agent",
            AgentKind::Pi => "Pi",
            AgentKind::Hermes => "Hermes",
            AgentKind::OpenClaw => "OpenClaw",
            AgentKind::Antigravity => "Antigravity",
            AgentKind::Amp => "Amp / Factory",
            AgentKind::Reasonix => "Reasonix",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    #[default]
    Idle,
    Working,
    Blocked,
    Done,
}

// ---------------------------------------------------------------- Shell profiles

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProfileSource {
    Detected,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub id: String,
    pub name: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    pub source: ProfileSource,
}

// ---------------------------------------------------------------- Panes & layout

/// Metadata that lets a pane re-inject an agent resume command after its PTY
/// has been spawned (e.g. on app restart).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResumeMeta {
    pub agent_kind: AgentKind,
    pub external_id: String,
    /// Command generated by the adapter only — never raw history file data.
    pub resume_command: String,
    /// Prevent double injection.
    #[serde(default)]
    pub injected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pane {
    pub id: String,
    pub cwd: String,
    pub profile: ShellProfile,
    pub cols: u16,
    pub rows: u16,
    /// Dynamic title from OSC 0 (basename-simplified); empty falls back to
    /// "终端 N" at presentation time.
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_kind: Option<AgentKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume: Option<ResumeMeta>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SplitDirection {
    /// Children laid out left|right.
    Row,
    /// Children laid out top/bottom.
    Column,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LayoutNode {
    /// Flattened so the wire shape is `{ "pane": { id, profile, ... } }`
    /// (matches the TS `LayoutNodeRust` contract). Without `flatten`, serde's
    /// externally-tagged struct variant would emit a double nest
    /// `{ "pane": { "pane": { ... } } }` and the UI would crash on `profile`.
    Pane {
        #[serde(flatten)]
        pane: Pane,
    },
    Split {
        direction: SplitDirection,
        /// Fraction of space given to `first` (0.05..=0.95).
        ratio: f64,
        first: Box<LayoutNode>,
        second: Box<LayoutNode>,
    },
}

// ---------------------------------------------------------------- Session

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_kind: Option<AgentKind>,
    pub layout: LayoutNode,
    #[serde(default)]
    pub sync_input: bool,
    pub created_at: String,
}

// ---------------------------------------------------------------- Command blocks

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandBlock {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub pane_id: String,
    pub command: String,
    #[serde(default)]
    pub output: String,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_kind: Option<AgentKind>,
    #[serde(default)]
    pub favorite: bool,
}

// ---------------------------------------------------------------- Agent conversations

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConversation {
    pub agent_kind: AgentKind,
    pub external_id: String,
    pub project_path: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_at: Option<String>,
    #[serde(default)]
    pub status: AgentStatus,
    /// Adapter-generated resume command.
    #[serde(default)]
    pub resume_command: String,
    /// Locator the adapter needs to re-read messages (file path / db path+row).
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub role: String,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
}

// ---------------------------------------------------------------- Notifications

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub id: String,
    pub at: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub read: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
    /// Optional UI action id, e.g. `"app.relaunch"` after a silent update install.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}

// ---------------------------------------------------------------- Git

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    pub path: String,
    pub status: String, // "M" | "A" | "D" | "?" | "R" | "U"
    #[serde(default)]
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default)]
    pub ahead: i64,
    #[serde(default)]
    pub behind: i64,
    #[serde(default)]
    pub changes: Vec<GitFileChange>,
    #[serde(default)]
    pub git_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

// ---------------------------------------------------------------- Store root

/// Bump on breaking change; migrations run stepwise from the on-disk version.
pub const STORE_SCHEMA_VERSION: u32 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub schema_version: u32,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub sessions: Vec<Session>,
    #[serde(default)]
    pub config: crate::core::config::AppConfig,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            schema_version: STORE_SCHEMA_VERSION,
            projects: Vec::new(),
            sessions: Vec::new(),
            config: Default::default(),
        }
    }
}
