import { describe, expect, it, vi } from "vitest";

import { recoverTerminalMetrics } from "./terminalMetrics";

describe("recoverTerminalMetrics", () => {
  it("remeasures, fits, refreshes, and reports dimension changes", () => {
    const measure = vi.fn();
    const clear = vi.fn();
    const fit = vi.fn(() => {
      terminal.cols = 100;
      terminal.rows = 40;
    });
    const refresh = vi.fn();
    const terminal = {
      cols: 80,
      rows: 24,
      options: { fontSize: 14 },
      refresh,
      _core: {
        _charSizeService: { measure },
        _renderService: {
          dimensions: { css: { cell: { width: 8, height: 16 } } },
          clear,
        },
      },
    };

    const next = recoverTerminalMetrics(terminal, { fit });

    expect(measure).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(fit).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(0, 39);
    expect(next).toEqual({ cols: 100, rows: 40 });
  });

  it("nudges fontSize when cell size is zero so measure can recover", () => {
    const measure = vi.fn();
    const terminal = {
      cols: 80,
      rows: 24,
      options: { fontSize: 14 },
      refresh: vi.fn(),
      _core: {
        _charSizeService: { measure },
        _renderService: {
          dimensions: { css: { cell: { width: 0, height: 0 } } },
          clear: vi.fn(),
        },
      },
    };
    const fit = vi.fn();

    const next = recoverTerminalMetrics(terminal, { fit });

    expect(measure.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fit).toHaveBeenCalled();
    expect(next).toBeNull();
  });
});
