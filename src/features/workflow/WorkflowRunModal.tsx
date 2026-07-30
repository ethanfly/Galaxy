// Workflow run dialog: typed param form + resolved command preview + target
// directory + confirmation (§5.6).
import { useEffect, useMemo, useState } from "react";

import { workflowResolve, workflowRun } from "../../shared/ipc/client";
import type { ResolvedWorkflow, Workflow } from "../../shared/ipc/types";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { Modal } from "../../shared/components/Modal";
import { layoutPanes } from "../../shared/utils";
import { t } from "../../shared/i18n";

export function WorkflowRunModal() {
  const workflowId = useUiStore((s) => s.workflowRunId);
  const close = useUiStore((s) => s.closeWorkflowRun);
  const config = useAppStore((s) => s.config);
  const workflow = config?.workflows.find((w) => w.id === workflowId);

  if (!workflow) return null;
  return <WorkflowRunInner key={workflow.id} workflow={workflow} onClose={close} />;
}

function WorkflowRunInner({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of workflow.params) init[p.name] = p.default ?? "";
    return init;
  });
  const [resolved, setResolved] = useState<ResolvedWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.currentProjectId));

  const cwd = useMemo(() => {
    if (workflow.cwd == null || workflow.cwd === "project") return project?.path;
    if (workflow.cwd === "currentPane") {
      return session ? layoutPanes(session.layout)[0]?.cwd : project?.path;
    }
    if (typeof workflow.cwd === "object" && "fixed" in workflow.cwd) return workflow.cwd.fixed;
    return project?.path;
  }, [workflow.cwd, project, session]);

  // Live preview of the fully resolved command (§5.6).
  useEffect(() => {
    const id = setTimeout(() => {
      workflowResolve(workflow.id, values, cwd)
        .then((r) => {
          setResolved(r);
          setError(null);
        })
        .catch((e) => {
          setResolved(null);
          setError((e as Error).message);
        });
    }, 120);
    return () => clearTimeout(id);
  }, [values, workflow.id, cwd]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const focused = session ? useTerminalStore.getState().focusedPane[session.id] : undefined;
      const panes = session ? layoutPanes(session.layout) : [];
      const target = focused ?? panes[0]?.id;
      if (!target) throw new Error("当前会话没有可用 Pane");
      await workflowRun(workflow.id, values, target, cwd);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${t("run")} · ${workflow.name}`} onClose={onClose} width={520}>
      <div className="modal-body">
        {workflow.description && (
          <p style={{ color: "var(--text-lo)", marginTop: 0 }}>{workflow.description}</p>
        )}
        {workflow.params.map((p) => (
          <div className="form-row" key={p.name}>
            <label>
              {p.name}
              {p.required ? " *" : ""}
            </label>
            <div className="form-value">
              {typeof p.type === "object" && "choice" in p.type ? (
                <select
                  value={values[p.name] ?? ""}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                >
                  <option value="">—</option>
                  {p.type.choice.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              ) : p.type === "bool" ? (
                <input
                  type="checkbox"
                  checked={["true", "1"].includes(values[p.name] ?? "")}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.checked ? "true" : "false" })}
                />
              ) : (
                <input
                  type="text"
                  value={values[p.name] ?? ""}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                  placeholder={p.default ?? ""}
                />
              )}
            </div>
          </div>
        ))}
        <div className="form-row">
          <label>解析后的命令</label>
          <div className="form-value">
            <code className="kbd" style={{ padding: "4px 8px", wordBreak: "break-all" }}>
              {resolved?.command ?? "…"}
            </code>
          </div>
        </div>
        <div className="form-row">
          <label>目标目录</label>
          <div className="form-value">
            <span style={{ color: "var(--text-md)" }}>{cwd ?? project?.path ?? "—"}</span>
          </div>
        </div>
        {error && <p style={{ color: "var(--red-400)" }}>{error}</p>}
      </div>
      <div className="modal-footer">
        <button className="btn" onClick={onClose}>{t("cancel")}</button>
        <button className="btn primary" disabled={!resolved || busy} onClick={() => void run()}>
          {t("run")}
        </button>
      </div>
    </Modal>
  );
}
