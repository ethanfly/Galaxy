//! Pi: `~/.pi/agent/sessions/*.jsonl` (read-only).
//! Resume: `pi --session <id>` or `pi -c <id>`.
use std::path::{Path, PathBuf};

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter,
    AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct PiAdapter;

impl PiAdapter {
    fn base() -> Option<PathBuf> {
        home_dir().map(|h| h.join(".pi").join("agent").join("sessions"))
    }

    fn alt_bases() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(h) = home_dir() {
            out.push(h.join(".pi").join("sessions"));
            out.push(h.join(".pi").join("agent"));
        }
        out
    }
}

impl AgentAdapter for PiAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Pi
    }

    fn availability(&self) -> AgentAvailability {
        let ok = Self::base().map(|p| p.is_dir()).unwrap_or(false)
            || Self::alt_bases().iter().any(|p| p.exists());
        AgentAvailability {
            kind: Some(self.kind()),
            available: ok,
            reason: if ok {
                String::new()
            } else {
                "未找到 ~/.pi/agent/sessions，可能未使用 Pi".into()
            },
        }
    }

    fn scan(
        &self,
        project_path: &str,
        since_ms: u64,
        cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let mut dirs = Vec::new();
        if let Some(b) = Self::base() {
            if b.is_dir() {
                dirs.push(b);
            }
        }
        for b in Self::alt_bases() {
            if b.is_dir() {
                dirs.push(b);
            }
        }
        let leaf = project_path
            .trim_end_matches(['\\', '/'])
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_lowercase();
        let mut out = Vec::new();
        for dir in dirs {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for entry in rd.flatten() {
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    return out;
                }
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                if !(name.ends_with(".jsonl") || name.ends_with(".json")) {
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
                let cwd = first_nonempty(&lines, "/cwd")
                    .or_else(|| first_nonempty(&lines, "/projectPath"))
                    .or_else(|| first_nonempty(&lines, "/workingDirectory"))
                    .or_else(|| first_nonempty(&lines, "/path"));
                let path_lc = path.to_string_lossy().to_lowercase();
                let matched = cwd
                    .as_ref()
                    .map(|c| path_matches(project_path, c) || c.to_lowercase().contains(&leaf))
                    .unwrap_or_else(|| path_lc.contains(&leaf) || leaf.is_empty());
                // Pi often embeds project in session metadata at root of first line
                let meta_match = lines.first().and_then(|v| {
                    v.get("cwd")
                        .or_else(|| v.get("project"))
                        .and_then(|x| x.as_str())
                        .map(|c| path_matches(project_path, c) || c.to_lowercase().contains(&leaf))
                });
                if !matched && meta_match != Some(true) && !leaf.is_empty() {
                    continue;
                }
                let summary = first_nonempty(&lines, "/title")
                    .or_else(|| first_nonempty(&lines, "/summary"))
                    .or_else(|| message_text(lines.iter().find(|v| {
                        v.get("role").and_then(|r| r.as_str()) == Some("user")
                    }).unwrap_or(&serde_json::Value::Null)))
                    .unwrap_or_else(|| format!("Pi · {id}"));
                out.push(AgentConversation {
                    agent_kind: AgentKind::Pi,
                    external_id: id.clone(),
                    project_path: project_path.to_string(),
                    summary: summary.chars().take(120).collect(),
                    last_message_at: first_nonempty(&lines, "/timestamp")
                        .or_else(|| first_nonempty(&lines, "/updatedAt")),
                    status: AgentStatus::Idle,
                    resume_command: format!("pi --session {id}"),
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
                // Skip pure session metadata lines without role/content
                let role = v
                    .get("role")
                    .or_else(|| v.get("type"))
                    .and_then(|r| r.as_str())
                    .unwrap_or("assistant");
                let text = message_text(v)?;
                Some(AgentMessage {
                    role: role.into(),
                    text,
                    at: v.get("timestamp").and_then(|t| t.as_str()).map(String::from),
                })
            })
            .collect()
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        // Prefer long form; short -c also works per Pi docs.
        format!("pi --session {}", conv.external_id)
    }
}
