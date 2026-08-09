//! Qwen Code: `~/.qwen/projects/<sanitized>/chats/*.jsonl` (Claude-like layout).
use std::path::{Path, PathBuf};

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, sanitize_cwd,
    AgentAdapter, AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct QwenAdapter;

impl QwenAdapter {
    fn base() -> Option<PathBuf> {
        home_dir().map(|h| h.join(".qwen").join("projects"))
    }
}

impl AgentAdapter for QwenAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Qwen
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
                reason: "未找到 ~/.qwen/projects，可能未使用 Qwen Code".into(),
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
        let mut dirs = Vec::new();
        let san = sanitize_cwd(project_path);
        for cand in [base.join(&san), base.join(san.trim_start_matches('-'))] {
            if cand.is_dir() {
                dirs.push(cand);
            }
        }
        if dirs.is_empty() {
            let leaf = project_path
                .trim_end_matches(['\\', '/'])
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or("")
                .to_lowercase();
            if let Ok(rd) = std::fs::read_dir(&base) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().to_lowercase();
                    if name.contains(&leaf) && e.path().is_dir() {
                        dirs.push(e.path());
                    }
                }
            }
        }
        let mut out = Vec::new();
        for dir in dirs {
            // chats/ subdir or direct jsonl
            let chat_roots = [dir.join("chats"), dir.clone()];
            for root in chat_roots {
                if !root.is_dir() {
                    continue;
                }
                let Ok(rd) = std::fs::read_dir(&root) else {
                    continue;
                };
                for entry in rd.flatten() {
                    if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                        return out;
                    }
                    let path = entry.path();
                    if path
                        .extension()
                        .map(|e| e != "jsonl" && e != "json")
                        .unwrap_or(true)
                    {
                        continue;
                    }
                    if since_ms > 0 && mtime_ms(&path) < since_ms {
                        continue;
                    }
                    let id = path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let lines = read_jsonl(&path, MAX_FILE_BYTES);
                    let cwd = first_nonempty(&lines, "/cwd");
                    if let Some(c) = &cwd {
                        if !path_matches(project_path, c) {
                            continue;
                        }
                    }
                    let summary = first_nonempty(&lines, "/summary")
                        .or_else(|| message_text(lines.first().unwrap_or(&serde_json::Value::Null)))
                        .unwrap_or_else(|| format!("Qwen · {id}"));
                    out.push(AgentConversation {
                        agent_kind: AgentKind::Qwen,
                        external_id: id.clone(),
                        project_path: project_path.to_string(),
                        summary: summary.chars().take(120).collect(),
                        last_message_at: first_nonempty(&lines, "/timestamp"),
                        status: AgentStatus::Idle,
                        resume_command: format!("qwen --resume {id}"),
                        source: path.to_string_lossy().to_string(),
                    });
                }
            }
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let lines = read_jsonl(Path::new(&conv.source), MAX_FILE_BYTES);
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
        format!("qwen --resume {}", conv.external_id)
    }
}
