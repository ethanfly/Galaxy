/**
 * Recover xterm after long-idle agent TUI freezes (Grok/Codex/Claude etc.).
 *
 * Failure modes we hit in production:
 * 1. Char size invalid → getMouseReportCoords returns undefined (clicks no-op).
 * 2. FitAddon.fit() no-ops when cell w/h is 0.
 * 3. terminal.resize(cols, rows) early-returns when size unchanged and only
 *    measures if size invalid — does NOT rebuild render dimensions when size
 *    looks "valid" but canvas is stale.
 * 4. RenderService IntersectionObserver can leave _isPaused=true; refreshRows
 *    then no-ops forever until unpaused.
 * 5. Mouse protocol listeners need NONE→protocol toggle to re-add (not self-assign).
 *
 * Exit/re-enter agent works because DEC mouse off/on + full redraw. We mirror that.
 */

interface FitTarget {
  fit(): void;
}

export interface TerminalMetricsTarget {
  cols: number;
  rows: number;
  options: { fontSize?: number };
  refresh(start: number, end: number): void;
  resize?(cols: number, rows: number): void;
}

type CoreLike = {
  _charSizeService?: {
    measure?: () => void;
    hasValidSize?: boolean;
    width?: number;
    height?: number;
  };
  _renderService?: {
    dimensions?: { css?: { cell?: { width: number; height: number } } };
    clear?: () => void;
    /** private — IntersectionObserver pause flag */
    _isPaused?: boolean;
    _needsFullRefresh?: boolean;
    refreshRows?: (start: number, end: number, isRedrawOnly?: boolean) => void;
  };
  coreMouseService?: { activeProtocol: string };
  viewport?: { syncScrollArea?: (force?: boolean) => void };
};

function coreOf(terminal: TerminalMetricsTarget): CoreLike | undefined {
  return (terminal as unknown as { _core?: CoreLike })._core;
}

/** True when mouse CSI reports would be dropped or coords invalid. */
export function isTerminalMouseBroken(terminal: TerminalMetricsTarget): boolean {
  const core = coreOf(terminal);
  if (!core) return false;
  const charOk = core._charSizeService?.hasValidSize !== false
    && (core._charSizeService?.width ?? 1) > 0
    && (core._charSizeService?.height ?? 1) > 0;
  const cell = core._renderService?.dimensions?.css?.cell;
  const cellOk = !!cell && cell.width > 0 && cell.height > 0;
  const paused = core._renderService?._isPaused === true;
  return !charOk || !cellOk || paused;
}

function forceCharMeasure(terminal: TerminalMetricsTarget): void {
  const core = coreOf(terminal);
  try {
    core?._charSizeService?.measure?.();
  } catch {
    /* private API */
  }
  const cell = core?._renderService?.dimensions?.css?.cell;
  const charInvalid =
    core?._charSizeService?.hasValidSize === false ||
    (core?._charSizeService?.width ?? 1) <= 0 ||
    (cell != null && (cell.width === 0 || cell.height === 0));
  if (charInvalid) {
    const size = terminal.options.fontSize ?? 14;
    try {
      // Option change forces CharSizeService to remeasure.
      terminal.options.fontSize = size + 0.001;
      terminal.options.fontSize = size;
      core?._charSizeService?.measure?.();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Unstick RenderService after IntersectionObserver left it paused while the
 * pane is actually on-screen (common after long idle / OS power throttling).
 */
export function unpauseTerminalRenderer(terminal: TerminalMetricsTarget): void {
  const rs = coreOf(terminal)?._renderService;
  if (!rs) return;
  try {
    if (rs._isPaused) {
      rs._isPaused = false;
      rs._needsFullRefresh = false;
    }
  } catch {
    /* ignore */
  }
}

/**
 * Tear down and rebind xterm mouse listeners (element + document).
 * Must go through NONE so requestedEvents slots are nullified before re-add.
 */
export function rebindTerminalMouse(terminal: TerminalMetricsTarget): void {
  const cms = coreOf(terminal)?.coreMouseService;
  if (!cms) return;
  try {
    const previous = cms.activeProtocol || "NONE";
    if (previous !== "NONE") {
      cms.activeProtocol = "NONE";
    }
    cms.activeProtocol = previous === "NONE" ? "NONE" : previous;
  } catch {
    /* unknown protocol / private API */
  }
}

/**
 * Force a real core resize even when cols×rows are unchanged.
 * Public Terminal.resize(same,same) early-returns without rebuilding dimensions.
 */
export function forceTerminalResizeCycle(
  terminal: TerminalMetricsTarget,
): void {
  if (typeof terminal.resize !== "function") return;
  const cols = terminal.cols;
  const rows = terminal.rows;
  if (cols < 2 || rows < 1) return;
  try {
    // Nudge then restore — takes the full resize path (measure, viewport sync).
    const nudgeCols = cols > 2 ? cols - 1 : cols + 1;
    terminal.resize(nudgeCols, rows);
    terminal.resize(cols, rows);
  } catch {
    try {
      terminal.resize(cols, rows);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Full recovery. Returns new cols/rows when fit changed dimensions.
 */
export function recoverTerminalMetrics(
  terminal: TerminalMetricsTarget,
  fit: FitTarget,
): { cols: number; rows: number } | null {
  const before = `${terminal.cols}x${terminal.rows}`;

  unpauseTerminalRenderer(terminal);
  forceCharMeasure(terminal);

  try {
    fit.fit();
  } catch {
    /* host not laid out */
  }

  const core = coreOf(terminal);
  try {
    core?._renderService?.clear?.();
  } catch {
    /* ignore */
  }

  forceTerminalResizeCycle(terminal);

  try {
    core?.viewport?.syncScrollArea?.(true);
  } catch {
    /* ignore */
  }

  unpauseTerminalRenderer(terminal);

  if (terminal.rows > 0) {
    try {
      // Bypass debounced pause if we just cleared it.
      core?._renderService?.refreshRows?.(0, terminal.rows - 1);
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
