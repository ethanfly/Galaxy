// Move a pane to another session tab (transactional on the backend).
import { useState } from "react";

import { paneMoveToSession } from "../../shared/ipc/client";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { Modal } from "../../shared/components/Modal";

export function MovePaneModal() {
  const movePaneId = useUiStore((s) => s.movePaneId);
  const close = useUiStore((s) => s.closeMovePane);
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!movePaneId) return null;
  const candidates = sessions.filter((s) => s.id !== currentSessionId);

  return (
    <Modal title="移动 Pane 到其他标签" onClose={close}>
      {error && <div style={{ color: "var(--red-400)", marginBottom: 8 }}>{error}</div>}
      {candidates.length === 0 && <div style={{ color: "var(--text-lo)" }}>没有其他会话标签</div>}
      <div className="result-list">
        {candidates.map((s) => (
          <div
            key={s.id}
            className="result-item"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await paneMoveToSession(movePaneId, s.id);
                // The pane left its source session — drop the stale focus
                // entry so shortcuts cannot target a pane that no longer
                // lives there. Do this before refreshSessions: if the
                // refresh throws, the stale entry must not survive to let
                // pane.close target a pane now owned by another session.
                if (currentSessionId) {
                  const ts = useTerminalStore.getState();
                  if (ts.focusedPane[currentSessionId] === movePaneId) {
                    const next = { ...ts.focusedPane };
                    delete next[currentSessionId];
                    useTerminalStore.setState({ focusedPane: next });
                  }
                }
                await useAppStore.getState().refreshSessions();
                close();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <span>{s.title}</span>
            <span className="result-hint">{busy ? "…" : ""}</span>
          </div>
        ))}
    </div>
    </Modal>
  );
}
