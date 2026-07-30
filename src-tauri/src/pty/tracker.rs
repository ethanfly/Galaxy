//! Per-pane stream trackers used by the PTY manager:
//!  - OSC 0/2 title capture (basename-simplified display titles)
//!  - command block extraction: OSC 133 marks when the shell supports shell
//!    integration, otherwise an input-submission heuristic; parsing failures
//!    degrade the pane to a plain terminal without blocking output
//!  - rolling plain-text tail used for agent status inference and triggers
use crate::core::models::{AgentKind, AgentStatus, CommandBlock};

const TAIL_CAP: usize = 16 * 1024;
const BLOCK_OUTPUT_CAP: usize = 128 * 1024;

/// Strip ANSI CSI / OSC sequences for heuristic analysis.
pub fn strip_ansi(input: &str) -> String {
    enum St {
        Norm,
        Esc,
        Csi,
        Osc,
        OscEsc,
    }
    let mut out = String::with_capacity(input.len());
    let mut st = St::Norm;
    for ch in input.chars() {
        st = match st {
            St::Norm => match ch {
                '\u{1b}' => St::Esc,
                c => {
                    out.push(c);
                    St::Norm
                }
            },
            St::Esc => match ch {
                '[' => St::Csi,
                ']' => St::Osc,
                _ => St::Norm,
            },
            St::Csi => match ch {
                '@'..='~' => St::Norm,
                _ => St::Csi,
            },
            St::Osc => match ch {
                '\u{7}' => St::Norm,
                '\u{1b}' => St::OscEsc,
                _ => St::Osc,
            },
            St::OscEsc => match ch {
                '\\' => St::Norm,
                _ => St::Osc,
            },
        };
    }
    out
}

/// Append to a capped tail buffer.
pub fn push_tail(tail: &mut String, data: &str) {
    tail.push_str(data);
    if tail.len() > TAIL_CAP {
        let cut = tail.len() - TAIL_CAP;
        let mut idx = cut;
        while !tail.is_char_boundary(idx) {
            idx += 1;
        }
        tail.drain(..idx);
    }
}

#[derive(Debug, Default)]
pub struct StreamEvents {
    pub title: Option<String>,
    pub completed_block: Option<(String, String, Option<i32>)>, // (command, output, exit)
    pub integration_seen: bool,
}

/// Stateful tracker for one pane's output stream.
pub struct PaneTracker {
    /// Partial OSC/CSI carry-over between chunks.
    pending: String,
    pub shell_integration: bool,
    /// Whether we're currently capturing block output.
    block_open: bool,
    block_command: String,
    block_output: String,
    /// Command waiting to be attributed (from input submission / OSC 133).
    pending_command: Option<String>,
    /// Last time this tracker saw input or output (for idle flush).
    last_activity: std::time::Instant,
}

impl Default for PaneTracker {
    fn default() -> Self {
        Self {
            pending: String::new(),
            shell_integration: false,
            block_open: false,
            block_command: String::new(),
            block_output: String::new(),
            pending_command: None,
            last_activity: std::time::Instant::now(),
        }
    }
}

impl PaneTracker {
    /// Key input flowed to the PTY; `\r` submits the accumulated line.
    /// Used when shell integration is active (OSC 133 will open/close blocks).
    pub fn note_input_submission(&mut self, line: Option<String>) {
        self.last_activity = std::time::Instant::now();
        self.pending_command = line;
    }

    /// Start a heuristic command block (no OSC 133). Call after closing any previous block.
    pub fn begin_heuristic_block(&mut self, command: String) {
        self.last_activity = std::time::Instant::now();
        self.block_open = true;
        self.block_command = command;
        self.block_output.clear();
        self.pending_command = None;
    }

    pub fn has_open_block(&self) -> bool {
        self.block_open
    }

    pub fn touch(&mut self) {
        self.last_activity = std::time::Instant::now();
    }

    /// Idle-flush candidate: open heuristic block with content and quiet long enough.
    pub fn idle_block_ready(&self, idle: std::time::Duration) -> bool {
        !self.shell_integration
            && self.block_open
            && (!self.block_command.is_empty() || !self.block_output.is_empty())
            && self.last_activity.elapsed() >= idle
    }

    /// Close the open block heuristic-style and hand it to the manager.
    pub fn close_block(&mut self, exit_code: Option<i32>) -> Option<(String, String, Option<i32>)> {
        if !self.block_open {
            return None;
        }
        self.block_open = false;
        let cmd = std::mem::take(&mut self.block_command);
        let out = std::mem::take(&mut self.block_output);
        Some((cmd, out, exit_code))
    }

    /// Scan one output chunk for OSC events; returns extracted events.
    pub fn scan(&mut self, chunk: &str) -> StreamEvents {
        let mut ev = StreamEvents::default();
        let text = format!("{}{}", std::mem::take(&mut self.pending), chunk);
        let bytes = text.as_bytes();
        let mut i = 0;
        let mut plain = String::with_capacity(text.len());
        while i < bytes.len() {
            if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b']' {
                // OSC: ESC ] ... (BEL | ESC \)
                let start = i + 2;
                let mut end = None;
                let mut j = start;
                while j < bytes.len() {
                    if bytes[j] == 0x07 {
                        end = Some((j, j + 1));
                        break;
                    }
                    if bytes[j] == 0x1b && j + 1 < bytes.len() && bytes[j + 1] == b'\\' {
                        end = Some((j, j + 2));
                        break;
                    }
                    j += 1;
                }
                match end {
                    Some((content_end, next)) => {
                        let content = &text[start..content_end];
                        self.handle_osc(content, &mut ev);
                        i = next;
                    }
                    None => {
                        // Incomplete OSC — keep remainder for next chunk.
                        self.pending = text[i..].to_string();
                        break;
                    }
                }
            } else if plain.len() < BLOCK_OUTPUT_CAP {
                plain.push(bytes[i] as char);
                i += 1;
            } else {
                i += 1;
            }
        }
        if self.block_open {
            self.last_activity = std::time::Instant::now();
            self.block_output.push_str(&strip_ansi(&plain));
            if self.block_output.len() > BLOCK_OUTPUT_CAP {
                let over = self.block_output.len() - BLOCK_OUTPUT_CAP;
                self.block_output.drain(..over);
            }
        }
        ev
    }

    fn handle_osc(&mut self, content: &str, ev: &mut StreamEvents) {
        // OSC content like "0;title" or "133;C" or "133;D;0"
        let mut parts = content.splitn(3, ';');
        let code = parts.next().unwrap_or("");
        match code {
            "0" | "2" => {
                let title = parts.next().unwrap_or("").trim();
                if !title.is_empty() {
                    ev.title = Some(simplify_title(title));
                }
            }
            "133" => {
                self.shell_integration = true;
                ev.integration_seen = true;
                match parts.next().unwrap_or("") {
                    // Prompt finished / command line read — capture pending input
                    "B" => {
                        if let Some(cmd) = self.pending_command.take() {
                            self.block_command = cmd;
                        }
                    }
                    // Pre-execution: output starts after this mark.
                    "C" => {
                        if self.block_open {
                            if let Some(done) = self.close_block(None) {
                                ev.completed_block = Some(done);
                            }
                        }
                        self.block_open = true;
                        if let Some(cmd) = self.pending_command.take() {
                            self.block_command = cmd;
                        }
                    }
                    // Command finished; optional exit code.
                    s if s.starts_with('D') => {
                        let exit = parts
                            .next()
                            .and_then(|c| c.parse::<i32>().ok());
                        // 133;D;<code> form arrives with code in same part
                        let exit = exit.or_else(|| {
                            s.strip_prefix("D;").and_then(|c| c.parse::<i32>().ok())
                        });
                        if let Some(done) = self.close_block(exit) {
                            ev.completed_block = Some(done);
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

/// Detect an agent executable in a submitted command line (§5.1 agent badge).
pub fn detect_agent_kind(line: &str) -> Option<AgentKind> {
    let first = line.split_whitespace().next()?;
    let stem = first
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(first)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .trim_end_matches(".bat")
        .trim_end_matches(".ps1")
        .to_lowercase();
    // Also match `npx @scope/pkg` style second tokens.
    let second = line
        .split_whitespace()
        .nth(1)
        .unwrap_or("")
        .trim_start_matches('@')
        .to_lowercase();
    match stem.as_str() {
        "claude" => Some(AgentKind::ClaudeCode),
        "codex" => Some(AgentKind::Codex),
        "opencode" => Some(AgentKind::OpenCode),
        "omp" => Some(AgentKind::Omp),
        "grok" | "grok-build" => Some(AgentKind::Grok),
        "crush" => Some(AgentKind::Crush),
        "gemini" | "gemini-cli" => Some(AgentKind::Gemini),
        "copilot" | "gh-copilot" => Some(AgentKind::Copilot),
        "aider" => Some(AgentKind::Aider),
        "goose" => Some(AgentKind::Goose),
        "qwen" | "qwen-code" | "qwen_code" => Some(AgentKind::Qwen),
        "kimi" | "kimi-cli" => Some(AgentKind::Kimi),
        "cline" | "cline-cli" => Some(AgentKind::Cline),
        "roo" | "roo-cline" | "roo-code" => Some(AgentKind::Roo),
        "continue" | "cn" => Some(AgentKind::Continue),
        "cursor" | "cursor-agent" | "cursor-cli" => Some(AgentKind::Cursor),
        "pi" | "pi-agent" | "pi-mono" => Some(AgentKind::Pi),
        "hermes" | "hermes-agent" => Some(AgentKind::Hermes),
        "openclaw" | "clawdbot" | "clawd" => Some(AgentKind::OpenClaw),
        "antigravity" | "agy" => Some(AgentKind::Antigravity),
        "amp" | "factory" | "droid" => Some(AgentKind::Amp),
        // `npx @google/gemini-cli` / `npx @github/copilot` etc.
        "npx" | "pnpm" | "yarn" | "bunx" => {
            if second.contains("gemini") {
                Some(AgentKind::Gemini)
            } else if second.contains("copilot") {
                Some(AgentKind::Copilot)
            } else if second.contains("aider") {
                Some(AgentKind::Aider)
            } else if second.contains("opencode") {
                Some(AgentKind::OpenCode)
            } else if second.contains("qwen") {
                Some(AgentKind::Qwen)
            } else if second.contains("continue") {
                Some(AgentKind::Continue)
            } else if second.contains("hermes") {
                Some(AgentKind::Hermes)
            } else if second.contains("pi-mono") || second.ends_with("/pi") || second == "pi" {
                Some(AgentKind::Pi)
            } else {
                None
            }
        }
        // `gh copilot`
        "gh" => {
            if second == "copilot" {
                Some(AgentKind::Copilot)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Basename-simplify an OSC title (spec §5.1): "user@host: C:\foo\bar" → "bar".
pub fn simplify_title(raw: &str) -> String {
    let t = raw.trim();
    let after_colon = t.rsplit(": ").next().unwrap_or(t);
    let trimmed = after_colon.trim_matches(|c| c == '"' || c == '\'');
    // strip trailing prompt chars
    let cleaned = trimmed.trim_end_matches(['$', '>', '#', '%', '❯']);
    let name = cleaned
        .rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or(cleaned)
        .trim();
    if name.is_empty() { t.chars().take(48).collect() } else { name.chars().take(48).collect() }
}

/// Heuristic agent status inference from the stripped output tail (§5.4).
pub fn infer_agent_status(kind: AgentKind, stripped_tail: &str) -> AgentStatus {
    let tail = stripped_tail
        .lines()
        .rev()
        .take(24)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    let lower = tail.to_lowercase();

    let blocked_markers: &[&str] = match kind {
        AgentKind::ClaudeCode => &["do you want to proceed", "1. yes", "permission to use"],
        AgentKind::Codex => &["allow?", "y/n", "press enter to confirm"],
        AgentKind::OpenCode => &["permission", "allow once", "confirm"],
        AgentKind::Gemini => &["allow", "approve", "y/n", "waiting for approval"],
        AgentKind::Copilot => &["allow?", "confirm", "approve this", "y/n"],
        AgentKind::Aider => &["add command output to the chat", "(y/n)", "add these files"],
        AgentKind::Cline | AgentKind::Roo => &["approve", "reject", "auto-approve", "pending"],
        _ => &["confirm", "allow", "y/n", "permission", "approve", "waiting for"],
    };
    if blocked_markers.iter().any(|m| lower.contains(m)) {
        return AgentStatus::Blocked;
    }

    let working_markers: &[&str] = match kind {
        AgentKind::ClaudeCode => &["esc to interrupt", "thinking", "tokens"],
        AgentKind::Codex => &["esc to interrupt", "working"],
        AgentKind::Gemini => &["thinking", "running", "generating", "esc to cancel"],
        AgentKind::Aider => &["applied edit", "committing", "running", "scanning repo"],
        _ => &["esc to interrupt", "working", "thinking", "spinner", "running tool", "generating"],
    };
    if working_markers.iter().any(|m| lower.contains(&m.to_lowercase())) {
        return AgentStatus::Working;
    }

    AgentStatus::Idle
}

/// Build a CommandBlock from tracker output parts.
pub fn make_block(
    project_id: &str,
    session_id: &str,
    pane_id: &str,
    command: String,
    output: String,
    exit_code: Option<i32>,
) -> CommandBlock {
    CommandBlock {
        id: crate::core::models::new_id(),
        project_id: project_id.to_string(),
        session_id: session_id.to_string(),
        pane_id: pane_id.to_string(),
        command,
        output: output.trim().to_string(),
        started_at: crate::core::models::now_rfc3339(),
        ended_at: Some(crate::core::models::now_rfc3339()),
        exit_code,
        favorite: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn osc_title_is_extracted_and_simplified() {
        let mut t = PaneTracker::default();
        let ev = t.scan("\u{1b}]0;user@host: C:\\work\\proj\\\u{7}");
        assert_eq!(ev.title.as_deref(), Some("proj"));
    }

    #[test]
    fn osc133_marks_build_blocks() {
        let mut t = PaneTracker::default();
        t.note_input_submission(Some("cargo test".into()));
        t.scan("prompt> \u{1b}]133;C\u{7}");
        t.scan("running 3 tests\nok\n");
        let ev = t.scan("\u{1b}]133;D;0\u{7}");
        let (cmd, out, code) = ev.completed_block.expect("block completed");
        assert_eq!(cmd, "cargo test");
        assert!(out.contains("running 3 tests"));
        assert_eq!(code, Some(0));
        assert!(t.shell_integration);
    }

    #[test]
    fn heuristic_records_command_and_output() {
        let mut t = PaneTracker::default();
        t.begin_heuristic_block("ls".into());
        t.scan("file1 file2\n");
        assert!(t.has_open_block());
        let (cmd, out, _) = t.close_block(None).expect("has block");
        assert_eq!(cmd, "ls");
        assert!(out.contains("file1"));
    }

    #[test]
    fn heuristic_next_command_closes_previous() {
        let mut t = PaneTracker::default();
        t.begin_heuristic_block("echo a".into());
        t.scan("a\n");
        let prev = t.close_block(None).expect("first block");
        assert_eq!(prev.0, "echo a");
        t.begin_heuristic_block("echo b".into());
        t.scan("b\n");
        let next = t.close_block(None).expect("second block");
        assert_eq!(next.0, "echo b");
        assert!(next.1.contains('b'));
    }

    #[test]
    fn strip_ansi_removes_sequences() {
        let s = strip_ansi("\u{1b}[32mhello\u{1b}[0m \u{1b}]0;t\u{7}world");
        assert_eq!(s, "hello world");
    }

    #[test]
    fn status_inference_blocked_and_working() {
        assert_eq!(
            infer_agent_status(AgentKind::ClaudeCode, "❯ Do you want to proceed?\n  1. Yes"),
            AgentStatus::Blocked
        );
        assert_eq!(
            infer_agent_status(AgentKind::ClaudeCode, "⠋ Thinking… (esc to interrupt)"),
            AgentStatus::Working
        );
        assert_eq!(infer_agent_status(AgentKind::Codex, "❯"), AgentStatus::Idle);
    }

    #[test]
    fn split_osc_across_chunks() {
        let mut t = PaneTracker::default();
        let ev1 = t.scan("abc\u{1b}]0;my-partial");
        assert!(ev1.title.is_none());
        let ev2 = t.scan("-title\u{7}rest");
        assert_eq!(ev2.title.as_deref(), Some("my-partial-title"));
    }

    #[test]
    fn agent_executables_detected() {
        assert_eq!(detect_agent_kind("claude --resume x"), Some(AgentKind::ClaudeCode));
        assert_eq!(detect_agent_kind("C:\\tools\\codex.exe"), Some(AgentKind::Codex));
        assert_eq!(detect_agent_kind("gemini"), Some(AgentKind::Gemini));
        assert_eq!(detect_agent_kind("gh copilot"), Some(AgentKind::Copilot));
        assert_eq!(detect_agent_kind("aider"), Some(AgentKind::Aider));
        assert_eq!(detect_agent_kind("goose"), Some(AgentKind::Goose));
        assert_eq!(detect_agent_kind("qwen"), Some(AgentKind::Qwen));
        assert_eq!(detect_agent_kind("kimi"), Some(AgentKind::Kimi));
        assert_eq!(detect_agent_kind("cline"), Some(AgentKind::Cline));
        assert_eq!(detect_agent_kind("cursor-agent"), Some(AgentKind::Cursor));
        assert_eq!(detect_agent_kind("pi --session x"), Some(AgentKind::Pi));
        assert_eq!(detect_agent_kind("hermes chat"), Some(AgentKind::Hermes));
        assert_eq!(detect_agent_kind("openclaw"), Some(AgentKind::OpenClaw));
        assert_eq!(detect_agent_kind("antigravity"), Some(AgentKind::Antigravity));
        assert_eq!(detect_agent_kind("amp"), Some(AgentKind::Amp));
        assert_eq!(detect_agent_kind("npx @google/gemini-cli"), Some(AgentKind::Gemini));
        assert_eq!(detect_agent_kind("npm run dev"), None);
    }
}
