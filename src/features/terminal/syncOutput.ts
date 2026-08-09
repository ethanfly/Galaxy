/**
 * DEC 2026 synchronized-output gate.
 *
 * Agent TUIs (Codex, Grok, ...) wrap every redraw in `CSI ? 2026 h` …
 * `CSI ? 2026 l` and expect the terminal to hold the frame and paint it
 * atomically. xterm.js 5.5 does not implement DEC 2026, and ConPTY delivers
 * each frame split across chunks, so without this gate xterm renders
 * mid-frame states: the cursor sweeps through header/working/input rows and
 * DECTCEM hide/show pairs flicker ("光标乱跳/闪烁").
 *
 * The gate scans the output stream for the begin/end markers (nesting-aware,
 * markers may be split across chunks), buffers everything inside a sync
 * block, and flushes it as a single write when the block closes — one parse
 * pass, one render, no torn frames. Safety valves force-flush when the end
 * marker never arrives so a misbehaving app cannot stall the pane.
 */

const SYNC_BEGIN = "\u001b[?2026h";
const SYNC_END = "\u001b[?2026l";
/** Shared marker prefix without the final h/l. */
const SYNC_PREFIX = "\u001b[?2026";

export const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
export const DEFAULT_MAX_HOLD_MS = 250;

export interface SyncGateChunk {
  data: string;
  seq: number;
  generation: number;
}

export interface SyncOutputGateOptions {
  maxBufferedBytes?: number;
  maxHoldMs?: number;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
}

export interface SyncOutputGate {
  push(chunk: SyncGateChunk): void;
  /** Flush any buffered frame content immediately (teardown / recovery). */
  flushAll(): void;
  dispose(): void;
}

interface MarkerHit {
  start: number;
  end: number;
  begin: boolean;
}

/** Find the next complete BEGIN/END marker at or after `from`. */
function findMarker(text: string, from: number): MarkerHit | null {
  let index = from;
  for (;;) {
    const start = text.indexOf(SYNC_PREFIX, index);
    if (start < 0) return null;
    const final = text[start + SYNC_PREFIX.length];
    if (final === "h") return { start, end: start + SYNC_BEGIN.length, begin: true };
    if (final === "l") return { start, end: start + SYNC_END.length, begin: false };
    // Same prefix but another mode number (e.g. ?20260h) — keep searching.
    index = start + 1;
  }
}

/**
 * Length of the longest suffix of `text` that is a proper prefix of a sync
 * marker. Such tails are carried to the next chunk so markers split across
 * chunk boundaries are still recognized.
 */
function partialMarkerSuffixLength(text: string): number {
  const max = Math.min(text.length, SYNC_PREFIX.length);
  for (let len = max; len > 0; len -= 1) {
    if (SYNC_PREFIX.startsWith(text.slice(text.length - len))) return len;
  }
  return 0;
}

export function createSyncOutputGate(
  emit: (data: string, seq: number, generation: number) => void,
  options: SyncOutputGateOptions = {},
): SyncOutputGate {
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const maxHoldMs = options.maxHoldMs ?? DEFAULT_MAX_HOLD_MS;
  const schedule = options.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms));
  const cancel = options.clearTimeout ?? ((id) => window.clearTimeout(id));

  let depth = 0;
  let buffered = "";
  let bufferedSeq = 0;
  let bufferedGeneration = 0;
  let carry = "";
  let holdTimer: number | null = null;
  let disposed = false;

  const clearHoldTimer = () => {
    if (holdTimer != null) {
      cancel(holdTimer);
      holdTimer = null;
    }
  };

  const armHoldTimer = () => {
    if (holdTimer != null || maxHoldMs <= 0) return;
    holdTimer = schedule(() => {
      holdTimer = null;
      forceFlush();
    }, maxHoldMs);
  };

  const flushBuffered = () => {
    clearHoldTimer();
    if (buffered.length === 0) return;
    const data = buffered;
    const seq = bufferedSeq;
    const generation = bufferedGeneration;
    buffered = "";
    emit(data, seq, generation);
  };

  /** Safety valve: ESU never arrived (or buffer overflow) — release bytes. */
  const forceFlush = () => {
    depth = 0;
    if (carry) {
      buffered += carry;
      carry = "";
    }
    flushBuffered();
  };

  const push = (chunk: SyncGateChunk) => {
    if (disposed) return;
    const text = carry + chunk.data;
    carry = "";
    bufferedSeq = chunk.seq;
    bufferedGeneration = chunk.generation;

    // Emit outside-sync text immediately (preserving order relative to frame
    // flushes); buffer inside-sync text until the block closes. Marker bytes
    // are kept so the flushed frame stays byte-identical (xterm ignores 2026).
    const route = (segment: string, inside: boolean) => {
      if (segment.length === 0) return;
      if (inside) buffered += segment;
      else emit(segment, chunk.seq, chunk.generation);
    };

    let position = 0;
    for (;;) {
      const marker = findMarker(text, position);
      if (!marker) break;
      route(text.slice(position, marker.start), depth > 0);
      if (marker.begin) {
        depth += 1;
        route(text.slice(marker.start, marker.end), true);
        armHoldTimer();
      } else if (depth > 0) {
        route(text.slice(marker.start, marker.end), true);
        depth -= 1;
        if (depth === 0) flushBuffered();
      } else {
        // Unbalanced END outside any block — pass through untouched.
        route(text.slice(marker.start, marker.end), false);
      }
      position = marker.end;
    }

    let tail = text.slice(position);
    const partial = partialMarkerSuffixLength(tail);
    if (partial > 0) {
      carry = tail.slice(tail.length - partial);
      tail = tail.slice(0, tail.length - partial);
    }
    route(tail, depth > 0);

    if (depth > 0 && buffered.length > maxBufferedBytes) forceFlush();
  };

  const flushAll = () => {
    if (disposed) return;
    forceFlush();
  };

  const dispose = () => {
    disposed = true;
    clearHoldTimer();
    buffered = "";
    carry = "";
    depth = 0;
  };

  return { push, flushAll, dispose };
}
