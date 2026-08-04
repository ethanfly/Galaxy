// Agent history panel: project-scoped conversations, message viewer,
// one-click resume (§5.4). Auto-scans when the panel opens / project changes.
import { useCallback, useEffect, useRef, useState } from "react";

import { agentOpenConversation, agentScan, agentScanCancel, agentMessages } from "../../shared/ipc/client";
import type { AgentConversation, AgentMessage, AgentScanResult } from "../../shared/ipc/types";
import { onAgentScanDone } from "../../shared/ipc/events";
import { AgentBadge, agentLabel } from "../terminal/AgentBadge";
import { t, currentLang } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { formatDateTime } from "../../shared/utils";
import { Modal } from "../../shared/components/Modal";

export function AgentPanel() {
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.currentProjectId));
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<AgentScanResult | null>(null);
  const [viewConv, setViewConv] = useState<AgentConversation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectPath = project?.path;
  const scanGen = useRef(0);

  const scan = useCallback(async (path: string) => {
    const gen = ++scanGen.current;
    setScanning(true);
    setError(null);
    try {
      const res = await agentScan(path);
      if (scanGen.current !== gen) return;
      setResult(res);
    } catch (e) {
      if (scanGen.current !== gen) return;
      setError((e as Error).message);
    } finally {
      if (scanGen.current === gen) setScanning(false);
    }
  }, []);

  // Auto-scan whenever the selected project changes (or panel mounts with one).
  useEffect(() => {
    setResult(null);
    setError(null);
    if (!projectPath) {
      setScanning(false);
      return;
    }
    void scan(projectPath);
  }, [projectPath, scan]);

  useEffect(() => {
    const p = onAgentScanDone(({ projectPath: pp }) => {
      if (pp === projectPath) setScanning(false);
    });
    return () => {
      void p.then((u) => u());
    };
  }, [projectPath]);

  if (!project) {
    return <Empty text="选择项目后显示相关 Agent 会话" />;
  }

  // Only surface conversations that were actually found — hide empty / unavailable agents.
  const conversations = result?.conversations ?? [];

  return (
    <div className="panel-body">
      <div className="panel-toolbar">
        <span style={{ flex: 1, color: "var(--text-lo)", fontSize: 12 }}>
          {project.name} 的 Agent 会话
          {result && !scanning && (
            <span style={{ marginLeft: 6 }}>· {conversations.length} 条</span>
          )}
        </span>
        {scanning ? (
          <button type="button" className="btn" onClick={() => void agentScanCancel()}>
            取消
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => void scan(project.path)}>
            {t("scanAgents")}
          </button>
        )}
      </div>
      {error && <div style={{ color: "var(--red-400)" }}>{error}</div>}
      {scanning && <div style={{ color: "var(--text-lo)" }}>{t("scanning")}</div>}
      {result && conversations.length === 0 && !scanning && (
        <Empty text="未发现该项目的 Agent 会话" />
      )}
      {conversations.map((c) => (
        <ConversationItem
          key={`${c.agentKind}:${c.externalId}`}
          conversation={c}
          projectId={project.id}
          onView={() => setViewConv(c)}
        />
      ))}
      {viewConv && <MessagesModal conversation={viewConv} onClose={() => setViewConv(null)} />}
    </div>
  );
}

function ConversationItem({
  conversation: c,
  projectId,
  onView,
}: {
  conversation: AgentConversation;
  projectId: string;
  onView: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="conv-item">
      <div className="conv-summary">
        <AgentBadge kind={c.agentKind} /> {c.summary}
      </div>
      <div className="conv-meta">
        <span>{agentLabel(c.agentKind)}</span>
        {c.lastMessageAt && <span>{formatDateTime(c.lastMessageAt)}</span>}
        <span className={`agent-status-pill ${c.status}`}>{c.status}</span>
      </div>
      {err && <div style={{ color: "var(--red-400)", fontSize: 11 }}>{err}</div>}
      <div className="conv-actions">
        <button type="button" className="btn" onClick={onView}>
          {t("viewMessages")}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const session = await agentOpenConversation(projectId, c);
              await useAppStore.getState().refreshSessions();
              useAppStore.getState().selectSession(session.id);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "…" : t("resume")}
        </button>
      </div>
    </div>
  );
}

function MessagesModal({
  conversation,
  onClose,
}: {
  conversation: AgentConversation;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    agentMessages(conversation, 200)
      .then((m) => setMessages(m))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [conversation]);

  return (
    <Modal title={`${agentLabel(conversation.agentKind)} · ${conversation.summary}`} onClose={onClose} width="70vw">
      <div className="modal-body">
        {loading && <div>加载消息…</div>}
        {error && <div style={{ color: "var(--red-400)" }}>{error}</div>}
        {!loading && messages.length === 0 && <Empty text="没有可显示的消息" />}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 11,
                color: m.role === "user" ? "var(--text-hi)" : "var(--accent-soft)",
                marginBottom: 2,
              }}
            >
              {m.role === "user" ? (currentLang === "zh" ? "用户" : "User") : "Agent"}
              {m.at ? ` · ${formatDateTime(m.at)}` : ""}
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "inherit",
                color: "var(--text-md)",
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {m.text}
            </pre>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 16, color: "var(--text-lo)", textAlign: "center" }}>{text}</div>;
}
