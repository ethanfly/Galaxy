// Ctrl+R — unified history + favorites search (§5.3).
import { useCallback, useEffect, useMemo, useState } from "react";

import { blockSearch, ptyWrite } from "../../shared/ipc/client";
import type { CommandBlock } from "../../shared/ipc/types";
import { useUiStore } from "../../shared/stores/uiStore";
import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { Modal } from "../../shared/components/Modal";
import { truncate } from "../../shared/utils";
import { IconStar } from "../../shared/icons/Icons";

export function HistorySearchModal() {
  const open = useUiStore((s) => s.historySearchOpen);
  const close = useUiStore((s) => s.closeOverlays);
  const [query, setQuery] = useState("");
  const [blocks, setBlocks] = useState<CommandBlock[]>([]);
  const [selected, setSelected] = useState(0);

  const load = useCallback(async () => {
    // Unified: favorites first, then all blocks, deduped by command.
    const all = await blockSearch("", false);
    const seen = new Set<string>();
    const unique: CommandBlock[] = [];
    for (const b of [...all].sort((a, b) => Number(b.favorite) - Number(a.favorite))) {
      if (b.command && !seen.has(b.command)) {
        seen.add(b.command);
        unique.push(b);
      }
    }
    setBlocks(unique.reverse());
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      void load();
    }
  }, [open, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? blocks.filter((b) => b.command.toLowerCase().includes(q)) : blocks;
    return list.slice(0, 50).reverse();
  }, [query, blocks]);

  if (!open) return null;

  const insertIntoTerminal = async (run: boolean) => {
    const item = filtered[selected];
    if (!item?.command) return;
    const app = useAppStore.getState();
    const session = app.sessions.find((s) => s.id === app.currentSessionId);
    const focused = session ? useTerminalStore.getState().focusedPane[session.id] : null;
    const panes = session ? allPanes(session) : [];
    const target = focused ?? panes[0]?.id;
    if (target) {
      await ptyWrite(target, item.command + (run ? "\r" : ""));
    }
    close();
  };

  return (
    <Modal title="历史命令 (Ctrl+R — Enter 执行 · Tab 填入)" onClose={close} width="56vw">
      <div className="modal-body">
        <input
          autoFocus
          type="search"
          placeholder="搜索历史命令与收藏…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              void insertIntoTerminal(true);
            } else if (e.key === "Tab") {
              e.preventDefault();
              void insertIntoTerminal(false);
            }
          }}
        />
        <div className="result-list" style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {filtered.length === 0 && <div style={{ color: "var(--text-lo)", padding: 8 }}>无匹配历史</div>}
          {filtered.map((b, i) => (
            <div
              key={b.id}
              className={`result-item ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => void insertIntoTerminal(true)}
            >
              <span style={{ color: b.favorite ? "var(--amber-400)" : "var(--text-lo)" }}>
                <IconStar className="inline-icon" filled={b.favorite} size={12} />
              </span>
              <code>{truncate(b.command, 110)}</code>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

import { layoutPanes } from "../../shared/utils";
import type { Session } from "../../shared/ipc/types";
function allPanes(session: Session) {
  return layoutPanes(session.layout);
}
