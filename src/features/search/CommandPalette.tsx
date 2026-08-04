// Ctrl+P — global command palette: actions, projects, sessions, workflows,
// layout templates, panel entries (§5.6).
import { useEffect, useMemo, useRef, useState } from "react";

import { templateApply } from "../../shared/ipc/client";
import { fuzzyMatch } from "../../shared/utils";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { Modal } from "../../shared/components/Modal";
import { t } from "../../shared/i18n";

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const close = useUiStore((s) => s.closeOverlays);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = usePaletteItems();
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const scored = items
      .map((item) => ({ item, score: fuzzyMatch(query, `${item.label} ${item.keywords}`) }))
      .filter((x): x is { item: PaletteItem; score: number } => x.score != null)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.item);
  }, [query, items]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  if (!open) return null;

  const execute = async (item: PaletteItem) => {
    close();
    await item.run();
  };

  return (
    <Modal title={undefined} onClose={close} width="52vw">
      <div className="modal-body" style={{ paddingTop: 12 }}>
        <input
          ref={inputRef}
          type="search"
          placeholder={`${t("commandPalette")}…`}
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
            } else if (e.key === "Enter" && filtered[selected]) {
              void execute(filtered[selected]);
            }
          }}
        />
        <div className="result-list" style={{ maxHeight: "56vh", overflowY: "auto" }}>
          {filtered.length === 0 && <div style={{ color: "var(--text-lo)", padding: 8 }}>无匹配命令</div>}
          {filtered.slice(0, 40).map((item, i) => (
            <div
              key={item.id}
              className={`result-item ${i === selected ? "selected" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => void execute(item)}
            >
              <span>{item.label}</span>
              {item.hint && <span className="result-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function usePaletteItems(): PaletteItem[] {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const config = useAppStore((s) => s.config);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  return useMemo(() => {
    const app = useAppStore.getState;
    const ui = useUiStore.getState;
    const items: PaletteItem[] = [];

    const action = (id: string, label: string, hint: string | undefined, keywords: string, run: () => void | Promise<void>) =>
      items.push({ id, label, hint, keywords, run });

    action("new-terminal", t("newTerminal"), "Ctrl+Shift+T", "new terminal create tab session", async () => {
      const pid = app().currentProjectId;
      if (pid) await app().createSession(pid);
    });
    action("add-project", t("addProject"), "", "add project folder", async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ directory: true });
      if (typeof path === "string") await app().addProject(path);
    });
    action("find", `${t("search")} · 终端查找 Ctrl+F`, "Ctrl+F", "find search terminal", () => ui().openFind());
    action("search-blocks", `${t("search")} · 命令块 Ctrl+Shift+F`, "Ctrl+Shift+F", "blocks search", () => ui().openBlockSearch());
    action("history", `${t("history")} Ctrl+R`, "Ctrl+R", "history favorites commands", () => ui().openHistorySearch());
    action("panel-agent", `${t("agent")} 面板`, "Ctrl+Shift+A", "agent panel", () => ui().openPanel("agent"));
    action("panel-git", "Git 面板", "Ctrl+Shift+G", "git panel", () => ui().openPanel("git"));
    action("panel-history", `${t("history")} 面板`, "", "history blocks panel", () => ui().openPanel("history"));
    action("panel-notifications", `${t("notifications")} 面板`, "Ctrl+Shift+N", "notifications", () => ui().openPanel("notifications"));
    action("toggle-panel", t("toggleRightPanel"), "", "toggle right panel", () => ui().togglePanel());
    action("settings", t("settings"), "Ctrl+,", "settings preferences", () => ui().openSettings("general"));
    action("toggle-sidebar", t("toggleSidebar"), "", "sidebar toggle", () => ui().toggleWorkspaceContext());
    action("sync-input", `${t("syncInput")} 切换`, "", "sync input broadcast", async () => {
      const s = app().sessions.find((x) => x.id === app().currentSessionId);
      if (s) await app().setSessionSync(s.id, !s.syncInput);
    });

    // sessions
    for (const s of sessions) {
      action(`session-${s.id}`, `切换到: ${s.title}`, s.id === currentSessionId ? "当前" : undefined, `session tab ${s.title}`, () => {
        app().selectSession(s.id);
      });
    }
    // projects
    for (const p of projects) {
      action(`project-${p.id}`, `项目: ${p.name}`, p.id === currentProjectId ? "当前" : undefined, `project ${p.name} ${p.path}`, () => {
        app().selectProject(p.id);
      });
    }
    // workflows → fill params modal
    for (const wf of config?.workflows ?? []) {
      action(`workflow-${wf.id}`, `Workflow: ${wf.name}`, wf.commandTemplate, `workflow run ${wf.name}`, () => {
        ui().openWorkflowRun(wf.id);
      });
    }
    // layout templates
    for (const tpl of config?.layoutTemplates ?? []) {
      action(`template-apply-${tpl.id}`, `应用布局模板: ${tpl.name}`, "", `layout template ${tpl.name}`, async () => {
        if (currentSessionId) {
          const updated = await templateApply(currentSessionId, tpl.id);
          useAppStore.getState().updateSessionLocal(updated);
        }
      });
      action(`template-save`, `保存当前布局为模板`, "", "save layout template", () => {
        ui().openSettings("templates");
      });
    }
    return items;
  }, [sessions, projects, config, currentSessionId, currentProjectId]);
}
