// Status bar with configurable components: git · cwd · sessions · agent ·
// notifications · clock (order follows config, spec §5.6).
import { useEffect, useMemo, useState } from "react";

import { gitBranches, gitStatus } from "../../shared/ipc/client";
import type { GitBranch, GitStatus } from "../../shared/ipc/types";
import { useBranchCheckout } from "../panels/GitPanel";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { layoutPanes } from "../../shared/utils";

export function StatusBar() {
  const config = useAppStore((s) => s.config);
  const components = useMemo(
    () => config?.statusbarComponents ?? ["git", "cwd", "sessions", "agent", "notifications", "clock"],
    [config],
  );
  return (
    <div className="statusbar" role="status">
      {components.map((c, i) => (
        <StatusItem key={`${c}-${i}`} kind={c} isLast={components.length - 1 === i} />
      ))}
    </div>
  );
}

function StatusItem({ kind, isLast }: { kind: string; isLast: boolean }) {
  return (
    <>
      {kind === "git" && <GitComponent />}
      {kind === "cwd" && <CwdComponent />}
      {kind === "sessions" && <SessionsComponent />}
      {kind === "agent" && <AgentComponent />}
      {kind === "notifications" && <NotificationsComponent isLast={isLast} />}
      {kind === "clock" && <ClockComponent isLast={isLast} />}
      {!isLast && <span style={{ color: "var(--border-strong)" }}>·</span>}
    </>
  );
}

function GitComponent() {
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.currentProjectId));
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
    const onRefresh = () => void refresh();
    window.addEventListener("galaxy:git-refresh", onRefresh);
    window.addEventListener("focus", onRefresh);
    return () => {
      window.removeEventListener("galaxy:git-refresh", onRefresh);
      window.removeEventListener("focus", onRefresh);
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
        onClick={() => setMenuOpen((v) => !v)}
        title={`ahead ${status.ahead} / behind ${status.behind} · ${status.changes.length} 个变更`}
      >
        ⑂ {status.branch ?? "detached"}
        {status.changes.length > 0 && <span style={{ color: "var(--amber-400)" }}> ✱{status.changes.length}</span>}
        {status.ahead > 0 && <span style={{ color: "var(--cyan-400)" }}> ↑{status.ahead}</span>}
        {status.behind > 0 && <span style={{ color: "var(--amber-400)" }}> ↓{status.behind}</span>}
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
              className="icon-btn"
              style={{ display: "flex", width: "100%", justifyContent: "flex-start", height: 24 }}
              onClick={async () => {
                if (!b.current) await checkout(project.id, b.name);
                setMenuOpen(false);
              }}
            >
              {b.current ? "● " : "○ "}
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
  return <span className="status-item" title={cwd}>📁 {home}</span>;
}

function SessionsComponent() {
  const sessions = useAppStore((s) => s.sessions);
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));
  if (!session) return null;
  const panes = layoutPanes(session.layout).length;
  return (
    <span className="status-item">
      ◫ {sessions.length} session{sessions.length === 1 ? "" : "s"} · {panes} pane{panes === 1 ? "" : "s"}
      {session.syncInput && <span style={{ color: "var(--cyan-400)" }}> ⇉</span>}
    </span>
  );
}

function AgentComponent() {
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));
  const agentStatus = useTerminalStore((s) => s.agentStatus);
  if (!session) return null;
  const panes = layoutPanes(session.layout);
  const agents = panes
    .map((p) => ({ pane: p, a: agentStatus[p.id] }))
    .filter((x) => x.a || x.pane.agentKind);
  if (agents.length === 0) return null;
  const working = agents.filter((x) => x.a?.status === "working").length;
  const blocked = agents.filter((x) => x.a?.status === "blocked").length;
  return (
    <span className="status-item">
      ✦ {agents.length} agent{working > 0 && <span style={{ color: "var(--status-run)" }}> ▶{working}</span>}
      {blocked > 0 && <span style={{ color: "var(--status-blocked)" }}> ❗{blocked}</span>}
    </span>
  );
}

function NotificationsComponent({ isLast }: { isLast: boolean }) {
  const unread = useAppStore((s) => s.unreadCount);
  const togglePanel = useUiStore((s) => s.togglePanel);
  return (
    <>
      {!isLast && <span className="status-spacer" />}
      <span
        className="status-item clickable"
        onClick={() => togglePanel("notifications")}
        title={t("notifications")}
      >
        🔔{unread > 0 && <span style={{ color: "var(--amber-400)" }}> {unread}</span>}
      </span>
    </>
  );
}

function ClockComponent({ isLast }: { isLast: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  void isLast;
  const pad = (n: number) => String(n).padStart(2, "0");
  return <span className="status-item">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>;
}
