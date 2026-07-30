// Git panel: branch, ahead/behind, change counts and file list (§5.5).
import { useEffect, useState } from "react";

import { gitCheckout, gitStatus } from "../../shared/ipc/client";
import type { GitFileChange, GitStatus } from "../../shared/ipc/types";
import { useAppStore } from "../../shared/stores/appStore";

export function GitPanel() {
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.currentProjectId));
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectId = project?.id;

  const refresh = async (pid: string) => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await gitStatus(pid));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) void refresh(projectId);
    else setStatus(null);
  }, [projectId]);

  useEffect(() => {
    const onRefresh = () => {
      if (projectId) void refresh(projectId);
    };
    window.addEventListener("galaxy:git-refresh", onRefresh);
    window.addEventListener("focus", onRefresh);
    return () => {
      window.removeEventListener("galaxy:git-refresh", onRefresh);
      window.removeEventListener("focus", onRefresh);
    };
  }, [projectId]);

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
    <div className="panel-body">
      <div className="panel-toolbar">
        <span style={{ color: "var(--cyan-400)" }}>⑂ {status?.branch ?? "HEAD detached"}</span>
        {(status?.ahead ?? 0) > 0 && <span className="kbd">↑{status!.ahead}</span>}
        {(status?.behind ?? 0) > 0 && <span className="kbd">↓{status!.behind}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={loading} onClick={() => void refresh(project.id)}>
          {loading ? "…" : "刷新"}
        </button>
      </div>
      {error && <div style={{ color: "var(--red-400)" }}>{error}</div>}
      {status?.changes.length === 0 && (
        <div style={{ color: "var(--text-lo)", padding: "8px 0" }}>工作区干净 ✓</div>
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
    <div>
      <div style={{ color: "var(--text-lo)", fontSize: 11, padding: "6px 0 2px" }}>{title}</div>
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
