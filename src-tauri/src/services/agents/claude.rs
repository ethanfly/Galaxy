//! Claude Code: `~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl` (§5.4).
use std::path::PathBuf;

use super::{
    first_nonempty, home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter,
    AgentAvailability, CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub struct ClaudeAdapter;

impl ClaudeAdapter {
    fn base() -> Option<PathBuf> {
        home_dir().map(|h| h.join(".claude").join("projects"))
    }
}

impl AgentAdapter for ClaudeAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::ClaudeCode
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
                reason: "未找到 ~/.claude/projects，可能未使用 Claude Code".into(),
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
        let mut out = Vec::new();
        // Directory name is the sanitized cwd — a cheap project pre-filter,
        // then confirm with in-line `cwd` entries.
        let sanitized = super::sanitize_cwd(project_path);
        let candidates: Vec<PathBuf> = [
            base.join(&sanitized),
            base.join(sanitized.trim_start_matches('-')),
        ]
        .into_iter()
        .filter(|p| p.is_dir())
        .collect();

        let mut dirs = candidates;
        if dirs.is_empty() {
            // Fall back to scanning sibling dirs whose decoded cwd matches —
            // still cheap because we pre-filter by name similarity.
            if let Ok(rd) = std::fs::read_dir(&base) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.to_lowercase().contains(
                        &project_path
                            .trim_end_matches(['\\', '/'])
                            .rsplit(['\\', '/'])
                            .next()
                            .unwrap_or("")
                            .to_lowercase(),
                    ) && e.path().is_dir()
                    {
                        dirs.push(e.path());
                    }
                }
            }
        }

        for dir in dirs {
            let Ok(rd) = std::fs::read_dir(&dir) else {
                continue;
            };
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
                let id = match path.file_stem().map(|s| s.to_string_lossy().to_string()) {
                    Some(s) if !s.is_empty() => s,
                    _ => continue,
                };
                let lines = read_jsonl(&path, MAX_FILE_BYTES);
                if lines.is_empty() {
                    continue;
                }
                // Project match: the in-line cwd must match the project.
                let cwd = first_nonempty(&lines, "/cwd")
                    .or_else(|| first_nonempty(&lines, "/message/cwd"))
                    .unwrap_or_default();
                if !cwd.is_empty() && !path_matches(project_path, &cwd) {
                    continue;
                }
                let last_ts = lines.iter().rev().find_map(|v| {
                    v.get("timestamp")
                        .and_then(|t| t.as_str())
                        .map(String::from)
                });
                let summary = lines
                    .iter()
                    .filter(|v| v.get("type").and_then(|t| t.as_str()) == Some("user"))
                    .find_map(|v| message_text(v))
                    .map(|t| t.chars().take(160).collect())
                    .unwrap_or_else(|| "Claude Code 会话".into());
                let status = crate::pty::tracker::infer_historical_agent_status(
                    AgentKind::ClaudeCode,
                    &lines
                        .iter()
                        .rev()
                        .take(10)
                        .filter_map(|v| message_text(v))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
                out.push(AgentConversation {
                    agent_kind: AgentKind::ClaudeCode,
                    external_id: id.clone(),
                    project_path: project_path.to_string(),
                    summary,
                    last_message_at: last_ts,
                    status: if matches!(status, AgentStatus::Blocked) {
                        AgentStatus::Blocked
                    } else {
                        AgentStatus::Idle
                    },
                    resume_command: format!("claude --resume {id}"),
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
            .filter_map(|v| {
                let role = match v.get("type").and_then(|t| t.as_str()) {
                    Some("user") => "user",
                    Some("assistant") => "assistant",
                    _ => return None,
                };
                let text = message_text(v)?;
                Some(AgentMessage {
                    role: role.into(),
                    text,
                    at: v
                        .get("timestamp")
                        .and_then(|t| t.as_str())
                        .map(String::from),
                })
            })
            .collect();
        if msgs.len() > limit {
            msgs = msgs.split_off(msgs.len() - limit);
        }
        msgs
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("claude --resume {}", conv.external_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_jsonl_shape() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(super::super::sanitize_cwd("C:\\proj-x"));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jsonl");
        std::fs::write(
            &f,
            concat!(
                "{\"type\":\"user\",\"cwd\":\"C:\\\\proj-x\",\"timestamp\":\"2026-07-01T10:00:00Z\",\"message\":{\"content\":\"帮我修复登录\"}}\n",
                "{\"type\":\"assistant\",\"timestamp\":\"2026-07-01T10:00:05Z\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"好的\"}]}}\n"
            ),
        )
        .unwrap();
        // Point HOME at the temp dir and rescan via a fresh adapter path check.
        let conv = AgentConversation {
            agent_kind: AgentKind::ClaudeCode,
            external_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".into(),
            project_path: "C:\\proj-x".into(),
            summary: String::new(),
            last_message_at: None,
            status: AgentStatus::Idle,
            resume_command: String::new(),
            source: f.to_string_lossy().to_string(),
        };
        let msgs = ClaudeAdapter.read_messages(&conv, 50);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "user");
        assert!(msgs[0].text.contains("修复登录"));
    }
}
