//! Hermes Agent: `~/.hermes/state.db` SQLite (sessions + messages, read-only).
//! Resume: `hermes sessions resume <id>`.
use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use super::{home_dir, path_matches, AgentAdapter, AgentAvailability, CancelToken};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

pub struct HermesAdapter;

impl HermesAdapter {
    fn db_path() -> Option<PathBuf> {
        home_dir().map(|h| h.join(".hermes").join("state.db"))
    }

    fn open(path: &std::path::Path) -> Option<Connection> {
        Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .ok()
    }

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("PRAGMA table_info({table})"))
            .ok()
            .map(|mut s| {
                s.query_map([], |r| r.get::<_, String>(1))
                    .map(|rows| rows.flatten().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    }

    fn pick(cols: &[String], candidates: &[&str]) -> Option<String> {
        candidates
            .iter()
            .find(|c| cols.iter().any(|x| x.eq_ignore_ascii_case(c)))
            .map(|s| s.to_string())
    }

    fn table(conn: &Connection, names: &[&str]) -> Option<(String, Vec<String>)> {
        for n in names {
            let cols = Self::columns(conn, n);
            if !cols.is_empty() {
                return Some((n.to_string(), cols));
            }
        }
        None
    }
}

impl AgentAdapter for HermesAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Hermes
    }

    fn availability(&self) -> AgentAvailability {
        let Some(path) = Self::db_path() else {
            return AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到用户目录".into(),
            };
        };
        if !path.is_file() {
            return AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到 ~/.hermes/state.db，可能未使用 Hermes".into(),
            };
        }
        match Self::open(&path) {
            Some(_) => AgentAvailability {
                kind: Some(self.kind()),
                available: true,
                reason: String::new(),
            },
            None => AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "Hermes state.db 无法只读打开（可能被锁定）".into(),
            },
        }
    }

    fn scan(
        &self,
        project_path: &str,
        _since_ms: u64,
        cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let Some(path) = Self::db_path() else { return Vec::new() };
        let Some(conn) = Self::open(&path) else { return Vec::new() };
        let Some((table, cols)) = Self::table(&conn, &["sessions", "session", "chats", "conversations"])
        else {
            return Vec::new();
        };
        if cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return Vec::new();
        }

        let id_col = Self::pick(&cols, &["id", "session_id", "uuid"]).unwrap_or_else(|| "id".into());
        let title_col = Self::pick(&cols, &["title", "name", "summary", "label"]);
        let time_col = Self::pick(
            &cols,
            &["updated_at", "last_active", "modified_at", "created_at", "timestamp"],
        );
        let cwd_col = Self::pick(
            &cols,
            &["cwd", "working_dir", "worktree", "project_path", "directory", "path"],
        );

        let has_title = title_col.is_some();
        let has_time = time_col.is_some();
        let has_cwd = cwd_col.is_some();
        let order = time_col.clone().unwrap_or_else(|| id_col.clone());
        let sql = format!(
            "SELECT {id}{title}{time}{cwd} FROM {table} ORDER BY {order} DESC LIMIT 200",
            id = id_col,
            title = title_col.as_ref().map(|c| format!(", {c}")).unwrap_or_default(),
            time = time_col.as_ref().map(|c| format!(", {c}")).unwrap_or_default(),
            cwd = cwd_col.as_ref().map(|c| format!(", {c}")).unwrap_or_default(),
            table = table,
            order = order,
        );
        let Ok(mut stmt) = conn.prepare(&sql) else { return Vec::new() };
        let leaf = project_path
            .trim_end_matches(['\\', '/'])
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_lowercase();

        let rows = stmt.query_map([], |r| {
            let id: String = r.get(0)?;
            let mut idx = 1;
            let title: Option<String> = if has_title {
                let v = r.get(idx)?;
                idx += 1;
                v
            } else {
                None
            };
            let at: Option<String> = if has_time {
                let as_str: Option<String> = r.get(idx).ok();
                let as_i64: Option<i64> = r.get(idx).ok();
                idx += 1;
                as_str.or_else(|| as_i64.map(|n| n.to_string()))
            } else {
                None
            };
            let cwd: Option<String> = if has_cwd { r.get(idx)? } else { None };
            Ok((id, title, at, cwd))
        });
        let Ok(rows) = rows else { return Vec::new() };

        rows.flatten()
            .filter(|(_id, _title, _at, cwd)| {
                if let Some(c) = cwd {
                    path_matches(project_path, c) || c.to_lowercase().contains(&leaf)
                } else {
                    // No cwd column — include all (user filters in UI by project later)
                    true
                }
            })
            .map(|(id, title, at, _cwd)| AgentConversation {
                agent_kind: AgentKind::Hermes,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary: title
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| format!("Hermes · {id}")),
                last_message_at: at,
                status: AgentStatus::Idle,
                resume_command: format!("hermes sessions resume {id}"),
                source: format!("{}::{id}", path.to_string_lossy()),
            })
            .collect()
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let Some((db, session_id)) = conv.source.split_once("::") else {
            return Vec::new();
        };
        let Some(conn) = Self::open(std::path::Path::new(db)) else {
            return Vec::new();
        };
        let Some((table, cols)) =
            Self::table(&conn, &["messages", "message", "chat_messages", "turns"])
        else {
            return Vec::new();
        };
        let session_col =
            Self::pick(&cols, &["session_id", "sessionId", "chat_id", "conversation_id"])
                .unwrap_or_else(|| "session_id".into());
        let role_col = Self::pick(&cols, &["role", "author", "sender"]).unwrap_or_else(|| "role".into());
        let Some(text_col) = Self::pick(&cols, &["content", "text", "body", "message"]) else {
            return Vec::new();
        };
        let sql = format!(
            "SELECT {role_col}, {text_col} FROM {table} WHERE {session_col} = ?1 ORDER BY rowid DESC LIMIT ?2",
            role_col = role_col,
            text_col = text_col,
            table = table,
            session_col = session_col,
        );
        let Ok(mut stmt) = conn.prepare(&sql) else { return Vec::new() };
        let rows = stmt
            .query_map(rusqlite::params![session_id, limit as i64], |r| {
                Ok((
                    r.get::<_, String>(0).unwrap_or_else(|_| "assistant".into()),
                    r.get::<_, String>(1).unwrap_or_default(),
                ))
            })
            .ok();
        let Some(rows) = rows else { return Vec::new() };
        let mut msgs: Vec<AgentMessage> = rows
            .flatten()
            .filter(|(_, t)| !t.trim().is_empty())
            .map(|(role, text)| AgentMessage {
                role,
                text: text.chars().take(4000).collect(),
                at: None,
            })
            .collect();
        msgs.reverse();
        msgs
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("hermes sessions resume {}", conv.external_id)
    }
}
