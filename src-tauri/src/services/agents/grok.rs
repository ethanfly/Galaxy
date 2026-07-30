//! Grok Build: `~/.grok/sessions/<url-encoded-cwd>/<uuid>/`
//! (`summary.json` + `chat_history.jsonl`) (§5.4).
use std::path::PathBuf;

use super::{home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter, AgentAvailability, CancelToken};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct GrokAdapter;

impl GrokAdapter {
    fn base() -> Option<PathBuf> {
        home_dir().map(|h| h.join(".grok").join("sessions"))
    }

    /// Minimal percent-decode for matching url-encoded cwd segments.
    pub fn percent_decode(input: &str) -> String {
        let bytes = input.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                let hex = |b: u8| -> Option<u8> {
                    match b {
                        b'0'..=b'9' => Some(b - b'0'),
                        b'a'..=b'f' => Some(b - b'a' + 10),
                        b'A'..=b'F' => Some(b - b'A' + 10),
                        _ => None,
                    }
                };
                if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                    out.push(h << 4 | l);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        }
        String::from_utf8_lossy(&out).to_string()
    }
}

impl AgentAdapter for GrokAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Grok
    }

    fn availability(&self) -> AgentAvailability {
        match Self::base() {
            Some(p) if p.is_dir() => AgentAvailability { kind: Some(self.kind()), available: true, reason: String::new() },
            _ => AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到 ~/.grok/sessions".into(),
            },
        }
    }

    fn scan(&self, project_path: &str, since_ms: u64, cancel: &CancelToken) -> Vec<AgentConversation> {
        let Some(base) = Self::base() else { return Vec::new() };
        let mut out = Vec::new();
        let Ok(cwds) = std::fs::read_dir(&base) else { return out };
        for cwd_entry in cwds.flatten() {
            if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                return out;
            }
            let cwd_dir = cwd_entry.path();
            if !cwd_dir.is_dir() {
                continue;
            }
            let decoded = Self::percent_decode(&cwd_entry.file_name().to_string_lossy());
            let Ok(sessions) = std::fs::read_dir(&cwd_dir) else { continue };
            for sess in sessions.flatten() {
                let sess_dir = sess.path();
                if !sess_dir.is_dir() {
                    continue;
                }
                let summary_path = sess_dir.join("summary.json");
                let history_path = sess_dir.join("chat_history.jsonl");
                if !summary_path.is_file() {
                    continue;
                }
                if since_ms > 0
                    && mtime_ms(&summary_path) < since_ms
                    && mtime_ms(&history_path) < since_ms
                {
                    continue;
                }
                let Ok(raw) = std::fs::read_to_string(&summary_path) else { continue };
                let Ok(summary) = serde_json::from_str::<serde_json::Value>(&raw) else { continue };
                let cwd = summary
                    .pointer("/info/cwd")
                    .and_then(|c| c.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| decoded.clone());
                if !path_matches(project_path, &cwd) {
                    continue;
                }
                let id = summary
                    .pointer("/info/id")
                    .and_then(|i| i.as_str())
                    .map(String::from)
                    .or_else(|| sess.file_name().to_str().map(String::from))
                    .unwrap_or_default();
                if id.is_empty() {
                    continue;
                }
                let title = summary
                    .pointer("/info/title")
                    .and_then(|t| t.as_str())
                    .map(String::from)
                    .or_else(|| {
                        read_jsonl(&history_path, MAX_FILE_BYTES)
                            .iter()
                            .find_map(message_text)
                            .map(|t: String| t.chars().take(160).collect())
                    })
                    .unwrap_or_else(|| "Grok Build 会话".into());
                let last_ts = summary
                    .pointer("/info/updatedAt")
                    .and_then(|t| t.as_str())
                    .map(String::from)
                    .or_else(|| {
                        read_jsonl(&history_path, MAX_FILE_BYTES)
                            .iter()
                            .rev()
                            .find_map(|v| v.get("timestamp").and_then(|t| t.as_str()).map(String::from))
                    });
                out.push(AgentConversation {
                    agent_kind: AgentKind::Grok,
                    external_id: id.clone(),
                    project_path: project_path.to_string(),
                    summary: title,
                    last_message_at: last_ts,
                    status: AgentStatus::Idle,
                    resume_command: format!("grok -r {id}"),
                    source: sess_dir.to_string_lossy().to_string(),
                });
            }
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let history = std::path::Path::new(&conv.source).join("chat_history.jsonl");
        let lines = read_jsonl(&history, MAX_FILE_BYTES);
        let mut msgs: Vec<AgentMessage> = lines
            .iter()
            .filter_map(|v| {
                let text = message_text(v)?;
                let role = v
                    .get("role")
                    .and_then(|r| r.as_str())
                    .unwrap_or("assistant")
                    .to_string();
                Some(AgentMessage {
                    role: if role.contains("user") { "user".into() } else { role },
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
        format!("grok -r {}", conv.external_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decode_works() {
        assert_eq!(GrokAdapter::percent_decode("C%3A%5Cwork%5Cproj"), "C:\\work\\proj");
        assert_eq!(GrokAdapter::percent_decode("plain"), "plain");
    }
}
