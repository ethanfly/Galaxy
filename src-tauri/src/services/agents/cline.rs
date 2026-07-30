//! Cline / Roo Code: VS Code `globalStorage/*/tasks/` (read-only, best-effort).
//! Paths differ by OS / editor (Code, Cursor, VSCodium).
use std::path::{Path, PathBuf};

use super::{message_text, mtime_ms, AgentAdapter, AgentAvailability, CancelToken};
#[cfg(not(windows))]
use super::home_dir;
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

pub struct ClineAdapter {
    kind: AgentKind,
    /// Folder name fragment under globalStorage
    storage_id: &'static str,
    resume_bin: &'static str,
}

impl ClineAdapter {
    pub fn cline() -> Self {
        Self {
            kind: AgentKind::Cline,
            storage_id: "saoudrizwan.claude-dev",
            resume_bin: "cline",
        }
    }

    pub fn roo() -> Self {
        Self {
            kind: AgentKind::Roo,
            storage_id: "rooveterinaryinc.roo-cline",
            resume_bin: "roo",
        }
    }

    fn global_storage_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();
        #[cfg(windows)]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                for app in ["Code", "Code - Insiders", "Cursor", "VSCodium", "Code - OSS"] {
                    roots.push(PathBuf::from(&appdata).join(app).join("User").join("globalStorage"));
                }
            }
        }
        #[cfg(target_os = "macos")]
        {
            if let Some(h) = home_dir() {
                let lib = h.join("Library").join("Application Support");
                for app in ["Code", "Cursor", "VSCodium", "Code - Insiders"] {
                    roots.push(lib.join(app).join("User").join("globalStorage"));
                }
            }
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            if let Some(h) = home_dir() {
                for app in ["Code", "Cursor", "VSCodium", "Code - OSS"] {
                    roots.push(h.join(".config").join(app).join("User").join("globalStorage"));
                }
            }
        }
        roots
    }

    fn task_dirs(&self) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for root in Self::global_storage_roots() {
            let base = root.join(self.storage_id).join("tasks");
            if base.is_dir() {
                out.push(base);
            }
            // Alternate id fragments
            if let Ok(rd) = std::fs::read_dir(&root) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().to_lowercase();
                    if name.contains(&self.storage_id.to_lowercase())
                        || (self.kind == AgentKind::Cline && name.contains("cline"))
                        || (self.kind == AgentKind::Roo && name.contains("roo"))
                    {
                        let tasks = e.path().join("tasks");
                        if tasks.is_dir() {
                            out.push(tasks);
                        }
                    }
                }
            }
        }
        out
    }
}

impl AgentAdapter for ClineAdapter {
    fn kind(&self) -> AgentKind {
        self.kind
    }

    fn availability(&self) -> AgentAvailability {
        let ok = !self.task_dirs().is_empty();
        AgentAvailability {
            kind: Some(self.kind),
            available: ok,
            reason: if ok {
                String::new()
            } else {
                format!(
                    "未找到 {} 任务目录（VS Code/Cursor globalStorage）",
                    self.kind.label()
                )
            },
        }
    }

    fn scan(
        &self,
        project_path: &str,
        since_ms: u64,
        cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let leaf = project_path
            .trim_end_matches(['\\', '/'])
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_lowercase();
        let mut out = Vec::new();
        for tasks in self.task_dirs() {
            let Ok(rd) = std::fs::read_dir(&tasks) else { continue };
            for entry in rd.flatten() {
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    return out;
                }
                let dir = entry.path();
                if !dir.is_dir() {
                    continue;
                }
                if since_ms > 0 && mtime_ms(&dir) < since_ms {
                    continue;
                }
                // ui_messages.json / api_conversation_history.json / task metadata
                let meta_candidates = [
                    dir.join("ui_messages.json"),
                    dir.join("api_conversation_history.json"),
                    dir.join("task.json"),
                    dir.join("metadata.json"),
                ];
                let mut summary = format!("{} 任务", self.kind.label());
                let mut matched = leaf.is_empty();
                let mut source = dir.to_string_lossy().to_string();
                for meta in &meta_candidates {
                    if !meta.is_file() {
                        continue;
                    }
                    source = meta.to_string_lossy().to_string();
                    if let Ok(raw) = std::fs::read_to_string(meta) {
                        let lower = raw.to_lowercase();
                        if !leaf.is_empty()
                            && (lower.contains(&leaf)
                                || lower.contains(&project_path.replace('\\', "/").to_lowercase())
                                || lower.contains(&project_path.replace('/', "\\").to_lowercase()))
                        {
                            matched = true;
                        }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                            if let Some(t) = v
                                .get("task")
                                .or_else(|| v.get("title"))
                                .or_else(|| v.get("name"))
                                .and_then(|x| x.as_str())
                            {
                                summary = t.chars().take(120).collect();
                            }
                        }
                    }
                }
                if !matched {
                    // Also match if any file mentions project path
                    continue;
                }
                let id = dir
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| source.clone());
                out.push(AgentConversation {
                    agent_kind: self.kind,
                    external_id: id.clone(),
                    project_path: project_path.to_string(),
                    summary,
                    last_message_at: None,
                    status: AgentStatus::Idle,
                    resume_command: format!("{} --task {id}", self.resume_bin),
                    source,
                });
            }
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let path = Path::new(&conv.source);
        let file = if path.is_dir() {
            path.join("ui_messages.json")
        } else {
            path.to_path_buf()
        };
        let Ok(raw) = std::fs::read_to_string(&file) else {
            return Vec::new();
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return Vec::new();
        };
        let arr = v
            .as_array()
            .cloned()
            .or_else(|| v.get("messages").and_then(|m| m.as_array()).cloned())
            .unwrap_or_default();
        arr.iter()
            .rev()
            .take(limit)
            .rev()
            .filter_map(|m| {
                Some(AgentMessage {
                    role: m
                        .get("role")
                        .or_else(|| m.get("type"))
                        .and_then(|r| r.as_str())
                        .unwrap_or("assistant")
                        .into(),
                    text: message_text(m)
                        .or_else(|| m.get("text").and_then(|t| t.as_str()).map(String::from))
                        .or_else(|| m.get("say").and_then(|t| t.as_str()).map(String::from))?,
                    at: m.get("ts").and_then(|t| t.as_str()).map(String::from),
                })
            })
            .collect()
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("{} --task {}", self.resume_bin, conv.external_id)
    }
}
