// Shortcut editor: view / rebind / disable / reset; conflicts are caught
// before save and identify the colliding command (§5.6).
// Global hotkey (OS-level show/hide) lives here with the same click-to-record UX.
import { useEffect, useRef, useState } from "react";

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

/** Token for the global hotkey row in the recording state machine. */
const GLOBAL_HOTKEY_TOKEN = "__global_hotkey__";

export function ShortcutsSection({
  draft,
  onChange,
}: {
  draft: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const [recording, setRecording] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const conflicts = findConflicts(draft.shortcuts);

  const applyDraft = (patch: Partial<AppConfig> | ((current: AppConfig) => AppConfig)) => {
    const current = draftRef.current;
    const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
    onChangeRef.current(next);
  };

  const setBinding = (command: string, keys: string) => {
    applyDraft((current) => ({
      ...current,
      shortcuts: current.shortcuts.map((s) => (s.command === command ? { ...s, keys } : s)),
    }));
  };

  // Window-level capture while recording so the user can click the box then
  // press a chord without needing the button to stay focused after click.
  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

      const clear = () => {
        if (recording === GLOBAL_HOTKEY_TOKEN) {
          applyDraft({ globalHotkey: null });
        } else {
          setBinding(recording, "");
        }
        setRecording(null);
      };

      if (e.key === "Escape" || e.key === "Backspace" || e.key === "Delete") {
        clear();
        return;
      }

      const sig = chordSignature({
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
        key: e.key,
      });

      if (recording === GLOBAL_HOTKEY_TOKEN) {
        applyDraft({ globalHotkey: sig });
      } else {
        setBinding(recording, sig);
      }
      setRecording(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

  return (
    <div>
      <p style={{ color: "var(--text-lo)", marginTop: 0 }}>
        点击按键框后按下新组合；Esc / Backspace 可清除。冲突会在保存时阻止并指出冲突命令。
      </p>

      <h4 style={{ color: "var(--text-md)", margin: "4px 0 10px" }}>系统级热键</h4>
      <div className="form-row">
        <label>全局热键</label>
        <div className="form-value">
          <KeyCaptureButton
            active={recording === GLOBAL_HOTKEY_TOKEN}
            display={draft.globalHotkey ?? ""}
            emptyLabel="（禁用 · 点击设置）"
            onStart={() => setRecording(GLOBAL_HOTKEY_TOKEN)}
            onClear={() => {
              applyDraft({ globalHotkey: null });
              setRecording(null);
            }}
          />
          <span style={{ color: "var(--text-lo)", fontSize: "var(--fs-body-small)" }}>
            显示 / 隐藏主窗口（系统级，应用未聚焦时也生效）
          </span>
        </div>
      </div>

      <h4 style={{ color: "var(--text-md)", margin: "18px 0 10px" }}>应用内快捷键</h4>
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
              <KeyCaptureButton
                active={recording === s.command}
                display={s.keys}
                emptyLabel="（禁用）"
                conflict={conflict}
                onStart={() => setRecording(s.command)}
                onClear={() => {
                  setBinding(s.command, "");
                  setRecording(null);
                }}
              />
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

function KeyCaptureButton({
  active,
  display,
  emptyLabel,
  conflict,
  onStart,
  onClear,
}: {
  active: boolean;
  display: string;
  emptyLabel: string;
  conflict?: boolean;
  onStart: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="kbd"
        style={{
          minWidth: 160,
          padding: "4px 10px",
          borderColor: conflict
            ? "var(--red-400)"
            : active
              ? "var(--accent, var(--blue-400, #5b9fd4))"
              : undefined,
          outline: active ? "1px solid var(--accent, var(--blue-400, #5b9fd4))" : undefined,
        }}
        onClick={() => onStart()}
        aria-pressed={active}
        title={active ? "按下新快捷键，Esc 清除" : "点击后按下键盘组合"}
      >
        {active ? "按下新快捷键…" : display || emptyLabel}
      </button>
      {(display || active) && (
        <button type="button" className="btn" onClick={onClear} title="清除">
          清除
        </button>
      )}
    </>
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
