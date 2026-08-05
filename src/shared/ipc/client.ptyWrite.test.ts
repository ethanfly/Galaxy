import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { ptyWrite } from "./client";

describe("ptyWrite ordering", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("serializes consecutive writes for the same pane", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    invoke.mockImplementation(async (_cmd: string, args: { data: string }) => {
      order.push(`start:${args.data}`);
      if (args.data === "down") await firstGate;
      order.push(`end:${args.data}`);
    });

    const first = ptyWrite("pane-1", "down");
    const second = ptyWrite("pane-1", "up");

    // Flush microtasks so the first invoke has started and is blocked on the gate.
    await vi.waitFor(() => {
      expect(order).toEqual(["start:down"]);
    });

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["start:down", "end:down", "start:up", "end:up"]);
  });
});
