// Agent history panel: project-scoped conversations, message viewer,
// one-click resume (§5.4).
import { useEffect, useState } from "react";

import { agentOpenConversation, agentScan, agentScanCancel, agentMessages } from "../../shared/ipc/client";
import type { AgentConversation, AgentScanResult } from "../../shared/ipc/types";
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

  useEffect(() => {
    setResult(null);
    setScanning(false);
  }, [projectPath]);

  useEffect(() => {
    const p = onAgentScanDone(({ projectPath: pp }) => {
      if (pp === projectPath) setScanning(false);
    });
    return () => {
      void p.then((u) => u());
    };
  }, [projectPath]);

  const scan = async () => {
    if (!project) return;
    setScanning(true);
    setError(null);
    try {
      const res = await agentScan(project.path);
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  if (!project) {
    return <Empty text="选择项目后显示相关 Agent 会话" />;
  }

  const unavailable = result?.availability.filter((a) => !a.available) ?? [];

  return (
    <div className="panel-body">
      <div className="panel-toolbar">
        <span style={{ flex: 1, color: "var(--text-lo)", fontSize: 12 }}>
          {project.name} 的 Agent 会话
        </span>
        {scanning ? (
          <button className="btn" onClick={() => void agentScanCancel()}>
            取消
          </button>
        ) : (
          <button className="btn primary" onClick={() => void scan()}>
            {t("scanAgents")}
          </button>
        )}
      </div>
      {error && <div style={{ color: "var(--red-400)" }}>{error}</div>}
      {scanning && <div style={{ color: "var(--text-lo)" }}>{t("scanning")}</div>}
      {result && result.conversations.length === 0 && !scanning && (
        <Empty text="未发现该项目的 Agent 会话" />
      )}
      {result?.conversations.map((c) => (
        <ConversationItem
          key={`${c.agentKind}:${c.externalId}`}
          conversation={c}
          projectId={project.id}
          onView={() => setViewConv(c)}
        />
      ))}
      {unavailable.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {unavailable.map((a) => (
            <div key={a.kind} style={{ color: "var(--text-lo)", fontSize: 11, padding: "2px 0" }}>
              · {agentLabel(a.kind!)}: {a.reason}
            </div>
          ))}
        </div>
      )}
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
        <button className="btn" onClick={onView}>
          {t("viewMessages")}
        </button>
        <button
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
          ↻ {t("resume")}
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
  const [messages, setMessages] = useState<import("../../shared/ipc/types").AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
                color: m.role === "user" ? "var(--cyan-400)" : "var(--nebula-300)",
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
