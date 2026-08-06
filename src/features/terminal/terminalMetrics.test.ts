import { describe, expect, it, vi } from "vitest";

import { recoverTerminalMetrics, rebindTerminalMouse } from "./terminalMetrics";

/** Mock coreMouseService that records every protocol set (like real setter). */
function mockMouseService(initial: string) {
  let protocol = initial;
  const sets: string[] = [];
  return {
    sets,
    get activeProtocol() {
      return protocol;
    },
    set activeProtocol(name: string) {
      protocol = name;
      sets.push(name);
    },
  };
}

describe("rebindTerminalMouse", () => {
  it("toggles NONE then restores protocol so xterm can tear down and re-add listeners", () => {
    const cms = mockMouseService("VT200");
    const terminal = {
      cols: 80,
      rows: 24,
      options: {},
      refresh: vi.fn(),
      _core: { coreMouseService: cms },
    };

    rebindTerminalMouse(terminal);

    // Must NOT be a single self-assign VT200→VT200 (that skips re-add in xterm).
    expect(cms.sets).toEqual(["NONE", "VT200"]);
    expect(cms.activeProtocol).toBe("VT200");
  });

  it("when already NONE only re-fires NONE (no spurious protocol)", () => {
    const cms = mockMouseService("NONE");
    const terminal = {
      cols: 80,
      rows: 24,
      options: {},
      refresh: vi.fn(),
      _core: { coreMouseService: cms },
    };

    rebindTerminalMouse(terminal);

    expect(cms.sets).toEqual(["NONE"]);
  });

  it("handles DRAG and ANY the same way (agent TUI common modes)", () => {
    for (const mode of ["DRAG", "ANY", "X10"] as const) {
      const cms = mockMouseService(mode);
      rebindTerminalMouse({
        cols: 80,
        rows: 24,
        options: {},
        refresh: vi.fn(),
        _core: { coreMouseService: cms },
      } as never);
      expect(cms.sets).toEqual(["NONE", mode]);
    }
  });
});

describe("recoverTerminalMetrics", () => {
  it("remeasures, fits, force-resizes, refreshes, and rebinds via NONE→protocol", () => {
    const measure = vi.fn();
    const clear = vi.fn();
    const resize = vi.fn();
    const refresh = vi.fn();
    const fit = vi.fn(() => {
      terminal.cols = 100;
      terminal.rows = 40;
    });
    const cms = mockMouseService("VT200");
    const terminal = {
      cols: 80,
      rows: 24,
      options: { fontSize: 14 },
      refresh,
      resize,
      _core: {
        _charSizeService: { measure },
        _renderService: {
          dimensions: { css: { cell: { width: 8, height: 16 } } },
          clear,
        },
        coreMouseService: cms,
      },
    };

    const next = recoverTerminalMetrics(terminal, { fit });

    expect(measure).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(fit).toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(100, 40);
    expect(refresh).toHaveBeenCalledWith(0, 39);
    // Critical: recover must drive real rebind path, not self-assign.
    expect(cms.sets).toEqual(["NONE", "VT200"]);
    expect(next).toEqual({ cols: 100, rows: 40 });
  });

  it("nudges fontSize when cell size is zero so measure can recover", () => {
    const measure = vi.fn();
    const cms = mockMouseService("DRAG");
    const terminal = {
      cols: 80,
      rows: 24,
      options: { fontSize: 14 },
      refresh: vi.fn(),
      resize: vi.fn(),
      _core: {
        _charSizeService: { measure },
        _renderService: {
          dimensions: { css: { cell: { width: 0, height: 0 } } },
          clear: vi.fn(),
        },
        coreMouseService: cms,
      },
    };
    const fit = vi.fn();

    const next = recoverTerminalMetrics(terminal, { fit });

    expect(measure.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fit).toHaveBeenCalled();
    expect(cms.sets).toEqual(["NONE", "DRAG"]);
    expect(next).toBeNull();
  });

  it("still rebinds mouse when cols/rows are unchanged after idle", () => {
    const cms = mockMouseService("ANY");
    const fit = vi.fn(); // does not change cols/rows
    const resize = vi.fn();
    const terminal = {
      cols: 120,
      rows: 40,
      options: { fontSize: 14 },
      refresh: vi.fn(),
      resize,
      _core: {
        _charSizeService: { measure: vi.fn() },
        _renderService: {
          dimensions: { css: { cell: { width: 9, height: 18 } } },
          clear: vi.fn(),
        },
        coreMouseService: cms,
      },
    };

    const next = recoverTerminalMetrics(terminal, { fit });

    expect(next).toBeNull();
    expect(resize).toHaveBeenCalledWith(120, 40);
    expect(cms.sets).toEqual(["NONE", "ANY"]);
  });
});
