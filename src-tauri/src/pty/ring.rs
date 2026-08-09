//! Per-pane ordered ring buffer of output chunks with monotonically
//! increasing sequence numbers. The UI detects sequence gaps and replays
//! from here; when the requested range has already been evicted the replay
//! reports a truncation marker so the terminal can show a clear notice.
use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq)]
pub struct RingChunk {
    pub seq: u64,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Replay {
    /// All chunks with seq > after_seq are present.
    Chunks(Vec<RingChunk>),
    /// The requested range was partially evicted. Carries the chunks that
    /// are still buffered plus the lowest seq the buffer still holds.
    Truncated {
        from_seq: u64,
        chunks: Vec<RingChunk>,
    },
}

pub struct RingBuffer {
    chunks: VecDeque<RingChunk>,
    byte_cap: usize,
    chunk_cap: usize,
    bytes: usize,
    next_seq: u64,
}

impl RingBuffer {
    pub fn new(byte_cap: usize, chunk_cap: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            byte_cap,
            chunk_cap,
            bytes: 0,
            next_seq: 1,
        }
    }

    pub fn push(&mut self, data: String) -> RingChunk {
        let chunk = RingChunk {
            seq: self.next_seq,
            data,
        };
        self.next_seq += 1;
        self.bytes += chunk.data.len();
        self.chunks.push_back(chunk.clone());
        while self.bytes > self.byte_cap || self.chunks.len() > self.chunk_cap {
            if let Some(old) = self.chunks.pop_front() {
                self.bytes = self.bytes.saturating_sub(old.data.len());
            } else {
                break;
            }
        }
        chunk
    }

    pub fn replay(&self, after_seq: u64) -> Replay {
        let oldest = self.chunks.front().map(|c| c.seq).unwrap_or(self.next_seq);
        let chunks: Vec<RingChunk> = self
            .chunks
            .iter()
            .filter(|c| c.seq > after_seq)
            .cloned()
            .collect();
        if after_seq + 1 < oldest && !self.chunks.is_empty() {
            Replay::Truncated {
                from_seq: oldest,
                chunks,
            }
        } else {
            Replay::Chunks(chunks)
        }
    }

    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    pub fn latest_seq(&self) -> u64 {
        self.next_seq.saturating_sub(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_after_gap_reports_truncation() {
        let mut r = RingBuffer::new(24, 10);
        for i in 0..8 {
            r.push(format!("chunk{i}"));
        }
        // evicted 1..=N? ask for everything since seq 0
        match r.replay(0) {
            Replay::Truncated { from_seq, chunks } => {
                assert!(from_seq > 1);
                assert!(!chunks.is_empty());
            }
            Replay::Chunks(_) => panic!("expected truncation"),
        }
    }

    #[test]
    fn replay_within_buffer_is_exact() {
        let mut r = RingBuffer::new(1 << 20, 128);
        for i in 0..5 {
            r.push(format!("{i}"));
        }
        match r.replay(2) {
            Replay::Chunks(chunks) => {
                assert_eq!(
                    chunks.iter().map(|c| c.seq).collect::<Vec<_>>(),
                    vec![3, 4, 5]
                );
            }
            _ => panic!(),
        }
    }

    #[test]
    fn caps_are_enforced() {
        let mut r = RingBuffer::new(1 << 20, 4);
        for _ in 0..10 {
            r.push("x".repeat(10));
        }
        assert!(r.len() <= 4);
    }
}
