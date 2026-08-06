/**
 * Recover xterm cell metrics and mouse binding after long idle / WebView
 * suspend / agent TUI stuck state.
 *
 * FitAddon.fit() no-ops when css.cell width/height is 0, and also skips a
 * full render when cols×rows are unchanged — both leave TUI mouse dead.
 * Exiting and re-entering an agent fixes it because the agent re-sends mouse
 * DEC modes (rebinds handlers) and redraws; we do the same without restart.
 */

interface FitTarget {
  fit(): void;
}

interface TerminalMetricsTarget {
  cols: number;
  rows: number;
  options: { fontSize?: number };
  refresh(start: number, end: number): void;
  resize?(cols: number, rows: number): void;
}

type CoreLike = {
  _charSizeService?: { measure?: () => void };
  _renderService?: {
    dimensions?: { css?: { cell?: { width: number; height: number } } };
    clear?: () => void;
  };
  coreMouseService?: { activeProtocol: string };
};

function coreOf(terminal: TerminalMetricsTarget): CoreLike | undefined {
  return (terminal as unknown as { _core?: CoreLike })._core;
}

function forceCharMeasure(terminal: TerminalMetricsTarget): void {
  const core = coreOf(terminal);
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
}

/**
 * Re-fire mouse protocol change so xterm rebinds document/element listeners.
 * Matches what happens when an agent exits (sends ?1000l) and re-enters (?1000h).
 */
export function rebindTerminalMouse(terminal: TerminalMetricsTarget): void {
  const cms = coreOf(terminal)?.coreMouseService;
  if (!cms) return;
  try {
    // Self-assign forces onProtocolChange (same trick xterm uses at open()).
    cms.activeProtocol = cms.activeProtocol;
  } catch {
    /* ignore */
  }
}

/**
 * Remeasure, fit, force full refresh, rebind mouse. Returns new cols/rows when
 * they change (caller should ptyResize); null when unchanged or not ready.
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

  const core = coreOf(terminal);
  try {
    core?._renderService?.clear?.();
  } catch {
    /* ignore */
  }

  // FitAddon only resizes when cols/rows change. Force a same-size resize so
  // render dimensions rebuild after a long idle with a live agent TUI.
  if (typeof terminal.resize === "function" && terminal.cols > 0 && terminal.rows > 0) {
    try {
      terminal.resize(terminal.cols, terminal.rows);
    } catch {
      /* ignore */
    }
  }

  if (terminal.rows > 0) {
    try {
      terminal.refresh(0, terminal.rows - 1);
    } catch {
      /* mid-teardown */
    }
  }

  rebindTerminalMouse(terminal);

  if (`${terminal.cols}x${terminal.rows}` !== before) {
    return { cols: terminal.cols, rows: terminal.rows };
  }
  return null;
}
