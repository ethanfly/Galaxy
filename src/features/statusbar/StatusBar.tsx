// Status bar with configurable components: git · cwd · sessions · agent ·
// notifications · clock (order follows config, spec §5.6).
import { useEffect, useMemo, useState } from "react";

import { gitBranches, gitStatus } from "../../shared/ipc/client";
import type { GitBranch, GitStatus } from "../../shared/ipc/types";
import {
  IconAgent,
  IconAlert,
  IconBell,
  IconFolder,
  IconGit,
  IconPlay,
  IconSessions,
  IconSyncInput,
} from "../../shared/icons/Icons";
import { useBranchCheckout } from "../panels/GitPanel";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { layoutPanes } from "../../shared/utils";

const DEFAULT_COMPONENTS = ["git", "cwd", "sessions", "agent", "notifications", "clock"];
/** Always pinned to the far right of the status bar. */
const RIGHT_KINDS = new Set(["notifications", "clock"]);

export function StatusBar() {
  const config = useAppStore((s) => s.config);
  const components = useMemo(
    () => config?.statusbarComponents ?? DEFAULT_COMPONENTS,
    [config],
  );
  // Left cluster (git/cwd/…) · spacer · right cluster always 🔔 + clock
  const left = components.filter((c) => !RIGHT_KINDS.has(c));
  const right = ["notifications", "clock"] as const;

  return (
    <div className="statusbar" role="status">
      <div className="statusbar-left">
        {left.map((c, i) => (
          <StatusItem key={`${c}-${i}`} kind={c} showSep={i < left.length - 1} />
        ))}
      </div>
      <span className="status-spacer" />
      <div className="statusbar-right">
        {right.map((c, i) => (
          <StatusItem key={`r-${c}-${i}`} kind={c} showSep={i < right.length - 1} />
        ))}
      </div>
    </div>
  );
}

function StatusItem({ kind, showSep }: { kind: string; showSep: boolean }) {
  return (
    <>
      {kind === "git" && <GitComponent />}
      {kind === "cwd" && <CwdComponent />}
      {kind === "sessions" && <SessionsComponent />}
      {kind === "agent" && <AgentComponent />}
      {kind === "notifications" && <NotificationsComponent />}
      {kind === "clock" && <ClockComponent />}
      {showSep && <span className="status-sep" aria-hidden="true">·</span>}
    </>
  );
}

function GitComponent() {
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.currentProjectId));
  const togglePanel = useUiStore((s) => s.togglePanel);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const { checkout, error } = useBranchCheckout();

  const refresh = async () => {
    if (!project) return;
    try {
      setStatus(await gitStatus(project.id));
    } catch {
      /* git may be unavailable */
    }
  };

  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onRefresh = () => {
      // Debounce watcher storms; skip window focus (was thrashing with panel).
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 500);
    };
    window.addEventListener("galaxy:git-refresh", onRefresh);
    return () => {
      window.removeEventListener("galaxy:git-refresh", onRefresh);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (menuOpen && project) {
      void gitBranches(project.id).then(setBranches).catch(() => setBranches([]));
    }
  }, [menuOpen, project]);

  if (!project || !status?.isRepo) return null;
  return (
    <span style={{ position: "relative" }}>
      <span
        className="status-item clickable"
        onClick={() => togglePanel("git")}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen((v) => !v);
        }}
        title={`${t("git")} 面板 · ahead ${status.ahead} / behind ${status.behind} · ${status.changes.length} 个变更（右键切换分支）`}
      >
        <IconGit size={12} className="inline-icon" />
        <span>{status.branch ?? "detached"}</span>
        {status.changes.length > 0 && (
          <span style={{ color: "var(--amber-400)" }}>*{status.changes.length}</span>
        )}
        {status.ahead > 0 && <span style={{ color: "var(--text-hi)" }}>↑{status.ahead}</span>}
        {status.behind > 0 && <span style={{ color: "var(--amber-400)" }}>↓{status.behind}</span>}
      </span>
      {menuOpen && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: 0,
            background: "var(--bg-raised)",
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            minWidth: 200,
            padding: 4,
            zIndex: 60,
            boxShadow: "0 8px 30px rgba(0,0,0,.5)",
          }}
        >
          <div style={{ padding: "4px 8px", color: "var(--text-lo)", fontSize: 10 }}>{t("checkout")}</div>
          {error && <div style={{ padding: "4px 8px", color: "var(--red-400)", maxWidth: 280, whiteSpace: "pre-wrap" }}>{error}</div>}
          {branches.map((b) => (
            <button
              key={b.name}
              type="button"
              className="icon-btn"
              style={{ display: "flex", width: "100%", justifyContent: "flex-start", height: 24 }}
              onClick={async () => {
                if (!b.current) await checkout(project.id, b.name);
                setMenuOpen(false);
              }}
            >
              <span className={`branch-state ${b.current ? "current" : ""}`} aria-hidden="true" />
              {b.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function CwdComponent() {
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));
  if (!session) return null;
  const cwd = layoutPanes(session.layout)[0]?.cwd ?? "";
  const home = cwd.replace(/^[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+/, "~");
  return (
    <span className="status-item" title={cwd}>
      <IconFolder size={12} className="inline-icon" />
      <span>{home}</span>
    </span>
  );
}

function SessionsComponent() {
  const sessions = useAppStore((s) => s.sessions);
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));
  if (!session) return null;
  const panes = layoutPanes(session.layout).length;
  return (
    <span className="status-item">
      <IconSessions size={12} className="inline-icon" />
      <span>
        {sessions.length}s · {panes}p
      </span>
      {session.syncInput && (
        <span style={{ color: "var(--status-run)" }} title={t("syncInput")}>
          <IconSyncInput size={11} />
        </span>
      )}
    </span>
  );
}

function AgentComponent() {
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));
  const agentStatus = useTerminalStore((s) => s.agentStatus);
  const togglePanel = useUiStore((s) => s.togglePanel);
  if (!session) return null;
  const panes = layoutPanes(session.layout);
  const agents = panes
    .map((p) => ({ pane: p, a: agentStatus[p.id] }))
    .filter((x) => x.a || x.pane.agentKind);
  if (agents.length === 0) return null;
  const working = agents.filter((x) => x.a?.status === "working").length;
  const blocked = agents.filter((x) => x.a?.status === "blocked").length;
  return (
    <span
      className="status-item clickable"
      onClick={() => togglePanel("agent")}
      title={`${t("agent")} 面板 · Ctrl+Shift+A`}
    >
      <IconAgent size={12} className="inline-icon" />
      <span>{agents.length}</span>
      {working > 0 && (
        <span style={{ color: "var(--status-run)", display: "inline-flex", alignItems: "center", gap: 2 }}>
          <IconPlay size={10} />
          {working}
        </span>
      )}
      {blocked > 0 && (
        <span style={{ color: "var(--status-blocked)", display: "inline-flex", alignItems: "center", gap: 2 }}>
          <IconAlert size={10} />
          {blocked}
        </span>
      )}
    </span>
  );
}

function NotificationsComponent() {
  const unread = useAppStore((s) => s.unreadCount);
  const togglePanel = useUiStore((s) => s.togglePanel);
  return (
    <span
      className="status-item clickable"
      onClick={() => togglePanel("notifications")}
      title={t("notifications")}
    >
      <IconBell size={12} className="inline-icon" />
      {unread > 0 && <span style={{ color: "var(--amber-400)" }}>{unread}</span>}
    </span>
  );
}

function ClockComponent() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="status-item status-clock">
      {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
    </span>
  );
}
