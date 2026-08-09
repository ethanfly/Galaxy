//! Kimi CLI: `~/.kimi/sessions/` (JSONL/JSON, read-only).
use std::path::{Path, PathBuf};

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter,
    AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct KimiAdapter;

impl KimiAdapter {
    fn base() -> Option<PathBuf> {
        home_dir().map(|h| h.join(".kimi").join("sessions"))
    }
}

impl AgentAdapter for KimiAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Kimi
    }

    fn availability(&self) -> AgentAvailability {
        match Self::base() {
            Some(p) if p.is_dir() => AgentAvailability {
                kind: Some(self.kind()),
                available: true,
                reason: String::new(),
            },
            _ => AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到 ~/.kimi/sessions，可能未使用 Kimi CLI".into(),
            },
        }
    }

    fn scan(
        &self,
        project_path: &str,
        since_ms: u64,
        cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let Some(base) = Self::base() else {
            return Vec::new();
        };
        let Ok(rd) = std::fs::read_dir(&base) else {
            return Vec::new();
        };
        let leaf = project_path
            .trim_end_matches(['\\', '/'])
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_lowercase();
        let mut out = Vec::new();
        for entry in rd.flatten() {
            if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if since_ms > 0 && mtime_ms(&path) < since_ms {
                continue;
            }
            let id = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let lines = if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                read_jsonl(&path, MAX_FILE_BYTES)
            } else if let Ok(raw) = std::fs::read_to_string(&path) {
                serde_json::from_str::<serde_json::Value>(&raw)
                    .map(|v| {
                        v.get("messages")
                            .and_then(|m| m.as_array())
                            .cloned()
                            .or_else(|| v.as_array().cloned())
                            .unwrap_or_else(|| vec![v])
                    })
                    .unwrap_or_default()
            } else {
                continue;
            };
            let cwd = first_nonempty(&lines, "/cwd").or_else(|| first_nonempty(&lines, "/project"));
            let path_lc = path.to_string_lossy().to_lowercase();
            let matched = cwd
                .as_ref()
                .map(|c| path_matches(project_path, c))
                .unwrap_or_else(|| path_lc.contains(&leaf) || leaf.is_empty());
            if !matched && !leaf.is_empty() {
                continue;
            }
            let summary = first_nonempty(&lines, "/title")
                .or_else(|| message_text(lines.first().unwrap_or(&serde_json::Value::Null)))
                .unwrap_or_else(|| format!("Kimi · {id}"));
            out.push(AgentConversation {
                agent_kind: AgentKind::Kimi,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary: summary.chars().take(120).collect(),
                last_message_at: None,
                status: AgentStatus::Idle,
                resume_command: format!("kimi --resume {id}"),
                source: path.to_string_lossy().to_string(),
            });
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
                    v.get("messages")
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
                    role: v
                        .get("role")
                        .and_then(|r| r.as_str())
                        .unwrap_or("assistant")
                        .into(),
                    text: message_text(v)?,
                    at: None,
                })
            })
            .collect()
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("kimi --resume {}", conv.external_id)
    }
}
