//! Output triggers (spec §5.6): bounded regex with cooldown; actions are
//! notify / mark / bell / stop-scroll. The regex crate is linear-time, and
//! pattern length is capped, so evaluation has an execution time ceiling.
use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const MAX_PATTERN_LEN: usize = 512;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TriggerScope {
    #[default]
    Global,
    Project(String),
    Session(String),
    Pane(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Copy)]
#[serde(rename_all = "camelCase")]
pub enum TriggerAction {
    Notify,
    Mark,
    Bell,
    StopScroll,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    pub id: String,
    pub name: String,
    pub pattern: String,
    #[serde(default)]
    pub scope: TriggerScope,
    #[serde(default = "default_cooldown")]
    pub cooldown_ms: u64,
    #[serde(default)]
    pub actions: Vec<TriggerAction>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub case_sensitive: bool,
}

fn default_cooldown() -> u64 {
    5_000
}
fn default_true() -> bool {
    true
}

impl Default for Trigger {
    fn default() -> Self {
        Self {
            id: super::models::new_id(),
            name: String::new(),
            pattern: String::new(),
            scope: TriggerScope::Global,
            cooldown_ms: default_cooldown(),
            actions: vec![TriggerAction::Notify],
            enabled: true,
            case_sensitive: false,
        }
    }
}

impl Trigger {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.pattern.len() > MAX_PATTERN_LEN {
            return Err(AppError::InvalidInput(format!(
                "触发器正则过长（上限 {MAX_PATTERN_LEN} 字符）"
            )));
        }
        self.compile().map_err(|e| AppError::InvalidInput(format!("触发器正则无效: {e}")))?;
        Ok(())
    }

    pub fn compile(&self) -> Result<regex::Regex, regex::Error> {
        regex::RegexBuilder::new(&self.pattern)
            .case_insensitive(!self.case_sensitive)
            .size_limit(1 << 20)
            .build()
    }

    pub fn matches_scope(&self, project_id: &str, session_id: &str, pane_id: &str) -> bool {
        match &self.scope {
            TriggerScope::Global => true,
            TriggerScope::Project(p) => p == project_id,
            TriggerScope::Session(s) => s == session_id,
            TriggerScope::Pane(p) => p == pane_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pattern_length_is_capped() {
        let mut t = Trigger::default();
        t.pattern = "a".repeat(MAX_PATTERN_LEN + 1);
        assert!(t.validate().is_err());
        t.pattern = "a".repeat(MAX_PATTERN_LEN);
        assert!(t.validate().is_ok());
    }

    #[test]
    fn invalid_regex_rejected() {
        let mut t = Trigger::default();
        t.pattern = "(".into();
        assert!(t.validate().is_err());
    }

    #[test]
    fn scope_matching() {
        let mut t = Trigger::default();
        t.scope = TriggerScope::Pane("p1".into());
        assert!(t.matches_scope("x", "y", "p1"));
        assert!(!t.matches_scope("x", "y", "p2"));
    }
}
