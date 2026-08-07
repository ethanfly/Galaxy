import { describe, expect, it } from "vitest";

import { enforceNonBlinkingCursor } from "./terminalCursor";

describe("enforceNonBlinkingCursor", () => {
  it("disables blinking re-enabled by terminal output", () => {
    const terminal = { options: { cursorBlink: true } };

    enforceNonBlinkingCursor(terminal);

    expect(terminal.options.cursorBlink).toBe(false);
  });
});
