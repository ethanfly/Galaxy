//! Cursor Agent: project `.cursor/` + `~/.cursor/` chat/composer history (read-only).
use std::path::{Path, PathBuf};

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter,
    AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct CursorAdapter;

impl CursorAdapter {
    fn roots(project_path: &str) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let proj = PathBuf::from(project_path);
        out.push(proj.join(".cursor"));
        out.push(proj.join(".cursor").join("chats"));
        out.push(proj.join(".cursor").join("projects"));
        if let Some(h) = home_dir() {
            out.push(h.join(".cursor"));
            out.push(h.join(".cursor").join("chats"));
            out.push(h.join(".cursor").join("projects"));
            out.push(h.join(".cursor").join("ai-tracking"));
        }
        out
    }

    fn collect(project_path: &str, cancel: &CancelToken) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for root in Self::roots(project_path) {
            if !root.exists() {
                continue;
            }
            Self::walk(&root, 0, &mut files, cancel);
        }
        files
    }

    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, cancel: &CancelToken) {
        if depth > 6 || cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                Self::walk(&p, depth + 1, out, cancel);
            } else {
                let n = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
                if n.ends_with(".json") || n.ends_with(".jsonl") || n.ends_with(".txt") {
                    // Skip huge binary-ish caches
                    if n.contains("index") || n.contains("cache") {
                        continue;
                    }
                    out.push(p);
                }
            }
        }
    }
}

impl AgentAdapter for CursorAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Cursor
    }

    fn availability(&self) -> AgentAvailability {
        let ok = home_dir().map(|h| h.join(".cursor").exists()).unwrap_or(false);
        AgentAvailability {
            kind: Some(self.kind()),
            available: ok,
            reason: if ok {
                String::new()
            } else {
                "未找到 ~/.cursor（安装 Cursor 后可扫描 Agent 会话）".into()
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
        for path in Self::collect(project_path, cancel) {
            if since_ms > 0 && mtime_ms(&path) < since_ms {
                continue;
            }
            let path_lc = path.to_string_lossy().to_lowercase();
            // Prefer project-local or path mentioning project leaf
            let in_project = path.starts_with(project_path) || path_lc.contains(&leaf);
            if !in_project && !leaf.is_empty() {
                // Still allow if JSON mentions cwd
                let peek = std::fs::read_to_string(&path).unwrap_or_default();
                if !peek.to_lowercase().contains(&leaf)
                    && !peek.contains(&project_path.replace('\\', "/"))
                {
                    continue;
                }
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
                        v.get("messages")
                            .or_else(|| v.get("bubbles"))
                            .and_then(|m| m.as_array())
                            .cloned()
                            .or_else(|| v.as_array().cloned())
                            .unwrap_or_else(|| vec![v])
                    })
                    .unwrap_or_default()
            } else {
                continue;
            };
            if lines.is_empty() && path.extension().map(|e| e == "txt").unwrap_or(false) {
                out.push(AgentConversation {
                    agent_kind: AgentKind::Cursor,
                    external_id: id.clone(),
                    project_path: project_path.to_string(),
                    summary: format!("Cursor · {id}"),
                    last_message_at: None,
                    status: AgentStatus::Idle,
                    resume_command: "cursor-agent".to_string(),
                    source: path.to_string_lossy().to_string(),
                });
                continue;
            }
            if lines.is_empty() {
                continue;
            }
            let cwd = first_nonempty(&lines, "/cwd");
            if let Some(c) = &cwd {
                if !path_matches(project_path, c) && !c.to_lowercase().contains(&leaf) {
                    continue;
                }
            }
            let summary = first_nonempty(&lines, "/title")
                .or_else(|| first_nonempty(&lines, "/name"))
                .or_else(|| message_text(lines.first().unwrap_or(&serde_json::Value::Null)))
                .unwrap_or_else(|| format!("Cursor · {id}"));
            out.push(AgentConversation {
                agent_kind: AgentKind::Cursor,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary: summary.chars().take(120).collect(),
                last_message_at: None,
                status: AgentStatus::Idle,
                resume_command: "cursor-agent".to_string(),
                source: path.to_string_lossy().to_string(),
            });
            if out.len() >= 80 {
                break;
            }
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let path = Path::new(&conv.source);
        if path.extension().map(|e| e == "txt").unwrap_or(false) {
            if let Ok(raw) = std::fs::read_to_string(path) {
                return vec![AgentMessage {
                    role: "assistant".into(),
                    text: raw.chars().take(4000).collect(),
                    at: None,
                }];
            }
            return Vec::new();
        }
        let lines = if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            read_jsonl(path, MAX_FILE_BYTES)
        } else if let Ok(raw) = std::fs::read_to_string(path) {
            serde_json::from_str::<serde_json::Value>(&raw)
                .map(|v| {
                    v.get("messages")
                        .or_else(|| v.get("bubbles"))
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
                    role: v.get("role").or_else(|| v.get("type")).and_then(|r| r.as_str()).unwrap_or("assistant").into(),
                    text: message_text(v)?,
                    at: None,
                })
            })
            .collect()
    }

    fn resume_command(&self, _conv: &AgentConversation) -> String {
        "cursor-agent".to_string()
    }
}
