//! Crush: `<project>/.crush/crush.db` — per-project SQLite, read-only (§5.4).
use rusqlite::{Connection, OpenFlags};

use super::{AgentAdapter, AgentAvailability, CancelToken};
use crate::core::models::{AgentConversation, AgentKind, AgentMessage, AgentStatus};
use std::path::PathBuf;

pub struct CrushAdapter;

impl CrushAdapter {
    fn db_for(project_path: &str) -> PathBuf {
        PathBuf::from(project_path).join(".crush").join("crush.db")
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
}

impl AgentAdapter for CrushAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Crush
    }

    fn availability(&self) -> AgentAvailability {
        AgentAvailability {
            kind: Some(self.kind()),
            available: true,
            reason: String::new(),
        }
    }

    fn scan(
        &self,
        project_path: &str,
        _since_ms: u64,
        _cancel: &CancelToken,
    ) -> Vec<AgentConversation> {
        let db_path = Self::db_for(project_path);
        if !db_path.is_file() {
            return Vec::new();
        }
        let Some(conn) = Self::open(&db_path) else {
            tracing::warn!("crush.db 打开失败（可能被锁定），跳过 Crush 适配器");
            return Vec::new();
        };
        let cols = Self::columns(&conn, "sessions");
        let (table, cols) = if cols.is_empty() {
            let cols = Self::columns(&conn, "session");
            if cols.is_empty() {
                return Vec::new();
            }
            ("session", cols)
        } else {
            ("sessions", cols)
        };
        let id_col = Self::pick(&cols, &["id", "session_id"]).unwrap_or_else(|| "id".into());
        let title_col = Self::pick(&cols, &["title", "name", "summary"]);
        let time_col = Self::pick(
            &cols,
            &["updated_at", "created_at", "time_updated", "time_created"],
        );

        let has_title = title_col.is_some();
        let has_time = time_col.is_some();
        let sql = format!(
            "SELECT {id_col}{title_sel}{time_sel} FROM {table} ORDER BY {order} DESC LIMIT 100",
            id_col = id_col,
            title_sel = title_col
                .as_ref()
                .map(|c| format!(", {c}"))
                .unwrap_or_default(),
            time_sel = time_col
                .as_ref()
                .map(|c| format!(", {c}"))
                .unwrap_or_default(),
            table = table,
            order = time_col.clone().unwrap_or_else(|| id_col.clone()),
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let rows = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                let title: Option<String> = if has_title { r.get(1)? } else { None };
                let tidx = if has_title { 2 } else { 1 };
                let at: Option<String> = if has_time { r.get(tidx)? } else { None };
                Ok((id, title, at))
            })
            .ok();
        let Some(rows) = rows else { return Vec::new() };
        rows.flatten()
            .map(|(id, title, at)| AgentConversation {
                agent_kind: AgentKind::Crush,
                external_id: id.clone(),
                project_path: project_path.to_string(),
                summary: title
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| "Crush 会话".into()),
                last_message_at: at,
                status: AgentStatus::Idle,
                resume_command: format!("crush --session {id}"),
                source: format!("{}::{id}", db_path.to_string_lossy()),
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
        let cols = Self::columns(&conn, "messages");
        let (table, cols) = if cols.is_empty() {
            let cols = Self::columns(&conn, "message");
            ("message", cols)
        } else {
            ("messages", cols)
        };
        if cols.is_empty() {
            return Vec::new();
        }
        let session_col =
            Self::pick(&cols, &["session_id", "sessionId"]).unwrap_or_else(|| "session_id".into());
        let role_col = Self::pick(&cols, &["role", "author"]).unwrap_or_else(|| "role".into());
        let Some(text_col) = Self::pick(&cols, &["content", "text", "body"]) else {
            return Vec::new();
        };
        let sql = format!(
            "SELECT {role_col}, {text_col} FROM {table} WHERE {session_col} = ?1 ORDER BY rowid DESC LIMIT ?2",
            role_col = role_col,
            text_col = text_col,
            table = table,
            session_col = session_col,
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let rows = stmt
            .query_map(rusqlite::params![session_id, limit as i64], |r| {
                Ok((
                    r.get::<_, String>(0).unwrap_or_default(),
                    r.get::<_, String>(1).unwrap_or_default(),
                ))
            })
            .ok();
        let Some(rows) = rows else { return Vec::new() };
        let mut msgs: Vec<AgentMessage> = rows
            .flatten()
            .map(|(role, text)| AgentMessage {
                role,
                text,
                at: None,
            })
            .collect();
        msgs.reverse();
        msgs
    }

    fn resume_command(&self, conv: &AgentConversation) -> String {
        format!("crush --session {}", conv.external_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crush_db_scans_sessions() {
        let tmp = tempfile::tempdir().unwrap();
        let proj = tmp.path().join("myproj");
        std::fs::create_dir_all(proj.join(".crush")).unwrap();
        let db = proj.join(".crush").join("crush.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT, updated_at TEXT);
             CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT);
             INSERT INTO sessions VALUES('s1','修登录页','2026-07-02T10:00:00Z');
             INSERT INTO messages(session_id, role, content) VALUES('s1','user','帮我修登录页'),('s1','assistant','已修复');",
        )
        .unwrap();
        drop(conn);
        let found = CrushAdapter.scan(
            proj.to_str().unwrap(),
            0,
            &std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].external_id, "s1");
        assert!(found[0].resume_command.contains("crush --session s1"));
        let msgs = CrushAdapter.read_messages(&found[0], 10);
        assert_eq!(msgs.len(), 2);
    }
}
