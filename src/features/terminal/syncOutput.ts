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
/** OSC 0 window-title update — Codex wraps every animation frame in one. */
const OSC0_PREFIX = "\u001b]0;";

export const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
export const DEFAULT_MAX_HOLD_MS = 250;
/** Two OSC 0 updates closer than this (ms) mark a high-frequency TUI frame
 * stream (e.g. Codex's working spinner), enabling frame coalescing. */
export const DEFAULT_OSC_FRAME_DETECT_MS = 500;
/** In frame-coalescing mode, flush buffered content after this idle window
 * even if no OSC 0 arrived (safety valve for non-frame output). */
export const DEFAULT_OSC_FRAME_HOLD_MS = 200;
/** Leave frame-coalescing mode after this much time without any OSC 0. */
export const DEFAULT_OSC_FRAME_IDLE_MS = 2000;

export interface SyncGateChunk {
  data: string;
  seq: number;
  generation: number;
}

export interface SyncOutputGateOptions {
  maxBufferedBytes?: number;
  maxHoldMs?: number;
  /** Frame-coalescing window between two OSC 0 updates. */
  oscFrameDetectMs?: number;
  /** Idle flush window while frame-coalescing. */
  oscFrameHoldMs?: number;
  /** Leave frame-coalescing mode after this silent period. */
  oscFrameIdleMs?: number;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (id: number) => void;
  /** Injectable clock for tests. */
  now?: () => number;
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
 * marker or an OSC 0 opener. Such tails are carried to the next chunk so
 * markers split across chunk boundaries are still recognized.
 */
function partialMarkerSuffixLength(text: string): number {
  const prefixes = [SYNC_PREFIX, OSC0_PREFIX];
  const max = Math.min(text.length, SYNC_PREFIX.length);
  for (let len = max; len > 0; len -= 1) {
    const tail = text.slice(text.length - len);
    if (prefixes.some((prefix) => prefix.startsWith(tail))) return len;
  }
  return 0;
}

export function createSyncOutputGate(
  emit: (data: string, seq: number, generation: number) => void,
  options: SyncOutputGateOptions = {},
): SyncOutputGate {
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const maxHoldMs = options.maxHoldMs ?? DEFAULT_MAX_HOLD_MS;
  const oscFrameDetectMs = options.oscFrameDetectMs ?? DEFAULT_OSC_FRAME_DETECT_MS;
  const oscFrameHoldMs = options.oscFrameHoldMs ?? DEFAULT_OSC_FRAME_HOLD_MS;
  const oscFrameIdleMs = options.oscFrameIdleMs ?? DEFAULT_OSC_FRAME_IDLE_MS;
  const schedule = options.setTimeout ?? ((handler, ms) => window.setTimeout(handler, ms));
  const cancel = options.clearTimeout ?? ((id) => window.clearTimeout(id));
  const now = options.now ?? (() => Date.now());

  let depth = 0;
  let buffered = "";
  let bufferedSeq = 0;
  let bufferedGeneration = 0;
  let carry = "";
  let holdTimer: number | null = null;
  let disposed = false;
  /** Last OSC 0 update seen (either mode). */
  let lastOsc0At = Number.NEGATIVE_INFINITY;
  /** Coalescing mode: buffer everything until the next OSC 0 flush. */
  let oscFrameMode = false;
  /** Whether the open DEC 2026 block carries non-marker payload. */
  let syncHasPayload = false;

  const clearHoldTimer = () => {
    if (holdTimer != null) {
      cancel(holdTimer);
      holdTimer = null;
    }
  };

  const armHoldTimer = (ms: number) => {
    if (holdTimer != null || ms <= 0) return;
    holdTimer = schedule(() => {
      holdTimer = null;
      forceFlush();
    }, ms);
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

  /** Safety valve: ESU/OSC 0 never arrived (or buffer overflow) — release bytes. */
  const forceFlush = () => {
    depth = 0;
    if (carry) {
      buffered += carry;
      carry = "";
    }
    flushBuffered();
  };

  /** Is this position the start of an OSC 0 update? */
  const osc0At = (text: string, from: number): number => text.indexOf(OSC0_PREFIX, from);

  /** End of the OSC 0 sequence (BEL or ST), or -1 when unterminated. */
  const osc0End = (text: string, from: number): number => {
    const bel = text.indexOf("\u0007", from);
    const st = text.indexOf("\u001b\\", from);
    if (bel < 0) return st;
    if (st < 0) return bel;
    return Math.min(bel, st);
  };

  const push = (chunk: SyncGateChunk) => {
    if (disposed) return;
    const text = carry + chunk.data;
    carry = "";
    bufferedSeq = chunk.seq;
    bufferedGeneration = chunk.generation;

    // Leave frame-coalescing mode after a silent period; release anything
    // buffered so normal (immediate) emission resumes.
    if (oscFrameMode && now() - lastOsc0At > oscFrameIdleMs) {
      oscFrameMode = false;
      forceFlush();
    }

    // Emit outside-sync text immediately (preserving order relative to frame
    // flushes); buffer inside-sync text until the block closes. In
    // frame-coalescing mode everything is buffered until the next OSC 0.
    // Marker bytes are kept so the flushed frame stays byte-identical.
    const inside = () => depth > 0 || oscFrameMode;
    const route = (segment: string) => {
      if (segment.length === 0) return;
      if (inside()) buffered += segment;
      else emit(segment, chunk.seq, chunk.generation);
    };

    let position = 0;
    for (;;) {
      const marker = findMarker(text, position);
      const osc = osc0At(text, position);
      const next =
        marker && (osc < 0 || marker.start < osc)
          ? { kind: "sync" as const, start: marker.start, end: marker.end, begin: marker.begin }
          : osc >= 0
            ? { kind: "osc0" as const, start: osc, end: osc + OSC0_PREFIX.length }
            : null;
      if (!next) break;

      if (next.kind === "sync") {
        const preSegment = text.slice(position, next.start);
        if (depth > 0 && preSegment.length > 0) syncHasPayload = true;
        route(preSegment);
        if (next.begin) {
          if (depth === 0) syncHasPayload = false;
          depth += 1;
          route(text.slice(next.start, next.end));
          armHoldTimer(maxHoldMs);
        } else if (depth > 0) {
          route(text.slice(next.start, next.end));
          depth -= 1;
          if (depth === 0) {
            // In frame-coalescing mode an EMPTY sync block is just the
            // per-frame marker pair (Codex wraps every animation frame in
            // one) — the OSC 0 update is the real frame boundary, so keep
            // buffering instead of flushing mid-frame.
            if (!(oscFrameMode && !syncHasPayload)) flushBuffered();
          }
        } else {
          // Unbalanced END outside any block — pass through untouched.
          route(text.slice(next.start, next.end));
        }
        position = next.end;
        continue;
      }

      // OSC 0 update. Outside a sync block it is the animation-frame marker:
      // the whole sequence (opener, title, BEL/ST) travels with the frame.
      const terminator = osc0End(text, next.end);
      const seqEnd = terminator >= 0 ? terminator + 1 : next.end;
      const pre = text.slice(position, next.start);
      const oscSeq = text.slice(next.start, seqEnd);
      if (depth > 0) {
        // Inside a sync block the OSC 0 is just frame payload.
        route(pre);
        route(oscSeq);
      } else {
        const at = now();
        if (oscFrameMode) {
          // Frame boundary: release this frame (including its OSC 0), then
          // keep buffering the next frame's content.
          route(pre);
          route(oscSeq);
          flushBuffered();
          lastOsc0At = at;
          armHoldTimer(oscFrameHoldMs);
        } else if (at - lastOsc0At <= oscFrameDetectMs) {
          // Two OSC 0 updates within the detect window — enter coalescing.
          // Content before this OSC 0 was already emitted; buffer from here.
          route(pre);
          oscFrameMode = true;
          route(oscSeq);
          lastOsc0At = at;
          armHoldTimer(oscFrameHoldMs);
        } else {
          route(pre + oscSeq);
          lastOsc0At = at;
        }
      }
      position = seqEnd;
    }

    let tail = text.slice(position);
    const partial = partialMarkerSuffixLength(tail);
    if (partial > 0) {
      carry = tail.slice(tail.length - partial);
      tail = tail.slice(0, tail.length - partial);
    }
    route(tail);

    if ((depth > 0 || oscFrameMode) && buffered.length > maxBufferedBytes) forceFlush();
  };

  const flushAll = () => {
    if (disposed) return;
    forceFlush();
    oscFrameMode = false;
  };

  const dispose = () => {
    disposed = true;
    clearHoldTimer();
    buffered = "";
    carry = "";
    depth = 0;
    oscFrameMode = false;
  };

  return { push, flushAll, dispose };
}
