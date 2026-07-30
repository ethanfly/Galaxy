//! Command block store backed by `blocks.jsonl` (spec §5.3, §7).
//! At most 500 non-favorite blocks are kept; favorites are never evicted.
//! When favorites alone exceed the soft cap the UI is asked to prompt the
//! user to clean up — nothing is discarded silently.
use std::path::Path;

use parking_lot::RwLock;

use crate::core::models::CommandBlock;
use crate::error::AppError;

pub const BLOCK_CAP: usize = 500;
pub const FAVORITE_SOFT_CAP: usize = 500;

pub struct BlockStore {
    path: std::path::PathBuf,
    blocks: RwLock<Vec<CommandBlock>>,
    favorite_overflow: RwLock<bool>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockListResult {
    pub blocks: Vec<CommandBlock>,
    pub favorite_overflow: bool,
}

impl BlockStore {
    /// Load existing blocks; malformed lines are skipped (never fatal).
    pub fn load(path: &Path) -> Result<Self, AppError> {
        let mut blocks = Vec::new();
        if path.exists() {
            let raw = std::fs::read_to_string(path)?;
            for line in raw.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                match serde_json::from_str::<CommandBlock>(line) {
                    Ok(b) => blocks.push(b),
                    Err(e) => tracing::warn!("跳过损坏的命令块行: {e}"),
                }
            }
        }
        let store = Self {
            path: path.to_path_buf(),
            blocks: RwLock::new(blocks),
            favorite_overflow: RwLock::new(false),
        };
        store.enforce_caps();
        Ok(store)
    }

    fn enforce_caps(&self) {
        let mut blocks = self.blocks.write();
        let non_fav: Vec<usize> = blocks
            .iter()
            .enumerate()
            .filter(|(_, b)| !b.favorite)
            .map(|(i, _)| i)
            .collect();
        let mut removed = 0usize;
        for &idx in non_fav.iter().take(non_fav.len().saturating_sub(BLOCK_CAP)) {
            blocks[idx].command = String::new();
            blocks[idx].output = String::new();
            removed += 1;
        }
        if removed > 0 {
            blocks.retain(|b| b.favorite || !b.command.is_empty() || !b.output.is_empty());
            tracing::info!("命令块容量限制：淘汰 {removed} 个非收藏块");
        }
        let favorites = blocks.iter().filter(|b| b.favorite).count();
        *self.favorite_overflow.write() = favorites > FAVORITE_SOFT_CAP;
    }

    fn persist_all(&self) -> Result<(), AppError> {
        let blocks = self.blocks.read();
        let mut buf = String::new();
        for b in blocks.iter() {
            buf.push_str(&serde_json::to_string(b)?);
            buf.push('\n');
        }
        let tmp = self.path.with_extension("jsonl.tmp");
        std::fs::write(&tmp, &buf)
            .map_err(|e| AppError::Persistence(format!("写入命令块失败: {e}")))?;
        if self.path.exists() {
            let _ = std::fs::remove_file(&self.path);
        }
        std::fs::rename(&tmp, &self.path)
            .map_err(|e| AppError::Persistence(format!("替换命令块存储失败: {e}")))?;
        Ok(())
    }

    /// Append a completed block, then drop the oldest non-favorites if over cap.
    pub fn append(&self, block: CommandBlock) -> Result<(), AppError> {
        {
            let line = serde_json::to_string(&block)? + "\n";
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .map_err(|e| AppError::Persistence(format!("追加命令块失败: {e}")))?;
            f.write_all(line.as_bytes())
                .map_err(|e| AppError::Persistence(format!("追加命令块失败: {e}")))?;
        }
        self.blocks.write().push(block);
        self.enforce_caps();
        Ok(())
    }

    pub fn list(&self, session_id: Option<&str>) -> BlockListResult {
        let blocks = self.blocks.read();
        let filtered: Vec<CommandBlock> = match session_id {
            Some(sid) => blocks.iter().filter(|b| b.session_id == sid).cloned().collect(),
            None => blocks.clone(),
        };
        BlockListResult {
            blocks: filtered,
            favorite_overflow: *self.favorite_overflow.read(),
        }
    }

    /// Unified history/favorite search used by Ctrl+R and block search.
    pub fn search(&self, query: &str, favorites_only: bool) -> Vec<CommandBlock> {
        let q = query.trim().to_lowercase();
        self.blocks
            .read()
            .iter()
            .filter(|b| !favorites_only || b.favorite)
            .filter(|b| {
                q.is_empty()
                    || b.command.to_lowercase().contains(&q)
                    || b.output.to_lowercase().contains(&q)
            })
            .cloned()
            .collect()
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<Option<CommandBlock>, AppError> {
        {
            let mut blocks = self.blocks.write();
            let Some(b) = blocks.iter_mut().find(|b| b.id == id) else {
                return Ok(None);
            };
            b.favorite = favorite;
        }
        self.enforce_caps();
        self.persist_all()?;
        Ok(self.blocks.read().iter().find(|b| b.id == id).cloned())
    }

    pub fn get(&self, id: &str) -> Option<CommandBlock> {
        self.blocks.read().iter().find(|b| b.id == id).cloned()
    }

    /// Clear non-favorite blocks (user-initiated cleanup).
    pub fn clear_non_favorites(&self) -> Result<usize, AppError> {
        let removed = {
            let mut blocks = self.blocks.write();
            let before = blocks.len();
            blocks.retain(|b| b.favorite);
            before - blocks.len()
        };
        self.enforce_caps();
        self.persist_all()?;
        Ok(removed)
    }

    pub fn remove_for_session(&self, session_id: &str) -> Result<(), AppError> {
        {
            let mut blocks = self.blocks.write();
            blocks.retain(|b| b.session_id != session_id);
        }
        self.enforce_caps();
        self.persist_all()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::CommandBlock;

    fn block(i: usize, favorite: bool) -> CommandBlock {
        CommandBlock {
            id: format!("b{i}"),
            project_id: "p".into(),
            session_id: "s".into(),
            pane_id: "pn".into(),
            command: format!("cmd{i}"),
            output: "out".into(),
            started_at: crate::core::models::now_rfc3339(),
            ended_at: None,
            exit_code: Some(0),
            favorite,
        }
    }

    #[test]
    fn non_favorites_capped_but_favorites_survive() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("blocks.jsonl");
        let store = BlockStore::load(&path).unwrap();
        for i in 0..(BLOCK_CAP + 10) {
            store.append(block(i, false)).unwrap();
        }
        store.append(block(9999, true)).unwrap();
        let all = store.list(None).blocks;
        let favs = all.iter().filter(|b| b.favorite).count();
        assert!(favs >= 1);
        assert!(all.iter().filter(|b| !b.favorite).count() <= BLOCK_CAP);
        // the oldest non-favorites were evicted
        assert!(all.iter().all(|b| b.command != "cmd0"));
        assert!(all.iter().any(|b| b.id == "b9999"));
    }

    #[test]
    fn search_filters_by_content_and_favorite() {
        let tmp = tempfile::tempdir().unwrap();
        let store = BlockStore::load(&tmp.path().join("b.jsonl")).unwrap();
        let mut b = block(1, true);
        b.command = "cargo build".into();
        store.append(b).unwrap();
        store.append(block(2, false)).unwrap();
        assert_eq!(store.search("cargo", true).len(), 1);
        assert_eq!(store.search("cmd2", false).len(), 1);
    }
}
