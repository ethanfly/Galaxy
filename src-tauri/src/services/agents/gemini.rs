//! Gemini CLI: `~/.gemini/tmp/*/chats/` and `~/.gemini/chats/` (best-effort, read-only).
use std::path::{Path, PathBuf};

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter,
    AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct GeminiAdapter;

impl GeminiAdapter {
    fn bases() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(h) = home_dir() {
            out.push(h.join(".gemini").join("tmp"));
            out.push(h.join(".gemini").join("chats"));
            out.push(h.join(".gemini"));
        }
        out
    }

    fn collect_chat_files(cancel: &CancelToken) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for base in Self::bases() {
            if !base.exists() {
                continue;
            }
            Self::walk_chats(&base, 0, &mut files, cancel);
        }
        files
    }

    fn walk_chats(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, cancel: &CancelToken) {
        if depth > 5 || cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                if p.file_name().map(|n| n == "chats").unwrap_or(false) || depth < 4 {
                    Self::walk_chats(&p, depth + 1, out, cancel);
                }
            } else {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                let is_chat = name.ends_with(".json")
                    || name.ends_with(".jsonl")
                    || name.contains("session")
                    || name.contains("chat");
                if is_chat {
                    out.push(p);
                }
            }
        }
    }
}

impl AgentAdapter for GeminiAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Gemini
    }

    fn availability(&self) -> AgentAvailability {
        let ok = Self::bases().iter().any(|p| p.exists());
        if ok {
            AgentAvailability {
                kind: Some(self.kind()),
                available: true,
                reason: String::new(),
            }
        } else {
            AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到 ~/.gemini，可能未使用 Gemini CLI".into(),
            }
        }
    }

    fn scan(
        &self,
        project_path: &str,
        since_ms: u64,
        cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let mut out = Vec::new();
        for path in Self::collect_chat_files(cancel) {
            if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            if since_ms > 0 && mtime_ms(&path) < since_ms {
                continue;
            }
            let id = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string_lossy().to_string());
            let lines = if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                read_jsonl(&path, MAX_FILE_BYTES)
            } else if let Ok(raw) = std::fs::read_to_string(&path) {
                serde_json::from_str::<serde_json::Value>(&raw)
                    .map(|v| {
                        if let Some(arr) = v.as_array() {
                            arr.clone()
                        } else if let Some(msgs) = v.get("messages").and_then(|m| m.as_array()) {
                            msgs.clone()
                        } else {
                            vec![v]
                        }
                    })
                    .unwrap_or_default()
            } else {
                continue;
            };
            if lines.is_empty() {
                continue;
            }
            // Project match: cwd field or path contains project leaf.
            let cwd = first_nonempty(&lines, "/cwd")
                .or_else(|| first_nonempty(&lines, "/projectPath"))
                .or_else(|| first_nonempty(&lines, "/project_path"))
                .or_else(|| first_nonempty(&lines, "/workspace"));
            let leaf = project_path
                .trim_end_matches(['\\', '/'])
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or("")
                .to_lowercase();
            let path_str = path.to_string_lossy().to_lowercase();
            let matched = cwd
                .as_ref()
                .map(|c| path_matches(project_path, c))
                .unwrap_or_else(|| path_str.contains(&leaf) || leaf.is_empty());
            if !matched && !leaf.is_empty() {
                continue;
            }
            let summary = first_nonempty(&lines, "/summary")
                .or_else(|| first_nonempty(&lines, "/title"))
                .or_else(|| message_text(lines.first().unwrap_or(&serde_json::Value::Null)))
                .unwrap_or_else(|| "Gemini 会话".into());
            let at = first_nonempty(&lines, "/timestamp")
                .or_else(|| first_nonempty(&lines, "/updatedAt"))
                .or_else(|| first_nonempty(&lines, "/createdAt"));
            out.push(AgentConversation {
                agent_kind: AgentKind::Gemini,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary: summary.chars().take(120).collect(),
                last_message_at: at,
                status: AgentStatus::Idle,
                resume_command: format!("gemini --resume {id}"),
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
                        .unwrap_or_else(|| vec![v])
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
                let role = v
                    .get("role")
                    .or_else(|| v.get("author"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("assistant")
                    .to_string();
                let text = message_text(v)?;
                Some(AgentMessage {
                    role,
                    text,
                    at: v.get("timestamp").and_then(|t| t.as_str()).map(String::from),
                })
            })
            .collect()
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("gemini --resume {}", conv.external_id)
    }
}
