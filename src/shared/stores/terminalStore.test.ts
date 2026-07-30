import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerTerminal,
  unregisterTerminal,
  useTerminalStore,
} from "./terminalStore";
import type { PaneChunk } from "../ipc/types";

// ptyReplay is mocked — sequence-gap replays go through the ring buffer API.
vi.mock("../ipc/client", () => ({
  ptyReplay: vi.fn(async (_paneId: string, _afterSeq: number) => ({
    paneId: _paneId,
    truncated: false,
    chunks: [{ paneId: _paneId, seq: 2, data: "REPLAYED" }],
  })),
}));

function reset() {
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
  beforeEach(reset);

  it("writes ordered chunks and tracks lastSeq", () => {
    const writes: string[] = [];
    registerTerminal({
      paneId: "p1",
      write: (d) => writes.push(d),
      replay: () => {},
      truncatedNotice: () => {},
    });
    useTerminalStore.getState().ingest([
      { paneId: "p1", seq: 1, data: "a" },
      { paneId: "p1", seq: 2, data: "b" },
    ]);
    expect(writes).toEqual(["a", "b"]);
    expect(useTerminalStore.getState().lastSeq.p1).toBe(2);
    unregisterTerminal("p1");
  });

  it("detects gaps and requests replay without double-writing", async () => {
    const writes: string[] = [];
    registerTerminal({
      paneId: "p1",
      write: (d) => writes.push(d),
      replay: () => {},
      truncatedNotice: () => {},
    });
    useTerminalStore.getState().ingest([{ paneId: "p1", seq: 1, data: "a" }]);
    useTerminalStore.getState().ingest([{ paneId: "p1", seq: 3, data: "c" }]);
    // seq 3 is held back (gap) and replay triggered from seq 1.
    expect(writes).toEqual(["a"]);
    await new Promise((r) => setTimeout(r, 10));
    // Replay delivered seq 2 via ptyReplay mock.
    expect(writes).toContain("REPLAYED");
    unregisterTerminal("p1");
  });

  it("records per-pane activity timestamps independently", () => {
    useTerminalStore.getState().ingest([
      { paneId: "p1", seq: 1, data: "x" },
      { paneId: "p2", seq: 1, data: "y" },
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
});
