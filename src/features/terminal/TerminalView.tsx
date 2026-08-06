// One pane = one PTY = one xterm instance (spec §3.2).
// WebGL renderer by default; on init failure or context loss we release the
// addon and fall back to the built-in renderer without touching the PTY.
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";

import "@xterm/xterm/css/xterm.css";

import {
  ptyBroadcast,
  ptyObserveScreen,
  ptyResize,
  ptyWrite,
  ptyWriteBytes,
  systemOpenExternal,
} from "../../shared/ipc/client";
import type { Pane, Session } from "../../shared/ipc/types";
import { registerTerminal, unregisterTerminal, useTerminalStore } from "../../shared/stores/terminalStore";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { resolveAppearance } from "../../shared/appearance";
import { t } from "../../shared/i18n";
import { layoutPanes } from "../../shared/utils";
import { GALAXY_THEME } from "./terminalTheme";
import { applyTerminalFontSize, terminalOptions } from "./terminalAppearance";
import { installTerminalClipboard } from "./terminalClipboard";
import { createAgentScreenObserver, readAgentScreen } from "./agentScreenObserver";
import { recoverTerminalMetrics } from "./terminalMetrics";
import { attachTerminalUserInput, binaryStringToBytes } from "./terminalInput";

export const searchAddons = new Map<string, SearchAddon>();
export const terminals = new Map<string, Terminal>();

export function TerminalView({ pane, session }: { pane: Pane; session: Session }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const scrollLocked = useTerminalStore((s) => !!s.scrollLocked[pane.id]);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const paneIdsKey = layoutPanes(session.layout)
    .map((item) => item.id)
    .join("\0");

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const appearance = resolveAppearance(
      useAppStore.getState().config,
      useUiStore.getState().appearancePreview,
    );
    const term = new Terminal(terminalOptions(appearance.terminalFontSize));
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void systemOpenExternal(uri);
      }),
    );
    term.open(host);

    // xterm <= 6.0 can leave its hidden IME textarea at a stale right-click
    // or partial-render position. WebView2 anchors the candidate window before
    // xterm's composition handler gets a chance to move it, so resync during
    // capture using the current buffer cursor (upstream xterm.js #5759).
    let imeComposing = false;
    const syncImeAnchor = () => {
      imeComposing = true;
      const textarea = term.textarea;
      const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
      if (!textarea || !screen || term.cols < 1 || term.rows < 1) return;
      const screenWidth = screen.clientWidth;
      const screenHeight = screen.clientHeight;
      if (screenWidth < 1 || screenHeight < 1) return;

      const buffer = term.buffer.active;
      const cursorX = Math.max(0, Math.min(buffer.cursorX, term.cols - 1));
      const cursorY = Math.max(0, Math.min(buffer.cursorY, term.rows - 1));
      const cellWidth = screenWidth / term.cols;
      const cellHeight = screenHeight / term.rows;
      textarea.style.left = `${cursorX * cellWidth}px`;
      textarea.style.top = `${cursorY * cellHeight}px`;
      textarea.style.width = `${Math.max(cellWidth, 1)}px`;
      textarea.style.height = `${Math.max(cellHeight, 1)}px`;
      textarea.style.lineHeight = `${Math.max(cellHeight, 1)}px`;
      textarea.style.zIndex = "-5";
    };
    const textarea = term.textarea;
    textarea?.addEventListener("compositionstart", syncImeAnchor, true);
    let imeConstraintTimer: number | null = null;
    const constrainImeComposition = () => {
      const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
      const composition = term.element?.querySelector<HTMLElement>(".composition-view");
      if (!textarea || !screen || !composition || term.cols < 1 || term.rows < 1) return;
      const buffer = term.buffer.active;
      const cellWidth = screen.clientWidth / term.cols;
      const cellHeight = screen.clientHeight / term.rows;
      const cursorX = Math.max(0, Math.min(buffer.cursorX, term.cols - 1));
      const cursorY = Math.max(0, Math.min(buffer.cursorY, term.rows - 1));
      const cursorLeft = cursorX * cellWidth;
      const top = cursorY * cellHeight;

      // The hidden textarea is the native IME candidate-window anchor and
      // must remain at the real cursor. The visible composition text may grow
      // leftward at the last columns so it remains readable without changing
      // text direction or escaping the terminal viewport.
      composition.style.direction = "";
      composition.style.maxWidth = `${screen.clientWidth}px`;
      composition.style.overflow = "hidden";
      const compositionWidth = Math.min(
        Math.max(composition.scrollWidth, composition.getBoundingClientRect().width, cellWidth),
        screen.clientWidth,
      );
      const compositionLeft = Math.max(
        0,
        Math.min(cursorLeft, screen.clientWidth - compositionWidth),
      );
      composition.style.left = `${compositionLeft}px`;
      composition.style.top = `${top}px`;
      composition.style.maxWidth = `${Math.max(screen.clientWidth - compositionLeft, 1)}px`;
      textarea.style.left = `${cursorLeft}px`;
      textarea.style.top = `${top}px`;
      textarea.style.width = `${Math.min(
        Math.max(textarea.getBoundingClientRect().width, cellWidth, 1),
        Math.max(screen.clientWidth - cursorLeft, 1),
      )}px`;
    };
    const scheduleImeConstraint = () => {
      constrainImeComposition();
      if (imeConstraintTimer != null) window.clearTimeout(imeConstraintTimer);
      // xterm 5.5 schedules a second zero-delay position update. Register our
      // settled pass after it so native IME anchoring cannot be overwritten.
      imeConstraintTimer = window.setTimeout(() => {
        imeConstraintTimer = null;
        if (imeComposing) constrainImeComposition();
      }, 0);
    };
    textarea?.addEventListener("compositionupdate", scheduleImeConstraint);
    const renderSub = term.onRender(() => {
      if (imeComposing) scheduleImeConstraint();
    });
    const finishImeComposition = () => {
      imeComposing = false;
      if (imeConstraintTimer != null) {
        window.clearTimeout(imeConstraintTimer);
        imeConstraintTimer = null;
      }
    };
    textarea?.addEventListener("compositionend", finishImeComposition);

    // Canvas renderer is more reliable for CJK font fallback than WebGL's
    // glyph atlas (missing faces → empty boxes). Still try WebGL; if it fails
    // or loses context we stay on the default canvas path.
    let webgl: WebglAddon | null = null;
    const preferCanvasForCjk = prefersCjkTerminalFonts();
    if (!preferCanvasForCjk) {
      try {
        webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl?.dispose();
          webgl = null;
        });
        term.loadAddon(webgl);
      } catch (err) {
        console.warn("WebGL addon unavailable, using canvas renderer", err);
        webgl = null;
      }
    }

    fitRef.current = fit;
    termRef.current = term;
    terminals.set(pane.id, term);
    searchAddons.set(pane.id, search);

    const current = useAppStore.getState().sessions.find((item) => item.id === session.id);
    let agentKnown = Boolean(
      pane.agentKind ||
        useTerminalStore.getState().agentStatus[pane.id] ||
        (current && layoutPanes(current.layout).find((item) => item.id === pane.id)?.agentKind),
    );
    let inputAlive = true;
    let renderedGeneration = 0;
    let renderedSeq = 0;
    const screenObserver = createAgentScreenObserver(
      () => ({ screen: readAgentScreen(term), renderedGeneration, renderedSeq }),
      (snapshot) =>
        ptyObserveScreen(
          pane.id,
          snapshot.screen,
          snapshot.renderedGeneration,
          snapshot.renderedSeq,
        ),
    );

    const recordRenderedOutput = (generation: number, seq: number) => {
      if (!inputAlive) return;
      // xterm completes queued writes in FIFO order. Assignment also lets a
      // restarted pane adopt its new ring, whose sequence begins at one.
      renderedGeneration = generation;
      renderedSeq = seq;
      if (agentKnown) screenObserver.schedule();
    };
    const writeOutput = (data: string, seq: number, generation: number) => {
      if (useTerminalStore.getState().scrollLocked[pane.id]) {
        // stop-scroll trigger action: keep the viewport where the user left
        // it even while output keeps flowing.
        const buffer = term.buffer.active;
        const y = buffer.viewportY;
        term.write(data, () => {
          try {
            term.scrollToLine(y);
          } catch {
            /* buffer scrolled */
          }
          recordRenderedOutput(generation, seq);
        });
        return;
      }
      term.write(data, () => recordRenderedOutput(generation, seq));
    };

    const refitMetrics = (): { cols: number; rows: number } | null => {
      if (!inputAlive) return null;
      if (host.clientWidth < 1 || host.clientHeight < 1) return null;
      // Force char remeasure first — FitAddon no-ops when cell size is 0,
      // which happens after long idle / WebView suspend and kills TUI mouse.
      return recoverTerminalMetrics(term, fit);
    };

    // Register replay/write surface for the batching pipeline. The sequence
    // advances only from xterm's parsed-write callback, never on IPC receipt.
    const handle = {
      paneId: pane.id,
      write: writeOutput,
      replay: (chunks: { data: string; seq: number; generation: number }[]) =>
        chunks.forEach((chunk) => writeOutput(chunk.data, chunk.seq, chunk.generation)),
      truncatedNotice: () => term.write(`\r\n\x1b[33m${t("truncatedNotice")}\x1b[0m\r\n`),
      refitMetrics,
    };
    registerTerminal(handle);

    // Agent status changes (including re-enter after exit) re-send mouse DEC
    // modes in a healthy run; when they don't (stuck long idle), recover metrics
    // and rebind mouse handlers so TUI clicks work without restarting the agent.
    const unsubAgentStatus = useTerminalStore.subscribe(
      (state) => state.agentStatus[pane.id],
      (status, prev) => {
        if (!status) return;
        if (!agentKnown) {
          agentKnown = true;
          screenObserver.schedule();
        }
        if (status.status === prev?.status && status.kind === prev?.kind) return;
        if (host.clientWidth < 1 || host.clientHeight < 1) return;
        try {
          const next = recoverTerminalMetrics(term, fit);
          if (next) void ptyResize(pane.id, next.cols, next.rows);
        } catch {
          /* mid-teardown */
        }
      },
    );

    // Input: direct, unbatched. Sync-input fans out to the whole session.
    // onData (text/SGR mouse) + onBinary (DEFAULT mouse as raw bytes).
    const sendTextInput = (data: string) => {
      if (!inputAlive) return;
      const sess = useAppStore.getState().sessions.find((s) => s.id === session.id);
      if (sess?.syncInput) {
        void ptyBroadcast(session.id, data);
      } else {
        void ptyWrite(pane.id, data);
      }
    };
    const sendBinaryInput = (data: string) => {
      if (!inputAlive) return;
      // DEFAULT mouse encoding is latin1 bytes; UTF-8 string IPC corrupts it.
      void ptyWriteBytes(pane.id, binaryStringToBytes(data));
    };
    const detachInput = attachTerminalUserInput(term, sendTextInput, sendBinaryInput);
    // Select-to-copy (and Ctrl+C / Ctrl+Shift+C when a selection exists).
    const disposeClipboard = installTerminalClipboard(term);
    const bellSub = term.onBell(() => {
      useTerminalStore.getState().addMark(pane.id);
    });
    const handleTerminalFocus = () => {
      useTerminalStore.getState().setFocusedPane(session.id, pane.id);
    };
    textarea?.addEventListener("focus", handleTerminalFocus);

    const runRecover = () => {
      if (!inputAlive) return;
      if (host.clientWidth < 1 || host.clientHeight < 1) return;
      try {
        const next = recoverTerminalMetrics(term, fit);
        if (next) void ptyResize(pane.id, next.cols, next.rows);
      } catch {
        /* mid-teardown */
      }
    };

    // Native capture beats React delegation order vs xterm's mousedown and
    // runs even if a synthetic path is skipped after long WebView idle.
    const onPointerRecover = () => {
      if (useTerminalStore.getState().scrollLocked[pane.id]) {
        useTerminalStore.getState().setScrollLocked(pane.id, false);
      }
      runRecover();
    };
    host.addEventListener("pointerdown", onPointerRecover, true);

    // While a TUI owns the pane, periodically heal metrics/listeners so a
    // long idle Grok session does not require exit/re-enter.
    let healTimer: number | null = null;
    const armHealTimer = () => {
      if (healTimer != null) window.clearInterval(healTimer);
      healTimer = window.setInterval(() => {
        if (!inputAlive) return;
        if (term.modes.mouseTrackingMode === "none" && !agentKnown) return;
        runRecover();
      }, 20_000);
    };
    armHealTimer();

    // Initial sizing after first paint.
    const initialFit = requestAnimationFrame(() => {
      if (!inputAlive) return;
      try {
        fit.fit();
        void ptyResize(pane.id, term.cols, term.rows);
      } catch {
        /* not laid out yet */
      }
    });

    const ro = new ResizeObserver(() => {
      if (!inputAlive) return;
      // Skip collapsed hosts. FitAddon also bails when cell width/height is 0,
      // and once metrics collapse it cannot recover without a real layout.
      if (host.clientWidth < 1 || host.clientHeight < 1) return;
      try {
        const next = recoverTerminalMetrics(term, fit);
        if (imeComposing) scheduleImeConstraint();
        if (next) void ptyResize(pane.id, next.cols, next.rows);
      } catch {
        /* during teardown */
      }
    });
    ro.observe(host);

    return () => {
      inputAlive = false;
      if (imeComposing) {
        textarea?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      }
      cancelAnimationFrame(initialFit);
      if (healTimer != null) window.clearInterval(healTimer);
      host.removeEventListener("pointerdown", onPointerRecover, true);
      ro.disconnect();
      detachInput();
      disposeClipboard();
      bellSub.dispose();
      renderSub.dispose();
      unsubAgentStatus();
      screenObserver.dispose();
      textarea?.removeEventListener("focus", handleTerminalFocus);
      textarea?.removeEventListener("compositionstart", syncImeAnchor, true);
      textarea?.removeEventListener("compositionupdate", scheduleImeConstraint);
      textarea?.removeEventListener("compositionend", finishImeComposition);
      webgl?.dispose();
      unregisterTerminal(pane.id, handle);
      if (terminals.get(pane.id) === term) terminals.delete(pane.id);
      if (searchAddons.get(pane.id) === search) searchAddons.delete(pane.id);
      // xterm 5.5 leaves zero-delay composition callbacks queued. Let those
      // finish before destroying the render service, otherwise closing a pane
      // during IME input raises an uncaught "dimensions" TypeError.
      window.setTimeout(() => term.dispose(), 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, session.id]);

  // Hidden sessions stay mounted to preserve scrollback. When a tab becomes
  // current again, re-fit (defense if metrics were ever zeroed) and focus the
  // session's remembered pane.
  useEffect(() => {
    if (currentSessionId !== session.id) return;
    const currentSession = useAppStore
      .getState()
      .sessions.find((item) => item.id === session.id);
    const panes = currentSession ? layoutPanes(currentSession.layout) : [];
    const focusedPane = useTerminalStore.getState().focusedPane[session.id];
    const preferredPane = panes.some((item) => item.id === focusedPane)
      ? focusedPane
      : (panes.find((item) => item.active)?.id ?? panes[0]?.id);

    const frame = requestAnimationFrame(() => {
      const host = hostRef.current;
      const term = termRef.current;
      const fit = fitRef.current;
      // Always re-measure when the session is shown — host may have been
      // display:none historically, or the window resized while inactive.
      // refresh() is required so TUI mouse coords match the live cell size.
      if (host && term && fit && host.clientWidth >= 1 && host.clientHeight >= 1) {
        try {
          const next = recoverTerminalMetrics(term, fit);
          if (next) void ptyResize(pane.id, next.cols, next.rows);
        } catch {
          /* not laid out yet */
        }
      }
      if (preferredPane !== pane.id) return;
      if (
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        document.querySelector(".find-bar:focus-within")
      ) {
        return;
      }
      term?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [currentSessionId, pane.id, paneIdsKey, session.id]);

  // Apply font size changes live.
  useEffect(() => {
    const applyAppearance = () => {
      const terminal = termRef.current;
      const fit = fitRef.current;
      if (!terminal || !fit) return;
      const size = resolveAppearance(
        useAppStore.getState().config,
        useUiStore.getState().appearancePreview,
      ).terminalFontSize;
      try {
        const dimensions = applyTerminalFontSize(terminal, fit, size);
        if (dimensions) {
          void ptyResize(pane.id, dimensions.cols, dimensions.rows);
        }
      } catch {
        /* host may be between layout and teardown */
      }
    };
    const unsubConfig = useAppStore.subscribe(applyAppearance);
    const unsubPreview = useUiStore.subscribe(applyAppearance);
    return () => {
      unsubConfig();
      unsubPreview();
    };
  }, [pane.id]);

  void scrollLocked;

  return (
    <div
      ref={hostRef}
      className="terminal-host"
      data-pane-id={pane.id}
      style={{ backgroundColor: GALAXY_THEME.background }}
    />
  );
}

/** Prefer canvas renderer when the UI language or OS is CJK-oriented. */
function prefersCjkTerminalFonts(): boolean {
  try {
    const lang =
      (typeof navigator !== "undefined" && (navigator.language || navigator.languages?.[0])) || "";
    if (/^(zh|ja|ko)/i.test(lang)) return true;
    // Config language from the app store (zh-CN default).
    const cfgLang = useAppStore.getState().config?.language ?? "";
    if (/^zh/i.test(cfgLang)) return true;
  } catch {
    /* ignore */
  }
  // Safe default on unknown environments: canvas is correct for CJK.
  return true;
}
