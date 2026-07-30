// Ctrl+F — xterm find across all panes of the current session (§5.3).
import { useEffect, useRef, useState } from "react";

import { IconChevronDown, IconChevronUp, IconClose } from "../../shared/icons/Icons";
import { searchAddons } from "../terminal/TerminalView";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { layoutPanes } from "../../shared/utils";

export function FindBar() {
  const open = useUiStore((s) => s.findBarOpen);
  const close = useUiStore((s) => s.closeFind);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open || !session) return null;

  const find = (direction: 1 | -1) => {
    if (!query) return;
    // Search all panes of the current session (spec §5.3).
    for (const pane of layoutPanes(session.layout)) {
      const addon = searchAddons.get(pane.id);
      try {
        if (direction === 1) addon?.findNext(query, { incremental: false });
        else addon?.findPrevious(query);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        type="search"
        placeholder="查找（当前会话所有 pane）"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) {
            for (const pane of layoutPanes(session.layout)) {
              try {
                searchAddons.get(pane.id)?.findNext(e.target.value, { incremental: true });
              } catch {
                /* noop */
              }
            }
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") find(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") close();
        }}
      />
      <button type="button" className="icon-btn" onClick={() => find(-1)} title="上一个" aria-label="上一个">
        <IconChevronUp />
      </button>
      <button type="button" className="icon-btn" onClick={() => find(1)} title="下一个" aria-label="下一个">
        <IconChevronDown />
      </button>
      <button type="button" className="icon-btn" onClick={close} title="关闭" aria-label="关闭">
        <IconClose />
      </button>
    </div>
  );
}
