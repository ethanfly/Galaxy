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
  ptyResize,
  ptyWrite,
  systemOpenExternal,
} from "../../shared/ipc/client";
import type { Pane, Session } from "../../shared/ipc/types";
import { registerTerminal, unregisterTerminal, useTerminalStore } from "../../shared/stores/terminalStore";
import { useAppStore } from "../../shared/stores/appStore";
import { t } from "../../shared/i18n";

const GALAXY_THEME = {
  background: "#070916",
  foreground: "#d8ddf4",
  cursor: "#9a7bf5",
  cursorAccent: "#070916",
  selectionBackground: "#2b3566",
  black: "#0c0f22",
  red: "#ef5470",
  green: "#48ded1",
  yellow: "#f5b754",
  blue: "#7da6ff",
  magenta: "#9a7bf5",
  cyan: "#59e6d9",
  white: "#b8bde0",
  brightBlack: "#35407a",
  brightRed: "#ff7d93",
  brightGreen: "#6ff2e4",
  brightYellow: "#ffd07f",
  brightBlue: "#9fbdff",
  brightMagenta: "#b9a7ff",
  brightCyan: "#84efe5",
  brightWhite: "#eef1ff",
};

export const searchAddons = new Map<string, SearchAddon>();
export const terminals = new Map<string, Terminal>();

export function TerminalView({ pane, session }: { pane: Pane; session: Session }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const scrollLocked = useTerminalStore((s) => !!s.scrollLocked[pane.id]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const config = useAppStore.getState().config;

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Mono NF", "Microsoft YaHei UI", monospace',
      fontSize: config?.terminalFontSize ?? 14,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      theme: GALAXY_THEME,
      rightClickSelectsWord: true,
      windowsMode: true,
    });
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

    // GPU renderer with graceful fallback (spec §3.2, §9.2).
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        // Context lost: release and continue on the fallback renderer.
        webgl?.dispose();
        webgl = null;
      });
      term.loadAddon(webgl);
    } catch (err) {
      console.warn("WebGL addon unavailable, using fallback renderer", err);
      webgl = null;
    }

    fitRef.current = fit;
    termRef.current = term;
    terminals.set(pane.id, term);
    searchAddons.set(pane.id, search);

    // Register replay/write surface for the batching pipeline.
    registerTerminal({
      paneId: pane.id,
      write: (data) => {
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
          });
          return;
        }
        term.write(data);
      },
      replay: (chunks) => chunks.forEach((c) => term.write(c.data)),
      truncatedNotice: () => term.write(`\r\n\x1b[33m${t("truncatedNotice")}\x1b[0m\r\n`),
    });

    // Input: direct, unbatched. Sync-input fans out to the whole session.
    const inputSub = term.onData((data) => {
      const sess = useAppStore.getState().sessions.find((s) => s.id === session.id);
      if (sess?.syncInput) {
        void ptyBroadcast(session.id, data);
      } else {
        void ptyWrite(pane.id, data);
      }
    });
    const bellSub = term.onBell(() => {
      useTerminalStore.getState().addMark(pane.id);
    });

    // Initial sizing after first paint.
    const initialFit = requestAnimationFrame(() => {
      try {
        fit.fit();
        void ptyResize(pane.id, term.cols, term.rows);
      } catch {
        /* not laid out yet */
      }
      term.focus();
    });

    const ro = new ResizeObserver(() => {
      try {
        const before = `${term.cols}x${term.rows}`;
        fit.fit();
        if (`${term.cols}x${term.rows}` !== before) {
          void ptyResize(pane.id, term.cols, term.rows);
        }
      } catch {
        /* during teardown */
      }
    });
    ro.observe(host);

    return () => {
      cancelAnimationFrame(initialFit);
      ro.disconnect();
      inputSub.dispose();
      bellSub.dispose();
      webgl?.dispose();
      unregisterTerminal(pane.id);
      terminals.delete(pane.id);
      searchAddons.delete(pane.id);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, session.id]);

  // Apply font size changes live.
  useEffect(() => {
    const unsub = useAppStore.subscribe((s) => {
      const size = s.config?.terminalFontSize;
      if (size && termRef.current && termRef.current.options.fontSize !== size) {
        termRef.current.options.fontSize = size;
        try {
          fitRef.current?.fit();
          void ptyResize(pane.id, termRef.current.cols, termRef.current.rows);
        } catch {
          /* noop */
        }
      }
    });
    return unsub;
  }, [pane.id]);

  void scrollLocked;

  return <div ref={hostRef} className="terminal-host" data-pane-id={pane.id} />;
}
