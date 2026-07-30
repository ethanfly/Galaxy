//! Streaming decode of PTY bytes → Unicode text.
//!
//! Two failure modes that produce "boxes" / tofu for Chinese:
//! 1. Multi-byte UTF-8 sequences split across `read()` calls — naive
//!    `from_utf8_lossy` turns the incomplete lead into U+FFFD and corrupts
//!    the following bytes.
//! 2. Chinese Windows PowerShell 5.1 / cmd often emit GBK (CP936) instead of
//!    UTF-8. Those bytes are invalid UTF-8 and become replacement characters.
//!
//! This decoder keeps a pending tail for incomplete sequences and, when a
//! sequence is invalid as UTF-8, falls back to GB18030 (superset of GBK) for
//! that span. Pure UTF-8 streams (PowerShell 7, Git Bash, modern ConPTY) stay
//! on the UTF-8 path.

use encoding_rs::GB18030;

/// Streaming text decoder shared by one PTY reader thread.
#[derive(Debug, Default)]
pub struct StreamDecoder {
    pending: Vec<u8>,
}

impl StreamDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a raw PTY chunk; returns complete Unicode text ready to display.
    pub fn push(&mut self, data: &[u8]) -> String {
        if data.is_empty() && self.pending.is_empty() {
            return String::new();
        }
        self.pending.extend_from_slice(data);
        let (text, rest) = decode_buffer(&self.pending);
        self.pending = rest;
        text
    }

    /// Flush any remaining pending bytes (EOF).
    pub fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let (text, rest) = decode_buffer_force(&self.pending);
        self.pending = rest;
        // Anything still undecodable → replacement, never panic.
        if !self.pending.is_empty() {
            let mut out = text;
            out.push('\u{FFFD}');
            self.pending.clear();
            out
        } else {
            text
        }
    }
}

/// Decode as much as possible; leave incomplete UTF-8/GB multi-byte tails in `rest`.
fn decode_buffer(buf: &[u8]) -> (String, Vec<u8>) {
    if buf.is_empty() {
        return (String::new(), Vec::new());
    }

    // Fast path: whole buffer is valid UTF-8.
    if let Ok(s) = std::str::from_utf8(buf) {
        return (s.to_string(), Vec::new());
    }

    let mut out = String::with_capacity(buf.len());
    let mut i = 0;
    while i < buf.len() {
        match try_utf8_char(buf, i) {
            Utf8Try::Char(ch, len) => {
                out.push(ch);
                i += len;
            }
            Utf8Try::Incomplete => {
                // Need more bytes from the next read — keep the tail.
                return (out, buf[i..].to_vec());
            }
            Utf8Try::Invalid => {
                // Not UTF-8 here. Try one GB18030 character (2–4 bytes).
                match try_gb_char(buf, i) {
                    Some((ch, len)) => {
                        out.push(ch);
                        i += len;
                    }
                    None => {
                        // Incomplete multi-byte GB sequence at end of buffer.
                        if looks_like_gb_lead(buf[i]) && i + 1 >= buf.len() {
                            return (out, buf[i..].to_vec());
                        }
                        // Skip one bad byte rather than stall forever.
                        out.push('\u{FFFD}');
                        i += 1;
                    }
                }
            }
        }
    }
    (out, Vec::new())
}

fn decode_buffer_force(buf: &[u8]) -> (String, Vec<u8>) {
    let (mut text, rest) = decode_buffer(buf);
    if rest.is_empty() {
        return (text, rest);
    }
    // EOF: decode remaining with GB18030 lossy rather than drop.
    let (decoded, _, _) = GB18030.decode(&rest);
    text.push_str(&decoded);
    (text, Vec::new())
}

enum Utf8Try {
    Char(char, usize),
    Incomplete,
    Invalid,
}

fn try_utf8_char(buf: &[u8], i: usize) -> Utf8Try {
    let b0 = buf[i];
    let need = utf8_width(b0);
    if need == 0 {
        return Utf8Try::Invalid;
    }
    if i + need > buf.len() {
        // Could still be invalid if remaining bytes aren't continuations, but
        // we must wait for more data when the lead looks valid.
        return Utf8Try::Incomplete;
    }
    match std::str::from_utf8(&buf[i..i + need]) {
        Ok(s) => {
            let ch = s.chars().next().unwrap_or('\u{FFFD}');
            Utf8Try::Char(ch, need)
        }
        Err(_) => Utf8Try::Invalid,
    }
}

fn utf8_width(b0: u8) -> usize {
    if b0 < 0x80 {
        1
    } else if b0 & 0xE0 == 0xC0 {
        2
    } else if b0 & 0xF0 == 0xE0 {
        3
    } else if b0 & 0xF8 == 0xF0 {
        4
    } else {
        0
    }
}

fn looks_like_gb_lead(b: u8) -> bool {
    // GBK/GB18030 lead: 0x81..=0xFE
    (0x81..=0xFE).contains(&b)
}

fn try_gb_char(buf: &[u8], i: usize) -> Option<(char, usize)> {
    if !looks_like_gb_lead(buf[i]) {
        return None;
    }
    // Try 2-byte first (most CJK), then 4-byte GB18030.
    for len in [2usize, 4, 3] {
        if i + len > buf.len() {
            // Incomplete multi-byte at end — signal by returning None only when
            // no complete length fits; caller keeps pending if lead-only.
            continue;
        }
        let slice = &buf[i..i + len];
        let (decoded, _enc, had_errors) = GB18030.decode(slice);
        if had_errors {
            continue;
        }
        let mut chars = decoded.chars();
        if let (Some(ch), None) = (chars.next(), chars.next()) {
            // Exactly one Unicode scalar from this span → good character boundary.
            if ch != '\u{FFFD}' {
                return Some((ch, len));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_chinese_intact() {
        let mut d = StreamDecoder::new();
        let s = d.push("你好世界".as_bytes());
        assert_eq!(s, "你好世界");
        assert!(d.pending.is_empty());
    }

    #[test]
    fn utf8_split_across_chunks() {
        let mut d = StreamDecoder::new();
        // "中" = E4 B8 AD
        let bytes = "中文".as_bytes();
        let first = d.push(&bytes[..2]); // incomplete
        assert!(first.is_empty(), "incomplete lead must wait");
        let second = d.push(&bytes[2..]);
        assert_eq!(second, "中文");
    }

    #[test]
    fn gbk_chinese_decodes() {
        // "测试" in GBK: B2 E2 CA D4
        let gbk = [0xB2u8, 0xE2, 0xCA, 0xD4];
        let mut d = StreamDecoder::new();
        let s = d.push(&gbk);
        assert_eq!(s, "测试");
    }

    #[test]
    fn mixed_ascii_and_gbk() {
        let mut raw = b"hi ".to_vec();
        raw.extend_from_slice(&[0xB2, 0xE2]); // 测
        let mut d = StreamDecoder::new();
        assert_eq!(d.push(&raw), "hi 测");
    }
}
