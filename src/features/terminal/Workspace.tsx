// Layout-tree driven workspace: recursive split containers, draggable
// dividers (weights only — terminals are never rebuilt), pane chrome with
// split/close/move/sync actions.
import { useCallback, useRef, useState, type HTMLAttributes } from "react";

import {
  IconClose,
  IconMove,
  IconPrompt,
  IconSplitDown,
  IconSplitRight,
  IconSyncInput,
} from "../../shared/icons/Icons";
import { layoutSetRatio, paneClose, paneSplit } from "../../shared/ipc/client";
import type { LayoutNodeRust, Pane, Session } from "../../shared/ipc/types";
import { TerminalView, terminals } from "./TerminalView";
import { ContextMenu } from "../tabs/TabBar";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { layoutPanes, unwrapPane } from "../../shared/utils";
import { copyTerminalSelection, pasteTerminalClipboard } from "./terminalClipboard";

export function Workspace() {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const createSession = useAppStore((s) => s.createSession);
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  if (sessions.length === 0 || !currentSessionId) {
    return (
      <div className="empty-workspace">
        <div className="big-glyph">✧</div>
        <div>{sessions.length === 0 ? "从左侧添加项目并新建终端" : "选择一个会话标签"}</div>
        {currentProjectId && (
          <button className="btn primary" onClick={() => void createSession(currentProjectId)}>
            {t("newTerminal")}
          </button>
        )}
      </div>
    );
  }

  // Keep every loaded session's terminals mounted. Inactive sessions use
  // visibility:hidden (not display:none) so xterm cell metrics stay valid —
  // display:none collapses the host to 0×0, which permanently breaks FitAddon
  // recovery and TUI mouse tracking (coords divide by cell width/height).
  // Mirrors terminal-surface ↔ insights-surface stacking in App.tsx.
  return (
    <div className="session-stack" data-testid="workspace-instance">
      {sessions.map((session) => {
        const active = session.id === currentSessionId;
        return (
          <div
            key={session.id}
            data-session-id={session.id}
            className={`session-surface ${active ? "active" : "inactive"}`}
            aria-hidden={!active}
            // Prevent focus / hit-test leakage into stacked inactive sessions.
            {...(!active ? ({ inert: "" } as HTMLAttributes<HTMLDivElement>) : {})}
          >
            <LayoutRenderer node={session.layout} session={session} path={[]} />
          </div>
        );
      })}
    </div>
  );
}

function LayoutRenderer({
  node,
  session,
  path,
}: {
  node: LayoutNodeRust;
  session: Session;
  path: boolean[];
}) {
  if ("pane" in node) {
    const pane = unwrapPane(node.pane as Parameters<typeof unwrapPane>[0]);
    if (!pane) return null;
    return <PaneCell pane={pane} session={session} />;
  }
  const { direction, ratio, first, second } = node.split;
  return (
    <SplitContainer
      direction={direction}
      ratio={ratio}
      first={<LayoutRenderer node={first} session={session} path={[...path, true]} />}
      second={<LayoutRenderer node={second} session={session} path={[...path, false]} />}
      sessionId={session.id}
      path={path}
    />
  );
}

function SplitContainer({
  direction,
  ratio,
  first,
  second,
  sessionId,
  path,
}: {
  direction: "row" | "column";
  ratio: number;
  first: React.ReactNode;
  second: React.ReactNode;
  sessionId: string;
  path: boolean[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const onDividerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const rel =
          direction === "row"
            ? (ev.clientX - rect.left) / rect.width
            : (ev.clientY - rect.top) / rect.height;
        setDragRatio(Math.min(0.95, Math.max(0.05, rel)));
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDragging(false);
        setDragRatio((current) => {
          if (current != null) void layoutSetRatio(sessionId, path, current);
          return null;
        });
        void ev;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [direction, sessionId, path],
  );

  // Weight-only updates — children are not remounted during drags.
  const shown = dragRatio ?? ratio;
  return (
    <div ref={containerRef} className={`split-container ${direction}`}>
      <div
        className="pane-wrapper"
        style={direction === "row" ? { width: `${shown * 100}%` } : { height: `${shown * 100}%` }}
      >
        {first}
      </div>
      <div
        className={`divider ${direction} ${dragging ? "dragging" : ""}`}
        role="separator"
        aria-orientation={direction === "row" ? "vertical" : "horizontal"}
        onPointerDown={onDividerPointerDown}
      />
      <div className="pane-wrapper" style={{ flex: 1 }}>
        {second}
      </div>
    </div>
  );
}

function PaneCell({ pane, session }: { pane: Pane; session: Session }) {
  const focused = useTerminalStore((s) => s.focusedPane[session.id] === pane.id);
  const setFocusedPane = useTerminalStore((s) => s.setFocusedPane);
  const updateSessionLocal = useAppStore((s) => s.updateSessionLocal);
  const setSessionSync = useAppStore((s) => s.setSessionSync);
  const openMovePane = useUiStore((s) => s.openMovePane);
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);

  const doSplit = async (direction: "row" | "column") => {
    const updated = await paneSplit(pane.id, direction);
    const selectedPane = layoutPanes(updated.layout).find((item) => item.active)?.id;
    if (selectedPane) setFocusedPane(updated.id, selectedPane);
    updateSessionLocal(updated);
  };

  const doClose = async () => {
    await paneClose(pane.id);
    await useAppStore.getState().refreshSessions();
  };

  const openContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setFocusedPane(session.id, pane.id);
    // rightClickSelectsWord may have just updated the selection; snapshot for the menu.
    const term = terminals.get(pane.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      hasSelection: Boolean(term?.hasSelection() && term.getSelection()),
    });
  };

  return (
    <div
      className={`pane-cell ${focused ? "focused" : ""}`}
      onClick={() => setFocusedPane(session.id, pane.id)}
      onPointerDown={() => setFocusedPane(session.id, pane.id)}
      onContextMenu={openContextMenu}
    >
      <div className="pane-chrome">
        <span className="pane-shell-icon" style={{ color: "var(--text-lo)" }}>
          <IconPrompt size={12} />
        </span>
        <span className="pane-title" title={pane.cwd}>
          {pane.title || pane.profile?.name || "终端"}
        </span>
        {pane.exitCode != null && (
          <span style={{ color: "var(--red-400)" }}>exit {pane.exitCode}</span>
        )}
        <button type="button" className="icon-btn" title={t("splitRight")} aria-label={t("splitRight")} onClick={() => void doSplit("row")}>
          <IconSplitRight />
        </button>
        <button type="button" className="icon-btn" title={t("splitDown")} aria-label={t("splitDown")} onClick={() => void doSplit("column")}>
          <IconSplitDown />
        </button>
        <button type="button" className="icon-btn" title={t("movePane")} aria-label={t("movePane")} onClick={() => openMovePane(pane.id)}>
          <IconMove />
        </button>
        <button
          type="button"
          className={`icon-btn ${session.syncInput ? "active" : ""}`}
          title={t("syncInput")}
          aria-label={t("syncInput")}
          aria-pressed={session.syncInput}
          onClick={() => void setSessionSync(session.id, !session.syncInput)}
        >
          <IconSyncInput />
        </button>
        {layoutPanes(session.layout).length > 1 && (
          <button type="button" className="icon-btn" title={t("close")} aria-label={t("close")} onClick={() => void doClose()}>
            <IconClose />
          </button>
        )}
      </div>
      <TerminalView pane={pane} session={session} />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: t("copy"),
              disabled: !menu.hasSelection,
              onClick: () => {
                const term = terminals.get(pane.id);
                if (term) copyTerminalSelection(term);
              },
            },
            {
              label: t("paste"),
              onClick: () => {
                const term = terminals.get(pane.id);
                if (term) void pasteTerminalClipboard(term);
              },
            },
            { type: "separator" },
            { label: t("splitRight"), onClick: () => void doSplit("row") },
            { label: t("splitDown"), onClick: () => void doSplit("column") },
            { label: t("movePane"), onClick: () => openMovePane(pane.id) },
            {
              label: t("syncInput") + (session.syncInput ? ` · ${t("enabledState")}` : ""),
              onClick: () => void setSessionSync(session.id, !session.syncInput),
            },
            { label: t("close"), danger: true, onClick: () => void doClose() },
          ]}
        />
      )}
    </div>
  );
}
