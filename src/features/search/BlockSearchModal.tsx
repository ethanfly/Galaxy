// Ctrl+Shift+F — persisted command block search (§5.3).
import { useCallback, useEffect, useState } from "react";

import { blockSearch } from "../../shared/ipc/client";
import type { CommandBlock } from "../../shared/ipc/types";
import { useUiStore } from "../../shared/stores/uiStore";
import { useAppStore } from "../../shared/stores/appStore";
import { Modal } from "../../shared/components/Modal";
import { formatDateTime, layoutPanes, truncate } from "../../shared/utils";
import { t } from "../../shared/i18n";

export function BlockSearchModal() {
  const open = useUiStore((s) => s.blockSearchOpen);
  const close = useUiStore((s) => s.closeOverlays);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommandBlock[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);

  const search = useCallback(async (q: string, fav: boolean) => {
    setResults((await blockSearch(q, fav)).slice(-100).reverse());
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      void search("", false);
    }
  }, [open, search]);

  if (!open) return null;

  return (
    <Modal title={`${t("search")} — 命令块 (Ctrl+Shift+F)`} onClose={close} width="64vw">
      <div className="modal-body">
        <div style={{ display: "flex", gap: 8 }}>
          <input
            autoFocus
            type="search"
            placeholder="搜索命令与输出…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              void search(e.target.value, showFavorites);
            }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-md)" }}>
            <input
              type="checkbox"
              checked={showFavorites}
              onChange={(e) => {
                setShowFavorites(e.target.checked);
                void search(query, e.target.checked);
              }}
            />
            仅收藏
          </label>
        </div>
        <ResultsList results={results} onClose={close} />
      </div>
    </Modal>
  );
}

function ResultsList({ results, onClose }: { results: CommandBlock[]; onClose: () => void }) {
  return (
    <div className="result-list" style={{ maxHeight: "55vh", overflowY: "auto" }}>
      {results.length === 0 && <div style={{ color: "var(--text-lo)", padding: 8 }}>无匹配结果</div>}
      {results.map((b) => (
        <div key={b.id} className="result-item" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <code>{truncate(b.command || "(未捕获命令)", 96)}</code>
            <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 2 }}>
              {b.favorite ? "★ " : ""}
              {formatDateTime(b.startedAt)}
              {b.exitCode != null ? ` · exit ${b.exitCode}` : ""}
              {b.output ? ` · ${truncate(b.output.replace(/\s+/g, " "), 80)}` : ""}
            </div>
          </div>
          <span className="result-hint">
            <button
              className="icon-btn"
              title="复制命令"
              onClick={() => void navigator.clipboard.writeText(b.command)}
            >
              ⧉
            </button>
            <button
              className="icon-btn"
              title={t("rerun")}
              onClick={async () => {
                const app = useAppStore.getState();
                const session = app.sessions.find((s) => s.id === app.currentSessionId);
                const paneId = (session ? layoutPanes(session.layout)[0]?.id : null) ?? b.paneId;
                if (paneId && b.command) {
                  const { blockRerun } = await import("../../shared/ipc/client");
                  await blockRerun(b.id, paneId);
                  onClose();
                }
              }}
            >
              ↻
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
