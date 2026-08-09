import type { Terminal } from "@xterm/xterm";

/**
 * Runtime diagnostics for TUI mouse debugging.
 *
 * Exposes `window.__galaxyTermDiag(paneId?)` so that when TUI mouse input
 * stops working in the field we can capture the exact pipeline state instead
 * of guessing. Run it in DevTools while the pane is misbehaving and share the
 * output. It is read-only and cheap.
 */

interface CoreLike {
  coreMouseService?: { activeProtocol?: string; activeEncoding?: string };
  _charSizeService?: { hasValidSize?: boolean; width?: number; height?: number };
  _renderService?: {
    _isPaused?: boolean;
    dimensions?: { css?: { cell?: { width?: number; height?: number } } };
  };
  coreService?: { isCursorHidden?: boolean };
}

export interface TerminalDiagSnapshot {
  paneId: string;
  cols: number;
  rows: number;
  mouseTrackingMode: string;
  activeProtocol: string;
  activeEncoding: string;
  charSizeValid: boolean;
  charWidth: number;
  charHeight: number;
  cellWidth: number;
  cellHeight: number;
  renderPaused: boolean;
  cursorHidden: boolean;
  focused: boolean;
}

function describe(paneId: string, term: Terminal): TerminalDiagSnapshot {
  const core = (term as unknown as { _core?: CoreLike })._core ?? {};
  const cell = core._renderService?.dimensions?.css?.cell;
  return {
    paneId,
    cols: term.cols,
    rows: term.rows,
    mouseTrackingMode: term.modes?.mouseTrackingMode ?? "?",
    activeProtocol: core.coreMouseService?.activeProtocol ?? "?",
    activeEncoding: core.coreMouseService?.activeEncoding ?? "?",
    charSizeValid: Boolean(core._charSizeService?.hasValidSize),
    charWidth: core._charSizeService?.width ?? 0,
    charHeight: core._charSizeService?.height ?? 0,
    cellWidth: cell?.width ?? 0,
    cellHeight: cell?.height ?? 0,
    renderPaused: core._renderService?._isPaused === true,
    cursorHidden: core.coreService?.isCursorHidden === true,
    focused: term.textarea === document.activeElement,
  };
}

/**
 * Install `window.__galaxyTermDiag`. Idempotent; called once with the shared
 * terminal registry. Passing a paneId returns one snapshot, otherwise all.
 */
export function installTerminalDiagnostics(terminals: Map<string, Terminal>): void {
  if (typeof window === "undefined") return;
  const target = window as unknown as Record<string, unknown>;
  target.__galaxyTermDiag = (paneId?: string) => {
    if (paneId) {
      const term = terminals.get(paneId);
      return term ? describe(paneId, term) : { paneId, error: "no live terminal" };
    }
    const out: Record<string, TerminalDiagSnapshot> = {};
    terminals.forEach((term, id) => {
      out[id] = describe(id, term);
    });
    return out;
  };
}
