//! OpenCode: `~/.local/share/opencode/opencode.db` SQLite (read-only).
//! A missing runtime, DB lock or schema drift makes just this adapter
//! unavailable — everything else keeps working (§5.4).
use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use super::{home_dir, path_matches, AgentAdapter, AgentAvailability, CancelToken};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};

pub struct OpenCodeAdapter;

impl OpenCodeAdapter {
    fn db_path() -> Option<PathBuf> {
        home_dir().map(|h| {
            h.join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db")
        })
    }

    fn open_readonly(path: &std::path::Path) -> Option<Connection> {
        Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .ok()
    }

    /// Read table columns; returns None if the table is missing (schema drift).
    fn columns(conn: &Connection, table: &str) -> Option<Vec<String>> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).ok()?;
        let cols = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .ok()?
            .filter_map(|c| c.ok())
            .collect::<Vec<_>>();
        if cols.is_empty() {
            None
        } else {
            Some(cols)
        }
    }

    fn pick(cols: &[String], candidates: &[&str]) -> Option<String> {
        candidates
            .iter()
            .find(|c| cols.iter().any(|x| x.eq_ignore_ascii_case(c)))
            .map(|s| s.to_string())
    }
}

impl AgentAdapter for OpenCodeAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::OpenCode
    }

    fn availability(&self) -> AgentAvailability {
        let Some(path) = Self::db_path() else {
            return AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到 OpenCode 数据库".into(),
            };
        };
        if !path.is_file() {
            return AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "未找到 OpenCode 数据库（可能未使用 OpenCode）".into(),
            };
        }
        match Self::open_readonly(&path) {
            Some(conn) => match Self::columns(&conn, "session") {
                Some(_) => AgentAvailability {
                    kind: Some(self.kind()),
                    available: true,
                    reason: String::new(),
                },
                None => AgentAvailability {
                    kind: Some(self.kind()),
                    available: false,
                    reason: "OpenCode 数据库结构不兼容（适配器保持只读，不影响其它 Agent）".into(),
                },
            },
            None => AgentAvailability {
                kind: Some(self.kind()),
                available: false,
                reason: "OpenCode 数据库被锁定或无运行时支持".into(),
            },
        }
    }

    fn scan(
        &self,
        project_path: &str,
        _since_ms: u64,
        _cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let Some(path) = Self::db_path() else {
            return Vec::new();
        };
        let Some(conn) = Self::open_readonly(&path) else {
            return Vec::new();
        };
        let Some(cols) = Self::columns(&conn, "session") else {
            return Vec::new();
        };

        let id_col = Self::pick(&cols, &["id", "session_id"]).unwrap_or_else(|| "id".into());
        let dir_col = Self::pick(&cols, &["directory", "cwd", "worktree", "path"]);
        let title_col = Self::pick(&cols, &["title", "summary", "name"]);
        let time_col = Self::pick(
            &cols,
            &["time_updated", "updated_at", "time_created", "created_at"],
        );
        let Some(dir_col) = dir_col else {
            return Vec::new();
        };

        let has_title = title_col.is_some();
        let has_time = time_col.is_some();
        let sql = format!(
            "SELECT {id_col}, {dir_col}{title_sel}{time_sel} FROM session ORDER BY {order} DESC LIMIT 200",
            id_col = id_col,
            dir_col = dir_col,
            title_sel = title_col.as_ref().map(|c| format!(", {c}")).unwrap_or_default(),
            time_sel = time_col.as_ref().map(|c| format!(", {c}")).unwrap_or_default(),
            order = time_col.clone().unwrap_or_else(|| id_col.clone()),
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let rows = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                let dir: String = r.get(1)?;
                let title: Option<String> = if has_title { r.get(2)? } else { None };
                let tidx = if has_title { 3 } else { 2 };
                let at: Option<String> = if has_time { r.get(tidx)? } else { None };
                Ok((id, dir, title, at))
            })
            .ok();
        let Some(rows) = rows else { return Vec::new() };

        let mut out = Vec::new();
        for row in rows.flatten() {
            let (id, dir, title, at) = row;
            if !path_matches(project_path, &dir) {
                continue;
            }
            out.push(AgentConversation {
                agent_kind: AgentKind::OpenCode,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary: title
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| "OpenCode 会话".into()),
                last_message_at: at,
                status: AgentStatus::Idle,
                resume_command: format!("opencode -s {id}"),
                source: format!("{}::{id}", path.to_string_lossy()),
            });
        }
        out
    }

    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage> {
        let Some((db, session_id)) = conv.source.split_once("::") else {
            return Vec::new();
        };
        let Some(conn) = Self::open_readonly(std::path::Path::new(db)) else {
            return Vec::new();
        };
        let Some(cols) = Self::columns(&conn, "message") else {
            return Vec::new();
        };
        let session_col = Self::pick(&cols, &["session_id", "sessionId", "session"])
            .unwrap_or_else(|| "session_id".into());
        let role_col = Self::pick(&cols, &["role", "author"]).unwrap_or_else(|| "role".into());
        let text_col = match Self::pick(&cols, &["text", "content", "body"]) {
            Some(c) => c,
            None => return Vec::new(),
        };
        let time_col = Self::pick(&cols, &["time_created", "created_at", "time"]);

        let has_time = time_col.is_some();
        let sql = format!(
            "SELECT {role_col}, {text_col}{time_sel} FROM message WHERE {session_col} = ?1 ORDER BY rowid DESC LIMIT ?2",
            role_col = role_col,
            text_col = text_col,
            time_sel = time_col.as_ref().map(|c| format!(", {c}")).unwrap_or_default(),
            session_col = session_col,
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let rows = stmt
            .query_map(rusqlite::params![session_id, limit as i64], |r| {
                let role: String = r.get(0)?;
                let text: String = r.get(1)?;
                let at: Option<String> = if has_time { r.get(2)? } else { None };
                Ok((role, text, at))
            })
            .ok();
        let Some(rows) = rows else { return Vec::new() };
        let mut msgs: Vec<AgentMessage> = rows
            .flatten()
            .map(|(role, text, at)| AgentMessage { role, text, at })
            .collect();
        msgs.reverse();
        msgs
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("opencode -s {}", conv.external_id)
    }
}
