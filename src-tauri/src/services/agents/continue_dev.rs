//! Continue.dev: `~/.continue/sessions` or project `.continue/` (read-only).
use std::path::{Path, PathBuf};

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter,
    AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct ContinueAdapter;

impl ContinueAdapter {
    fn bases(project_path: &str) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(h) = home_dir() {
            out.push(h.join(".continue").join("sessions"));
            out.push(h.join(".continue"));
        }
        out.push(PathBuf::from(project_path).join(".continue").join("sessions"));
        out.push(PathBuf::from(project_path).join(".continue"));
        out
    }
}

impl AgentAdapter for ContinueAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Continue
    }

    fn availability(&self) -> AgentAvailability {
        let ok = home_dir()
            .map(|h| h.join(".continue").exists())
            .unwrap_or(false);
        AgentAvailability {
            kind: Some(self.kind()),
            available: ok,
            reason: if ok {
                String::new()
            } else {
                "未找到 ~/.continue，可能未使用 Continue".into()
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
        for base in Self::bases(project_path) {
            if !base.exists() {
                continue;
            }
            let Ok(rd) = std::fs::read_dir(&base) else { continue };
            for entry in rd.flatten() {
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    return out;
                }
                let path = entry.path();
                if path.is_dir() {
                    continue;
                }
                let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if !(name.ends_with(".json") || name.ends_with(".jsonl")) {
                    continue;
                }
                if since_ms > 0 && mtime_ms(&path) < since_ms {
                    continue;
                }
                let id = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(name);
                let lines = if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                    read_jsonl(&path, MAX_FILE_BYTES)
                } else if let Ok(raw) = std::fs::read_to_string(&path) {
                    serde_json::from_str::<serde_json::Value>(&raw)
                        .map(|v| {
                            v.get("history")
                                .or_else(|| v.get("messages"))
                                .and_then(|m| m.as_array())
                                .cloned()
                                .or_else(|| v.as_array().cloned())
                                .unwrap_or_else(|| vec![v])
                        })
                        .unwrap_or_default()
                } else {
                    continue;
                };
                let cwd = first_nonempty(&lines, "/cwd")
                    .or_else(|| first_nonempty(&lines, "/workspaceDirectory"));
                let path_lc = path.to_string_lossy().to_lowercase();
                let matched = cwd
                    .as_ref()
                    .map(|c| path_matches(project_path, c))
                    .unwrap_or_else(|| path_lc.contains(&leaf) || leaf.is_empty());
                if !matched && !leaf.is_empty() {
                    // Project-local .continue always matches this project
                    if !path.starts_with(project_path) {
                        continue;
                    }
                }
                let summary = first_nonempty(&lines, "/title")
                    .or_else(|| message_text(lines.first().unwrap_or(&serde_json::Value::Null)))
                    .unwrap_or_else(|| format!("Continue · {id}"));
                out.push(AgentConversation {
                    agent_kind: AgentKind::Continue,
                    external_id: id.clone(),
                    project_path: project_path.to_string(),
                    summary: summary.chars().take(120).collect(),
                    last_message_at: None,
                    status: AgentStatus::Idle,
                    resume_command: format!("cn --resume {id}"),
                    source: path.to_string_lossy().to_string(),
                });
            }
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let path = Path::new(&conv.source);
        let lines = if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            read_jsonl(path, MAX_FILE_BYTES)
        } else if let Ok(raw) = std::fs::read_to_string(path) {
            serde_json::from_str::<serde_json::Value>(&raw)
                .map(|v| {
                    v.get("history")
                        .or_else(|| v.get("messages"))
                        .and_then(|m| m.as_array())
                        .cloned()
                        .or_else(|| v.as_array().cloned())
                        .unwrap_or_default()
                })
                .unwrap_or_default()
        } else {
            return Vec::new();
        };
        lines
            .iter()
            .rev()
            .take(limit)
            .rev()
            .filter_map(|v| {
                Some(AgentMessage {
                    role: v.get("role").and_then(|r| r.as_str()).unwrap_or("assistant").into(),
                    text: message_text(v)?,
                    at: None,
                })
            })
            .collect()
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("cn --resume {}", conv.external_id)
    }
}
