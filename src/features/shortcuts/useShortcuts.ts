// Global keyboard shortcut routing. Bindings come from config.shortcuts;
// conflicts are already rejected backend-side before persistence.
import { useEffect } from "react";

import { eventSignature, layoutPanes, layoutSplitPaths } from "../../shared/utils";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { layoutSetRatio, paneClose, paneSplit } from "../../shared/ipc/client";

/** Commands we route. Anything unbound falls through to the terminal. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // IMEs report keyCode 229 while composing. Global chords must not
      // interrupt the composition or turn candidate-selection keystrokes into
      // destructive terminal actions (close/split/panel toggles).
      if (e.isComposing || e.keyCode === 229) return;
      const config = useAppStore.getState().config;
      if (!config) return;
      const ui = useUiStore.getState();

      // Overlays capture Esc/Enter themselves; skip routing when a modal is open
      // except for explicit close chords.
      const overlayOpen =
        ui.blockSearchOpen || ui.historySearchOpen || ui.paletteOpen || ui.settingsOpen || ui.workflowRunId != null || ui.movePaneId != null;

      const sig = eventSignature(e);
      const binding = config.shortcuts.find(
        (b) => b.enabled && b.keys.replace(/\s/g, "") && chordEqual(b.keys, sig),
      );
      if (!binding) return;
      if (overlayOpen) return;

      // In editable targets (except xterm's helper textarea which has class
      // xterm-helper-textarea), don't steal text chords.
      const el = e.target as HTMLElement | null;
      const inXterm = el?.classList?.contains("xterm-helper-textarea");
      if (isEditableTarget(e.target) && !inXterm && !binding.keys.includes("Ctrl")) return;

      e.preventDefault();
      e.stopPropagation();
      void dispatch(binding.command);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

function chordEqual(bound: string, sig: string): boolean {
  const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();
  return norm(bound) === norm(sig);
}

async function dispatch(command: string): Promise<void> {
  const app = useAppStore.getState();
  const ui = useUiStore.getState();
  const ts = useTerminalStore.getState();
  const session = app.sessions.find((s) => s.id === app.currentSessionId);

  switch (command) {
    case "terminal.new": {
      if (app.currentProjectId) await app.createSession(app.currentProjectId);
      return;
    }
    case "tab.close": {
      if (session) await app.closeSession(session.id);
      return;
    }
    case "tab.rename": {
      // Tab bar handles inline rename via context menu; palette-friendly path:
      return;
    }
    case "pane.splitRight":
    case "pane.splitDown": {
      if (!session) return;
      const focused = ts.focusedPane[session.id] ?? layoutPanes(session.layout)[0]?.id;
      if (focused) {
        const updated = await paneSplit(focused, command === "pane.splitRight" ? "row" : "column");
        const selectedPane = layoutPanes(updated.layout).find((pane) => pane.active)?.id;
        if (selectedPane) ts.setFocusedPane(updated.id, selectedPane);
        app.updateSessionLocal(updated);
      }
      return;
    }
    case "pane.close": {
      if (!session) return;
      const focused = ts.focusedPane[session.id] ?? layoutPanes(session.layout)[0]?.id;
      if (focused) {
        await paneClose(focused);
        await app.refreshSessions();
      }
      return;
    }
    case "pane.focusLeft":
    case "pane.focusRight":
    case "pane.focusUp":
    case "pane.focusDown": {
      if (!session) return;
      focusDirectional(session.id, command.replace("pane.focus", "").toLowerCase() as Direction);
      return;
    }
    case "pane.resizeLeft":
    case "pane.resizeRight":
    case "pane.resizeUp":
    case "pane.resizeDown": {
      if (!session) return;
      await resizeDirectional(
        session.id,
        session,
        command.replace("pane.resize", "").toLowerCase() as Direction,
      );
      return;
    }
    case "pane.syncInput": {
      if (session) await app.setSessionSync(session.id, !session.syncInput);
      return;
    }
    case "search.find":
      ui.openFind();
      return;
    case "search.blocks":
      ui.openBlockSearch();
      return;
    case "search.history":
      ui.openHistorySearch();
      return;
    case "command.palette":
      ui.openPalette();
      return;
    case "settings.open":
      ui.openSettings("general");
      return;
    case "panel.agent":
      ui.togglePanel("agent");
      return;
    case "panel.git":
      ui.togglePanel("git");
      return;
    case "panel.notifications":
      ui.togglePanel("notifications");
      return;
    default:
      return;
  }
}

type Direction = "left" | "right" | "up" | "down";

/** Geometric pane navigation using rendered rects (DOM data-pane-id). */
function focusDirectional(sessionId: string, dir: Direction) {
  const ts = useTerminalStore.getState();
  const sessionRoot = [...document.querySelectorAll<HTMLElement>("[data-session-id]")].find(
    (element) => element.dataset.sessionId === sessionId,
  );
  const panes = sessionRoot
    ? [...sessionRoot.querySelectorAll<HTMLElement>("[data-pane-id]")].filter(
        (element) => element.getClientRects().length > 0,
      )
    : [];
  if (panes.length === 0) return;
  const currentId = ts.focusedPane[sessionId];
  const currentEl = panes.find((el) => el.dataset.paneId === currentId) ?? panes[0];
  const cur = currentEl.getBoundingClientRect();
  const curC = { x: cur.left + cur.width / 2, y: cur.top + cur.height / 2 };
  let best: { id: string; score: number } | null = null;
  for (const el of panes) {
    if (el === currentEl) continue;
    const r = el.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const dx = c.x - curC.x;
    const dy = c.y - curC.y;
    const inDir =
      (dir === "left" && dx < -4) ||
      (dir === "right" && dx > 4) ||
      (dir === "up" && dy < -4) ||
      (dir === "down" && dy > 4);
    if (!inDir) continue;
    // Prefer panes mostly aligned on the perpendicular axis.
    const primary = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
    const secondary = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2;
    if (!best || score < best.score) best = { id: el.dataset.paneId!, score };
  }
  if (best) {
    ts.setFocusedPane(sessionId, best.id);
  }
  // Focus the xterm belonging to the newly focused pane.
  const focusId = useTerminalStore.getState().focusedPane[sessionId];
  const target = panes.find((p) => p.dataset.paneId === focusId);
  target?.querySelector("textarea")?.focus();
}

/** Alt+Shift+Arrow: adjust the nearest ancestor split weight by ±0.05. */
async function resizeDirectional(
  sessionId: string,
  session: import("../../shared/ipc/types").Session,
  dir: Direction,
) {
  const ts = useTerminalStore.getState();
  const focusedId = ts.focusedPane[sessionId] ?? layoutPanes(session.layout)[0]?.id;
  if (!focusedId) return;

  const path = findAncestorSplitPath(session.layout, focusedId);
  if (!path) return;
  const ratio = getRatioAt(session.layout, path);
  if (ratio == null) return;

  // left/up shrinks in the primary direction. If the focused pane sits in
  // the first child it maps to ratio-0.05, otherwise ratio+0.05.
  const inFirst = paneInFirst(session.layout, path, focusedId);
  const step = dir === "left" || dir === "up" ? -0.05 : 0.05;
  const adjusted = inFirst ? ratio + step : ratio - step;
  await layoutSetRatio(sessionId, path, Math.min(0.95, Math.max(0.05, adjusted)));
  await useAppStore.getState().refreshSessions();
}

function findAncestorSplitPath(
  node: import("../../shared/ipc/types").LayoutNodeRust,
  paneId: string,
  path: boolean[] = [],
): boolean[] | null {
  if ("pane" in node) return null;
  const { first, second } = node.split;
  if ("pane" in first && first.pane.id === paneId) return [...path];
  if ("pane" in second && second.pane.id === paneId) return [...path];
  return (
    findAncestorSplitPath(first, paneId, [...path, true]) ??
    findAncestorSplitPath(second, paneId, [...path, false])
  );
}

function getRatioAt(
  node: import("../../shared/ipc/types").LayoutNodeRust,
  path: boolean[],
): number | null {
  if (path.length === 0) return "split" in node ? node.split.ratio : null;
  if ("pane" in node) return null;
  return getRatioAt(path[0] ? node.split.first : node.split.second, path.slice(1));
}

function paneInFirst(
  node: import("../../shared/ipc/types").LayoutNodeRust,
  splitPath: boolean[],
  paneId: string,
): boolean {
  // Walk to the split at splitPath; determine whether paneId is in `first`.
  let cur = node;
  for (const goFirst of splitPath) {
    if ("pane" in cur) return true;
    cur = goFirst ? cur.split.first : cur.split.second;
  }
  if ("pane" in cur) return true;
  return layoutPanes(cur.split.first).some((p) => p.id === paneId);
}

export { layoutSplitPaths };
