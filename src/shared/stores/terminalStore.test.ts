import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerTerminal,
  unregisterTerminal,
  useTerminalStore,
} from "./terminalStore";
import type { PaneChunk } from "../ipc/types";

// ptyReplay is mocked — sequence-gap replays go through the ring buffer API.
const { ptyReplayMock } = vi.hoisted(() => ({
  ptyReplayMock: vi.fn(),
}));
vi.mock("../ipc/client", () => ({ ptyReplay: ptyReplayMock }));

function reset() {
  useTerminalStore.getState().resetPane("p1");
  useTerminalStore.getState().resetPane("p2");
  useTerminalStore.setState({
    lastSeq: {},
    activity: {},
    agentStatus: {},
    marks: {},
    scrollLocked: {},
    focusedPane: {},
  });
}

describe("terminalStore seq tracking", () => {
  beforeEach(() => {
    reset();
    ptyReplayMock.mockReset();
    ptyReplayMock.mockResolvedValue({
      paneId: "p1",
      generation: 1,
      truncated: false,
      chunks: [{ paneId: "p1", generation: 1, seq: 2, data: "REPLAYED" }],
    });
  });

  it("writes ordered chunks and tracks lastSeq", () => {
    const write = vi.fn();
    registerTerminal({
      paneId: "p1",
      write,
      replay: () => {},
      truncatedNotice: () => {},
    });
    useTerminalStore.getState().ingest([
      { paneId: "p1", generation: 1, seq: 1, data: "a" },
      { paneId: "p1", generation: 1, seq: 2, data: "b" },
    ]);
    expect(write.mock.calls).toEqual([
      ["a", 1, 1],
      ["b", 2, 1],
    ]);
    expect(useTerminalStore.getState().lastSeq.p1).toBe(2);
    unregisterTerminal("p1");
  });

  it("buffers output until the terminal instance is registered", () => {
    const write = vi.fn();

    useTerminalStore.getState().ingest([
      { paneId: "p1", generation: 1, seq: 1, data: "early-a" },
      { paneId: "p1", generation: 1, seq: 2, data: "early-b" },
    ]);

    expect(useTerminalStore.getState().lastSeq.p1).toBeUndefined();
    registerTerminal({
      paneId: "p1",
      write,
      replay: () => {},
      truncatedNotice: () => {},
    });

    expect(write.mock.calls).toEqual([
      ["early-a", 1, 1],
      ["early-b", 2, 1],
    ]);
    expect(useTerminalStore.getState().lastSeq.p1).toBe(2);
    unregisterTerminal("p1");
  });

  it("detects gaps and requests replay without double-writing", async () => {
    const write = vi.fn();
    registerTerminal({
      paneId: "p1",
      write,
      replay: () => {},
      truncatedNotice: () => {},
    });
    useTerminalStore
      .getState()
      .ingest([{ paneId: "p1", generation: 1, seq: 1, data: "a" }]);
    useTerminalStore
      .getState()
      .ingest([{ paneId: "p1", generation: 1, seq: 3, data: "c" }]);
    // seq 3 is held back (gap) and replay triggered from seq 1.
    expect(write).toHaveBeenNthCalledWith(1, "a", 1, 1);
    expect(ptyReplayMock).toHaveBeenCalledWith("p1", 1, 1);
    await new Promise((r) => setTimeout(r, 10));
    // Replay delivered seq 2 via ptyReplay mock.
    expect(write).toHaveBeenCalledWith("REPLAYED", 2, 1);
    unregisterTerminal("p1");
  });

  it("holds later live chunks until gap replay restores contiguous order", async () => {
    let resolveReplay!: (value: {
      paneId: string;
      generation: number;
      truncated: boolean;
      chunks: PaneChunk[];
    }) => void;
    ptyReplayMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReplay = resolve;
        }),
    );
    const write = vi.fn();
    registerTerminal({
      paneId: "p1",
      write,
      replay: () => {},
      truncatedNotice: () => {},
    });

    useTerminalStore
      .getState()
      .ingest([{ paneId: "p1", generation: 1, seq: 1, data: "a" }]);
    useTerminalStore
      .getState()
      .ingest([{ paneId: "p1", generation: 1, seq: 3, data: "c" }]);
    useTerminalStore
      .getState()
      .ingest([{ paneId: "p1", generation: 1, seq: 4, data: "d" }]);

    expect(write.mock.calls).toEqual([["a", 1, 1]]);
    expect(useTerminalStore.getState().lastSeq.p1).toBe(1);

    resolveReplay({
      paneId: "p1",
      generation: 1,
      truncated: false,
      chunks: [
        { paneId: "p1", generation: 1, seq: 2, data: "b" },
        { paneId: "p1", generation: 1, seq: 3, data: "c" },
      ],
    });
    await vi.waitFor(() => {
      expect(write.mock.calls).toEqual([
        ["a", 1, 1],
        ["b", 2, 1],
        ["c", 3, 1],
        ["d", 4, 1],
      ]);
    });
    expect(useTerminalStore.getState().lastSeq.p1).toBe(4);
    unregisterTerminal("p1");
  });

  it("drops an old-generation replay when the pane restarts in place", async () => {
    let resolveReplay!: (value: {
      paneId: string;
      generation: number;
      truncated: boolean;
      chunks: PaneChunk[];
    }) => void;
    ptyReplayMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReplay = resolve;
        }),
    );
    const write = vi.fn();
    registerTerminal({
      paneId: "p1",
      write,
      replay: () => {},
      truncatedNotice: () => {},
    });

    useTerminalStore.getState().ingest([
      { paneId: "p1", generation: 1, seq: 1, data: "old-1" },
      { paneId: "p1", generation: 1, seq: 3, data: "old-3" },
    ]);
    useTerminalStore
      .getState()
      .ingest([{ paneId: "p1", generation: 2, seq: 1, data: "new-1" }]);

    resolveReplay({
      paneId: "p1",
      generation: 1,
      truncated: false,
      chunks: [
        { paneId: "p1", generation: 1, seq: 2, data: "old-2" },
        { paneId: "p1", generation: 1, seq: 3, data: "old-3" },
      ],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(write.mock.calls).toEqual([
      ["old-1", 1, 1],
      ["new-1", 1, 2],
    ]);
    expect(useTerminalStore.getState().lastSeq.p1).toBe(1);
    unregisterTerminal("p1");
  });

  it("records per-pane activity timestamps independently", () => {
    useTerminalStore.getState().ingest([
      { paneId: "p1", generation: 1, seq: 1, data: "x" },
      { paneId: "p2", generation: 1, seq: 1, data: "y" },
    ]);
    const { activity } = useTerminalStore.getState();
    expect(activity.p1).toBeGreaterThan(0);
    expect(activity.p2).toBeGreaterThan(0);
  });

  it("marks, bells and scroll-locks per pane", () => {
    useTerminalStore.getState().addMark("p1");
    useTerminalStore.getState().addMark("p1");
    useTerminalStore.getState().setScrollLocked("p1", true);
    expect(useTerminalStore.getState().marks.p1).toBe(2);
    expect(useTerminalStore.getState().scrollLocked.p1).toBe(true);
    useTerminalStore.getState().clearMarks("p1");
    expect(useTerminalStore.getState().marks.p1).toBe(0);
  });

  it("supports pane-specific Agent subscriptions without PTY output fanout", () => {
    const listener = vi.fn();
    const unsubscribe = useTerminalStore.subscribe(
      (state) => state.agentStatus.p1,
      listener,
    );

    useTerminalStore
      .getState()
      .ingest([{ paneId: "p2", generation: 1, seq: 1, data: "output" }]);
    useTerminalStore.getState().setAgent("p2", "codex", "working");
    expect(listener).not.toHaveBeenCalled();

    useTerminalStore.getState().setAgent("p1", "codex", "working");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual({ kind: "codex", status: "working" });

    unsubscribe();
  });
});
