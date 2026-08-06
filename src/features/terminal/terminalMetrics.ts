/**
 * Recover xterm cell metrics after long idle / WebView suspend / zeroed
 * char sizes. FitAddon.fit() no-ops when css.cell width/height is 0, so we
 * must remeasure first or TUI mouse coords and scrolling stay dead.
 */

interface FitTarget {
  fit(): void;
}

interface TerminalMetricsTarget {
  cols: number;
  rows: number;
  options: { fontSize?: number };
  refresh(start: number, end: number): void;
}

function forceCharMeasure(terminal: TerminalMetricsTarget): void {
  const core = (terminal as unknown as { _core?: {
    _charSizeService?: { measure?: () => void };
    _renderService?: {
      dimensions?: { css?: { cell?: { width: number; height: number } } };
      clear?: () => void;
    };
  } })._core;
  try {
    core?._charSizeService?.measure?.();
  } catch {
    /* private API */
  }
  // If measure still reports 0 (e.g. DOM measure while frozen), nudge fontSize
  // so CharSizeService's option listener re-runs measure after paint.
  const cell = core?._renderService?.dimensions?.css?.cell;
  if (cell && (cell.width === 0 || cell.height === 0)) {
    const size = terminal.options.fontSize ?? 14;
    try {
      terminal.options.fontSize = size + 0.001;
      terminal.options.fontSize = size;
      core?._charSizeService?.measure?.();
    } catch {
      /* ignore */
    }
  }
  try {
    core?._renderService?.clear?.();
  } catch {
    /* ignore */
  }
}

/**
 * Remeasure, fit, and full-refresh. Returns new cols/rows when they change
 * (caller should ptyResize); null when unchanged or host not ready.
 */
export function recoverTerminalMetrics(
  terminal: TerminalMetricsTarget,
  fit: FitTarget,
): { cols: number; rows: number } | null {
  const before = `${terminal.cols}x${terminal.rows}`;
  forceCharMeasure(terminal);
  try {
    fit.fit();
  } catch {
    return null;
  }
  if (terminal.rows > 0) {
    try {
      terminal.refresh(0, terminal.rows - 1);
    } catch {
      /* mid-teardown */
    }
  }
  if (`${terminal.cols}x${terminal.rows}` !== before) {
    return { cols: terminal.cols, rows: terminal.rows };
  }
  return null;
}
