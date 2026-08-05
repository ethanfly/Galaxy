use std::time::{Duration, Instant};

use crate::core::models::{AgentKind, AgentStatus};

pub const IDLE_CONFIRMATION: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentObservation {
    Working,
    Blocked,
    Idle,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentTransition {
    pub previous: AgentStatus,
    pub current: AgentStatus,
    pub completed_epoch: Option<u64>,
}

#[derive(Debug)]
pub struct AgentStateMachine {
    stable: AgentStatus,
    idle_candidate_since: Option<Instant>,
    working_epoch: u64,
    completed_epoch: Option<u64>,
}

impl Default for AgentStateMachine {
    fn default() -> Self {
        Self {
            stable: AgentStatus::Idle,
            idle_candidate_since: None,
            working_epoch: 0,
            completed_epoch: None,
        }
    }
}

impl AgentStateMachine {
    pub fn stable(&self) -> AgentStatus {
        self.stable
    }

    pub fn observe(
        &mut self,
        observation: AgentObservation,
        observed_at: Instant,
    ) -> Option<AgentTransition> {
        if self.stable == AgentStatus::Done {
            return None;
        }
        match observation {
            AgentObservation::Unknown => None,
            AgentObservation::Working => {
                self.idle_candidate_since = None;
                if self.stable == AgentStatus::Working {
                    return None;
                }
                let previous = self.stable;
                let blocked_epoch_is_complete = previous == AgentStatus::Blocked
                    && (self.working_epoch == 0
                        || self.completed_epoch == Some(self.working_epoch));
                if previous != AgentStatus::Blocked || blocked_epoch_is_complete {
                    self.working_epoch += 1;
                }
                self.stable = AgentStatus::Working;
                Some(AgentTransition {
                    previous,
                    current: AgentStatus::Working,
                    completed_epoch: None,
                })
            }
            AgentObservation::Blocked => {
                self.idle_candidate_since = None;
                self.transition_to(AgentStatus::Blocked, None)
            }
            AgentObservation::Idle => {
                if self.stable == AgentStatus::Idle {
                    self.idle_candidate_since = None;
                    return None;
                }
                let Some(candidate_since) = self.idle_candidate_since else {
                    self.idle_candidate_since = Some(observed_at);
                    return None;
                };
                if observed_at.saturating_duration_since(candidate_since) < IDLE_CONFIRMATION {
                    return None;
                }
                self.idle_candidate_since = None;
                let completion = self.completion_for(AgentStatus::Idle);
                self.transition_to(AgentStatus::Idle, completion)
            }
        }
    }

    pub fn finish(&mut self) -> Option<AgentTransition> {
        if self.stable == AgentStatus::Done {
            return None;
        }
        self.idle_candidate_since = None;
        let completion = self.completion_for(AgentStatus::Done);
        self.transition_to(AgentStatus::Done, completion)
    }

    fn completion_for(&mut self, next: AgentStatus) -> Option<u64> {
        if self.stable != AgentStatus::Working
            || !matches!(next, AgentStatus::Idle | AgentStatus::Done)
            || self.completed_epoch == Some(self.working_epoch)
        {
            return None;
        }
        self.completed_epoch = Some(self.working_epoch);
        Some(self.working_epoch)
    }

    fn transition_to(
        &mut self,
        current: AgentStatus,
        completed_epoch: Option<u64>,
    ) -> Option<AgentTransition> {
        if self.stable == current {
            return None;
        }
        let previous = self.stable;
        self.stable = current;
        Some(AgentTransition {
            previous,
            current,
            completed_epoch,
        })
    }
}

pub fn infer_stream_observation(kind: AgentKind, text: &str) -> AgentObservation {
    let lines = recent_lines(text);
    if lines.iter().any(|line| is_working_line(kind, line)) {
        return AgentObservation::Working;
    }
    if has_blocked_evidence(kind, &lines) {
        return AgentObservation::Blocked;
    }
    AgentObservation::Unknown
}

pub fn infer_screen_observation(kind: AgentKind, screen: &str) -> AgentObservation {
    let lines: Vec<&str> = screen.lines().collect();
    if lines.iter().any(|line| is_working_line(kind, line)) {
        return AgentObservation::Working;
    }
    if has_blocked_evidence(kind, &lines) {
        return AgentObservation::Blocked;
    }
    if lines.iter().any(|line| is_idle_line(kind, line)) {
        return AgentObservation::Idle;
    }
    AgentObservation::Unknown
}

fn recent_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.lines().rev().take(24).collect();
    lines.reverse();
    lines
}

fn status_text(line: &str) -> String {
    line.trim()
        .trim_start_matches(|character: char| {
            matches!(
                character,
                '*' | '\u{2022}' | '\u{00b7}' | '\u{2219}' | '\u{25e6}' | '\u{280b}'
            )
        })
        .trim_start()
        .to_lowercase()
}

fn is_working_line(kind: AgentKind, line: &str) -> bool {
    let lower = status_text(line);
    match kind {
        AgentKind::Codex => {
            lower.starts_with("working (")
                && lower.contains("esc to interrupt")
                && lower.ends_with(')')
        }
        AgentKind::ClaudeCode => {
            lower.contains("esc to interrupt")
                || lower.starts_with("thinking")
                || lower.starts_with("tokens")
        }
        AgentKind::Gemini => {
            lower.starts_with("thinking")
                || lower.starts_with("generating")
                || lower.contains("esc to cancel")
        }
        AgentKind::Aider => {
            lower.starts_with("applied edit")
                || lower.starts_with("committing")
                || lower.starts_with("scanning repo")
        }
        _ => {
            lower.contains("esc to interrupt")
                || lower.starts_with("working")
                || lower.starts_with("thinking")
                || lower.starts_with("running tool")
                || lower.starts_with("generating")
        }
    }
}

fn has_blocked_evidence(kind: AgentKind, lines: &[&str]) -> bool {
    if kind == AgentKind::Codex {
        let recent: Vec<String> = lines
            .iter()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(8)
            .map(|line| prompt_text(line))
            .collect();
        let has_header = recent.iter().any(|line| {
            line.starts_with("allow command?")
                || line.starts_with("do you want to run")
                || line.starts_with("would you like to run")
        });
        let has_confirmation = recent.iter().any(|line| {
            line.contains("[y/n]")
                || line.contains("(y/n)")
                || line.starts_with("press enter to confirm")
                || line.starts_with("1. yes")
                || line.starts_with("yes, proceed")
        });
        return has_header && has_confirmation;
    }
    lines.iter().any(|line| is_blocked_line(kind, line))
}

fn prompt_text(line: &str) -> String {
    status_text(line)
        .trim_start_matches(|character: char| {
            matches!(character, '>' | '\u{00bb}' | '\u{203a}' | '\u{276f}')
        })
        .trim_start()
        .to_string()
}

fn is_blocked_line(kind: AgentKind, line: &str) -> bool {
    let lower = line.trim().to_lowercase();
    let markers: &[&str] = match kind {
        AgentKind::ClaudeCode => &["do you want to proceed", "permission to use", "1. yes"],
        AgentKind::Codex => &[],
        AgentKind::OpenCode => &["allow once", "permission", "confirm"],
        AgentKind::Gemini => &["waiting for approval", "approve", "[y/n]"],
        AgentKind::Copilot => &["approve this", "allow?", "confirm", "[y/n]"],
        AgentKind::Aider => &["add command output to the chat", "add these files", "(y/n)"],
        AgentKind::Cline | AgentKind::Roo => &["auto-approve", "approve", "reject"],
        _ => &[
            "waiting for approval",
            "permission required",
            "approve?",
            "confirm?",
        ],
    };
    markers.iter().any(|marker| lower.contains(marker))
}

fn is_idle_line(kind: AgentKind, line: &str) -> bool {
    let line = line.trim_start();
    match kind {
        AgentKind::Codex => {
            line == ">>"
                || line.starts_with(">> ")
                || line == "\u{00bb}"
                || line.starts_with("\u{00bb} ")
                || line == "\u{203a}"
                || line.starts_with("\u{203a} ")
                || line == "\u{276f}"
                || line.starts_with("\u{276f} ")
        }
        AgentKind::ClaudeCode => line == "\u{276f}" || line.starts_with("\u{276f} "),
        _ => {
            line == ">"
                || line.starts_with(">> ")
                || line == "\u{276f}"
                || line.starts_with("\u{276f} ")
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use crate::core::models::{AgentKind, AgentStatus};

    use super::*;

    #[test]
    fn codex_stream_absence_is_unknown_and_never_idle() {
        assert_eq!(
            infer_stream_observation(AgentKind::Codex, "ordinary command output"),
            AgentObservation::Unknown
        );
        assert_eq!(
            infer_stream_observation(AgentKind::Codex, "* Working (1m 25s * esc to interrupt)"),
            AgentObservation::Working
        );
    }

    #[test]
    fn codex_screen_requires_anchored_status_evidence() {
        assert_eq!(
            infer_screen_observation(
                AgentKind::Codex,
                ">> Run /review\n* Working (1m 25s * esc to interrupt)"
            ),
            AgentObservation::Working
        );
        assert_eq!(
            infer_screen_observation(
                AgentKind::Codex,
                "let label = \"Working (1m * esc to interrupt)\";"
            ),
            AgentObservation::Unknown
        );
        assert_eq!(
            infer_screen_observation(AgentKind::Codex, ">> Run /review on my changes"),
            AgentObservation::Idle
        );
        for prompt in [">>", "\u{00bb}", "\u{203a}", "\u{276f}"] {
            assert_eq!(
                infer_screen_observation(AgentKind::Codex, prompt),
                AgentObservation::Idle
            );
        }
    }

    #[test]
    fn codex_working_has_priority_over_blocked_and_composer_markers() {
        let screen = ">> Continue\nAllow command? [y/N]\n* Working (2s * esc to interrupt)";
        assert_eq!(
            infer_screen_observation(AgentKind::Codex, screen),
            AgentObservation::Working
        );
    }

    #[test]
    fn codex_blocked_requires_a_structured_prompt_not_marker_like_output() {
        let source_output =
            ">> Continue\nlet choice = \"[y/n]\";\n// press enter to confirm in the demo";
        assert_eq!(
            infer_screen_observation(AgentKind::Codex, source_output),
            AgentObservation::Idle
        );

        let approval = "Would you like to run the following command?\n\
                        cargo test\n\
                        > 1. Yes, proceed\n\
                        Press enter to confirm or esc to cancel";
        assert_eq!(
            infer_screen_observation(AgentKind::Codex, approval),
            AgentObservation::Blocked
        );
        assert_eq!(
            infer_screen_observation(AgentKind::Codex, "Allow command? [y/N]"),
            AgentObservation::Blocked
        );
    }

    #[test]
    fn idle_needs_two_samples_across_the_confirmation_interval() {
        let start = Instant::now();
        let mut machine = AgentStateMachine::default();

        assert_eq!(machine.observe(AgentObservation::Unknown, start), None);
        assert_eq!(machine.stable(), AgentStatus::Idle);
        assert_eq!(
            machine.observe(AgentObservation::Working, start),
            Some(AgentTransition {
                previous: AgentStatus::Idle,
                current: AgentStatus::Working,
                completed_epoch: None,
            })
        );
        assert_eq!(machine.working_epoch, 1);

        assert_eq!(
            machine.observe(AgentObservation::Idle, start + Duration::from_millis(10)),
            None
        );
        assert_eq!(
            machine.observe(AgentObservation::Idle, start + Duration::from_millis(499)),
            None
        );
        assert_eq!(
            machine.observe(AgentObservation::Idle, start + Duration::from_millis(510)),
            Some(AgentTransition {
                previous: AgentStatus::Working,
                current: AgentStatus::Idle,
                completed_epoch: Some(1),
            })
        );
        assert_eq!(
            machine.observe(AgentObservation::Idle, start + Duration::from_secs(2)),
            None
        );
    }

    #[test]
    fn each_new_working_epoch_can_complete_only_once() {
        let start = Instant::now();
        let mut machine = AgentStateMachine::default();

        machine.observe(AgentObservation::Working, start);
        machine.observe(AgentObservation::Idle, start + Duration::from_secs(1));
        let first = machine.observe(AgentObservation::Idle, start + Duration::from_secs(2));
        assert_eq!(first.unwrap().completed_epoch, Some(1));

        machine.observe(AgentObservation::Working, start + Duration::from_secs(3));
        assert_eq!(machine.working_epoch, 2);
        machine.observe(AgentObservation::Idle, start + Duration::from_secs(4));
        let second = machine.observe(AgentObservation::Idle, start + Duration::from_secs(5));
        assert_eq!(second.unwrap().completed_epoch, Some(2));
        assert_eq!(
            machine.observe(AgentObservation::Idle, start + Duration::from_secs(6)),
            None
        );
    }

    #[test]
    fn blocked_resume_stays_in_the_same_epoch_and_unknown_preserves_state() {
        let start = Instant::now();
        let mut machine = AgentStateMachine::default();

        machine.observe(AgentObservation::Working, start);
        machine.observe(AgentObservation::Blocked, start + Duration::from_millis(1));
        assert_eq!(machine.stable(), AgentStatus::Blocked);
        assert_eq!(
            machine.observe(AgentObservation::Unknown, start + Duration::from_secs(1)),
            None
        );
        machine.observe(AgentObservation::Working, start + Duration::from_secs(2));
        assert_eq!(machine.working_epoch, 1);
    }

    #[test]
    fn finish_emits_done_once_and_completes_only_active_work() {
        let start = Instant::now();
        let mut machine = AgentStateMachine::default();
        machine.observe(AgentObservation::Working, start);

        assert_eq!(
            machine.finish(),
            Some(AgentTransition {
                previous: AgentStatus::Working,
                current: AgentStatus::Done,
                completed_epoch: Some(1),
            })
        );
        assert_eq!(machine.finish(), None);
        assert_eq!(
            machine.observe(AgentObservation::Working, start + Duration::from_secs(1)),
            None
        );
        assert_eq!(
            machine.observe(AgentObservation::Idle, start + Duration::from_secs(2)),
            None
        );
        assert_eq!(machine.stable(), AgentStatus::Done);
    }
}
