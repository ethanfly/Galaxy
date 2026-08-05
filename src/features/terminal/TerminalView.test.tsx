import { describe, expect, it } from "vitest";

import { applyTerminalFontSize, terminalOptions } from "./terminalAppearance";
import { GALAXY_THEME } from "./terminalTheme";

describe("GALAXY_THEME", () => {
  it("uses the deep-space monochrome canvas while preserving ANSI semantics", () => {
    expect(GALAXY_THEME.background).toBe("#030405");
    expect(GALAXY_THEME.foreground).toBe("#f7f8f8");
    expect(GALAXY_THEME.cursor).toBe("#ffffff");
    expect(GALAXY_THEME.cursorAccent).toBe("#030405");
    expect(GALAXY_THEME.selectionBackground).toBe("#34383d");
    expect(GALAXY_THEME.red).not.toBe(GALAXY_THEME.green);
    expect(GALAXY_THEME.blue).not.toBe(GALAXY_THEME.cyan);
  });
});

describe("terminal appearance", () => {
  it("constructs a solid cursor at the requested terminal size", () => {
    const options = terminalOptions(21);

    expect(options.fontSize).toBe(21);
    expect(options.cursorBlink).toBe(false);
  });

  it("updates a changed font size and reports fitted PTY dimensions", () => {
    const terminal = { options: { fontSize: 14 }, cols: 96, rows: 28 };
    let fits = 0;
    const fit = {
      fit() {
        fits += 1;
        terminal.cols = 82;
        terminal.rows = 24;
      },
    };

    expect(applyTerminalFontSize(terminal, fit, 20)).toEqual({ cols: 82, rows: 24 });
    expect(terminal.options.fontSize).toBe(20);
    expect(fits).toBe(1);
  });

  it("does not refit when the effective font size is unchanged", () => {
    const terminal = { options: { fontSize: 18 }, cols: 80, rows: 24 };
    let fits = 0;

    expect(applyTerminalFontSize(terminal, { fit: () => { fits += 1; } }, 18)).toBeNull();
    expect(fits).toBe(0);
  });
});
