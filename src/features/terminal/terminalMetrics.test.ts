import { describe, expect, it, vi } from "vitest";

import { recoverTerminalMetrics, rebindTerminalMouse } from "./terminalMetrics";

describe("recoverTerminalMetrics", () => {
  it("remeasures, fits, refreshes, rebinds mouse, and reports dimension changes", () => {
    const measure = vi.fn();
    const clear = vi.fn();
    const resize = vi.fn();
    const refresh = vi.fn();
    const fit = vi.fn(() => {
      terminal.cols = 100;
      terminal.rows = 40;
    });
    const coreMouseService = { activeProtocol: "VT200" };
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
        coreMouseService,
      },
    };

    const next = recoverTerminalMetrics(terminal, { fit });

    expect(measure).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(fit).toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(100, 40);
    expect(refresh).toHaveBeenCalledWith(0, 39);
    expect(coreMouseService.activeProtocol).toBe("VT200");
    expect(next).toEqual({ cols: 100, rows: 40 });
  });

  it("nudges fontSize when cell size is zero so measure can recover", () => {
    const measure = vi.fn();
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
        coreMouseService: { activeProtocol: "NONE" },
      },
    };
    const fit = vi.fn();

    const next = recoverTerminalMetrics(terminal, { fit });

    expect(measure.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fit).toHaveBeenCalled();
    expect(next).toBeNull();
  });
});

describe("rebindTerminalMouse", () => {
  it("self-assigns activeProtocol to force handler rebind", () => {
    const coreMouseService = { activeProtocol: "DRAG" };
    const terminal = {
      cols: 80,
      rows: 24,
      options: {},
      refresh: vi.fn(),
      _core: { coreMouseService },
    };
    rebindTerminalMouse(terminal);
    expect(coreMouseService.activeProtocol).toBe("DRAG");
  });
});
