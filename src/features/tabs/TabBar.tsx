// Global tab strip (spec §5.1): cross-project tabs, rename / close /
// close-others / drag reorder / horizontal scroll / Ctrl+W.
import { useCallback, useRef, useState } from "react";

import { AgentBadge } from "../terminal/AgentBadge";
import { t } from "../../shared/i18n";
import type { Session } from "../../shared/ipc/types";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { layoutPanes } from "../../shared/utils";

export function TabBar() {
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const selectSession = useAppStore((s) => s.selectSession);
  const closeSession = useAppStore((s) => s.closeSession);
  const renameSession = useAppStore((s) => s.renameSession);
  const reorderSessions = useAppStore((s) => s.reorderSessions);
  const activity = useTerminalStore((s) => s.activity);
  const agentStatus = useTerminalStore((s) => s.agentStatus);
  const marks = useTerminalStore((s) => s.marks);

  const [menu, setMenu] = useState<{ session: Session; x: number; y: number } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const dragId = useRef<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const displayTitle = useCallback((s: Session) => {
    const first = layoutPanes(s.layout)[0];
    const dyn = first?.title?.trim();
    return dyn || s.title || t("terminal") + " ?";
  }, []);

  const onDragStart = (id: string) => {
    dragId.current = id;
  };

  const onDrop = (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetId) return;
    const ids = sessions.map((s) => s.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, from);
    void reorderSessions(ids);
  };

  const commitRename = async () => {
    if (renameId && renameValue.trim()) {
      await renameSession(renameId, renameValue.trim());
    }
    setRenameId(null);
  };

  const closeOthers = async (keepId: string) => {
    for (const s of sessions) {
      if (s.id !== keepId) await closeSession(s.id);
    }
    setMenu(null);
  };

  return (
    <div className="tabbar" role="tablist" aria-label="会话标签">
      <div
        className="tab-strip"
        ref={stripRef}
        onWheel={(e) => {
          // Lateral wheel → horizontal scroll through tabs.
          if (stripRef.current) stripRef.current.scrollLeft += e.deltaY;
        }}
      >
        {sessions.map((s) => {
          const panes = layoutPanes(s.layout);
          const anyActivity = panes.some(
            (p) => (activity[p.id] ?? 0) > Date.now() - 1500 && p.exitCode == null,
          );
          const anyMark = panes.some((p) => (marks[p.id] ?? 0) > 0);
          const agent = panes
            .map((p) => agentStatus[p.id]?.kind ?? p.agentKind)
            .find(Boolean);
          const status = panes
            .map((p) => agentStatus[p.id]?.status)
            .find((st) => st === "working" || st === "blocked");
          return (
            <div
              key={s.id}
              role="tab"
              aria-selected={s.id === currentSessionId}
              className={`tab ${s.id === currentSessionId ? "active" : ""}`}
              draggable={renameId !== s.id}
              onDragStart={() => onDragStart(s.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(s.id)}
              onClick={() => selectSession(s.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ session: s, x: e.clientX, y: e.clientY });
              }}
              title={s.title}
            >
              {anyActivity && <span className="activity-dot" aria-hidden />}
              {anyMark && <span style={{ color: "var(--amber-400)" }}>◆</span>}
              {agent && <AgentBadge kind={agent} />}
              {status === "working" && <span style={{ color: "var(--status-run)" }}>▶</span>}
              {status === "blocked" && <span style={{ color: "var(--status-blocked)" }}>❗</span>}
              {renameId === s.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename();
                    if (e.key === "Escape") setRenameId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 100 }}
                />
              ) : (
                <span className="tab-title">{displayTitle(s)}</span>
              )}
              <button
                className="tab-close"
                aria-label={`关闭 ${displayTitle(s)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeSession(s.id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="tabbar-actions">
        <button
          className="icon-btn"
          title={`${t("newTerminal")} (Ctrl+Shift+T)`}
          onClick={() => {
            const app = useAppStore.getState();
            if (app.currentProjectId) void app.createSession(app.currentProjectId);
          }}
        >
          ＋
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: t("rename"),
              onClick: () => {
                setRenameId(menu.session.id);
                setRenameValue(menu.session.title);
                setMenu(null);
              },
            },
            { label: t("close"), onClick: () => void closeSession(menu.session.id) },
            { label: t("closeOthers"), onClick: () => void closeOthers(menu.session.id) },
          ]}
        />
      )}
    </div>
  );
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: Array<{ label: string; onClick: () => void; danger?: boolean; disabled?: boolean }>;
  onClose: () => void;
}) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 90 }}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        role="menu"
        style={{
          position: "fixed",
          left: x,
          top: y,
          background: "var(--bg-raised)",
          border: "1px solid var(--border-strong)",
          borderRadius: 4,
          minWidth: 160,
          padding: 4,
          boxShadow: "0 8px 30px rgba(0,0,0,.5)",
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: 0,
              background: "transparent",
              color: item.danger ? "var(--red-400)" : "var(--text-md)",
              padding: "6px 10px",
              cursor: item.disabled ? "default" : "pointer",
              borderRadius: 2,
              opacity: item.disabled ? 0.5 : 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--space-3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => {
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
