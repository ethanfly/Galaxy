//! Aider: project-local `.aider.chat.history.md` / `.aider.input.history` (read-only).
use std::path::{Path, PathBuf};

use super::{mtime_ms, AgentAdapter, AgentAvailability, CancelToken};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

pub struct AiderAdapter;

impl AiderAdapter {
    fn history_candidates(project_path: &str) -> Vec<PathBuf> {
        let root = PathBuf::from(project_path);
        vec![
            root.join(".aider.chat.history.md"),
            root.join(".aider.input.history"),
            root.join(".aider.chat.history"),
            root.join("aider.chat.history.md"),
        ]
    }
}

impl AgentAdapter for AiderAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Aider
    }

    fn availability(&self) -> AgentAvailability {
        // Always "available" — scan is project-local and cheap.
        AgentAvailability {
            kind: Some(self.kind()),
            available: true,
            reason: String::new(),
        }
    }

    fn scan(
        &self,
        project_path: &str,
        since_ms: u64,
        _cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let mut out = Vec::new();
        for path in Self::history_candidates(project_path) {
            if !path.is_file() {
                continue;
            }
            if since_ms > 0 && mtime_ms(&path) < since_ms {
                continue;
            }
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "aider".into());
            let summary = if name.contains("chat") {
                "Aider 对话历史".to_string()
            } else {
                "Aider 输入历史".to_string()
            };
            let id = format!("{project_path}::{name}");
            out.push(AgentConversation {
                agent_kind: AgentKind::Aider,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary,
                last_message_at: None,
                status: AgentStatus::Idle,
                resume_command: "aider".to_string(),
                source: path.to_string_lossy().to_string(),
            });
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let path = Path::new(&conv.source);
        let Ok(raw) = std::fs::read_to_string(path) else {
            return Vec::new();
        };
        // Markdown history: split on #### / role headers when present.
        let mut msgs = Vec::new();
        let mut role = "assistant".to_string();
        let mut buf = String::new();
        for line in raw.lines() {
            let t = line.trim();
            if t.starts_with("####") || t.starts_with("## ") {
                if !buf.trim().is_empty() {
                    msgs.push(AgentMessage {
                        role: role.clone(),
                        text: buf.trim().chars().take(4000).collect(),
                        at: None,
                    });
                    buf.clear();
                }
                let lower = t.to_lowercase();
                role = if lower.contains("user") || lower.contains("human") {
                    "user".into()
                } else {
                    "assistant".into()
                };
            } else {
                buf.push_str(line);
                buf.push('\n');
            }
        }
        if !buf.trim().is_empty() {
            msgs.push(AgentMessage {
                role,
                text: buf.trim().chars().take(4000).collect(),
                at: None,
            });
        }
        if msgs.is_empty() && !raw.trim().is_empty() {
            // Fallback: last N lines as one block.
            let tail: String = raw
                .lines()
                .rev()
                .take(limit.saturating_mul(4).max(40))
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            msgs.push(AgentMessage {
                role: "assistant".into(),
                text: tail.chars().take(4000).collect(),
                at: None,
            });
        }
        if msgs.len() > limit {
            msgs.split_off(msgs.len() - limit)
        } else {
            msgs
        }
    }

    fn resume_command(&self, _conv: &AgentConversation) -> String {
        "aider".to_string()
    }
}
