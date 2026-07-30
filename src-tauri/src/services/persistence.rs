//! Atomic persistence with last-known-good backup and stepwise migrations
//! (spec §7):
//!   write: serialize → unique temp file in same dir → flush + sync → replace
//!          original → copy fresh file into backups/
//!   load:  main file → backup → safe defaults; corrupted files are moved
//!          aside (`.corrupt-<ts>`), never overwritten.
//!
//! Concurrent `save` calls are serialized with a mutex and write to unique
//! temp names so two in-flight persists cannot delete each other's temp file
//! (which previously surfaced as `AppError::Io` / os error 2 on Windows).
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use parking_lot::Mutex;
use time::OffsetDateTime;

use crate::core::models::{Store, STORE_SCHEMA_VERSION};
use crate::error::AppError;
use super::paths::DataPaths;

pub struct Persistence {
    paths: DataPaths,
    /// Serializes atomic replace so concurrent commands cannot race on the
    /// shared `store.json` / temp path.
    write_lock: Mutex<()>,
    tmp_seq: AtomicU64,
}

fn timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
        .replace([':', '.'], "-")
}

impl Persistence {
    pub fn new(paths: DataPaths) -> Result<Self, AppError> {
        paths.ensure_dirs()?;
        Ok(Self {
            paths,
            write_lock: Mutex::new(()),
            tmp_seq: AtomicU64::new(0),
        })
    }

    pub fn paths(&self) -> &DataPaths {
        &self.paths
    }

    /// Load store: main → backup → defaults. Migrations run stepwise.
    pub fn load(&self) -> Result<(Store, bool), AppError> {
        match self.try_load_file(&self.paths.store) {
            Ok(store) => Ok((self.migrate(store)?, false)),
            Err(primary_err) => {
                let backup_file = self.paths.backups.join("store.json");
                match self.try_load_file(&backup_file) {
                    Ok(store) => {
                        tracing::warn!("主存储损坏，已从备份恢复: {primary_err}");
                        let store = self.migrate(store)?;
                        // Restore backup as the new main file.
                        let _ = self.save(&store);
                        Ok((store, true))
                    }
                    Err(_) => {
                        if self.paths.store.exists() {
                            let ts = timestamp();
                            let moved = self.paths.store.with_file_name(format!(
                                "store.json.corrupt-{ts}"
                            ));
                            let _ = std::fs::rename(&self.paths.store, &moved);
                            tracing::warn!("存储文件损坏且备份不可用，已改名保留: {primary_err}");
                        }
                        Ok((Store::default(), true))
                    }
                }
            }
        }
    }

    fn try_load_file(&self, path: &Path) -> Result<Store, AppError> {
        let raw = std::fs::read_to_string(path).map_err(|e| {
            AppError::Persistence(format!("读取 {} 失败: {e}", path.display()))
        })?;
        let mut value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| AppError::Persistence(format!("解析 {} 失败: {e}", path.display())))?;
        // Pre-flatten era stores used a double-nested pane shape from serde's
        // externally-tagged struct variant. Unwrap so both formats load.
        unwrap_legacy_double_nested_panes(&mut value);
        let store: Store = serde_json::from_value(value)
            .map_err(|e| AppError::Persistence(format!("解析 {} 失败: {e}", path.display())))?;
        Ok(store)
    }

    /// Stepwise migration: each step upgrades version N → N+1.
    pub fn migrate(&self, mut store: Store) -> Result<Store, AppError> {
        while store.schema_version < STORE_SCHEMA_VERSION {
            let from = store.schema_version;
            store = match from {
                1 => migrate_v1_to_v2(store),
                2 => migrate_v2_to_v3(store),
                v => {
                    return Err(AppError::Persistence(format!(
                        "未知的存储版本 {v}，无法迁移（当前支持 {STORE_SCHEMA_VERSION}）"
                    )))
                }
            };
            tracing::info!("存储迁移: v{from} -> v{}", store.schema_version);
        }
        if store.schema_version > STORE_SCHEMA_VERSION {
            return Err(AppError::Persistence(format!(
                "存储版本 {} 高于应用支持的 {STORE_SCHEMA_VERSION}，请升级应用",
                store.schema_version
            )));
        }
        Ok(store)
    }

    /// Atomic write: unique temp → flush → replace → backup copy.
    /// Serialized so concurrent Tauri commands / window-state saves cannot
    /// race on a shared temp path (Windows os error 2).
    pub fn save(&self, store: &Store) -> Result<(), AppError> {
        let _guard = self.write_lock.lock();
        // Recreate data dirs if the user (or cleaner) removed them mid-session.
        self.paths.ensure_dirs()?;

        let seq = self.tmp_seq.fetch_add(1, Ordering::Relaxed);
        // Unique temp name: concurrent saves must not share one path.
        let tmp = self
            .paths
            .root
            .join(format!("store.{}.{}.tmp", std::process::id(), seq));

        let bytes = serde_json::to_vec_pretty(store)
            .map_err(|e| AppError::Persistence(format!("序列化存储失败: {e}")))?;
        std::fs::write(&tmp, &bytes)
            .map_err(|e| AppError::Persistence(format!("写入临时存储失败: {e}")))?;
        // flush + fsync for durability, then replace
        {
            let f = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&tmp)
                .map_err(|e| AppError::Persistence(format!("打开临时存储失败: {e}")))?;
            f.sync_all().ok();
        }

        // Windows cannot rename over an existing file. Remove destination
        // first, then rename; on failure try to leave a recoverable state.
        if self.paths.store.exists() {
            std::fs::remove_file(&self.paths.store)
                .map_err(|e| AppError::Persistence(format!("替换主存储失败: {e}")))?;
        }
        if let Err(e) = std::fs::rename(&tmp, &self.paths.store) {
            // Best-effort: if rename failed but tmp still holds the new data,
            // copy as a fallback so the user does not lose the write.
            match std::fs::copy(&tmp, &self.paths.store) {
                Ok(_) => {
                    let _ = std::fs::remove_file(&tmp);
                }
                Err(copy_err) => {
                    let _ = std::fs::remove_file(&tmp);
                    return Err(AppError::Persistence(format!(
                        "移动主存储失败: {e}（回退复制也失败: {copy_err}）"
                    )));
                }
            }
        }
        // keep last-good backup
        let _ = std::fs::copy(&self.paths.store, self.paths.backups.join("store.json"));
        Ok(())
    }

    pub fn backup_path(&self) -> PathBuf {
        self.paths.backups.join("store.json")
    }
}

// --------------------------------------------------------------- migrations

/// Legacy layout wire shape was `{ "pane": { "pane": { id, profile, ... } } }`.
/// Current (flattened) shape is `{ "pane": { id, profile, ... } }`.
fn unwrap_legacy_double_nested_panes(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(inner) = map.get("pane").cloned() {
                if let serde_json::Value::Object(ref inner_map) = inner {
                    // Double nest: outer key "pane" wraps another object that
                    // itself has "pane" but no pane fields like "profile".
                    if inner_map.contains_key("pane") && !inner_map.contains_key("profile") {
                        if let Some(actual) = inner_map.get("pane") {
                            map.insert("pane".into(), actual.clone());
                        }
                    }
                }
            }
            for child in map.values_mut() {
                unwrap_legacy_double_nested_panes(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                unwrap_legacy_double_nested_panes(item);
            }
        }
        _ => {}
    }
}

fn migrate_v1_to_v2(mut store: Store) -> Store {
    // v1 → v2: sessions gained `sort_order`; ensure defaults & normalization.
    for (i, s) in store.sessions.iter_mut().enumerate() {
        if s.sort_order == 0 {
            s.sort_order = i as i64;
        }
        s.layout.normalize();
    }
    store.schema_version = 2;
    store
}

fn migrate_v2_to_v3(mut store: Store) -> Store {
    // v2 → v3: config gained agent_notifications / statusbar components.
    if store.config.statusbar_components.is_empty() {
        store.config.statusbar_components = crate::core::config::AppConfig::default()
            .statusbar_components;
    }
    store.schema_version = 3;
    store
}

// --------------------------------------------------------------- run state

/// Clean-shutdown marker used for crash-recovery prompts (spec §8).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
    pub clean_shutdown: bool,
    pub pid: u32,
}

pub fn read_run_state(path: &Path) -> Option<RunState> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<RunState>(&s).ok())
}

pub fn write_run_state(path: &Path, clean: bool) {
    let state = RunState { clean_shutdown: clean, pid: std::process::id() };
    if let Ok(json) = serde_json::to_string(&state) {
        let _ = std::fs::write(path, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_paths() -> (tempfile::TempDir, DataPaths) {
        let dir = tempfile::tempdir().unwrap();
        let paths = DataPaths::under(dir.path().to_path_buf());
        paths.ensure_dirs().unwrap();
        (dir, paths)
    }

    #[test]
    fn save_then_load_roundtrip_with_backup() {
        let (_tmp, paths) = tmp_paths();
        let p = Persistence::new(paths.clone()).unwrap();
        let mut store = Store::default();
        store.projects.push(crate::core::models::Project {
            id: "p1".into(),
            name: "demo".into(),
            path: "C:\\demo".into(),
            color: "#694dc9".into(),
            default_profile_id: None,
            created_at: crate::core::models::now_rfc3339(),
            last_accessed_at: crate::core::models::now_rfc3339(),
        });
        p.save(&store).unwrap();
        assert!(paths.store.exists());
        assert!(p.backup_path().exists());
        let (loaded, degraded) = p.load().unwrap();
        assert!(!degraded);
        assert_eq!(loaded.projects.len(), 1);
    }

    #[test]
    fn corrupted_main_recovers_from_backup() {
        let (_tmp, paths) = tmp_paths();
        let p = Persistence::new(paths.clone()).unwrap();
        let store = Store::default();
        p.save(&store).unwrap(); // creates main + backup
        std::fs::write(&paths.store, "{not json").unwrap();
        let (loaded, degraded) = p.load().unwrap();
        assert!(degraded);
        assert_eq!(loaded.schema_version, STORE_SCHEMA_VERSION);
    }

    #[test]
    fn corrupted_main_and_backup_falls_back_moving_file_aside() {
        let (_tmp, paths) = tmp_paths();
        let p = Persistence::new(paths.clone()).unwrap();
        std::fs::write(&paths.store, "{not json").unwrap();
        std::fs::write(p.backup_path(), "{also bad").unwrap();
        let (_, degraded) = p.load().unwrap();
        assert!(degraded);
        assert!(!paths.store.exists(), "corrupt main moved aside");
        let moved = std::fs::read_dir(&paths.root)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with("store.json.corrupt-"));
        assert!(moved);
    }

    #[test]
    fn migration_v1_fills_sort_order_and_versions() {
        let (_tmp, paths) = tmp_paths();
        let p = Persistence::new(paths).unwrap();
        let json = r#"{
            "schemaVersion": 1,
            "projects": [],
            "sessions": [],
            "config": {"schemaVersion": 1}
        }"#;
        std::fs::write(&p.paths.store, json).unwrap();
        let (store, _) = p.load().unwrap();
        assert_eq!(store.schema_version, STORE_SCHEMA_VERSION);
        assert!(!store.config.shortcuts.is_empty(), "defaults merged");
    }

    #[test]
    fn concurrent_saves_do_not_lose_store() {
        use std::sync::Arc;
        use std::thread;

        let (_tmp, paths) = tmp_paths();
        let p = Arc::new(Persistence::new(paths.clone()).unwrap());
        let mut handles = Vec::new();
        for i in 0..8 {
            let p = p.clone();
            handles.push(thread::spawn(move || {
                let mut store = Store::default();
                store.projects.push(crate::core::models::Project {
                    id: format!("p{i}"),
                    name: format!("demo{i}"),
                    path: format!("C:\\demo{i}"),
                    color: "#694dc9".into(),
                    default_profile_id: None,
                    created_at: crate::core::models::now_rfc3339(),
                    last_accessed_at: crate::core::models::now_rfc3339(),
                });
                p.save(&store).expect("concurrent save must succeed");
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert!(paths.store.exists(), "store.json must exist after concurrent saves");
        let (loaded, degraded) = p.load().unwrap();
        assert!(!degraded);
        assert_eq!(loaded.projects.len(), 1, "last writer wins with a valid store");
        // No leftover shared tmp name (unique temps are cleaned on success).
        let leftovers: Vec<_> = std::fs::read_dir(&paths.root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("store.")
                    && e.file_name().to_string_lossy().ends_with(".tmp")
            })
            .collect();
        assert!(leftovers.is_empty(), "temp files cleaned: {leftovers:?}");
    }
}
