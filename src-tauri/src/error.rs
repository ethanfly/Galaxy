//! Unified error type. All Tauri commands return `CmdResult<T>` whose error
//! carries a machine-readable code and a user-facing message (no Rust stack
//! traces reach the UI).
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("invariant violation: {0}")]
    Invariant(String),
    #[error("persistence error: {0}")]
    Persistence(String),
    #[error("pty error: {0}")]
    Pty(String),
    #[error("git error: {0}")]
    Git(String),
    #[error("agent error: {0}")]
    Agent(String),
    #[error("platform error: {0}")]
    Platform(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdError {
    /// Machine readable code, e.g. "PT_NOT_FOUND", "GIT_CHECKOUT_CONFLICT".
    pub code: String,
    /// User-facing message: what happened, scope of impact, next step.
    pub message: String,
    /// Optional structured details (e.g. git stderr for conflict display).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl CmdError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), detail: None }
    }
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

impl AppError {
    pub fn to_cmd(&self) -> CmdError {
        match self {
            AppError::NotFound(m) => CmdError::new("NOT_FOUND", m.clone()),
            AppError::InvalidInput(m) => CmdError::new("INVALID_INPUT", m.clone()),
            AppError::Invariant(m) => CmdError::new("INVARIANT", m.clone()),
            AppError::Persistence(m) => CmdError::new("PERSISTENCE", m.clone()),
            AppError::Pty(m) => CmdError::new("PTY", m.clone()),
            AppError::Git(m) => CmdError::new("GIT", m.clone()),
            AppError::Agent(m) => CmdError::new("AGENT", m.clone()),
            AppError::Platform(m) => CmdError::new("PLATFORM", m.clone()),
            AppError::Io(e) => CmdError::new("IO", format!("系统 I/O 失败: {e}")),
            AppError::Json(e) => CmdError::new("SERIALIZE", format!("数据序列化失败: {e}")),
            AppError::Internal(m) => CmdError::new("INTERNAL", m.clone()),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.to_cmd().serialize(s)
    }
}

pub type CmdResult<T> = Result<T, CmdError>;

pub trait IntoCmd<T> {
    fn cmd(self) -> CmdResult<T>;
}
impl<T> IntoCmd<T> for Result<T, AppError> {
    fn cmd(self) -> CmdResult<T> {
        self.map_err(|e| e.to_cmd())
    }
}
