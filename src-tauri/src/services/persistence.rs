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
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use time::OffsetDateTime;

use super::paths::DataPaths;
use crate::core::models::{Store, STORE_SCHEMA_VERSION};
use crate::error::AppError;

static RUN_STATE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static RUN_STATE_TMP_SEQ: AtomicU64 = AtomicU64::new(0);

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
                            let moved = self
                                .paths
                                .store
                                .with_file_name(format!("store.json.corrupt-{ts}"));
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
        let raw = std::fs::read_to_string(path)
            .map_err(|e| AppError::Persistence(format!("读取 {} 失败: {e}", path.display())))?;
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
        self.save_with_commit(store, atomic_replace_file)
    }

    fn save_with_commit(
        &self,
        store: &Store,
        commit: fn(&Path, &Path) -> std::io::Result<()>,
    ) -> Result<(), AppError> {
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
        let result = (|| -> Result<(), AppError> {
            std::fs::write(&tmp, &bytes)
                .map_err(|e| AppError::Persistence(format!("写入临时存储失败: {e}")))?;
            let f = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&tmp)
                .map_err(|e| AppError::Persistence(format!("打开临时存储失败: {e}")))?;
            f.sync_all()
                .map_err(|e| AppError::Persistence(format!("同步临时存储失败: {e}")))?;
            drop(f);

            commit(&tmp, &self.paths.store)
                .map_err(|e| AppError::Persistence(format!("提交主存储失败: {e}")))?;
            // Keep last-good backup after the main commit succeeds.
            let _ = std::fs::copy(&self.paths.store, self.paths.backups.join("store.json"));
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        result
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
        store.config.statusbar_components =
            crate::core::config::AppConfig::default().statusbar_components;
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
    match std::fs::read_to_string(path) {
        Ok(raw) => Some(serde_json::from_str::<RunState>(&raw).unwrap_or(RunState {
            clean_shutdown: false,
            pid: 0,
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => Some(RunState {
            clean_shutdown: false,
            pid: 0,
        }),
    }
}

#[cfg(windows)]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn wide_path(path: &Path) -> std::io::Result<Vec<u16>> {
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        if wide.contains(&0) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "path contains an interior NUL",
            ));
        }
        wide.push(0);
        Ok(wide)
    }

    let source = wide_path(source)?;
    let destination = wide_path(destination)?;
    // Both UTF-16 buffers are NUL-terminated and remain alive for the call.
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

pub fn write_run_state(path: &Path, clean: bool) -> Result<(), AppError> {
    let _guard = RUN_STATE_WRITE_LOCK.lock();
    let state = RunState {
        clean_shutdown: clean,
        pid: std::process::id(),
    };
    let bytes = serde_json::to_vec(&state)
        .map_err(|error| AppError::Persistence(format!("序列化运行状态失败: {error}")))?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Persistence("运行状态路径缺少父目录".into()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| AppError::Persistence(format!("创建运行状态目录失败: {error}")))?;

    let seq = RUN_STATE_TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_file_name(format!(".run_state.{}.{}.tmp", std::process::id(), seq));
    let result = (|| -> Result<(), AppError> {
        std::fs::write(&tmp, bytes)
            .map_err(|error| AppError::Persistence(format!("写入临时运行状态失败: {error}")))?;
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&tmp)
            .and_then(|file| file.sync_all())
            .map_err(|error| AppError::Persistence(format!("同步运行状态失败: {error}")))?;

        atomic_replace_file(&tmp, path)
            .map_err(|error| AppError::Persistence(format!("提交运行状态失败: {error}")))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
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
            .any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("store.json.corrupt-")
            });
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
    fn malformed_run_state_is_treated_as_an_unclean_shutdown() {
        let (tmp, _) = tmp_paths();
        let path = tmp.path().join("run_state.json");
        std::fs::write(&path, "{truncated").unwrap();

        let state = read_run_state(&path).expect("a malformed marker must be conservative");
        assert!(!state.clean_shutdown);
    }

    #[test]
    fn run_state_write_failures_are_reported() {
        let (tmp, _) = tmp_paths();
        let path = tmp.path().join("run_state.json");
        std::fs::create_dir(&path).unwrap();

        write_run_state(&path, false).expect_err("a directory cannot be replaced by the marker");
    }

    #[cfg(windows)]
    #[test]
    fn atomic_replace_overwrites_existing_run_state() {
        let (tmp, _) = tmp_paths();
        let source = tmp.path().join("run_state.tmp");
        let destination = tmp.path().join("run_state.json");
        std::fs::write(&source, b"new marker").unwrap();
        std::fs::write(&destination, b"old marker").unwrap();

        atomic_replace_file(&source, &destination).expect("atomic replacement should succeed");

        assert_eq!(std::fs::read(&destination).unwrap(), b"new marker");
        assert!(
            !source.exists(),
            "a successful move consumes the temporary file"
        );
    }

    #[cfg(windows)]
    #[test]
    fn failed_atomic_replace_preserves_existing_run_state() {
        use std::os::windows::fs::OpenOptionsExt;

        let (tmp, _) = tmp_paths();
        let source = tmp.path().join("run_state.tmp");
        let destination = tmp.path().join("run_state.json");
        std::fs::write(&source, b"new marker").unwrap();
        std::fs::write(&destination, b"old marker").unwrap();

        // Excluding FILE_SHARE_DELETE makes moving this source fail deterministically.
        let _locked_source = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0x1 | 0x2)
            .open(&source)
            .unwrap();

        atomic_replace_file(&source, &destination)
            .expect_err("a locked source cannot be atomically moved");

        assert_eq!(std::fs::read(&destination).unwrap(), b"old marker");
    }

    fn store_with_project(id: &str) -> Store {
        let mut store = Store::default();
        store.projects.push(crate::core::models::Project {
            id: id.into(),
            name: id.into(),
            path: format!("C:\\{id}"),
            color: "#694dc9".into(),
            default_profile_id: None,
            created_at: crate::core::models::now_rfc3339(),
            last_accessed_at: crate::core::models::now_rfc3339(),
        });
        store
    }

    fn reject_store_commit(source: &Path, destination: &Path) -> std::io::Result<()> {
        assert!(
            source.exists(),
            "the complete temporary store must exist before commit"
        );
        assert!(
            destination.exists(),
            "the old main store must exist until commit"
        );
        Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "injected commit failure",
        ))
    }

    #[test]
    fn failed_store_commit_preserves_existing_main() {
        let (_tmp, paths) = tmp_paths();
        let persistence = Persistence::new(paths.clone()).unwrap();
        persistence.save(&store_with_project("old")).unwrap();

        persistence
            .save_with_commit(&store_with_project("new"), reject_store_commit)
            .expect_err("the injected commit must fail");

        let raw = std::fs::read(&paths.store).expect("the old main store must remain readable");
        let persisted: Store = serde_json::from_slice(&raw).unwrap();
        assert_eq!(persisted.projects[0].id, "old");
    }

    #[test]
    fn failed_store_commit_cleans_temporary_file() {
        let (_tmp, paths) = tmp_paths();
        let persistence = Persistence::new(paths.clone()).unwrap();
        persistence.save(&store_with_project("old")).unwrap();

        persistence
            .save_with_commit(&store_with_project("new"), reject_store_commit)
            .expect_err("the injected commit must fail");

        let leftovers: Vec<_> = std::fs::read_dir(&paths.root)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with("store.") && name.ends_with(".tmp")
            })
            .collect();
        assert!(
            leftovers.is_empty(),
            "temporary files remain: {leftovers:?}"
        );
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
        assert!(
            paths.store.exists(),
            "store.json must exist after concurrent saves"
        );
        let (loaded, degraded) = p.load().unwrap();
        assert!(!degraded);
        assert_eq!(
            loaded.projects.len(),
            1,
            "last writer wins with a valid store"
        );
        // No leftover shared tmp name (unique temps are cleaned on success).
        let leftovers: Vec<_> = std::fs::read_dir(&paths.root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name().to_string_lossy().starts_with("store.")
                    && e.file_name().to_string_lossy().ends_with(".tmp")
            })
            .collect();
        assert!(leftovers.is_empty(), "temp files cleaned: {leftovers:?}");
    }
}
