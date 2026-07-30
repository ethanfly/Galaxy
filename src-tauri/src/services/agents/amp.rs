//! Amp / Factory CLI: `~/.factory/sessions` and `~/.factory/projects` (read-only).
use std::path::{Path, PathBuf};

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter,
    AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct AmpAdapter;

impl AmpAdapter {
    fn bases() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(h) = home_dir() {
            out.push(h.join(".factory").join("sessions"));
            out.push(h.join(".factory").join("projects"));
            out.push(h.join(".factory"));
            out.push(h.join(".amp").join("sessions"));
            out.push(h.join(".amp"));
        }
        out
    }

    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, cancel: &CancelToken) {
        if depth > 5 || cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                Self::walk(&p, depth + 1, out, cancel);
            } else {
                let n = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
                if n.ends_with(".json") || n.ends_with(".jsonl") {
                    out.push(p);
                }
            }
        }
    }
}

impl AgentAdapter for AmpAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Amp
    }

    fn availability(&self) -> AgentAvailability {
        let ok = Self::bases().iter().any(|p| p.exists());
        AgentAvailability {
            kind: Some(self.kind()),
            available: ok,
            reason: if ok {
                String::new()
            } else {
                "未找到 ~/.factory 或 ~/.amp（Amp / Factory CLI）".into()
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
        let mut files = Vec::new();
        for base in Self::bases() {
            if base.exists() {
                Self::walk(&base, 0, &mut files, cancel);
            }
        }
        let mut out = Vec::new();
        for path in files {
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
            let cwd = first_nonempty(&lines, "/cwd")
                .or_else(|| first_nonempty(&lines, "/projectPath"))
                .or_else(|| first_nonempty(&lines, "/repo"));
            let path_lc = path.to_string_lossy().to_lowercase();
            let matched = cwd
                .as_ref()
                .map(|c| path_matches(project_path, c) || c.to_lowercase().contains(&leaf))
                .unwrap_or_else(|| path_lc.contains(&leaf) || leaf.is_empty());
            if !matched && !leaf.is_empty() {
                continue;
            }
            let summary = first_nonempty(&lines, "/title")
                .or_else(|| message_text(lines.first().unwrap_or(&serde_json::Value::Null)))
                .unwrap_or_else(|| format!("Amp · {id}"));
            out.push(AgentConversation {
                agent_kind: AgentKind::Amp,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary: summary.chars().take(120).collect(),
                last_message_at: None,
                status: AgentStatus::Idle,
                resume_command: format!("amp --session {id}"),
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
                    role: v.get("role").and_then(|r| r.as_str()).unwrap_or("assistant").into(),
                    text: message_text(v)?,
                    at: None,
                })
            })
            .collect()
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("amp --session {}", conv.external_id)
    }
}
