//! Unified PTY backend interface. The Windows implementation uses ConPTY
//! (via portable-pty); a Unix PTY implementation can be substituted without
//! touching the manager or the UI (spec §3.1).
use std::io::Read;

use serde::{Deserialize, Serialize};

use crate::core::models::ShellProfile;
use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct PtySpec {
    pub program: String,
    pub args: Vec<String>,
    pub env: std::collections::BTreeMap<String, String>,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

impl PtySpec {
    pub fn from_profile(profile: &ShellProfile, cwd: &str) -> Self {
        Self {
            program: profile.program.clone(),
            args: profile.args.clone(),
            env: profile.env.clone(),
            cwd: cwd.to_string(),
            cols: crate::core::layout::DEFAULT_COLS,
            rows: crate::core::layout::DEFAULT_ROWS,
        }
    }
}

/// A running pseudo-terminal process.
pub trait PtyProcess: Send {
    /// Take the output reader (called once, moved into a reader thread).
    fn take_reader(&mut self) -> Result<Box<dyn Read + Send>, AppError>;
    fn write(&mut self, data: &[u8]) -> Result<(), AppError>;
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), AppError>;
    fn kill(&mut self) -> Result<(), AppError>;
    fn try_wait(&mut self) -> Result<Option<i32>, AppError>;
    fn pid(&self) -> Option<u32>;
}

pub trait PtyBackend: Send + Sync {
    /// Human readable backend name for diagnostics ("ConPTY" / "UnixPTY").
    fn name(&self) -> &'static str;
    fn spawn(&self, spec: &PtySpec) -> Result<Box<dyn PtyProcess>, AppError>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitEvent {
    pub pane_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}
