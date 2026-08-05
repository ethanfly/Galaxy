import { describe, expect, it } from "vitest";

import { DEFAULT_APPEARANCE, resolveAppearance } from "./appearance";

describe("resolveAppearance", () => {
  it("resolves preview before persisted config before boot defaults", () => {
    expect(resolveAppearance(null, null)).toEqual(DEFAULT_APPEARANCE);
    expect(resolveAppearance({ terminalFontSize: 16, uiFontSize: 15 }, null)).toEqual({
      terminalFontSize: 16,
      uiFontSize: 15,
    });
    expect(
      resolveAppearance(
        { terminalFontSize: 16, uiFontSize: 15 },
        { terminalFontSize: 22, uiFontSize: 19 },
      ),
    ).toEqual({ terminalFontSize: 22, uiFontSize: 19 });
  });
});
