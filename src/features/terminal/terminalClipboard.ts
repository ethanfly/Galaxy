import type { Terminal } from "@xterm/xterm";

/** Write plain text to the system clipboard with a legacy fallback. */
export async function writeClipboardText(text: string): Promise<void> {
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* fall through to execCommand */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

/** Copy the active xterm selection when present. Returns true if something was copied. */
export function copyTerminalSelection(term: Terminal): boolean {
  if (!term.hasSelection()) return false;
  const text = term.getSelection();
  if (!text) return false;
  void writeClipboardText(text);
  return true;
}

/**
 * Install copy-on-select and copy keyboard shortcuts for one terminal.
 *
 * - Selecting text (mouse or keyboard) copies once the selection settles.
 * - Ctrl+C / Ctrl+Insert / Ctrl+Shift+C copy when a selection exists
 *   (Ctrl+C without a selection still reaches the PTY as interrupt).
 */
export function installTerminalClipboard(term: Terminal): () => void {
  let copyTimer: number | null = null;

  const flushCopy = () => {
    copyTimer = null;
    copyTerminalSelection(term);
  };

  const selectionSub = term.onSelectionChange(() => {
    if (copyTimer != null) {
      window.clearTimeout(copyTimer);
      copyTimer = null;
    }
    if (!term.hasSelection()) return;
    // Debounce so drag selection writes once when the gesture settles.
    copyTimer = window.setTimeout(flushCopy, 120);
  });

  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== "keydown") return true;
    if (ev.altKey || ev.metaKey) return true;

    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const isCopyChord =
      (ev.ctrlKey && !ev.shiftKey && (key === "c" || key === "Insert")) ||
      (ev.ctrlKey && ev.shiftKey && key === "c");

    if (!isCopyChord) return true;
    if (!term.hasSelection()) {
      // No selection: let Ctrl+C fall through as SIGINT; Ctrl+Shift+C is a no-op.
      return !(ev.ctrlKey && ev.shiftKey && key === "c");
    }

    if (copyTimer != null) {
      window.clearTimeout(copyTimer);
      copyTimer = null;
    }
    copyTerminalSelection(term);
    // Stop xterm from turning Ctrl+C into \x03 while text is selected.
    return false;
  });

  return () => {
    if (copyTimer != null) {
      window.clearTimeout(copyTimer);
      copyTimer = null;
    }
    selectionSub.dispose();
  };
}
