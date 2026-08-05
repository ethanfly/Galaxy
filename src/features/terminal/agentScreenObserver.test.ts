import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentScreenObserver, readAgentScreen } from "./agentScreenObserver";

function screenSource(lines: string[], baseY = 0, rows = lines.length) {
  return {
    rows,
    buffer: {
      active: {
        baseY,
        getLine(index: number) {
          const value = lines[index];
          return value == null
            ? undefined
            : { translateToString: () => value.replace(/\s+$/, "") };
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
      () => current,
      async (screen) => { sent.push(screen); },
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
    vi.advanceTimersByTime(450);
    expect(sent).toEqual(["first", "second", "settled"]);

    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["first", "second", "settled"]);
  });

  it("repeats an unchanged screen once for settled status confirmation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sent: string[] = [];
    const observer = createAgentScreenObserver(
      () => "idle composer",
      async (screen) => { sent.push(screen); },
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

  it("isolates rejected sends and cancels pending work on dispose", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let current = "first";
    const sent: string[] = [];
    const observer = createAgentScreenObserver(
      () => current,
      async (screen) => {
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
});
