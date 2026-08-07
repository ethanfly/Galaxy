import { describe, expect, it, vi } from "vitest";

import {
  forceTerminalResizeCycle,
  isTerminalMouseBroken,
  rebindTerminalMouse,
  recoverTerminalMetrics,
  suspendTerminalImeRepositioning,
  unpauseTerminalRenderer,
} from "./terminalMetrics";

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
  it("toggles NONE then restores protocol (not self-assign)", () => {
    const cms = mockMouseService("VT200");
    rebindTerminalMouse({
      cols: 80,
      rows: 24,
      options: {},
      refresh: vi.fn(),
      _core: { coreMouseService: cms },
    } as never);

    expect(cms.sets).toEqual(["NONE", "VT200"]);
  });

  it("preserves DEFAULT when the agent selected legacy mouse encoding", () => {
    let protocol = "VT200";
    let encoding = "DEFAULT";
    const sets: string[] = [];
    const encodings: string[] = [];
    const service = {
      get activeProtocol() {
        return protocol;
      },
      set activeProtocol(name: string) {
        protocol = name;
        sets.push(name);
      },
      get activeEncoding() {
        return encoding;
      },
      set activeEncoding(name: string) {
        encoding = name;
        encodings.push(name);
      },
    };
    rebindTerminalMouse({
      cols: 80,
      rows: 24,
      options: {},
      refresh: vi.fn(),
      _core: { coreMouseService: service },
    } as never);
    expect(sets).toEqual(["NONE", "VT200"]);
    expect(encodings).toEqual([]);
    expect(service.activeEncoding).toBe("DEFAULT");
  });

  it("covers DRAG/ANY/X10 used by agent TUIs", () => {
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

describe("forceTerminalResizeCycle", () => {
  it("nudges cols then restores so same-size early-return is bypassed", () => {
    const resize = vi.fn();
    const terminal = { cols: 100, rows: 40, options: {}, refresh: vi.fn(), resize };
    forceTerminalResizeCycle(terminal);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(resize).toHaveBeenNthCalledWith(1, 99, 40);
    expect(resize).toHaveBeenNthCalledWith(2, 100, 40);
  });
});

describe("unpauseTerminalRenderer", () => {
  it("clears _isPaused so refreshRows can run after long idle", () => {
    const rs = { _isPaused: true, _needsFullRefresh: true };
    unpauseTerminalRenderer({
      cols: 80,
      rows: 24,
      options: {},
      refresh: vi.fn(),
      _core: { _renderService: rs },
    } as never);
    expect(rs._isPaused).toBe(false);
    expect(rs._needsFullRefresh).toBe(false);
  });
});

describe("suspendTerminalImeRepositioning", () => {
  it("suppresses xterm render-driven IME moves until restored", () => {
    const updateCompositionElements = vi.fn();
    const compositionHelper = { updateCompositionElements };
    const terminal = {
      cols: 80,
      rows: 24,
      options: {},
      _core: {
        _compositionHelper: compositionHelper,
      },
    };

    const restore = suspendTerminalImeRepositioning(terminal as never);

    compositionHelper.updateCompositionElements();
    expect(updateCompositionElements).not.toHaveBeenCalled();

    restore();
    compositionHelper.updateCompositionElements();
    expect(updateCompositionElements).toHaveBeenCalledTimes(1);

    restore();
    compositionHelper.updateCompositionElements();
    expect(updateCompositionElements).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when xterm internals are unavailable", () => {
    const terminal = {
      cols: 80,
      rows: 24,
      options: {},
      refresh: vi.fn(),
    };

    expect(() => suspendTerminalImeRepositioning(terminal)()).not.toThrow();
  });
});

describe("isTerminalMouseBroken", () => {
  it("detects zero cell size and paused renderer", () => {
    expect(
      isTerminalMouseBroken({
        cols: 80,
        rows: 24,
        options: {},
        refresh: vi.fn(),
        _core: {
          _charSizeService: { hasValidSize: true, width: 8, height: 16 },
          _renderService: {
            dimensions: { css: { cell: { width: 0, height: 0 } } },
            _isPaused: false,
          },
        },
      } as never),
    ).toBe(true);

    expect(
      isTerminalMouseBroken({
        cols: 80,
        rows: 24,
        options: {},
        refresh: vi.fn(),
        _core: {
          _charSizeService: { hasValidSize: true, width: 8, height: 16 },
          _renderService: {
            dimensions: { css: { cell: { width: 8, height: 16 } } },
            _isPaused: true,
          },
        },
      } as never),
    ).toBe(true);

    expect(
      isTerminalMouseBroken({
        cols: 80,
        rows: 24,
        options: {},
        refresh: vi.fn(),
        _core: {
          _charSizeService: { hasValidSize: true, width: 8, height: 16 },
          _renderService: {
            dimensions: { css: { cell: { width: 8, height: 16 } } },
            _isPaused: false,
          },
        },
      } as never),
    ).toBe(false);
  });
});

describe("recoverTerminalMetrics", () => {
  it("does not force a full redraw when terminal metrics are healthy", () => {
    const cms = mockMouseService("VT200");
    const clear = vi.fn();
    const refreshRows = vi.fn();
    const resize = vi.fn();
    const refresh = vi.fn();
    const terminal = {
      cols: 100,
      rows: 40,
      options: { fontSize: 14 },
      refresh,
      resize,
      _core: {
        _charSizeService: {
          measure: vi.fn(),
          hasValidSize: true,
          width: 8,
          height: 16,
        },
        _renderService: {
          dimensions: { css: { cell: { width: 8, height: 16 } } },
          clear,
          _isPaused: false,
          _needsFullRefresh: false,
          refreshRows,
        },
        coreMouseService: cms,
        viewport: { syncScrollArea: vi.fn() },
      },
    };

    const next = recoverTerminalMetrics(terminal, { fit: vi.fn() });

    expect(next).toBeNull();
    expect(resize).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(refreshRows).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(cms.sets).toEqual(["NONE", "VT200"]);
  });

  it("deep-repairs a stale renderer even when its numeric metrics look valid", () => {
    const cms = mockMouseService("VT200");
    const clear = vi.fn();
    const refreshRows = vi.fn();
    const resize = vi.fn();
    const refresh = vi.fn();
    const terminal = {
      cols: 100,
      rows: 40,
      options: { fontSize: 14 },
      refresh,
      resize,
      _core: {
        _charSizeService: {
          measure: vi.fn(),
          hasValidSize: true,
          width: 8,
          height: 16,
        },
        _renderService: {
          dimensions: { css: { cell: { width: 8, height: 16 } } },
          clear,
          _isPaused: false,
          _needsFullRefresh: false,
          refreshRows,
        },
        coreMouseService: cms,
        viewport: { syncScrollArea: vi.fn() },
      },
    };

    recoverTerminalMetrics(terminal, { fit: vi.fn() }, { forceRendererRepair: true });

    expect(resize.mock.calls).toEqual([
      [99, 40],
      [100, 40],
    ]);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(refreshRows).toHaveBeenCalledWith(0, 39);
    expect(refresh).toHaveBeenCalledWith(0, 39);
    expect(cms.sets).toEqual(["NONE", "VT200"]);
  });

  it("does not unpause a renderer that is legitimately hidden", () => {
    const cms = mockMouseService("VT200");
    const clear = vi.fn();
    const refresh = vi.fn();
    const terminal = {
      cols: 100,
      rows: 40,
      options: { fontSize: 14 },
      refresh,
      _core: {
        _charSizeService: { hasValidSize: true, width: 8, height: 16 },
        _renderService: {
          dimensions: { css: { cell: { width: 8, height: 16 } } },
          clear,
          _isPaused: true,
          _needsFullRefresh: true,
        },
        coreMouseService: cms,
      },
    };

    recoverTerminalMetrics(terminal, { fit: vi.fn() }, { allowRendererRepair: false });

    expect(terminal._core._renderService._isPaused).toBe(true);
    expect(clear).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(cms.sets).toEqual(["NONE", "VT200"]);
  });

  it("unpauses, force-resizes, refreshes, and rebinds NONE→protocol", () => {
    const measure = vi.fn();
    const clear = vi.fn();
    const refreshRows = vi.fn();
    const resize = vi.fn();
    const refresh = vi.fn();
    const fit = vi.fn(() => {
      terminal.cols = 100;
      terminal.rows = 40;
    });
    const cms = mockMouseService("VT200");
    const rs = {
      dimensions: { css: { cell: { width: 8, height: 16 } } },
      clear,
      _isPaused: true,
      _needsFullRefresh: true,
      refreshRows,
    };
    const terminal = {
      cols: 80,
      rows: 24,
      options: { fontSize: 14 },
      refresh,
      resize,
      _core: {
        _charSizeService: { measure, hasValidSize: true, width: 8, height: 16 },
        _renderService: rs,
        coreMouseService: cms,
        viewport: { syncScrollArea: vi.fn() },
      },
    };

    const next = recoverTerminalMetrics(terminal, { fit });

    expect(rs._isPaused).toBe(false);
    expect(measure).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(fit).toHaveBeenCalled();
    // After fit, cols=100 → nudge 99 then restore 100
    expect(resize).toHaveBeenCalled();
    expect(cms.sets).toEqual(["NONE", "VT200"]);
    expect(next).toEqual({ cols: 100, rows: 40 });
  });

  it("still rebinds without redrawing when dimensions are unchanged", () => {
    const cms = mockMouseService("ANY");
    const resize = vi.fn();
    const terminal = {
      cols: 120,
      rows: 40,
      options: { fontSize: 14 },
      refresh: vi.fn(),
      resize,
      _core: {
        _charSizeService: {
          measure: vi.fn(),
          hasValidSize: true,
          width: 9,
          height: 18,
        },
        _renderService: {
          dimensions: { css: { cell: { width: 9, height: 18 } } },
          clear: vi.fn(),
          _isPaused: false,
          refreshRows: vi.fn(),
        },
        coreMouseService: cms,
        viewport: { syncScrollArea: vi.fn() },
      },
    };

    const next = recoverTerminalMetrics(terminal, { fit: vi.fn() });

    expect(next).toBeNull();
    expect(resize).not.toHaveBeenCalled();
    expect(cms.sets).toEqual(["NONE", "ANY"]);
  });
});
