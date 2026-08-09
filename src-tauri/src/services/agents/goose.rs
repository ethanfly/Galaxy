//! Block Goose: `~/.config/goose/sessions` or `~/.local/share/goose` (read-only).
use std::path::{Path, PathBuf};

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter,
    AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct GooseAdapter;

impl GooseAdapter {
    fn bases() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(h) = home_dir() {
            out.push(h.join(".config").join("goose").join("sessions"));
            out.push(h.join(".config").join("goose"));
            out.push(
                h.join(".local")
                    .join("share")
                    .join("goose")
                    .join("sessions"),
            );
            out.push(h.join(".goose").join("sessions"));
        }
        out
    }

    fn collect_files(cancel: &CancelToken) -> Vec<PathBuf> {
        let mut files = Vec::new();
        for base in Self::bases() {
            if !base.is_dir() {
                continue;
            }
            let Ok(rd) = std::fs::read_dir(&base) else {
                continue;
            };
            for e in rd.flatten() {
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    return files;
                }
                let p = e.path();
                if p.is_file() {
                    let n = p
                        .file_name()
                        .map(|x| x.to_string_lossy().to_string())
                        .unwrap_or_default();
                    if n.ends_with(".json") || n.ends_with(".jsonl") || n.ends_with(".yaml") {
                        files.push(p);
                    }
                } else if p.is_dir() {
                    if let Ok(inner) = std::fs::read_dir(&p) {
                        for f in inner.flatten() {
                            let fp = f.path();
                            if fp.is_file() {
                                files.push(fp);
                            }
                        }
                    }
                }
            }
        }
        files
    }
}

impl AgentAdapter for GooseAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Goose
    }

    fn availability(&self) -> AgentAvailability {
        let ok = Self::bases().iter().any(|p| p.exists());
        AgentAvailability {
            kind: Some(self.kind()),
            available: ok,
            reason: if ok {
                String::new()
            } else {
                "未找到 Goose 会话目录（~/.config/goose）".into()
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
        for path in Self::collect_files(cancel) {
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
                .or_else(|| first_nonempty(&lines, "/working_dir"))
                .or_else(|| first_nonempty(&lines, "/directory"));
            let path_lc = path.to_string_lossy().to_lowercase();
            let matched = cwd
                .as_ref()
                .map(|c| path_matches(project_path, c))
                .unwrap_or_else(|| path_lc.contains(&leaf) || leaf.is_empty());
            if !matched && !leaf.is_empty() {
                continue;
            }
            let summary = first_nonempty(&lines, "/description")
                .or_else(|| first_nonempty(&lines, "/name"))
                .or_else(|| message_text(lines.first().unwrap_or(&serde_json::Value::Null)))
                .unwrap_or_else(|| format!("Goose · {id}"));
            out.push(AgentConversation {
                agent_kind: AgentKind::Goose,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary: summary.chars().take(120).collect(),
                last_message_at: None,
                status: AgentStatus::Idle,
                resume_command: format!("goose session resume {id}"),
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
        format!("goose session resume {}", conv.external_id)
    }
}
