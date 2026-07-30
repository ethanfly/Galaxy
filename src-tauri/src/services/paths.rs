//! Data directory layout (spec §7):
//!   <data>/store.json        — projects, sessions, layouts, settings, window state
//!   <data>/blocks.jsonl      — command blocks
//!   <data>/backups/          — last-known-good backup of store.json
//!   <data>/logs/             — rolling sanitized application logs
//!   <data>/run_state.json    — clean-shutdown flag for crash recovery
use std::path::PathBuf;

use crate::error::AppError;

#[derive(Debug, Clone)]
pub struct DataPaths {
    pub root: PathBuf,
    pub store: PathBuf,
    pub blocks: PathBuf,
    pub backups: PathBuf,
    pub logs: PathBuf,
    pub run_state: PathBuf,
}

impl DataPaths {
    /// `base` is the app data dir chosen by Tauri; tests may pass a temp dir.
    pub fn under(base: PathBuf) -> Self {
        Self {
            store: base.join("store.json"),
            blocks: base.join("blocks.jsonl"),
            backups: base.join("backups"),
            logs: base.join("logs"),
            run_state: base.join("run_state.json"),
            root: base,
        }
    }

    pub fn ensure_dirs(&self) -> Result<(), AppError> {
        for p in [&self.root, &self.backups, &self.logs] {
            std::fs::create_dir_all(p)
                .map_err(|e| AppError::Persistence(format!("创建数据目录失败: {e}")))?;
        }
        Ok(())
    }
}
