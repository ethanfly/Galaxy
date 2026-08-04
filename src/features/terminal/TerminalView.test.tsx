import { describe, expect, it } from "vitest";

import { GALAXY_THEME } from "./terminalTheme";

describe("GALAXY_THEME", () => {
  it("uses the workspace charcoal and signal-green terminal palette", () => {
    expect(GALAXY_THEME.background).toBe("#0b0e0f");
    expect(GALAXY_THEME.foreground).toBe("#edf3f0");
    expect(GALAXY_THEME.cursor).toBe("#67d9ad");
    expect(GALAXY_THEME.cursorAccent).toBe("#0b0e0f");
    expect(GALAXY_THEME.selectionBackground).toBe("#244d3d");
    expect(GALAXY_THEME.magenta).not.toMatch(/9a7bf5|b9a7ff/i);
    expect(GALAXY_THEME.magenta).not.toBe(GALAXY_THEME.yellow);
    expect(GALAXY_THEME.brightMagenta).not.toBe(GALAXY_THEME.brightYellow);
  });
});
