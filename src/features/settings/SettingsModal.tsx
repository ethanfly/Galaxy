// Settings center (§5.6): general / workflows / layout templates / triggers /
// shortcuts / diagnostics.
import { useEffect, useState } from "react";

import * as ipc from "../../shared/ipc/client";
import type {
  AppConfig,
  DiagnosticsInfo,
  ShellProfile,
  ShortcutBinding,
  Trigger,
  TriggerAction,
  Workflow,
  WorkflowParam,
} from "../../shared/ipc/types";
import { Modal } from "../../shared/components/Modal";
import { IconAlert, IconCheck, IconClose, IconPlus } from "../../shared/icons/Icons";
import { t } from "../../shared/i18n";
import { setLanguage } from "../../shared/i18n";
import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore, type SettingsSection } from "../../shared/stores/uiStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { layoutPanes, localId } from "../../shared/utils";
import { ShortcutsSection } from "./ShortcutsSection";

export const SETTINGS_SECTIONS: Array<{ id: SettingsSection; labelKey: string }> = [
  { id: "general", labelKey: "general" },
  { id: "workflows", labelKey: "workflows" },
  { id: "templates", labelKey: "layoutTemplates" },
  { id: "triggers", labelKey: "triggers" },
  { id: "shortcuts", labelKey: "shortcuts" },
  { id: "diagnostics", labelKey: "diagnostics" },
];

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const section = useUiStore((s) => s.settingsSection);
  const setSection = useUiStore((s) => s.openSettings);
  const close = useUiStore((s) => s.closeSettings);
  const setAppearancePreview = useUiStore((s) => s.setAppearancePreview);
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const error = useAppStore((s) => s.error);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && config) {
      setAppearancePreview(null);
      setDraft(structuredClone(config));
      // Stale global errors (e.g. a prior failed save) should not stick on reopen.
      if (useAppStore.getState().error) {
        useAppStore.setState({ error: null });
      }
    }
  }, [open, config, setAppearancePreview]);

  useEffect(() => () => setAppearancePreview(null), [setAppearancePreview]);

  if (!open || !draft) return null;

  const isAppearanceValid = (value: AppConfig) =>
    Number.isFinite(value.terminalFontSize) &&
    Number.isInteger(value.terminalFontSize) &&
    value.terminalFontSize >= 8 &&
    value.terminalFontSize <= 32 &&
    Number.isFinite(value.uiFontSize) &&
    Number.isInteger(value.uiFontSize) &&
    value.uiFontSize >= 8 &&
    value.uiFontSize <= 24;

  const requestClose = () => {
    if (!saving) close();
  };

  const save = async () => {
    if (saving || !isAppearanceValid(draft)) return;
    setSaving(true);
    try {
      const ok = await setConfig(draft);
      if (ok) {
        setLanguage(draft.language);
        close();
      }
    } finally {
      setSaving(false);
    }
  };

  const changeDraft = (next: AppConfig) => {
    if (saving) return;
    setDraft(next);
    if (
      Number.isFinite(next.terminalFontSize) &&
      Number.isInteger(next.terminalFontSize) &&
      next.terminalFontSize >= 8 &&
      next.terminalFontSize <= 32 &&
      Number.isFinite(next.uiFontSize) &&
      Number.isInteger(next.uiFontSize) &&
      next.uiFontSize >= 8 &&
      next.uiFontSize <= 24
    ) {
      setAppearancePreview({
        terminalFontSize: next.terminalFontSize,
        uiFontSize: next.uiFontSize,
      });
    }
  };

  return (
    <Modal title={t("settings")} onClose={requestClose} className="settings-modal" width="78vw">
      <div className="settings-shell">
        <div className="settings-nav">
          {SETTINGS_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={section === s.id ? "active" : ""}
              aria-current={section === s.id ? "page" : undefined}
              disabled={saving}
              onClick={() => setSection(s.id)}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {error && (
            <div className="banner" style={{ marginBottom: 12 }}>
              <IconAlert size={14} />
              <span>{error}</span>
            </div>
          )}
          {section === "general" && <GeneralSection draft={draft} onChange={changeDraft} />}
          {section === "workflows" && <WorkflowsSection draft={draft} onChange={changeDraft} />}
          {section === "templates" && <TemplatesSection draft={draft} onChange={changeDraft} />}
          {section === "triggers" && <TriggersSection draft={draft} onChange={changeDraft} />}
          {section === "shortcuts" && <ShortcutsSection draft={draft} onChange={changeDraft} />}
          {section === "diagnostics" && <DiagnosticsSection />}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn" disabled={saving} onClick={requestClose}>{t("cancel")}</button>
        <button
          className="btn primary"
          disabled={saving || !isAppearanceValid(draft)}
          onClick={() => void save()}
        >
          {t("save")}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- general

function GeneralSection({
  draft,
  onChange,
}: {
  draft: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const profiles = useAppStore((s) => s.profiles);
  const [newProfile, setNewProfile] = useState({ name: "", program: "", args: "" });

  const update = (patch: Partial<AppConfig>) => onChange({ ...draft, ...patch });

  return (
    <div>
      <div className="form-row">
        <label>语言 / Language</label>
        <div className="form-value">
          <select value={draft.language} onChange={(e) => update({ language: e.target.value })}>
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <label>主题</label>
        <div className="form-value">
          <span style={{ color: "var(--text-md)" }}>深色（商业版固定）</span>
        </div>
      </div>
      <div className="form-row">
        <label>终端字号 ({draft.terminalFontSize}px)</label>
        <div className="form-value">
          <input
            type="number"
            min={8}
            max={32}
            step={1}
            value={draft.terminalFontSize}
            onChange={(e) => update({ terminalFontSize: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="form-row">
        <label>界面字号 ({draft.uiFontSize}px)</label>
        <div className="form-value">
          <input
            type="number"
            min={8}
            max={24}
            step={1}
            value={draft.uiFontSize}
            onChange={(e) => update({ uiFontSize: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="form-row">
        <label>默认 Shell Profile</label>
        <div className="form-value">
          <select
            value={draft.defaultProfileId ?? ""}
            onChange={(e) => update({ defaultProfileId: e.target.value || null })}
          >
            <option value="">自动（第一项）</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="btn" onClick={() => void ipc.profilesRedetect().then(() => useAppStore.getState().init())}>
            重新探测
          </button>
        </div>
      </div>
      <div className="form-row">
        <label>全局热键</label>
        <div className="form-value">
          <input
            type="text"
            placeholder="如 Ctrl+Alt+T（留空禁用）"
            value={draft.globalHotkey ?? ""}
            onChange={(e) => update({ globalHotkey: e.target.value || null })}
          />
        </div>
      </div>
      <div className="form-row">
        <label>资源管理器右键菜单</label>
        <div className="form-value">
          <input
            type="checkbox"
            checked={draft.contextMenuEnabled}
            onChange={(e) => update({ contextMenuEnabled: e.target.checked })}
          />
          <span style={{ color: "var(--text-lo)" }}>“在此处打开银河终端”</span>
        </div>
      </div>
      <div className="form-row">
        <label>Agent 状态通知</label>
        <div className="form-value">
          <input
            type="checkbox"
            checked={draft.agentNotifications}
            onChange={(e) => update({ agentNotifications: e.target.checked })}
          />
          <span style={{ color: "var(--text-lo)" }}>完成 / 阻塞时发送系统通知</span>
        </div>
      </div>
      <div className="form-row">
        <label>触发器通知</label>
        <div className="form-value">
          <input
            type="checkbox"
            checked={draft.triggerNotifications}
            onChange={(e) => update({ triggerNotifications: e.target.checked })}
          />
        </div>
      </div>
      <div className="form-row">
        <label>硬件加速</label>
        <div className="form-value">
          <input
            type="checkbox"
            checked={draft.hardwareAcceleration}
            onChange={(e) => update({ hardwareAcceleration: e.target.checked })}
          />
          <span style={{ color: "var(--text-lo)" }}>CAPTURE_SCREEN 自动切软件渲染</span>
        </div>
      </div>
      <div className="form-row">
        <label>状态栏组件（顺序）</label>
        <div className="form-value" style={{ flexWrap: "wrap" }}>
          {draft.statusbarComponents.map((c, i) => (
            <span key={`${c}-${i}`} className="kbd" style={{ display: "inline-flex", gap: 4 }}>
              {c}
              <button
                type="button"
                className="icon-btn"
                title={`${t("removeStatusbarComponent")} ${c}`}
                aria-label={`${t("removeStatusbarComponent")} ${c}`}
                onClick={() =>
                  update({ statusbarComponents: draft.statusbarComponents.filter((_, j) => j !== i) })
                }
              >
                <IconClose size={12} />
              </button>
            </span>
          ))}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value)
                update({ statusbarComponents: [...draft.statusbarComponents, e.target.value] });
            }}
          >
            <option value="">+ 添加</option>
            {["git", "cwd", "sessions", "agent", "notifications", "clock"]
              .filter((c) => !draft.statusbarComponents.includes(c))
              .map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
          </select>
        </div>
      </div>

      <h4 style={{ color: "var(--text-md)", margin: "18px 0 6px" }}>自定义 Shell Profile</h4>
      {draft.customProfiles.map((p) => (
        <div key={p.id} className="form-row">
          <label>{p.name}</label>
          <div className="form-value">
            <code style={{ color: "var(--text-lo)", overflow: "hidden", textOverflow: "ellipsis" }}>
              {p.program} {p.args.join(" ")}
            </code>
            <button
              className="btn"
              onClick={() =>
                update({ customProfiles: draft.customProfiles.filter((x) => x.id !== p.id) })
              }
            >
              {t("delete")}
            </button>
          </div>
        </div>
      ))}
      <div className="form-row">
        <label>新增 Profile</label>
        <div className="form-value">
          <input
            type="text"
            placeholder="名称"
            value={newProfile.name}
            onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
          />
          <input
            type="text"
            placeholder="程序路径"
            value={newProfile.program}
            onChange={(e) => setNewProfile({ ...newProfile, program: e.target.value })}
          />
          <input
            type="text"
            placeholder="参数（空格分隔）"
            value={newProfile.args}
            onChange={(e) => setNewProfile({ ...newProfile, args: e.target.value })}
          />
          <button
            type="button"
            className="icon-btn"
            title={t("addCustomProfile")}
            aria-label={t("addCustomProfile")}
            disabled={!newProfile.name || !newProfile.program}
            onClick={() => {
              const p: ShellProfile = {
                id: `custom-${localId()}`,
                name: newProfile.name,
                program: newProfile.program,
                args: newProfile.args.split(/\s+/).filter(Boolean),
                icon: null,
                env: {},
                source: "custom",
              };
              update({ customProfiles: [...draft.customProfiles, p] });
              setNewProfile({ name: "", program: "", args: "" });
            }}
          >
            <IconPlus />
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- workflows

function WorkflowsSection({
  draft,
  onChange,
}: {
  draft: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const updateWorkflow = (idx: number, wf: Workflow) => {
    const workflows = [...draft.workflows];
    workflows[idx] = wf;
    onChange({ ...draft, workflows });
  };

  return (
    <div>
      <p style={{ color: "var(--text-lo)", marginTop: 0 }}>
        参数化命令模板，使用 {"{{param}}"} 占位；运行时按声明类型校验。
      </p>
      {draft.workflows.map((wf, idx) => (
        <div key={wf.id} className="conv-item" style={{ marginBottom: 10 }}>
          <div className="form-row">
            <label>名称</label>
            <div className="form-value">
              <input
                type="text"
                value={wf.name}
                onChange={(e) => updateWorkflow(idx, { ...wf, name: e.target.value })}
              />
              <label style={{ display: "flex", gap: 4, alignItems: "center", color: "var(--text-lo)" }}>
                <input
                  type="checkbox"
                  checked={wf.confirmBeforeRun}
                  onChange={(e) => updateWorkflow(idx, { ...wf, confirmBeforeRun: e.target.checked })}
                />
                运行前确认
              </label>
              <button
                className="btn danger"
                onClick={() =>
                  onChange({ ...draft, workflows: draft.workflows.filter((w) => w.id !== wf.id) })
                }
              >
                {t("delete")}
              </button>
            </div>
          </div>
          <div className="form-row">
            <label>命令模板</label>
            <div className="form-value">
              <input
                type="text"
                style={{ fontFamily: "var(--font-mono)" }}
                value={wf.commandTemplate}
                onChange={(e) => updateWorkflow(idx, { ...wf, commandTemplate: e.target.value })}
              />
            </div>
          </div>
          {wf.params.map((p, pi) => (
            <div key={pi} className="form-row" style={{ paddingLeft: 24 }}>
              <label style={{ fontSize: "var(--fs-body-small)" }}>参数 {p.name}</label>
              <div className="form-value" style={{ fontSize: "var(--fs-body-small)" }}>
                <input
                  type="text"
                  style={{ width: 120 }}
                  value={p.name}
                  onChange={(e) => {
                    const params = [...wf.params];
                    params[pi] = { ...p, name: e.target.value };
                    updateWorkflow(idx, { ...wf, params });
                  }}
                />
                <select
                  value={typeof p.type === "string" ? p.type : "choice"}
                  onChange={(e) => {
                    const params = [...wf.params];
                    const v = e.target.value;
                    params[pi] = {
                      ...p,
                      type: v === "choice" ? { choice: [] } : (v as WorkflowParam["type"]),
                    };
                    updateWorkflow(idx, { ...wf, params });
                  }}
                >
                  <option value="string">string</option>
                  <option value="int">int</option>
                  <option value="bool">bool</option>
                  <option value="path">path</option>
                  <option value="choice">choice</option>
                </select>
                <input
                  type="text"
                  placeholder="默认值"
                  style={{ width: 100 }}
                  value={p.default ?? ""}
                  onChange={(e) => {
                    const params = [...wf.params];
                    params[pi] = { ...p, default: e.target.value || null };
                    updateWorkflow(idx, { ...wf, params });
                  }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  title={`${t("removeWorkflowParameter")} ${p.name}`}
                  aria-label={`${t("removeWorkflowParameter")} ${p.name}`}
                  onClick={() => {
                    updateWorkflow(idx, { ...wf, params: wf.params.filter((_, j) => j !== pi) });
                  }}
                >
                  <IconClose />
                </button>
              </div>
            </div>
          ))}
          <div className="form-row" style={{ paddingLeft: 24 }}>
            <label />
            <div className="form-value">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  updateWorkflow(idx, {
                    ...wf,
                    params: [
                      ...wf.params,
                      { name: `param${wf.params.length + 1}`, type: "string", default: null, required: false, allowShellChars: false },
                    ],
                  })
                }
              >
                <IconPlus size={13} className="inline-icon" />
                <span>参数</span>
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => {
          const wf: Workflow = {
            id: localId("wf"),
            name: `Workflow ${draft.workflows.length + 1}`,
            description: "",
            commandTemplate: "",
            params: [],
            cwd: "project",
            profileId: null,
            confirmBeforeRun: true,
          };
          onChange({ ...draft, workflows: [...draft.workflows, wf] });
        }}
      >
        <IconPlus size={13} className="inline-icon" />
        <span>新建 Workflow</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------- templates

function TemplatesSection({
  draft,
  onChange,
}: {
  draft: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const currentSession = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId));
  const [name, setName] = useState("");

  const saveCurrent = async () => {
    if (!currentSession || !name.trim()) return;
    const tpl = await ipc.templateSave(currentSession.id, name.trim());
    onChange({
      ...draft,
      layoutTemplates: [...draft.layoutTemplates.filter((x) => x.name !== tpl.name), tpl],
    });
    setName("");
  };

  return (
    <div>
      <p style={{ color: "var(--text-lo)", marginTop: 0 }}>
        恢复时 layoutSnapshot 优先于命名模板；应用模板默认复用现有 Pane。
      </p>
      <div className="form-row">
        <label>保存当前布局</label>
        <div className="form-value">
          <input
            type="text"
            placeholder="模板名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!currentSession}
          />
          <button className="btn" disabled={!currentSession || !name.trim()} onClick={() => void saveCurrent()}>
            {t("save")}
          </button>
        </div>
      </div>
      {draft.layoutTemplates.length === 0 && (
        <p style={{ color: "var(--text-lo)" }}>暂无布局模板。</p>
      )}
      {draft.layoutTemplates.map((tpl) => (
        <div key={tpl.id} className="form-row">
          <label>{tpl.name}</label>
          <div className="form-value">
            <button
              className="btn"
              disabled={!currentSession}
              onClick={async () => {
                if (!currentSession) return;
                const updated = await ipc.templateApply(currentSession.id, tpl.id);
                useAppStore.getState().updateSessionLocal(updated);
              }}
            >
              {t("apply")}
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                await ipc.templateDelete(tpl.id);
                onChange({
                  ...draft,
                  layoutTemplates: draft.layoutTemplates.filter((x) => x.id !== tpl.id),
                });
              }}
            >
              {t("delete")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- triggers

const ALL_ACTIONS: Array<{ id: TriggerAction; label: string }> = [
  { id: "notify", label: "通知" },
  { id: "mark", label: "标记" },
  { id: "bell", label: "响铃" },
  { id: "stopScroll", label: "停止滚动" },
];

function TriggersSection({
  draft,
  onChange,
}: {
  draft: AppConfig;
  onChange: (c: AppConfig) => void;
}) {
  const updateTrigger = (idx: number, tr: Trigger) => {
    const triggers = [...draft.triggers];
    triggers[idx] = tr;
    onChange({ ...draft, triggers });
  };

  return (
    <div>
      <p style={{ color: "var(--text-lo)", marginTop: 0 }}>
        正则长度上限 512，使用线性时间引擎且带冷却时间 — 不会拖慢终端输出。
      </p>
      {draft.triggers.map((tr, idx) => (
        <div key={tr.id} className="conv-item" style={{ marginBottom: 10 }}>
          <div className="form-row">
            <label>名称</label>
            <div className="form-value">
              <input
                type="text"
                value={tr.name}
                onChange={(e) => updateTrigger(idx, { ...tr, name: e.target.value })}
              />
              <label style={{ display: "flex", gap: 4, color: "var(--text-lo)", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={tr.enabled}
                  onChange={(e) => updateTrigger(idx, { ...tr, enabled: e.target.checked })}
                />
                {tr.enabled ? t("enable") : t("disable")}
              </label>
              <button
                className="btn danger"
                onClick={() =>
                  onChange({ ...draft, triggers: draft.triggers.filter((x) => x.id !== tr.id) })
                }
              >
                {t("delete")}
              </button>
            </div>
          </div>
          <div className="form-row">
            <label>正则 ({tr.pattern.length}/512)</label>
            <div className="form-value">
              <input
                type="text"
                style={{ fontFamily: "var(--font-mono)" }}
                maxLength={512}
                value={tr.pattern}
                onChange={(e) => updateTrigger(idx, { ...tr, pattern: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <label>冷却 (ms)</label>
            <div className="form-value">
              <input
                type="number"
                min={0}
                step={500}
                value={tr.cooldownMs}
                onChange={(e) => updateTrigger(idx, { ...tr, cooldownMs: Number(e.target.value) })}
              />
              <label style={{ display: "flex", gap: 4, color: "var(--text-lo)", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={tr.caseSensitive}
                  onChange={(e) => updateTrigger(idx, { ...tr, caseSensitive: e.target.checked })}
                />
                区分大小写
              </label>
            </div>
          </div>
          <div className="form-row">
            <label>动作</label>
            <div className="form-value">
              {ALL_ACTIONS.map((a) => (
                <label key={a.id} style={{ display: "flex", gap: 4, alignItems: "center", color: "var(--text-md)" }}>
                  <input
                    type="checkbox"
                    checked={tr.actions.includes(a.id)}
                    onChange={(e) => {
                      const actions = e.target.checked
                        ? [...tr.actions, a.id]
                        : tr.actions.filter((x) => x !== a.id);
                      updateTrigger(idx, { ...tr, actions });
                    }}
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => {
          const tr: Trigger = {
            id: localId("tr"),
            name: `触发器 ${draft.triggers.length + 1}`,
            pattern: "error|failed",
            scope: "global",
            cooldownMs: 5000,
            actions: ["notify", "mark"],
            enabled: true,
            caseSensitive: false,
          };
          onChange({ ...draft, triggers: [...draft.triggers, tr] });
        }}
      >
        <IconPlus size={13} className="inline-icon" />
        <span>新建触发器</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------- diagnostics

function DiagnosticsSection() {
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void ipc.diagnosticsInfo().then(setInfo);
  }, []);

  if (!info) return <div>加载中…</div>;

  const genReport = async () => {
    const r = await ipc.diagnosticsReport();
    setReport(r);
  };

  return (
    <div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "var(--fs-body-small)" }}>
        <tbody>
          {[
            ["应用版本", info.appVersion],
            ["操作系统", `${info.os} (${info.arch})`],
            ["PTY 后端", info.ptyBackend],
            ["存储 Schema", String(info.schemaVersion)],
            ["配置文件", info.configPath],
            ["数据目录", info.dataDir],
            ["日志目录", info.logDir],
            ["Git 可用", info.gitAvailable ? "是" : "否"],
            ["GPU 加速", info.gpuAcceleration ? "开" : "关"],
            ["截图模式", info.capturesScreenMode ? "是 (CAPTURE_SCREEN)" : "否"],
            ["Shell Profile", `${info.profileCount} 个`],
            ["功能开关", info.featureFlags.join(", ")],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: "4px 8px", color: "var(--text-lo)", whiteSpace: "nowrap" }}>{k}</td>
              <td style={{ padding: "4px 8px", color: "var(--text-md)", wordBreak: "break-all" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 style={{ color: "var(--text-md)", margin: "14px 0 4px" }}>Shell 列表</h4>
      {info.shells.map((s) => (
        <div key={s} style={{ fontSize: "var(--fs-body-small)", color: "var(--text-md)", padding: "1px 0" }}>· {s}</div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={() => void genReport()}>
          生成脱敏报告
        </button>
        {report && (
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(report);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? (
              <>
                <IconCheck size={13} className="inline-icon" />
                <span>已复制</span>
              </>
            ) : "复制报告"}
          </button>
        )}
      </div>
      {report && (
        <pre
          style={{
            marginTop: 10,
            maxHeight: 260,
            overflow: "auto",
            background: "var(--space-0)",
            padding: 10,
            fontSize: "var(--fs-small)",
            color: "var(--text-md)",
            whiteSpace: "pre-wrap",
          }}
        >
          {report}
        </pre>
      )}
      <div style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={async () => {
            const r = await ipc.updaterCheck();
            if (r.notes) alert(r.notes);
            else alert(r.available ? `发现新版本 ${r.version}` : "当前已是最新版本");
          }}
        >
          检查更新
        </button>
      </div>
    </div>
  );
}

export function currentFocusedPaneId(): string | null {
  const app = useAppStore.getState();
  const session = app.sessions.find((s) => s.id === app.currentSessionId);
  if (!session) return null;
  return (
    useTerminalStore.getState().focusedPane[session.id] ?? layoutPanes(session.layout)[0]?.id ?? null
  );
}
