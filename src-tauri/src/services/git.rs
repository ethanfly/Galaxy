//! Git service (spec §5.5). Git is always executed with an argument array —
//! never by interpolating strings into an interactive shell. Destructive
//! operations (stash/reset/clean) are never invoked automatically.
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use parking_lot::Mutex;

use crate::core::models::{GitBranch, GitFileChange, GitStatus};
use crate::error::AppError;
use crate::services::logging;

pub struct GitService {
    /// Lazily probed on first use so cold start does not spawn `git --version`.
    git_available: OnceLock<bool>,
    cache: Mutex<std::collections::HashMap<String, Arc<Mutex<GitStatus>>>>,
    watchers: Mutex<std::collections::HashMap<String, notify::RecommendedWatcher>>,
}

fn run_git(dir: &Path, args: &[&str]) -> Result<String, AppError> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    cmd.stdin(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| {
        AppError::Git(format!(
            "无法启动 git: {e}（请确认 git 已安装并在 PATH 中）"
        ))
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(AppError::Git(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ))
    }
}

impl Default for GitService {
    fn default() -> Self {
        Self::new()
    }
}

fn probe_git_available() -> bool {
    let mut cmd = Command::new("git");
    cmd.arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

impl GitService {
    pub fn new() -> Self {
        Self {
            git_available: OnceLock::new(),
            cache: Mutex::new(std::collections::HashMap::new()),
            watchers: Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn is_available(&self) -> bool {
        *self.git_available.get_or_init(probe_git_available)
    }

    pub fn is_repo(&self, path: &Path) -> bool {
        if !self.is_available() {
            return false;
        }
        run_git(path, &["rev-parse", "--is-inside-work-tree"])
            .map(|s| s.trim() == "true")
            .unwrap_or(false)
    }

    /// Fresh status read (also updates the per-project cache).
    pub fn status(&self, path: &Path) -> GitStatus {
        let mut status = GitStatus {
            git_available: self.is_available(),
            ..Default::default()
        };
        if !self.is_available() || !self.is_repo(path) {
            return status;
        }
        status.is_repo = true;

        if let Ok(head) = run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
            let b = head.trim();
            status.branch = if b == "HEAD" {
                None
            } else {
                Some(b.to_string())
            };
        }
        if let Ok(counts) = run_git(
            path,
            &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
        ) {
            let mut it = counts.split_whitespace();
            status.behind = it.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            status.ahead = it.next().and_then(|n| n.parse().ok()).unwrap_or(0);
        }
        if let Ok(porcelain) = run_git(path, &["status", "--porcelain=v1"]) {
            status.changes = parse_porcelain(&porcelain);
        }

        let key = path.to_string_lossy().to_string();
        let mut cache = self.cache.lock();
        match cache.entry(key) {
            std::collections::hash_map::Entry::Occupied(e) => {
                *e.get().lock() = status.clone();
            }
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(Arc::new(Mutex::new(status.clone())));
            }
        }
        status
    }

    pub fn branches(&self, path: &Path) -> Result<Vec<GitBranch>, AppError> {
        let out = run_git(
            path,
            &["branch", "--format=%(refname:short) %(HEAD)", "--list"],
        )?;
        Ok(out
            .lines()
            .filter_map(|l| {
                let l = l.trim();
                if l.is_empty() {
                    return None;
                }
                let current = l.ends_with(" (HEAD)") || l.split_whitespace().nth(1) == Some("*");
                let name = l.split_whitespace().next().unwrap_or("").to_string();
                if name.is_empty() {
                    None
                } else {
                    Some(GitBranch { name, current })
                }
            })
            .collect())
    }

    /// Checkout must fail safely: git's own error is surfaced verbatim to the
    /// UI so conflicts are visible; we never stash or discard automatically.
    pub fn checkout(&self, path: &Path, branch: &str) -> Result<(), AppError> {
        // The branch must be one that git itself listed (also prevents arg injection).
        let branches = self.branches(path)?;
        if !branches.iter().any(|b| b.name == branch) {
            return Err(AppError::Git(format!("分支不存在: {branch}")));
        }
        run_git(path, &["checkout", branch])
            .map(|_| ())
            .map_err(|e| {
                let msg = match e {
                    AppError::Git(m) => m,
                    other => other.to_string(),
                };
                AppError::Git(
                    if msg.contains("would be overwritten") || msg.contains("Please commit") {
                        format!(
                            "切换分支可能与未提交改动冲突，请先提交或处理工作区。\nGit 返回: {msg}"
                        )
                    } else {
                        msg
                    },
                )
            })
    }

    /// Register `.git` watchers for every project; idempotent. Watchers
    /// receive the project id so stale branch/status can be refreshed.
    pub fn watch_all(
        &self,
        projects: &[(String, PathBuf)],
        on_change: Arc<dyn Fn(String) + Send + Sync>,
    ) {
        for (id, path) in projects {
            if let Err(e) = self.watch_repo(path, id, on_change.clone()) {
                tracing::warn!(
                    "Git 目录监视失败 {}: {}",
                    logging::redact(&path.to_string_lossy()),
                    logging::redact(&e.to_string())
                );
            }
        }
    }

    /// Watch `.git` for changes; callback receives the project path. Watchers
    /// are debounced coarsely (400ms) so checkpoint storms don't flood the UI.
    pub fn watch_repo(
        &self,
        path: &Path,
        project_id: &str,
        on_change: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<(), AppError> {
        let git_dir = path.join(".git");
        if !git_dir.is_dir() {
            return Ok(());
        }
        let key = path.to_string_lossy().to_string();
        if self.watchers.lock().contains_key(&key) {
            return Ok(());
        }
        let armed = Arc::new(AtomicBool::new(true));
        let armed_clone = armed.clone();
        let pid = project_id.to_string();
        let cb = on_change.clone();
        let watcher = notify::recommended_watcher(move |_res: notify::Result<notify::Event>| {
            if armed_clone.swap(false, Ordering::SeqCst) {
                let armed = armed_clone.clone();
                let pid = pid.clone();
                let cb = cb.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(400));
                    armed.store(true, Ordering::SeqCst);
                    cb(pid);
                });
            }
        })
        .map_err(|e| AppError::Git(format!("无法监视 Git 目录: {e}")))?;
        let mut watcher = watcher;
        use notify::Watcher;
        watcher
            .watch(Path::new(&git_dir), notify::RecursiveMode::Recursive)
            .map_err(|e| AppError::Git(format!("无法监视 Git 目录: {e}")))?;
        self.watchers.lock().insert(key, watcher);
        Ok(())
    }

    pub fn unwatch(&self, path: &Path) {
        self.watchers
            .lock()
            .remove(&path.to_string_lossy().to_string());
    }
}

fn parse_porcelain(raw: &str) -> Vec<GitFileChange> {
    raw.lines()
        .filter_map(|l| {
            if l.len() < 4 {
                return None;
            }
            let x = l.as_bytes()[0] as char;
            let y = l.as_bytes()[1] as char;
            let path = l[3..].trim().trim_matches('"').to_string();
            if path.is_empty() {
                return None;
            }
            let (status, staged) = match (x, y) {
                ('?', _) => ("?".to_string(), false),
                ('!', _) => return None,
                (' ', c) if c != ' ' => (c.to_string(), false),
                (c, _) if c != ' ' => (c.to_string(), true),
                _ => return None,
            };
            Some(GitFileChange {
                path,
                status,
                staged,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_parsing() {
        let raw = " M src/main.rs\nA  new.rs\n?? untracked.txt\nD  gone.rs\n R old.rs -> new.rs\n";
        let changes = parse_porcelain(raw);
        assert_eq!(changes.len(), 5);
        let new = changes.iter().find(|c| c.path == "new.rs").unwrap();
        assert!(new.staged);
        let m = changes.iter().find(|c| c.path == "src/main.rs").unwrap();
        assert!(!m.staged);
    }

    #[test]
    fn checkout_rejects_unknown_branch_even_when_repo_missing() {
        // Without a repo this fails at branches(), which is the safe path.
        let svc = GitService::new();
        let res = svc.checkout(Path::new("C:\\definitely\\not\\a\\repo\\xyz123"), "main");
        assert!(res.is_err());
    }
}
