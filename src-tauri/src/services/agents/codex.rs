//! Codex CLI: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (§5.4).
use std::path::PathBuf;

use super::{
    home_dir, message_text, mtime_ms, path_matches, read_jsonl, AgentAdapter, AgentAvailability,
    CancelToken,
};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Date folders older than this are skipped on cold scans (bounded work).
const COLD_SCAN_DAYS_LIMIT: usize = 30;

pub struct CodexAdapter;

impl CodexAdapter {
    fn base() -> Option<PathBuf> {
        home_dir().map(|h| h.join(".codex").join("sessions"))
    }

    fn collect_rollout_files(base: &PathBuf, since_ms: u64, cancel: &CancelToken) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let mut days_seen = 0usize;
        let Ok(years) = std::fs::read_dir(base) else {
            return out;
        };
        let mut years: Vec<_> = years.flatten().filter(|e| e.path().is_dir()).collect();
        years.sort_by_key(|e| e.file_name());
        years.reverse();
        'years: for year in years {
            let Ok(months) = std::fs::read_dir(year.path()) else {
                continue;
            };
            let mut months: Vec<_> = months.flatten().filter(|e| e.path().is_dir()).collect();
            months.sort_by_key(|e| e.file_name());
            months.reverse();
            for month in months {
                let Ok(days) = std::fs::read_dir(month.path()) else {
                    continue;
                };
                let mut days: Vec<_> = days.flatten().filter(|e| e.path().is_dir()).collect();
                days.sort_by_key(|e| e.file_name());
                days.reverse();
                for day in days {
                    if since_ms == 0 {
                        days_seen += 1;
                        if days_seen > COLD_SCAN_DAYS_LIMIT {
                            break 'years;
                        }
                    }
                    if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                        return out;
                    }
                    if let Ok(files) = std::fs::read_dir(day.path()) {
                        for f in files.flatten() {
                            let p = f.path();
                            let is_rollout = p
                                .file_name()
                                .map(|n| {
                                    let n = n.to_string_lossy();
                                    n.starts_with("rollout-") && n.ends_with(".jsonl")
                                })
                                .unwrap_or(false);
                            if is_rollout && (since_ms == 0 || mtime_ms(&p) >= since_ms) {
                                out.push(p);
                            }
                        }
                    }
                }
            }
        }
        out
    }
}

impl AgentAdapter for CodexAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Codex
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
                reason: "未找到 ~/.codex/sessions，可能未使用 Codex CLI".into(),
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
        for path in Self::collect_rollout_files(&base, since_ms, cancel) {
            if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            let lines = read_jsonl(&path, MAX_FILE_BYTES);
            if lines.is_empty() {
                continue;
            }
            // session_meta: {"type":"session_meta","payload":{"id","timestamp","cwd",...}}
            let meta = lines
                .iter()
                .find(|v| v.get("type").and_then(|t| t.as_str()) == Some("session_meta"));
            let id = meta
                .and_then(|m| {
                    m.pointer("/payload/id")
                        .and_then(|i| i.as_str())
                        .map(String::from)
                })
                .or_else(|| {
                    path.file_stem().map(|s| {
                        s.to_string_lossy()
                            .trim_start_matches("rollout-")
                            .to_string()
                    })
                });
            let Some(id) = id else { continue };
            let cwd = meta
                .and_then(|m| {
                    m.pointer("/payload/cwd")
                        .and_then(|c| c.as_str())
                        .map(String::from)
                })
                .or_else(|| {
                    lines.iter().find_map(|v| {
                        v.pointer("/payload/cwd")
                            .and_then(|c| c.as_str())
                            .map(String::from)
                    })
                })
                .unwrap_or_default();
            if !cwd.is_empty() && !path_matches(project_path, &cwd) {
                continue;
            }
            let last_ts = lines
                .iter()
                .rev()
                .find_map(|v| {
                    v.get("timestamp")
                        .and_then(|t| t.as_str())
                        .map(String::from)
                })
                .or_else(|| {
                    meta.and_then(|m| {
                        m.pointer("/payload/timestamp")
                            .and_then(|t| t.as_str())
                            .map(String::from)
                    })
                });
            let summary = lines
                .iter()
                .filter(|v| {
                    v.get("type").and_then(|t| t.as_str()) == Some("response_item")
                        || v.get("type").and_then(|t| t.as_str()) == Some("user_message")
                })
                .find_map(|v| message_text(v))
                .map(|t: String| t.chars().take(160).collect())
                .unwrap_or_else(|| "Codex 会话".into());
            out.push(AgentConversation {
                agent_kind: AgentKind::Codex,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary,
                last_message_at: last_ts,
                status: AgentStatus::Idle,
                resume_command: format!("codex resume {id}"),
                source: path.to_string_lossy().to_string(),
            });
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let lines = read_jsonl(std::path::Path::new(&conv.source), MAX_FILE_BYTES);
        let mut msgs: Vec<AgentMessage> = lines
            .iter()
            .filter_map(|v| {
                let ty = v.get("type").and_then(|t| t.as_str())?;
                let role = match ty {
                    "user_message" | "user" => "user",
                    "assistant_message" | "response_item" => "assistant",
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
        format!("codex resume {}", conv.external_id)
    }
}
