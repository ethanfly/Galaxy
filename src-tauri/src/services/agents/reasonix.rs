//! Reasonix: `<state root>/sessions/*.jsonl` + `<state root>/projects/<slug>/sessions`.
//!
//! Layout (mirrors the Reasonix runtime, read-only):
//! - Each session is a `<id>.jsonl` transcript (one JSON `provider.Message` per
//!   line: `role`, `content`, `raw_content`, `createdAt` in unix ms).
//! - A sidecar `<id>.jsonl.meta` (BranchMeta JSON) carries `workspace_root`,
//!   titles, `preview`, `updated_at` and the in-flight turn marker — listing
//!   needs no full transcript decode.
//! - Sidecars ending in `.events.jsonl` / `.conflicts.jsonl` / `.guardian.jsonl`
//!   are not primary transcripts and are skipped.
//! - `<state root>` = `REASONIX_STATE_HOME` → `REASONIX_HOME` → platform
//!   default (`%APPDATA%\reasonix` on Windows, `~/.reasonix` elsewhere).
//! Format drift or a missing state directory degrades to "unavailable" (§5.4).
use std::path::{Path, PathBuf};

use super::{mtime_ms, path_matches, read_jsonl, AgentAdapter, AgentAvailability, CancelToken};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_SUMMARY: &str = "Reasonix 会话";

/// Transient blocks Reasonix prepends to user turns (runtime context, not
/// user text). Kept in sync with the runtime's TransientUserBlockTags.
const TRANSIENT_USER_BLOCKS: &[&str] = &[
    "response-language",
    "reasoning-language",
    "memory-update",
    "background-jobs",
    "active-goal",
    "autoresearch-runtime",
    "hook-context",
    "capability-route",
    "interrupted-turn-recovery",
];

pub struct ReasonixAdapter;

/// BranchMeta sidecar (`<session>.jsonl.meta`) — subset of the runtime shape.
#[derive(serde::Deserialize, Default)]
struct BranchMeta {
    #[serde(default)]
    custom_title: Option<String>,
    #[serde(default)]
    topic_title: Option<String>,
    #[serde(default)]
    preview: Option<String>,
    #[serde(default)]
    workspace_root: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    in_flight_turn: Option<serde_json::Value>,
}

/// Reasonix user state root (`<state root>` in the runtime docs).
fn state_root() -> Option<PathBuf> {
    for var in ["REASONIX_STATE_HOME", "REASONIX_HOME"] {
        if let Ok(v) = std::env::var(var) {
            let p = PathBuf::from(v.trim());
            if !p.as_os_str().is_empty() {
                return Some(p);
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(dirs) = directories::BaseDirs::new() {
            return Some(dirs.config_dir().join("reasonix"));
        }
        None
    }
    #[cfg(not(windows))]
    {
        directories::BaseDirs::new().map(|d| d.home_dir().join(".reasonix"))
    }
}

/// Runtime `WorkspaceSlug`: flattens an absolute path for the
/// `<root>/projects/<slug>/sessions` store. Windows folds case (NTFS).
fn workspace_slug(path: &str) -> String {
    #[cfg(windows)]
    let path = path.to_lowercase();
    #[cfg(windows)]
    let path = path.as_str();
    path.chars()
        .map(|c| match c {
            ':' | '\\' | '/' => '-',
            c => c,
        })
        .collect()
}

/// Primary transcript check mirroring the runtime `IsSessionTranscriptName`.
fn is_transcript(path: &Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    name.ends_with(".jsonl")
        && !name.ends_with(".events.jsonl")
        && !name.ends_with(".conflicts.jsonl")
        && !name.ends_with(".guardian.jsonl")
}

/// BranchID: transcript file name without the `.jsonl` extension.
fn branch_id(path: &Path) -> Option<String> {
    path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
}

/// Unix-ms `createdAt` (Reasonix local metadata) → RFC3339 string.
fn unix_ms_rfc3339(ms: i64) -> Option<String> {
    time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000)
        .ok()
        .and_then(|dt| {
            dt.format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
}

fn system_time_rfc3339(t: std::time::SystemTime) -> Option<String> {
    time::OffsetDateTime::from(t)
        .format(&time::format_description::well_known::Rfc3339)
        .ok()
}

/// Strip transient runtime blocks from persisted user text so the summary and
/// messages show what the user actually typed.
fn strip_transient_blocks(text: &str) -> String {
    let mut s = text.to_string();
    for tag in TRANSIENT_USER_BLOCKS {
        let re = format!(r"(?s)^\s*<{tag}(?:\s+[^>]*)?>.*?</{tag}>\s*\n?");
        if let Ok(re) = regex::Regex::new(&re) {
            s = re.replace_all(&s, "").into_owned();
        }
    }
    s.trim().to_string()
}

fn load_meta(path: &Path) -> Option<BranchMeta> {
    let meta_path = PathBuf::from(format!("{}.meta", path.to_string_lossy()));
    let raw = std::fs::read_to_string(&meta_path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// First user turn text from the transcript (summary fallback).
fn first_user_text(path: &Path) -> Option<String> {
    read_jsonl(path, MAX_FILE_BYTES)
        .into_iter()
        .filter(|v| v.get("role").and_then(|r| r.as_str()) == Some("user"))
        .find_map(|v| {
            let raw = v.get("raw_content").and_then(|c| c.as_str());
            let content = v.get("content").and_then(|c| c.as_str());
            raw.or(content).map(|t| strip_transient_blocks(t))
        })
        .filter(|t| !t.is_empty())
}

impl AgentAdapter for ReasonixAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Reasonix
    }

    fn availability(&self) -> AgentAvailability {
        let Some(root) = state_root() else {
            return AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "无法定位 Reasonix 状态目录".into(),
            };
        };
        if root.join("sessions").is_dir() || root.join("projects").is_dir() {
            AgentAvailability {
                kind: Some(self.kind()),
                available: true,
                reason: String::new(),
            }
        } else {
            AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到 Reasonix 会话目录（可能未使用 Reasonix）".into(),
            }
        }
    }

    fn scan(
        &self,
        project_path: &str,
        since_ms: u64,
        cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let Some(root) = state_root() else {
            return Vec::new();
        };
        self.scan_at(&root, project_path, since_ms, cancel)
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let lines = read_jsonl(std::path::Path::new(&conv.source), MAX_FILE_BYTES);
        let mut msgs: Vec<AgentMessage> = lines
            .iter()
            .filter_map(|v| {
                let role = match v.get("role").and_then(|r| r.as_str()) {
                    Some("user") => "user",
                    Some("assistant") => "assistant",
                    _ => return None,
                };
                let text = if role == "user" {
                    v.get("raw_content")
                        .and_then(|c| c.as_str())
                        .filter(|t| !t.trim().is_empty())
                        .or_else(|| v.get("content").and_then(|c| c.as_str()))
                        .map(|t| strip_transient_blocks(t))
                        .filter(|t| !t.is_empty())
                } else {
                    v.get("content")
                        .and_then(|c| c.as_str())
                        .map(|t| t.trim().to_string())
                };
                let text = text?;
                let at = v
                    .get("createdAt")
                    .and_then(|t| t.as_i64())
                    .and_then(unix_ms_rfc3339);
                Some(AgentMessage {
                    role: role.into(),
                    text: text.chars().take(4000).collect(),
                    at,
                })
            })
            .collect();
        if msgs.len() > limit {
            msgs = msgs.split_off(msgs.len() - limit);
        }
        msgs
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("reasonix --resume {}", conv.external_id)
    }
}

impl ReasonixAdapter {
    /// Scan a concrete state root (testable without touching env vars).
    fn scan_at(
        &self,
        root: &Path,
        project_path: &str,
        since_ms: u64,
        cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        // Per-project store first (exact slug), then the global store.
        let proj_dir = root
            .join("projects")
            .join(&workspace_slug(project_path))
            .join("sessions");
        let global = root.join("sessions");

        let mut out = Vec::new();
        // Project store: slug already pins the project, so `workspace_root` is
        // optional there. Global store: require a matching `workspace_root`.
        for (dir, require_root) in [(proj_dir, false), (global, true)] {
            if !dir.is_dir() {
                continue;
            }
            let Ok(rd) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in rd.flatten() {
                if cancel.load(std::sync::atomic::Ordering::SeqCst) {
                    return out;
                }
                let path = entry.path();
                if !is_transcript(&path) {
                    continue;
                }
                if since_ms > 0 && mtime_ms(&path) < since_ms {
                    continue;
                }
                let Some(conv) = self.conversation_from(&path, project_path, require_root) else {
                    continue;
                };
                out.push(conv);
            }
        }
        out
    }

    fn conversation_from(
        &self,
        path: &Path,
        project_path: &str,
        require_root: bool,
    ) -> Option<AgentConversation> {
        let meta = load_meta(path)?;
        let workspace_root = meta.workspace_root.as_deref().unwrap_or("");
        if require_root
            && (workspace_root.is_empty() || !path_matches(project_path, workspace_root))
        {
            return None;
        }
        let id = branch_id(path)?;
        let summary = meta
            .custom_title
            .as_deref()
            .or(meta.topic_title.as_deref())
            .or(meta.preview.as_deref())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(160).collect())
            .or_else(|| first_user_text(path))
            .unwrap_or_else(|| DEFAULT_SUMMARY.into());
        let last_message_at = meta.updated_at.filter(|s| !s.is_empty()).or_else(|| {
            std::fs::metadata(path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| system_time_rfc3339(t))
        });
        let status = if meta.in_flight_turn.is_some() {
            AgentStatus::Working
        } else {
            AgentStatus::Idle
        };
        Some(AgentConversation {
            agent_kind: AgentKind::Reasonix,
            external_id: id.clone(),
            project_path: project_path.to_string(),
            summary,
            last_message_at,
            status,
            resume_command: format!("reasonix --resume {id}"),
            source: path.to_string_lossy().to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn cancel() -> CancelToken {
        Arc::new(std::sync::atomic::AtomicBool::new(false))
    }

    fn write_session(
        root: &Path,
        project: &str,
        id: &str,
        meta_json: &str,
        transcript: &str,
    ) -> PathBuf {
        let dir = root
            .join("projects")
            .join(&workspace_slug(project))
            .join("sessions");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join(format!("{id}.jsonl"));
        std::fs::write(&f, transcript).unwrap();
        std::fs::write(format!("{}.meta", f.to_string_lossy()), meta_json).unwrap();
        f
    }

    #[test]
    fn slug_folds_case_and_separators() {
        // Separator folding is platform-independent.
        assert_eq!(workspace_slug("/home/u/proj"), "-home-u-proj");
        // Case folding is Windows-only (NTFS), matching the runtime.
        #[cfg(windows)]
        assert_eq!(workspace_slug("C:\\Work\\Proj"), "c--work-proj");
        #[cfg(not(windows))]
        assert_eq!(workspace_slug("C:\\Work\\Proj"), "C--Work-Proj");
        #[cfg(windows)]
        assert_eq!(workspace_slug("D:/work/proj"), "d--work-proj");
        #[cfg(not(windows))]
        assert_eq!(workspace_slug("D:/work/proj"), "D--work-proj");
    }

    #[test]
    fn sidecars_are_not_transcripts() {
        assert!(is_transcript(Path::new("2026-08-09.abc.jsonl")));
        assert!(!is_transcript(Path::new("2026-08-09.abc.events.jsonl")));
        assert!(!is_transcript(Path::new("2026-08-09.abc.conflicts.jsonl")));
        assert!(!is_transcript(Path::new("2026-08-09.abc.guardian.jsonl")));
        assert!(!is_transcript(Path::new("2026-08-09.abc.jsonl.meta")));
    }

    #[test]
    fn scans_project_store_and_reads_meta() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = r#"{
            "id": "2026-08-09.0000000000-gpt-4",
            "custom_title": "修复登录",
            "workspace_root": "C:\\proj-x",
            "updated_at": "2026-08-09T10:00:00Z",
            "in_flight_turn": null
        }"#;
        let transcript = concat!(
            "{\"role\":\"user\",\"content\":\"帮我修复登录\",\"createdAt\":1780000000000}\n",
            "{\"role\":\"assistant\",\"content\":\"好的\",\"createdAt\":1780000005000}\n"
        );
        write_session(
            tmp.path(),
            "C:\\proj-x",
            "2026-08-09.0000000000-gpt-4",
            meta,
            transcript,
        );

        let convs = ReasonixAdapter.scan_at(tmp.path(), "C:\\proj-x", 0, &cancel());
        assert_eq!(convs.len(), 1);
        let c = &convs[0];
        assert_eq!(c.agent_kind, AgentKind::Reasonix);
        assert_eq!(c.external_id, "2026-08-09.0000000000-gpt-4");
        assert_eq!(c.summary, "修复登录");
        assert_eq!(c.last_message_at.as_deref(), Some("2026-08-09T10:00:00Z"));
        assert_eq!(c.status, AgentStatus::Idle);
        assert_eq!(
            c.resume_command,
            "reasonix --resume 2026-08-09.0000000000-gpt-4"
        );
    }

    #[test]
    fn global_store_requires_workspace_root_match() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("sessions");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("2026-08-09.0000000000-gpt-4.jsonl");
        std::fs::write(&f, "{\"role\":\"user\",\"content\":\"hi\"}\n").unwrap();
        std::fs::write(
            format!("{}.meta", f.to_string_lossy()),
            r#"{"workspace_root":"C:\\other-proj"}"#,
        )
        .unwrap();
        // Wrong project → skipped.
        assert!(ReasonixAdapter
            .scan_at(tmp.path(), "C:\\proj-x", 0, &cancel())
            .is_empty());
        // Right project → found.
        assert_eq!(
            ReasonixAdapter
                .scan_at(tmp.path(), "C:\\other-proj", 0, &cancel())
                .len(),
            1
        );
    }

    #[test]
    fn in_flight_turn_marks_working() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = r#"{
            "workspace_root": "C:\\proj-x",
            "in_flight_turn": {"start_message_index": 2}
        }"#;
        write_session(
            tmp.path(),
            "C:\\proj-x",
            "sess-a",
            meta,
            "{\"role\":\"user\",\"content\":\"x\"}\n",
        );
        let convs = ReasonixAdapter.scan_at(tmp.path(), "C:\\proj-x", 0, &cancel());
        assert_eq!(convs[0].status, AgentStatus::Working);
    }

    #[test]
    fn project_store_accepts_missing_workspace_root() {
        // Real Reasonix project-store metas omit `workspace_root`; the slug
        // directory already pins the project.
        let tmp = tempfile::tempdir().unwrap();
        let meta = r#"{
            "id": "20260809-113600.618420000-deepseek-v4-flash",
            "preview": "帮我修 bug",
            "updated_at": "2026-08-09T11:36:36.2352044Z",
            "in_flight_turn": null
        }"#;
        write_session(
            tmp.path(),
            "E:\\workspace\\Galaxy",
            "20260809-113600.618420000-deepseek-v4-flash",
            meta,
            "{\"role\":\"user\",\"content\":\"帮我修 bug\"}\n",
        );
        let convs = ReasonixAdapter.scan_at(tmp.path(), "E:\\workspace\\Galaxy", 0, &cancel());
        assert_eq!(convs.len(), 1);
        assert_eq!(convs[0].summary, "帮我修 bug");
        assert_eq!(
            convs[0].last_message_at.as_deref(),
            Some("2026-08-09T11:36:36.2352044Z")
        );
        // Slug folds case on Windows: a differently-cased project still matches.
        #[cfg(windows)]
        assert_eq!(
            ReasonixAdapter
                .scan_at(tmp.path(), "e:\\workspace\\galaxy", 0, &cancel())
                .len(),
            1
        );
    }

    #[test]
    fn summary_falls_back_to_transcript() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = r#"{"workspace_root":"C:\\proj-x"}"#;
        let transcript = concat!(
            "{\"role\":\"system\",\"content\":\"system prompt\"}\n",
            "{\"role\":\"user\",\"raw_content\":\"<memory-update>…</memory-update>\\n帮我调试\",\"content\":\"帮我调试\"}\n"
        );
        write_session(tmp.path(), "C:\\proj-x", "sess-b", meta, transcript);
        let convs = ReasonixAdapter.scan_at(tmp.path(), "C:\\proj-x", 0, &cancel());
        assert_eq!(convs[0].summary, "帮我调试");
    }

    #[test]
    fn read_messages_parses_transcript() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = r#"{"workspace_root":"C:\\proj-x"}"#;
        let transcript = concat!(
            "{\"role\":\"user\",\"content\":\"content-only\",\"createdAt\":1780000000000}\n",
            "{\"role\":\"user\",\"raw_content\":\"<response-language>zh</response-language>\\n原始输入\",\"content\":\"原始输入\",\"createdAt\":1780000001000}\n",
            "{\"role\":\"assistant\",\"content\":\"好的\",\"reasoning_content\":\"思考\",\"createdAt\":1780000002000}\n",
            "{\"role\":\"tool\",\"name\":\"bash\",\"content\":\"ls 输出\"}\n"
        );
        let f = write_session(tmp.path(), "C:\\proj-x", "sess-c", meta, transcript);
        let conv = AgentConversation {
            agent_kind: AgentKind::Reasonix,
            external_id: "sess-c".into(),
            project_path: "C:\\proj-x".into(),
            summary: String::new(),
            last_message_at: None,
            status: AgentStatus::Idle,
            resume_command: String::new(),
            source: f.to_string_lossy().to_string(),
        };
        let msgs = ReasonixAdapter.read_messages(&conv, 50);
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[0].text, "content-only");
        assert_eq!(msgs[1].text, "原始输入"); // raw_content wins, transient block stripped
        assert_eq!(msgs[2].role, "assistant");
        assert_eq!(msgs[2].text, "好的");
        assert_eq!(msgs[2].at.as_deref(), Some("2026-05-28T20:26:42Z"));
    }

    #[test]
    fn read_messages_respects_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let meta = r#"{"workspace_root":"C:\\proj-x"}"#;
        let mut t = String::new();
        for i in 0..10 {
            t.push_str(&format!("{{\"role\":\"user\",\"content\":\"m{i}\"}}\n"));
        }
        let f = write_session(tmp.path(), "C:\\proj-x", "sess-d", meta, &t);
        let conv = AgentConversation {
            agent_kind: AgentKind::Reasonix,
            external_id: "sess-d".into(),
            project_path: "C:\\proj-x".into(),
            summary: String::new(),
            last_message_at: None,
            status: AgentStatus::Idle,
            resume_command: String::new(),
            source: f.to_string_lossy().to_string(),
        };
        let msgs = ReasonixAdapter.read_messages(&conv, 3);
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].text, "m7");
    }
}
