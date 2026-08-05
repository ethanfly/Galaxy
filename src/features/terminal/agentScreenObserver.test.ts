import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentScreenObserver, readAgentScreen } from "./agentScreenObserver";

type ScreenLine = string | { text: string; isWrapped: boolean };

function screenSource(lines: ScreenLine[], baseY = 0, rows = lines.length) {
  return {
    rows,
    buffer: {
      active: {
        baseY,
        getLine(index: number) {
          const value = lines[index];
          if (value == null) return undefined;
          const text = typeof value === "string" ? value : value.text;
          return {
            isWrapped: typeof value === "string" ? false : value.isWrapped,
            translateToString: (trimRight = false) =>
              trimRight ? text.replace(/\s+$/, "") : text,
          };
        },
      },
    },
  };
}

describe("readAgentScreen", () => {
  it("reads only the newest rows from the active bottom viewport", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index}   `);

    expect(readAgentScreen(screenSource(lines, 20, 10), 3)).toBe(
      "line 27\nline 28\nline 29",
    );
  });

  it("reassembles xterm wrapped rows into one logical status line", () => {
    const result = readAgentScreen(
      screenSource([
        ">> Run /review on my changes",
        { text: "* Working (1m 25s * esc to ", isWrapped: false },
        { text: "interrupt)   ", isWrapped: true },
      ]),
    );

    expect(result).toBe(
      ">> Run /review on my changes\n* Working (1m 25s * esc to interrupt)",
    );
  });

  it("keeps the newest complete UTF-8 content within the byte ceiling", () => {
    const result = readAgentScreen(screenSource(["old", "甲乙丙丁", "newest"]), 3, 10);

    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(10);
    expect(result.endsWith("newest")).toBe(true);
    expect(result.includes("�")).toBe(false);
  });
});

describe("createAgentScreenObserver", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles active changes and sends one settled trailing snapshot", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let current = "first";
    const sent: string[] = [];
    const observer = createAgentScreenObserver(
      () => ({ screen: current, renderedGeneration: 1, renderedSeq: 1 }),
      async ({ screen }) => { sent.push(screen); },
    );

    observer.schedule();
    expect(sent).toEqual(["first"]);

    current = "second";
    vi.advanceTimersByTime(100);
    observer.schedule();
    vi.advanceTimersByTime(149);
    expect(sent).toEqual(["first"]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["first", "second"]);

    current = "settled";
    vi.advanceTimersByTime(599);
    expect(sent).toEqual(["first", "second"]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["first", "second", "settled"]);

    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["first", "second", "settled"]);
  });

  it("repeats an unchanged screen once for settled status confirmation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sent: string[] = [];
    const observer = createAgentScreenObserver(
      () => ({ screen: "idle composer", renderedGeneration: 1, renderedSeq: 1 }),
      async ({ screen }) => { sent.push(screen); },
    );

    observer.schedule();
    observer.schedule();
    vi.advanceTimersByTime(599);
    expect(sent).toEqual(["idle composer"]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(["idle composer", "idle composer"]);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(2);
  });

  it("keeps the settled sample at least 500ms after a throttle-delayed send", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let current = "working";
    const sent: Array<{ screen: string; at: number }> = [];
    const observer = createAgentScreenObserver(
      () => ({ screen: current, renderedGeneration: 1, renderedSeq: 1 }),
      async ({ screen }) => {
        sent.push({ screen, at: Date.now() });
      },
    );

    observer.schedule();
    vi.advanceTimersByTime(100);
    current = "idle";
    observer.schedule();
    vi.advanceTimersByTime(150);
    expect(sent).toEqual([
      { screen: "working", at: 0 },
      { screen: "idle", at: 250 },
    ]);

    vi.advanceTimersByTime(499);
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(101);
    expect(sent[sent.length - 1]).toEqual({ screen: "idle", at: 850 });
    expect(sent[2].at - sent[1].at).toBeGreaterThanOrEqual(500);
  });

  it("isolates rejected sends and cancels pending work on dispose", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let current = "first";
    const sent: string[] = [];
    const observer = createAgentScreenObserver(
      () => ({ screen: current, renderedGeneration: 1, renderedSeq: 1 }),
      async ({ screen }) => {
        sent.push(screen);
        if (screen === "first") throw new Error("offline");
      },
    );

    observer.schedule();
    await Promise.resolve();
    current = "second";
    vi.advanceTimersByTime(100);
    observer.schedule();
    vi.advanceTimersByTime(150);
    expect(sent).toEqual(["first", "second"]);

    current = "third";
    observer.schedule();
    observer.dispose();
    vi.runAllTimers();
    expect(sent).toEqual(["first", "second"]);
  });

  it("resends an unchanged screen when the rendered output sequence advances", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let renderedSeq = 1;
    const sent: Array<{ screen: string; renderedGeneration: number; renderedSeq: number }> = [];
    const observer = createAgentScreenObserver(
      () => ({ screen: "same screen", renderedGeneration: 1, renderedSeq }),
      async (snapshot) => { sent.push(snapshot); },
    );

    observer.schedule();
    renderedSeq = 2;
    vi.advanceTimersByTime(250);
    observer.schedule();

    expect(sent).toEqual([
      { screen: "same screen", renderedGeneration: 1, renderedSeq: 1 },
      { screen: "same screen", renderedGeneration: 1, renderedSeq: 2 },
    ]);
  });

  it("resends the same screen and sequence for a new PTY generation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let renderedGeneration = 1;
    const sent: Array<{ screen: string; renderedGeneration: number; renderedSeq: number }> = [];
    const observer = createAgentScreenObserver(
      () => ({ screen: "same screen", renderedGeneration, renderedSeq: 1 }),
      async (snapshot) => { sent.push(snapshot); },
    );

    observer.schedule();
    renderedGeneration = 2;
    vi.advanceTimersByTime(250);
    observer.schedule();

    expect(sent.map((snapshot) => snapshot.renderedGeneration)).toEqual([1, 2]);
  });
});
