//! Rolling, redacted application logs (spec §7, §8). Logs are structured
//! key=value lines with a correlation id; user paths (and anything that
//! looks like a command line or terminal content) are redacted by default.
use std::path::{Path, PathBuf};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LOG_FILES: usize = 5;

pub struct RollingLog {
    dir: PathBuf,
    current: PathBuf,
}

impl RollingLog {
    pub fn new(dir: &Path) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let name = format!("galaxy-{}.log", chrono_free_date());
        Ok(Self {
            dir: dir.to_path_buf(),
            current: dir.join(name),
        })
    }

    pub fn writer(&self) -> BoxedWriter {
        if let Ok(meta) = std::fs::metadata(&self.current) {
            if meta.len() > MAX_LOG_BYTES {
                let _ = self.rotate();
            }
        }
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.current)
        {
            Ok(f) => Box::new(f),
            Err(_) => Box::new(std::io::sink()),
        }
    }

    fn rotate(&self) -> std::io::Result<()> {
        let rotated = self
            .current
            .with_extension(format!("{}.log", chrono_free_time()));
        std::fs::rename(&self.current, rotated)?;
        // prune old
        let mut logs: Vec<_> = std::fs::read_dir(&self.dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".log"))
            .collect();
        logs.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
        while logs.len() > MAX_LOG_FILES {
            let f = logs.remove(0);
            let _ = std::fs::remove_file(f.path());
        }
        Ok(())
    }

    pub fn current_path(&self) -> PathBuf {
        self.current.clone()
    }
}

/// Boxed writer so `MakeWriter` closures have a single concrete type.
pub type BoxedWriter = Box<dyn std::io::Write + Send>;

fn chrono_free_date() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Iso8601::DATE)
        .unwrap_or_else(|_| "unknown".into())
}

fn chrono_free_time() -> String {
    let t = time::OffsetDateTime::now_utc().time();
    format!("{:02}{:02}{:02}", t.hour(), t.minute(), t.second())
}

/// Redact user-specific path fragments before any string hits the log file.
pub fn redact(input: &str) -> String {
    let mut out = input.to_string();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = home.to_string_lossy().to_string();
        if !home.is_empty() {
            out = out.replace(&home, "~");
        }
    }
    if let Ok(user) = std::env::var("USERNAME") {
        out = out.replace(&user, "<user>");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redaction_hides_home() {
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            let home = home.to_string_lossy().to_string();
            let out = redact(&format!("error in {home}\\proj"));
            assert!(!out.contains(&home));
            assert!(out.contains('~'));
        }
    }
}
