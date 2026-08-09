import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSyncOutputGate, type SyncOutputGate } from "./syncOutput";

const ESC = "\u001b";
const BEGIN = `${ESC}[?2026h`;
const END = `${ESC}[?2026l`;
const OSC0 = `${ESC}]0;`;
const BEL = "\u0007";

interface Emitted {
  data: string;
  seq: number;
  generation: number;
}

function setup(options: Parameters<typeof createSyncOutputGate>[1] = {}) {
  const emitted: Emitted[] = [];
  const emit = vi.fn((data: string, seq: number, generation: number) => {
    emitted.push({ data, seq, generation });
  });
  const timeouts = new Map<number, () => void>();
  let nextTimer = 1;
  const setTimeoutSpy = vi.fn((handler: () => void) => {
    const id = nextTimer++;
    timeouts.set(id, handler);
    return id;
  });
  const clearTimeoutSpy = vi.fn((id: number) => {
    timeouts.delete(id);
  });
  let clock = 0;
  const nowSpy = vi.fn(() => clock);
  const gate = createSyncOutputGate(emit, {
    setTimeout: setTimeoutSpy,
    clearTimeout: clearTimeoutSpy,
    now: nowSpy,
    ...options,
  });
  const fireAllTimers = () => {
    const handlers = [...timeouts.values()];
    timeouts.clear();
    handlers.forEach((handler) => handler());
  };
  return {
    gate,
    emitted,
    emit,
    setTimeoutSpy,
    clearTimeoutSpy,
    fireAllTimers,
    setClock: (ms: number) => {
      clock = ms;
    },
  };
}

/**
 * A Codex-style animation frame as captured from the real CLI: a row-clear
 * pass (cursor moves + `CSI K`), an OSC 0 title update carrying the spinner
 * glyph, and an empty DEC 2026 block. The whole frame lives OUTSIDE the sync
 * markers — exactly what the frame-coalescing mode must merge.
 */
function codexFrame(spinner: string, label: string): string {
  return `${ESC}[14;2H${ESC}[K${ESC}[16;19H${ESC}[K${ESC}[22;46H${ESC}[K${ESC}[27;2H${ESC}[K${ESC}[119C${ESC}[m${OSC0}${spinner} ${label}${BEL}${BEGIN}${END}`;
}

describe("syncOutput gate", () => {
  it("passes through plain output unchanged", () => {
    const { gate, emitted } = setup();
    gate.push({ data: "hello world", seq: 1, generation: 1 });
    expect(emitted).toEqual([{ data: "hello world", seq: 1, generation: 1 }]);
  });

  it("coalesces a full synchronized frame into one write and strips nothing", () => {
    const { gate, emitted } = setup();
    gate.push({ data: `before${BEGIN}frame-content${END}after`, seq: 5, generation: 2 });

    // Content outside the block is emitted in order around the frame, and the
    // frame itself (markers included) is flushed as a single write.
    expect(emitted).toEqual([
      { data: "before", seq: 5, generation: 2 },
      { data: `${BEGIN}frame-content${END}`, seq: 5, generation: 2 },
      { data: "after", seq: 5, generation: 2 },
    ]);
  });

  it("buffers a frame split across multiple pushes until the end marker", () => {
    const { gate, emitted } = setup();
    gate.push({ data: `x${BEGIN}part1`, seq: 1, generation: 1 });
    expect(emitted).toEqual([{ data: "x", seq: 1, generation: 1 }]);

    gate.push({ data: "part2", seq: 2, generation: 1 });
    expect(emitted).toHaveLength(1); // still buffered

    gate.push({ data: `part3${END}`, seq: 3, generation: 1 });
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual({
      data: `${BEGIN}part1part2part3${END}`,
      seq: 3, // watermark reports the last contributing seq
      generation: 1,
    });
  });

  it("recognizes a begin marker split across chunk boundaries", () => {
    const { gate, emitted } = setup();
    gate.push({ data: `a${ESC}[?20`, seq: 1, generation: 1 });
    expect(emitted).toEqual([{ data: "a", seq: 1, generation: 1 }]);

    gate.push({ data: `26hbody${END}`, seq: 2, generation: 1 });
    expect(emitted).toHaveLength(2);
    expect(emitted[1].data).toBe(`${BEGIN}body${END}`);
  });

  it("recognizes an end marker split across chunk boundaries", () => {
    const { gate, emitted } = setup();
    gate.push({ data: `${BEGIN}body${ESC}[?2026`, seq: 1, generation: 1 });
    expect(emitted).toHaveLength(0);

    gate.push({ data: "lrest", seq: 2, generation: 1 });
    expect(emitted).toHaveLength(2);
    expect(emitted[0].data).toBe(`${BEGIN}body${END}`);
    expect(emitted[1]).toEqual({ data: "rest", seq: 2, generation: 1 });
  });

  it("handles nested synchronized blocks", () => {
    const { gate, emitted } = setup();
    gate.push({ data: `${BEGIN}outer${BEGIN}inner${END}still${END}`, seq: 1, generation: 1 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data).toBe(`${BEGIN}outer${BEGIN}inner${END}still${END}`);
  });

  it("treats an end marker with no open block as plain output", () => {
    const { gate, emitted } = setup();
    gate.push({ data: `a${END}b`, seq: 1, generation: 1 });
    // Segments may be emitted separately, but byte order is preserved.
    expect(emitted.map((entry) => entry.data).join("")).toBe(`a${END}b`);
  });

  it("does not treat other private modes as markers", () => {
    const { gate, emitted } = setup();
    gate.push({ data: `${ESC}[?20260hkeep`, seq: 1, generation: 1 });
    expect(emitted).toEqual([{ data: `${ESC}[?20260hkeep`, seq: 1, generation: 1 }]);
  });

  it("force-flushes when the hold timeout fires without an end marker", () => {
    const { gate, emitted, fireAllTimers, setTimeoutSpy } = setup({ maxHoldMs: 50 });
    gate.push({ data: `${BEGIN}orphan`, seq: 1, generation: 1 });
    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(emitted).toHaveLength(0);

    fireAllTimers();
    expect(emitted).toEqual([{ data: `${BEGIN}orphan`, seq: 1, generation: 1 }]);

    // Subsequent output flows normally again.
    gate.push({ data: "after", seq: 2, generation: 1 });
    expect(emitted[1]).toEqual({ data: "after", seq: 2, generation: 1 });
  });

  it("force-flushes when the buffer exceeds the byte cap", () => {
    const { gate, emitted } = setup({ maxBufferedBytes: 16 });
    gate.push({ data: `${BEGIN}0123456789abcdef!`, seq: 1, generation: 1 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data).toBe(`${BEGIN}0123456789abcdef!`);
  });

  it("flushAll releases buffered content on teardown", () => {
    const { gate, emitted } = setup();
    gate.push({ data: `${BEGIN}pending`, seq: 1, generation: 1 });
    gate.flushAll();
    expect(emitted).toEqual([{ data: `${BEGIN}pending`, seq: 1, generation: 1 }]);
  });

  it("dispose stops further emission and clears timers", () => {
    const { gate, emitted, fireAllTimers, clearTimeoutSpy } = setup({ maxHoldMs: 10 });
    gate.push({ data: `${BEGIN}x`, seq: 1, generation: 1 });
    gate.dispose();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    fireAllTimers();
    gate.push({ data: "late", seq: 2, generation: 1 });
    expect(emitted).toHaveLength(0);
  });

  describe("OSC 0 animation-frame coalescing (Codex-style)", () => {
    it("merges high-frequency frames into per-frame writes", () => {
      const { gate, emitted, setClock, fireAllTimers } = setup();
      const f1 = codexFrame("⠋", "Ethanfly");
      const f2 = codexFrame("⠙", "Ethanfly");
      const f3 = codexFrame("⠹", "Ethanfly");
      const f4 = codexFrame("⠸", "Ethanfly");

      // Frame 1: single OSC 0 — passes through; the empty DEC 2026 block is
      // flushed separately (gate behavior, byte order preserved).
      setClock(0);
      gate.push({ data: f1, seq: 1, generation: 1 });
      expect(emitted.map((entry) => entry.data).join("")).toBe(f1);
      expect(emitted).toHaveLength(2); // [row-clear+OSC0, sync markers]

      // Frame 2: second OSC 0 inside the detect window — coalescing starts
      // at its OSC 0 marker (one-frame detection latency for the row-clear
      // pass, which was already emitted).
      setClock(80);
      gate.push({ data: f2, seq: 2, generation: 1 });
      expect(emitted.map((entry) => entry.data).join("")).toBe(
        f1 + f2.slice(0, f2.indexOf(OSC0)),
      );

      // Frame 3: everything since frame 2's OSC 0 (its markers, this frame's
      // row-clear pass and OSC 0) flushes as ONE write — the mid-frame
      // cursor sweep is never rendered.
      setClock(160);
      gate.push({ data: f3, seq: 3, generation: 1 });
      const f2Tail = f2.slice(f2.indexOf(OSC0)); // OSC0_2 + its empty sync block
      const f3Body = f3.slice(0, f3.indexOf(BEGIN)); // row-clear pass + OSC0_3
      expect(emitted[emitted.length - 1].data).toBe(f2Tail + f3Body);

      // Frame 4: steady state — one write per animation frame. The trailing
      // empty sync block is released by the hold-timeout safety valve.
      setClock(240);
      gate.push({ data: f4, seq: 4, generation: 1 });
      fireAllTimers();
      expect(emitted.map((entry) => entry.data).join("")).toBe(f1 + f2 + f3 + f4);
      const f3Tail = f3.slice(f3.indexOf(BEGIN)); // frame 3's empty sync block
      const f4Body = f4.slice(0, f4.indexOf(BEGIN));
      expect(emitted[emitted.length - 2].data).toBe(f3Tail + f4Body);
      expect(emitted[emitted.length - 1].data).toBe(f4.slice(f4.indexOf(BEGIN)));
    });

    it("does not coalesce sparse OSC 0 updates", () => {
      const { gate, emitted, setClock } = setup();
      setClock(0);
      gate.push({ data: `plain1${OSC0}title1${BEL}`, seq: 1, generation: 1 });
      setClock(2000); // > detect window (500ms)
      gate.push({ data: `plain2${OSC0}title2${BEL}`, seq: 2, generation: 1 });
      expect(emitted).toHaveLength(2);
      expect(emitted[1].data).toBe(`plain2${OSC0}title2${BEL}`);
    });

    it("leaves frame-coalescing mode after a silent period", () => {
      const { gate, emitted, setClock, fireAllTimers } = setup();
      setClock(0);
      gate.push({ data: `${OSC0}a${BEL}`, seq: 1, generation: 1 });
      setClock(80);
      gate.push({ data: `${OSC0}b${BEL}`, seq: 2, generation: 1 }); // enters mode
      expect(emitted).toHaveLength(1);

      setClock(80 + 2000 + 1); // silent beyond idle window
      gate.push({ data: `fresh${OSC0}c${BEL}`, seq: 3, generation: 1 });
      // Left mode: buffered OSC 0 b flushes, then fresh content emits live.
      expect(emitted.map((entry) => entry.data).join("")).toBe(
        `${OSC0}a${BEL}${OSC0}b${BEL}fresh${OSC0}c${BEL}`,
      );
      void fireAllTimers;
    });

    it("OSC 0 prefix split across chunks is carried", () => {
      const { gate, emitted, setClock } = setup();
      setClock(0);
      gate.push({ data: `${ESC}]`, seq: 1, generation: 1 });
      expect(emitted).toHaveLength(0); // partial OSC 0 opener held back
      setClock(10);
      gate.push({ data: `0;title${BEL}rest`, seq: 2, generation: 1 });
      expect(emitted.map((entry) => entry.data).join("")).toBe(`${OSC0}title${BEL}rest`);
    });
  });
});
