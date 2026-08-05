import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyTerminalSelection,
  installTerminalClipboard,
  writeClipboardText,
} from "./terminalClipboard";

function mockTerminal(overrides: {
  selection?: string;
  mouseTrackingMode?: "none" | "x10" | "vt200" | "drag" | "any";
  onSelectionChange?: (listener: () => void) => { dispose: () => void };
}) {
  const selection = overrides.selection ?? "";
  let keyHandler: ((ev: KeyboardEvent) => boolean) | null = null;
  let selectionListener: (() => void) | null = null;

  const term = {
    hasSelection: () => selection.length > 0,
    getSelection: () => selection,
    modes: { mouseTrackingMode: overrides.mouseTrackingMode ?? "none" },
    onSelectionChange: (listener: () => void) => {
      selectionListener = listener;
      return (
        overrides.onSelectionChange?.(listener) ?? {
          dispose: () => {
            selectionListener = null;
          },
        }
      );
    },
    attachCustomKeyEventHandler: (handler: (ev: KeyboardEvent) => boolean) => {
      keyHandler = handler;
    },
    /** test helpers */
    _fireSelection() {
      selectionListener?.();
    },
    _key(ev: Partial<KeyboardEvent> & { key: string }) {
      return keyHandler?.(
        {
          type: "keydown",
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
          ...ev,
        } as KeyboardEvent,
      );
    },
  };

  return term as typeof term & {
    hasSelection: () => boolean;
    getSelection: () => string;
    onSelectionChange: (listener: () => void) => { dispose: () => void };
    attachCustomKeyEventHandler: (handler: (ev: KeyboardEvent) => boolean) => void;
  };
}

describe("writeClipboardText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);

    await writeClipboardText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("skips empty strings", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);

    await writeClipboardText("");

    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("copyTerminalSelection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies non-empty selections and reports success", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    const term = {
      hasSelection: () => true,
      getSelection: () => "selected line",
    };

    expect(copyTerminalSelection(term as never)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("selected line");
  });

  it("returns false when nothing is selected", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    const term = {
      hasSelection: () => false,
      getSelection: () => "",
    };

    expect(copyTerminalSelection(term as never)).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("installTerminalClipboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("copies when a selection settles (copy-on-select)", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);

    const term = mockTerminal({ selection: "dragged text" });
    const dispose = installTerminalClipboard(term as never);

    term._fireSelection();
    expect(writeText).not.toHaveBeenCalled();

    vi.advanceTimersByTime(120);
    expect(writeText).toHaveBeenCalledWith("dragged text");

    dispose();
  });

  it("copies on Ctrl+C when text is selected and blocks PTY interrupt", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);

    const term = mockTerminal({ selection: "block me" });
    installTerminalClipboard(term as never);

    const pass = term._key({ key: "c", ctrlKey: true });
    expect(pass).toBe(false);
    expect(writeText).toHaveBeenCalledWith("block me");
  });

  it("lets Ctrl+C reach the PTY when there is no selection", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);

    const term = mockTerminal({ selection: "" });
    installTerminalClipboard(term as never);

    const pass = term._key({ key: "c", ctrlKey: true });
    expect(pass).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies on Ctrl+Shift+C when text is selected", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);

    const term = mockTerminal({ selection: "shift copy" });
    installTerminalClipboard(term as never);

    const pass = term._key({ key: "C", ctrlKey: true, shiftKey: true });
    expect(pass).toBe(false);
    expect(writeText).toHaveBeenCalledWith("shift copy");
  });

  it("does not copy-on-select while a TUI has mouse tracking enabled", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);

    const term = mockTerminal({ selection: "ignored", mouseTrackingMode: "vt200" });
    installTerminalClipboard(term as never);

    term._fireSelection();
    vi.advanceTimersByTime(200);
    expect(writeText).not.toHaveBeenCalled();
  });
});
