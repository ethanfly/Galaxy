//! Agent adapters (spec §5.4). Six adapters implement one interface: scan,
//! project matching, metadata parsing, message reading, status inference and
//! resume command generation. Agent files and SQLite databases are opened
//! read-only; agent-owned history is never modified. Format drift, DB locks
//! or a missing runtime degrade the adapter to "unavailable" — never fatal.
pub mod claude;
pub mod codex;
pub mod opencode;
pub mod omp;
pub mod grok;
pub mod crush;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;

use crate::core::models::{AgentConversation, AgentKind, AgentMessage};

pub type CancelToken = Arc<AtomicBool>;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAvailability {
    pub kind: Option<AgentKind>,
    pub available: bool,
    pub reason: String,
}

pub trait AgentAdapter: Send + Sync {
    fn kind(&self) -> AgentKind;
    /// Coarse availability: base paths exist / db opens read-only.
    fn availability(&self) -> AgentAvailability;
    /// Incremental scan: files/rows older than `since_ms` may be skipped.
    /// `cancel` must be checked between files so UI stays responsive.
    fn scan(
        &self,
        project_path: &str,
        since_ms: u64,
        cancel: &CancelToken,
    ) -> Vec<AgentConversation>;
    fn read_messages(&self, conv: &AgentConversation, limit: usize) -> Vec<AgentMessage>;
    /// Adapter-generated resume command — never raw history-file content.
    fn resume_command(&self, conv: &AgentConversation) -> String;
}

pub fn home_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|d| d.home_dir().to_path_buf())
}

/// Claude/OMP "sanitized cwd" convention: drive colon and separators → `-`.
pub fn sanitize_cwd(path: &str) -> String {
    path.chars()
        .map(|c| match c {
            ':' | '\\' | '/' => '-',
            c => c,
        })
        .collect()
}

pub fn path_matches(project_path: &str, recorded: &str) -> bool {
    normalize(project_path).eq_ignore_ascii_case(&normalize(recorded))
}

pub fn normalize(path: &str) -> String {
    let mut p = path.replace('/', "\\");
    while p.len() > 3 && p.ends_with('\\') {
        p.pop();
    }
    p
}

/// File modified time as unix ms (0 on failure).
pub fn mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Read a JSONL file line by line with a byte ceiling; malformed lines skipped.
pub fn read_jsonl(path: &Path, max_bytes: u64) -> Vec<serde_json::Value> {
    let Ok(meta) = std::fs::metadata(path) else { return Vec::new() };
    let mut out = Vec::new();
    if meta.len() > max_bytes {
        // Read only the tail — large histories must not be fully loaded.
        use std::io::{Read, Seek, SeekFrom};
        let Ok(mut f) = std::fs::File::open(path) else { return Vec::new() };
        let start = meta.len() - max_bytes;
        if f.seek(SeekFrom::Start(start)).is_err() {
            return Vec::new();
        }
        let mut buf = String::new();
        if f.read_to_string(&mut buf).is_err() {
            // Non-UTF8 boundary; fall back to lossy bytes.
            let _ = f.seek(SeekFrom::Start(start));
            let mut bytes = Vec::new();
            if f.read_to_end(&mut bytes).is_err() {
                return Vec::new();
            }
            buf = String::from_utf8_lossy(&bytes).to_string();
        }
        // Skip the (probably partial) first line.
        if let Some(pos) = buf.find('\n') {
            buf = buf[pos + 1..].to_string();
        }
        for line in buf.lines() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                out.push(v);
            }
        }
    } else if let Ok(raw) = std::fs::read_to_string(path) {
        for line in raw.lines() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                out.push(v);
            }
        }
    }
    out
}

pub fn first_nonempty(values: &[serde_json::Value], pointer: &str) -> Option<String> {
    values
        .iter()
        .find_map(|v| v.pointer(pointer).and_then(|x| x.as_str()).map(String::from))
}

pub struct AgentRegistry {
    adapters: Vec<Arc<dyn AgentAdapter>>,
    /// project_path → last scan watermark (incremental indexing)
    watermarks: Mutex<HashMap<String, u64>>,
    scan_generation: AtomicU64,
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            adapters: vec![
                Arc::new(claude::ClaudeAdapter),
                Arc::new(codex::CodexAdapter),
                Arc::new(opencode::OpenCodeAdapter),
                Arc::new(omp::OmpAdapter),
                Arc::new(grok::GrokAdapter),
                Arc::new(crush::CrushAdapter),
            ],
            watermarks: Mutex::new(HashMap::new()),
            scan_generation: AtomicU64::new(0),
        }
    }

    pub fn availability(&self) -> Vec<AgentAvailability> {
        self.adapters.iter().map(|a| a.availability()).collect()
    }

    /// Scan all available adapters for one project. Returns conversations and
    /// per-adapter availability so the panel can show actionable empty states.
    pub fn scan_project(
        &self,
        project_path: &str,
        cancel: &CancelToken,
    ) -> (Vec<AgentConversation>, Vec<AgentAvailability>) {
        let gen = self.scan_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let key = normalize(project_path).to_lowercase();
        let watermark = self.watermarks.lock().get(&key).copied().unwrap_or(0);
        let mut out = Vec::new();
        let mut availability = Vec::new();
        for adapter in &self.adapters {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let status = adapter.availability();
            if status.available {
                let found = adapter.scan(project_path, watermark, cancel);
                out.extend(found);
            }
            availability.push(status);
        }
        // Incremental watermark advances only when this scan is still current.
        if gen == self.scan_generation.load(Ordering::SeqCst) {
            self.watermarks.lock().insert(key, now_ms() + 1);
        }
        out.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at));
        (out, availability)
    }

    pub fn adapter(&self, kind: AgentKind) -> Option<Arc<dyn AgentAdapter>> {
        self.adapters.iter().find(|a| a.kind() == kind).cloned()
    }
}

/// Extract displayable text from common message shapes.
pub fn message_text(v: &serde_json::Value) -> Option<String> {
    for pointer in ["/text", "/content", "/message/content", "/payload/content"] {
        if let Some(s) = v.pointer(pointer) {
            if let Some(t) = s.as_str() {
                if !t.trim().is_empty() {
                    return Some(t.trim().chars().take(4000).collect());
                }
            }
            // content arrays of blocks with {type:"text", text:...}
            if let Some(arr) = s.as_array() {
                let joined: String = arr
                    .iter()
                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n");
                if !joined.trim().is_empty() {
                    return Some(joined.trim().chars().take(4000).collect());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_cwd_replaces_separators() {
        assert_eq!(sanitize_cwd("C:\\work\\proj"), "C--work-proj");
        assert_eq!(sanitize_cwd("/home/u/proj"), "-home-u-proj");
    }

    #[test]
    fn path_matching_is_case_and_separator_insensitive() {
        assert!(path_matches("C:\\Foo\\Bar", "c:/foo/bar/"));
        assert!(!path_matches("C:\\Foo", "C:\\Foo2"));
    }
}
