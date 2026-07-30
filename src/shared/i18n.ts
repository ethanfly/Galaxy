// Minimal zh-CN / en-US resource switch. Language follows config.language.
const dict: Record<string, { zh: string; en: string }> = {
  appName: { zh: "银河终端", en: "Galaxy Terminal" },
  projects: { zh: "项目", en: "Projects" },
  addProject: { zh: "添加项目", en: "Add project" },
  newTerminal: { zh: "新建终端", en: "New terminal" },
  terminal: { zh: "终端", en: "Terminal" },
  settings: { zh: "设置", en: "Settings" },
  general: { zh: "通用", en: "General" },
  workflows: { zh: "Workflows", en: "Workflows" },
  layoutTemplates: { zh: "布局模板", en: "Layout templates" },
  triggers: { zh: "触发器", en: "Triggers" },
  shortcuts: { zh: "快捷键", en: "Shortcuts" },
  diagnostics: { zh: "诊断", en: "Diagnostics" },
  agent: { zh: "Agent", en: "Agent" },
  git: { zh: "Git", en: "Git" },
  history: { zh: "历史", en: "History" },
  notifications: { zh: "通知", en: "Notifications" },
  search: { zh: "搜索", en: "Search" },
  commandPalette: { zh: "命令面板", en: "Command palette" },
  close: { zh: "关闭", en: "Close" },
  closeOthers: { zh: "关闭其他", en: "Close others" },
  rename: { zh: "重命名", en: "Rename" },
  splitRight: { zh: "向右分屏", en: "Split right" },
  splitDown: { zh: "向下分屏", en: "Split down" },
  syncInput: { zh: "同步输入", en: "Sync input" },
  rerun: { zh: "重跑", en: "Rerun" },
  favorite: { zh: "收藏", en: "Favorite" },
  copyCommand: { zh: "复制命令", en: "Copy command" },
  copyOutput: { zh: "复制输出", en: "Copy output" },
  markAllRead: { zh: "全部已读", en: "Mark all read" },
  noNotifications: { zh: "暂无通知", en: "No notifications" },
  scanAgents: { zh: "扫描 Agent 会话", en: "Scan agent sessions" },
  scanning: { zh: "扫描中…", en: "Scanning…" },
  resume: { zh: "恢复会话", en: "Resume" },
  viewMessages: { zh: "查看消息", en: "Messages" },
  checkout: { zh: "切换分支", en: "Checkout" },
  refresh: { zh: "刷新", en: "Refresh" },
  save: { zh: "保存", en: "Save" },
  cancel: { zh: "取消", en: "Cancel" },
  run: { zh: "运行", en: "Run" },
  delete: { zh: "删除", en: "Delete" },
  apply: { zh: "应用", en: "Apply" },
  reset: { zh: "重置", en: "Reset" },
  disable: { zh: "禁用", en: "Disable" },
  enable: { zh: "启用", en: "Enable" },
  cleanStart: { zh: "清洁启动", en: "Clean start" },
  restoreWorkspace: { zh: "恢复上次工作区", en: "Restore last workspace" },
  crashTitle: { zh: "检测到异常退出", en: "Unexpected shutdown detected" },
  crashBody: {
    zh: "上次会话未正常结束。可以恢复布局与工作上下文，或以空工作区启动（恢复数据仍会保留）。",
    en: "The last session did not exit cleanly. Restore layout & context, or start clean (recovery data is preserved).",
  },
  readOnlyWarning: {
    zh: "存储暂不可写，应用处于只读警告状态，更改不会保存。",
    en: "Storage is not writable; the app is in read-only warning mode. Changes won't persist.",
  },
  truncatedNotice: {
    zh: "[… 输出历史已截断，仅显示最近内容 …]",
    en: "[… earlier output truncated; showing recent only …]",
  },
};

export let currentLang: "zh" | "en" = "zh";

export function setLanguage(lang: string) {
  currentLang = lang.startsWith("zh") ? "zh" : "en";
}

export function t(key: keyof typeof dict | string): string {
  const entry = dict[key];
  if (!entry) return key;
  return currentLang === "zh" ? entry.zh : entry.en;
}
