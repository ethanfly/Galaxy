// Global tab strip (spec §5.1): cross-project tabs, rename / close /
// close-others / drag reorder / horizontal scroll / Ctrl+W.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconAlert, IconClose, IconPlay, IconPlus } from "../../shared/icons/Icons";
import { AgentBadge } from "../terminal/AgentBadge";
import { t } from "../../shared/i18n";
import type { AgentStatus, Session } from "../../shared/ipc/types";
import { sessionDisplayTitle, sessionPrimaryAgent } from "../../shared/sessionPresentation";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { layoutPanes } from "../../shared/utils";

/** How long the “recent output” lamp stays lit after the last chunk. */
const ACTIVITY_RECENT_MS = 12_000;

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

  // Tick so activity lamps expire without needing another state change
  // (e.g. tab switch used to be the only re-render that cleared a stale lamp).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [menu, setMenu] = useState<{ session: Session; x: number; y: number } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const dragId = useRef<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

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
          const title = sessionDisplayTitle(s);
          const live = panes.some((p) => p.exitCode == null);
          const anyActivity = panes.some(
            (p) => (activity[p.id] ?? 0) > now - ACTIVITY_RECENT_MS && p.exitCode == null,
          );
          const anyMark = panes.some((p) => (marks[p.id] ?? 0) > 0);
          const agent = sessionPrimaryAgent(s, agentStatus);
          const status = pickAgentStatus(panes.map((p) => agentStatus[p.id]?.status));
          const active = s.id === currentSessionId;
          // Status lamp: prefer agent state; fall back to recent PTY activity.
          const lamp: TabLamp =
            status === "working"
              ? "working"
              : status === "blocked"
                ? "blocked"
                : status === "done"
                  ? "done"
                  : anyActivity
                    ? "activity"
                    : agent
                      ? "idle"
                      : live
                        ? "live"
                        : "off";

          return (
            <div
              key={s.id}
              role="tab"
              aria-selected={active}
              className={`tab ${active ? "active" : ""} lamp-${lamp}`}
              draggable={renameId !== s.id}
              onDragStart={() => onDragStart(s.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(s.id)}
              onClick={() => selectSession(s.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ session: s, x: e.clientX, y: e.clientY });
              }}
              title={tabTitle(title, lamp, agent)}
            >
              <span
                className={`tab-status-lamp ${lamp}`}
                aria-hidden
                title={lampLabel(lamp)}
              />
              {anyMark && <span className="tab-mark" aria-hidden="true" />}
              {agent && <AgentBadge kind={agent} />}
              {status === "working" && (
                <span className="tab-status-icon working" aria-hidden>
                  <IconPlay size={11} />
                </span>
              )}
              {status === "blocked" && (
                <span className="tab-status-icon blocked" aria-hidden>
                  <IconAlert size={11} />
                </span>
              )}
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
                <span className="tab-title">{title}</span>
              )}
              <button
                type="button"
                className="tab-close"
                aria-label={`关闭 ${title}`}
                title={`关闭 ${title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeSession(s.id);
                }}
              >
                <IconClose size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tabbar-actions">
        <button
          type="button"
          className="icon-btn"
          title={`${t("newTerminal")} (Ctrl+Shift+T)`}
          aria-label={t("newTerminal")}
          onClick={() => {
            const app = useAppStore.getState();
            if (app.currentProjectId) void app.createSession(app.currentProjectId);
          }}
        >
          <IconPlus />
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

type TabLamp = "working" | "blocked" | "done" | "activity" | "idle" | "live" | "off";

function pickAgentStatus(statuses: Array<AgentStatus | undefined>): AgentStatus | undefined {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("working")) return "working";
  if (statuses.includes("done")) return "done";
  if (statuses.includes("idle")) return "idle";
  return undefined;
}

function lampLabel(lamp: TabLamp): string {
  switch (lamp) {
    case "working":
      return "运行中";
    case "blocked":
      return "等待输入 / 授权";
    case "done":
      return "已完成";
    case "activity":
      return "近期有输出";
    case "idle":
      return "Agent 空闲";
    case "live":
      return "终端运行中";
    default:
      return "";
  }
}

function tabTitle(title: string, lamp: TabLamp, agent?: string | null): string {
  const parts = [title];
  const ll = lampLabel(lamp);
  if (ll) parts.push(ll);
  if (agent) parts.push(String(agent));
  return parts.join(" · ");
}

export type ContextMenuItem =
  | { type?: "item"; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
  | { type: "separator" };

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Clamp/reflect into the viewport: a menu opened near the bottom edge must
  // flip upward instead of being clipped by the window.
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const left = Math.min(x, Math.max(margin, viewportW - rect.width - margin));
    const top =
      y + rect.height > viewportH - margin
        ? Math.max(margin, y - rect.height)
        : y;
    setPos({ left, top });
  }, [x, y]);
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
        ref={menuRef}
        role="menu"
        style={{
          position: "fixed",
          left: pos.left,
          top: pos.top,
          background: "var(--bg-raised)",
          border: "1px solid var(--border-strong)",
          borderRadius: 4,
          minWidth: 160,
          padding: 4,
          boxShadow: "0 8px 30px rgba(0,0,0,.5)",
        }}
      >
        {items.map((item, index) => {
          if (item.type === "separator") {
            return (
              <div
                key={`sep-${index}`}
                role="separator"
                style={{
                  height: 1,
                  margin: "4px 6px",
                  background: "var(--border-strong)",
                }}
              />
            );
          }
          return (
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
              onMouseEnter={(e) => {
                if (!item.disabled) e.currentTarget.style.background = "var(--space-3)";
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
