// Shortcut editor: view / rebind / disable / reset; conflicts are caught
// before save and identify the colliding command (§5.6).
import { useState } from "react";

import { configResetShortcuts } from "../../shared/ipc/client";
import type { AppConfig, ShortcutBinding } from "../../shared/ipc/types";
import { chordSignature } from "../../shared/utils";
import { t } from "../../shared/i18n";
import { IconAlert } from "../../shared/icons/Icons";

const COMMAND_LABELS: Record<string, string> = {
  "terminal.new": "新建终端",
  "tab.close": "关闭标签",
  "tab.rename": "重命名标签",
  "pane.splitRight": "向右分屏",
  "pane.splitDown": "向下分屏",
  "pane.close": "关闭 Pane",
  "pane.focusLeft": "焦点 ← Pane",
  "pane.focusRight": "焦点 → Pane",
  "pane.focusUp": "焦点 ↑ Pane",
  "pane.focusDown": "焦点 ↓ Pane",
  "pane.resizeLeft": "调整 ← 尺寸",
  "pane.resizeRight": "调整 → 尺寸",
  "pane.resizeUp": "调整 ↑ 尺寸",
  "pane.resizeDown": "调整 ↓ 尺寸",
  "pane.syncInput": "同步输入",
  "search.find": "终端查找",
  "search.blocks": "命令块搜索",
  "search.history": "历史命令",
  "command.palette": "命令面板",
  "settings.open": "打开设置",
  "panel.agent": "Agent 面板",
  "panel.git": "Git 面板",
  "panel.notifications": "通知面板",
};

export function ShortcutsSection({
  draft,
  onChange,
}: {
  draft: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const [recording, setRecording] = useState<string | null>(null);

  const conflicts = findConflicts(draft.shortcuts);

  const setBinding = (command: string, keys: string) => {
    onChange({
      ...draft,
      shortcuts: draft.shortcuts.map((s) => (s.command === command ? { ...s, keys } : s)),
    });
  };

  return (
    <div>
      <p style={{ color: "var(--text-lo)", marginTop: 0 }}>
        点击按键框后按下新组合；冲突会在保存时阻止并指出冲突命令。
      </p>
      {conflicts.length > 0 && (
        <div className="banner" style={{ marginBottom: 10 }}>
          <IconAlert size={14} />
          快捷键冲突：{conflicts.join("；")}
        </div>
      )}
      {draft.shortcuts.map((s) => {
        const conflict = conflicts.some((c) => c.includes(s.command));
        return (
          <div key={s.command} className="form-row">
            <label>{COMMAND_LABELS[s.command] ?? s.command}</label>
            <div className="form-value">
              <button
                className="kbd"
                style={{
                  minWidth: 150,
                  padding: "4px 10px",
                  borderColor: conflict ? "var(--red-400)" : undefined,
                }}
                onClick={() => setRecording(s.command)}
                onKeyDown={(e) => {
                  if (recording !== s.command) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
                  if (e.key === "Escape") {
                    setRecording(null);
                    return;
                  }
                  const sig = chordSignature({
                    ctrl: e.ctrlKey,
                    shift: e.shiftKey,
                    alt: e.altKey,
                    meta: e.metaKey,
                    key: e.key,
                  });
                  setBinding(s.command, sig);
                  setRecording(null);
                }}
                onBlur={() => recording === s.command && setRecording(null)}
              >
                {recording === s.command ? "按下新快捷键…" : s.keys || "（禁用）"}
              </button>
              <label style={{ display: "flex", gap: 4, alignItems: "center", color: "var(--text-lo)" }}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      shortcuts: draft.shortcuts.map((x) =>
                        x.command === s.command ? { ...x, enabled: e.target.checked } : x,
                      ),
                    })
                  }
                />
                {s.enabled ? t("enable") : t("disable")}
              </label>
              <button
                className="btn"
                onClick={async () => {
                  const cfg = await configResetShortcuts();
                  onChange({ ...draft, shortcuts: cfg.shortcuts });
                }}
                style={{ display: "none" }}
              />
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 14 }}>
        <button
          className="btn"
          onClick={async () => {
            const cfg = await configResetShortcuts();
            onChange({ ...draft, shortcuts: cfg.shortcuts });
          }}
        >
          {t("reset")} 全部快捷键
        </button>
      </div>
    </div>
  );
}

function findConflicts(shortcuts: ShortcutBinding[]): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const s of shortcuts) {
    if (!s.enabled || !s.keys.trim()) continue;
    const prev = seen.get(s.keys);
    if (prev) out.push(`“${COMMAND_LABELS[prev] ?? prev}” 与 “${COMMAND_LABELS[s.command] ?? s.command}” → ${s.keys}`);
    else seen.set(s.keys, s.command);
  }
  return out;
}
