import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSyncOutputGate, type SyncOutputGate } from "./syncOutput";

const ESC = "\u001b";
const BEGIN = `${ESC}[?2026h`;
const END = `${ESC}[?2026l`;

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
  const gate = createSyncOutputGate(emit, {
    setTimeout: setTimeoutSpy,
    clearTimeout: clearTimeoutSpy,
    ...options,
  });
  const fireAllTimers = () => {
    const handlers = [...timeouts.values()];
    timeouts.clear();
    handlers.forEach((handler) => handler());
  };
  return { gate, emitted, emit, setTimeoutSpy, clearTimeoutSpy, fireAllTimers };
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
});
