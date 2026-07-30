//! OMP: `~/.omp/agent/sessions/<sanitized-cwd>/<timestamp>_<uuid>.jsonl` (§5.4).
use std::path::PathBuf;

use super::{home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter, AgentAvailability, CancelToken};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct OmpAdapter;

impl OmpAdapter {
    fn base() -> Option<PathBuf> {
        home_dir().map(|h| h.join(".omp").join("agent").join("sessions"))
    }
}

impl AgentAdapter for OmpAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Omp
    }

    fn availability(&self) -> AgentAvailability {
        match Self::base() {
            Some(p) if p.is_dir() => AgentAvailability { kind: Some(self.kind()), available: true, reason: String::new() },
            _ => AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到 ~/.omp/agent/sessions".into(),
            },
        }
    }

    fn scan(&self, project_path: &str, since_ms: u64, cancel: &CancelToken) -> Vec<AgentConversation> {
        let Some(base) = Self::base() else { return Vec::new() };
        let sanitized = super::sanitize_cwd(project_path);
        let mut dirs: Vec<PathBuf> = [base.join(&sanitized), base.join(sanitized.trim_start_matches('-'))]
            .into_iter()
            .filter(|p| p.is_dir())
            .collect();
        if dirs.is_empty() {
            if let Ok(rd) = std::fs::read_dir(&base) {
                for e in rd.flatten() {
                    if e.path().is_dir() {
                        dirs.push(e.path());
                    }
                }
            }
        }
        let mut out = Vec::new();
        for dir in dirs {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for entry in rd.flatten() {
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    return out;
                }
                let path = entry.path();
                if path.extension().map(|e| e != "jsonl").unwrap_or(true) {
                    continue;
                }
                if since_ms > 0 && mtime_ms(&path) < since_ms {
                    continue;
                }
                let stem = match path.file_stem().map(|s| s.to_string_lossy().to_string()) {
                    Some(s) => s,
                    None => continue,
                };
                // <timestamp>_<uuid>
                let uuid = stem.rsplit_once('_').map(|(_, u)| u).unwrap_or(&stem).to_string();
                let lines = read_jsonl(&path, MAX_FILE_BYTES);
                if lines.is_empty() {
                    continue;
                }
                let cwd = lines
                    .iter()
                    .find_map(|v| {
                        v.pointer("/session/cwd")
                            .and_then(|c| c.as_str())
                            .map(String::from)
                            .or_else(|| v.pointer("/cwd").and_then(|c| c.as_str()).map(String::from))
                    })
                    .unwrap_or_default();
                if !cwd.is_empty() && !path_matches(project_path, &cwd) {
                    continue;
                }
                let summary = lines
                    .iter()
                    .find_map(message_text)
                    .map(|t: String| t.chars().take(160).collect())
                    .unwrap_or_else(|| "OMP 会话".into());
                let last_ts = lines
                    .iter()
                    .rev()
                    .find_map(|v| v.get("timestamp").and_then(|t| t.as_str()).map(String::from));
                out.push(AgentConversation {
                    agent_kind: AgentKind::Omp,
                    external_id: uuid.clone(),
                    project_path: project_path.to_string(),
                    summary,
                    last_message_at: last_ts,
                    status: AgentStatus::Idle,
                    resume_command: format!("omp -r {uuid}"),
                    source: path.to_string_lossy().to_string(),
                });
            }
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let lines = read_jsonl(std::path::Path::new(&conv.source), MAX_FILE_BYTES);
        let mut msgs: Vec<AgentMessage> = lines
            .iter()
            .enumerate()
            .filter_map(|(i, v)| {
                let text = message_text(v)?;
                let role = v
                    .get("role")
                    .and_then(|r| r.as_str())
                    .or_else(|| v.get("type").and_then(|t| t.as_str()))
                    .map(|r| if r.contains("user") { "user" } else { "assistant" })
                    .unwrap_or(if i % 2 == 0 { "user" } else { "assistant" })
                    .to_string();
                Some(AgentMessage {
                    role,
                    text,
                    at: v.get("timestamp").and_then(|t| t.as_str()).map(String::from),
                })
            })
            .collect();
        if msgs.len() > limit {
            msgs = msgs.split_off(msgs.len() - limit);
        }
        msgs
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("omp -r {}", conv.external_id)
    }
}
