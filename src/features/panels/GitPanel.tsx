// Git panel: branch, ahead/behind, change counts and file list (§5.5).
import { useCallback, useEffect, useRef, useState } from "react";

import { gitBranches, gitCheckout, gitStatus } from "../../shared/ipc/client";
import type { GitBranch, GitFileChange, GitStatus } from "../../shared/ipc/types";
import { IconCheck, IconGit, IconRefresh } from "../../shared/icons/Icons";
import { t } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";

/** Coalesce watcher storms so the toolbar never strobes on every .git tick. */
const AUTO_REFRESH_MS = 600;

export function GitPanel() {
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.currentProjectId));
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectId = project?.id;

  const inFlight = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const refresh = useCallback(async (pid: string, mode: "manual" | "auto" = "auto") => {
    // Auto refreshes never toggle `loading` — that was the strobing "刷新" button.
    if (mode === "auto" && inFlight.current) return;
    inFlight.current = true;
    if (mode === "manual") {
      setLoading(true);
      setError(null);
    }
    try {
      const [nextStatus, nextBranches] = await Promise.all([
        gitStatus(pid),
        gitBranches(pid).catch(() => [] as GitBranch[]),
      ]);
      // Drop stale responses if the user switched projects mid-flight.
      if (projectIdRef.current !== pid) return;
      setStatus(nextStatus);
      setBranches(nextBranches);
    } catch (e) {
      if (projectIdRef.current === pid && mode === "manual") {
        setError((e as Error).message);
      }
    } finally {
      inFlight.current = false;
      if (mode === "manual") setLoading(false);
    }
  }, []);

  const scheduleAutoRefresh = useCallback(
    (pid: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        void refresh(pid, "auto");
      }, AUTO_REFRESH_MS);
    },
    [refresh],
  );

  useEffect(() => {
    if (projectId) void refresh(projectId, "manual");
    else {
      setStatus(null);
      setBranches([]);
    }
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [projectId, refresh]);

  useEffect(() => {
    const onRefresh = () => {
      const pid = projectIdRef.current;
      if (pid) scheduleAutoRefresh(pid);
    };
    // Only react to git watcher / external signals — not window focus
    // (focus caused extra flicker when clicking inside the panel).
    window.addEventListener("galaxy:git-refresh", onRefresh);
    return () => window.removeEventListener("galaxy:git-refresh", onRefresh);
  }, [scheduleAutoRefresh]);

  const onCheckout = async (branch: string) => {
    if (!projectId || checkingOut) return;
    setCheckingOut(branch);
    setError(null);
    try {
      await gitCheckout(projectId, branch);
      window.dispatchEvent(new CustomEvent("galaxy:git-refresh"));
      await refresh(projectId, "auto");
    } catch (e) {
      const msg =
        (e as { detail?: string; message?: string }).detail ?? (e as Error).message;
      setError(msg);
    } finally {
      setCheckingOut(null);
    }
  };

  if (!project) return <div className="panel-body"><Empty text="选择项目后显示 Git 状态" /></div>;
  if (status && !status.gitAvailable) {
    return <div className="panel-body"><Empty text="未检测到 git 命令，请安装 Git" /></div>;
  }
  if (status && !status.isRepo) {
    return (
      <div className="panel-body">
        <Empty text={`${project.name} 不是 Git 仓库`} />
        <div style={{ textAlign: "center", color: "var(--text-lo)", fontSize: 12 }}>
          在终端中运行 <code className="kbd">git init</code> 以启用
        </div>
      </div>
    );
  }

  const staged = status?.changes.filter((c) => c.staged) ?? [];
  const unstaged = status?.changes.filter((c) => !c.staged && c.status !== "?") ?? [];
  const untracked = status?.changes.filter((c) => c.status === "?") ?? [];

  return (
    <div className="panel-body git-panel">
      <div className="panel-toolbar git-toolbar">
        <span className="git-branch-label" title={status?.branch ?? "HEAD detached"}>
          <IconGit size={12} className="inline-icon" />
          <span>{status?.branch ?? "HEAD detached"}</span>
        </span>
        {(status?.ahead ?? 0) > 0 && <span className="kbd">↑{status!.ahead}</span>}
        {(status?.behind ?? 0) > 0 && <span className="kbd">↓{status!.behind}</span>}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn git-refresh-btn"
          disabled={loading}
          title={t("refresh")}
          onClick={() => void refresh(project.id, "manual")}
        >
          <IconRefresh size={12} className="inline-icon" />
          <span>{loading ? "刷新中" : t("refresh")}</span>
        </button>
      </div>

      {error && (
        <div className="git-error" role="alert">
          {error}
        </div>
      )}

      {/* Branch switcher lives in-panel so statusbar popups aren't blocked */}
      <div className="git-section">
        <div className="git-section-title">{t("checkout")}</div>
        {branches.length === 0 ? (
          <div className="git-muted">暂无分支列表</div>
        ) : (
          <div className="git-branch-list" role="listbox" aria-label={t("checkout")}>
            {branches.map((b) => (
              <button
                key={b.name}
                type="button"
                role="option"
                aria-selected={b.current}
                className={`git-branch-item ${b.current ? "current" : ""}`}
                disabled={b.current || checkingOut === b.name}
                title={b.current ? "当前分支" : `切换到 ${b.name}`}
                onClick={() => void onCheckout(b.name)}
              >
                <span
                  className={`git-branch-mark ${b.current ? "current" : ""} ${checkingOut === b.name ? "loading" : ""}`}
                  aria-hidden="true"
                />
                <span className="git-branch-name">{b.name}</span>
                {b.current && <span className="git-branch-tag">当前</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {status?.changes.length === 0 && (
        <div className="git-muted git-clean-state" style={{ padding: "8px 0" }}>
          <IconCheck size={13} className="inline-icon" />
          <span>工作区干净</span>
        </div>
      )}
      <ChangeGroup title={`已暂存 (${staged.length})`} files={staged} cls="staged" />
      <ChangeGroup title={`未暂存 (${unstaged.length})`} files={unstaged} cls="unstaged" />
      <ChangeGroup title={`未跟踪 (${untracked.length})`} files={untracked} cls="untracked" />
    </div>
  );
}

function ChangeGroup({ title, files, cls }: { title: string; files: GitFileChange[]; cls: string }) {
  if (files.length === 0) return null;
  return (
    <div className="git-section">
      <div className="git-section-title">{title}</div>
      {files.map((f) => (
        <div key={f.path} className="git-file" title={f.path}>
          <span className={`git-status-badge ${cls}`}>{f.status === "?" ? "+" : f.status}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.path}</span>
        </div>
      ))}
    </div>
  );
}

export function useBranchCheckout() {
  const [error, setError] = useState<string | null>(null);
  const checkout = async (projectId: string, branch: string): Promise<boolean> => {
    setError(null);
    try {
      await gitCheckout(projectId, branch);
      window.dispatchEvent(new CustomEvent("galaxy:git-refresh"));
      return true;
    } catch (e) {
      const msg = (e as { detail?: string; message?: string }).detail ?? (e as Error).message;
      setError(msg);
      return false;
    }
  };
  return { checkout, error, clearError: () => setError(null) };
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 16, color: "var(--text-lo)", textAlign: "center" }}>{text}</div>;
}
