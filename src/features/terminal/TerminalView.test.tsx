import { describe, expect, it } from "vitest";

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
