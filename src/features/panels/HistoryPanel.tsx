// Command block history panel for the current session (§5.3).
import { useEffect, useState } from "react";

import { blockList, blockRerun, blockSetFavorite, blocksClearNonFavorites } from "../../shared/ipc/client";
import type { CommandBlock } from "../../shared/ipc/types";
import { onBlocksUpdated } from "../../shared/ipc/events";
import { useAppStore } from "../../shared/stores/appStore";
import { layoutPanes, truncate } from "../../shared/utils";
import { t } from "../../shared/i18n";

export function HistoryPanel() {
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));
  const [blocks, setBlocks] = useState<CommandBlock[]>([]);
  const [overflow, setOverflow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionId = session?.id;

  const refresh = async (sid: string) => {
    try {
      const res = await blockList(sid);
      setBlocks([...res.blocks].reverse());
      setOverflow(res.favoriteOverflow);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (sessionId) void refresh(sessionId);
    else setBlocks([]);
  }, [sessionId]);

  useEffect(() => {
    const p = onBlocksUpdated(({ sessionId: sid }) => {
      if (sid === sessionId) void refresh(sid);
    });
    return () => {
      void p.then((u) => u());
    };
  }, [sessionId]);

  if (!session) {
    return <div className="panel-body"><Empty text="选择会话后显示命令块" /></div>;
  }
  const firstPane = layoutPanes(session.layout)[0]?.id;

  return (
    <div className="panel-body">
      {overflow && (
        <div className="banner" style={{ marginBottom: 8 }}>
          收藏块超出软上限，请清理收藏或导出后清空。
          <button className="btn" onClick={() => {
            void blocksClearNonFavorites().then(() => {
              if (sessionId) void refresh(sessionId);
            });
          }}>
            清空非收藏
          </button>
        </div>
      )}
      {error && <div style={{ color: "var(--red-400)" }}>{error}</div>}
      {blocks.length === 0 && (
        <Empty text="暂无命令记录 — 在终端执行命令后会自动捕获（约 1 秒静默后写入；下一条命令也会结算上一条）" />
      )}
      {blocks.map((b) => (
        <BlockItem key={b.id} block={b} paneId={b.paneId === firstPane ? firstPane! : b.paneId} onChanged={() => sessionId && refresh(sessionId)} />
      ))}
    </div>
  );
}

export function BlockItem({
  block: b,
  paneId,
  onChanged,
}: {
  block: CommandBlock;
  paneId: string;
  onChanged: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (what: "command" | "output") => {
    await navigator.clipboard.writeText(what === "command" ? b.command : b.output);
    setCopied(what);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <div className="block-item">
      <code title={b.command}>{truncate(b.command || "(未捕获命令)", 120)}</code>
      {b.output && <pre>{truncate(b.output, 600)}</pre>}
      <div className="conv-meta">
        <span>{b.exitCode != null ? `exit ${b.exitCode}` : "·"}</span>
      </div>
      <div className="block-actions">
        <button className="btn" onClick={() => void copy("command")}>
          {copied === "command" ? "已复制 ✓" : t("copyCommand")}
        </button>
        <button className="btn" disabled={!b.output} onClick={() => void copy("output")}>
          {copied === "output" ? "已复制 ✓" : t("copyOutput")}
        </button>
        <button
          className="btn"
          disabled={!b.command}
          onClick={() => void blockRerun(b.id, paneId)}
          title={t("rerun")}
        >
          ↻
        </button>
        <button
          className={`btn ${b.favorite ? "primary" : ""}`}
          onClick={async () => {
            await blockSetFavorite(b.id, !b.favorite);
            onChanged();
          }}
          title={t("favorite")}
        >
          {b.favorite ? "★" : "☆"}
        </button>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 16, color: "var(--text-lo)", textAlign: "center" }}>{text}</div>;
}
