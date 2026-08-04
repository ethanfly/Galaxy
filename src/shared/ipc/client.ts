// Typed IPC client — every Tauri command has exactly one typed wrapper here.
import { invoke } from "@tauri-apps/api/core";

import type {
  AgentAvailability,
  AgentConversation,
  AgentMessage,
  AppConfig,
  BlockListResult,
  BootInfo,
  CommandBlock,
  DiagnosticsInfo,
  GitBranch,
  GitStatus,
  InsightsRange,
  InsightsSummary,
  LayoutTemplate,
  NotificationItem,
  PaneChunk,
  Project,
  ReplayDto,
  ResolvedWorkflow,
  Session,
  ShellProfile,
  SplitDirection,
  TemplateNode,
  UpdateInfo,
  WindowStateCfg,
  AgentScanResult,
} from "./types";

export class IpcError extends Error {
  code: string;
  detail?: string;
  constructor(e: { code?: string; message?: string; detail?: string } | string) {
    const msg = typeof e === "string" ? e : e.message ?? "未知错误";
    super(msg);
    this.code = typeof e === "string" ? "UNKNOWN" : e.code ?? "UNKNOWN";
    this.detail = typeof e === "string" ? undefined : e.detail;
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new IpcError(e as never);
  }
}

// ------------------------------------------------------------------ projects
export const projectList = () => call<Project[]>("project_list");
export const projectAdd = (path: string, name?: string, color?: string) =>
  call<Project>("project_add", { path, name, color });
export const projectUpdate = (project: Project) =>
  call<Project>("project_update", { project });
export const projectRemove = (id: string, force = false) =>
  call<void>("project_remove", { id, force });

// ------------------------------------------------------------------ sessions
export const sessionList = () => call<Session[]>("session_list");
export const sessionCreate = (projectId: string, opts?: { title?: string; profileId?: string; cwd?: string }) =>
  call<Session>("session_create", { projectId, ...opts });
export const sessionClose = (id: string) => call<void>("session_close", { id });
export const sessionRename = (id: string, title: string) =>
  call<Session>("session_rename", { id, title });
export const sessionReorder = (ids: string[]) => call<void>("session_reorder", { ids });
export const sessionSetSyncInput = (id: string, sync: boolean) =>
  call<Session>("session_set_sync_input", { id, sync });

// ------------------------------------------------------------------ layout
export const paneSplit = (paneId: string, direction: SplitDirection, profileId?: string) =>
  call<Session>("pane_split", { paneId, direction, profileId });
export const paneClose = (paneId: string) => call<string | null>("pane_close", { paneId });
export const paneMoveToSession = (paneId: string, targetSessionId: string) =>
  call<void>("pane_move_to_session", { paneId, targetSessionId });
export const layoutSetRatio = (sessionId: string, path: boolean[], ratio: number) =>
  call<void>("layout_set_ratio", { sessionId, path, ratio });
export const templateSave = (sessionId: string, name: string) =>
  call<LayoutTemplate>("template_save", { sessionId, name });
export const templateApply = (sessionId: string, templateId: string) =>
  call<Session>("template_apply", { sessionId, templateId });
export const templateDelete = (id: string) => call<void>("template_delete", { id });
export const workspaceRestore = () => call<number>("workspace_restore");
export const recoveryCleanStart = () => call<void>("recovery_clean_start");

// ------------------------------------------------------------------ pty
export const ptyWrite = (paneId: string, data: string) =>
  call<void>("pty_write", { paneId, data });
export const ptyBroadcast = (sessionId: string, data: string) =>
  call<void>("pty_broadcast", { sessionId, data });
export const ptyResize = (paneId: string, cols: number, rows: number) =>
  call<void>("pty_resize", { paneId, cols, rows });
export const ptyReplay = (paneId: string, afterSeq: number) =>
  call<ReplayDto>("pty_replay", { paneId, afterSeq });
export const ptyKill = (paneId: string) => call<void>("pty_kill", { paneId });

// ------------------------------------------------------------------ blocks
export const blockList = (sessionId?: string) =>
  call<BlockListResult>("block_list", { sessionId: sessionId ?? null });
export const blockSearch = (query: string, favoritesOnly = false) =>
  call<CommandBlock[]>("block_search", { query, favoritesOnly });
export const blockSetFavorite = (id: string, favorite: boolean) =>
  call<CommandBlock | null>("block_set_favorite", { id, favorite });
export const blockRerun = (id: string, paneId: string) =>
  call<void>("block_rerun", { id, paneId });
export const blocksClearNonFavorites = () => call<number>("blocks_clear_non_favorites");
export const insightsSummary = (
  projectId: string | null,
  range: InsightsRange,
  timezoneOffsetMinutes: number,
) => call<InsightsSummary>("insights_summary", { projectId, range, timezoneOffsetMinutes });

// ------------------------------------------------------------------ agents
export const agentScan = (projectPath: string) =>
  call<AgentScanResult>("agent_scan", { projectPath });
export const agentScanCancel = () => call<void>("agent_scan_cancel");
export const agentAvailability = () => call<AgentAvailability[]>("agent_availability");
export const agentMessages = (conversation: AgentConversation, limit = 200) =>
  call<AgentMessage[]>("agent_messages", { conversation, limit });
export const agentOpenConversation = (projectId: string, conversation: AgentConversation) =>
  call<Session>("agent_open_conversation", { projectId, conversation });
export const agentStatusMap = () => call<Record<string, string>>("agent_status_map");

// ------------------------------------------------------------------ git
export const gitStatus = (projectId: string) => call<GitStatus>("git_status", { projectId });
export const gitBranches = (projectId: string) => call<GitBranch[]>("git_branches", { projectId });
export const gitCheckout = (projectId: string, branch: string) =>
  call<void>("git_checkout", { projectId, branch });
export const gitRefresh = (projectId: string) => call<GitStatus>("git_refresh", { projectId });

// ------------------------------------------------------------------ workflows
export const workflowList = () => call<import("./types").Workflow[]>("workflow_list");
export const workflowResolve = (id: string, values: Record<string, string>, cwd?: string) =>
  call<ResolvedWorkflow>("workflow_resolve", { id, values, cwd: cwd ?? null });
export const workflowRun = (
  workflowId: string,
  values: Record<string, string>,
  targetPaneId: string,
  cwd?: string,
) => call<void>("workflow_run", { workflowId, values, targetPaneId, cwd: cwd ?? null });

// ------------------------------------------------------------------ notifications
export const notificationList = () => call<NotificationItem[]>("notification_list");
export const notificationMarkRead = (ids?: string[]) =>
  call<void>("notification_mark_read", { ids: ids ?? null });

// ------------------------------------------------------------------ system
export const configGet = () => call<AppConfig>("config_get");
export const configUpdate = (config: AppConfig) => call<AppConfig>("config_update", { config });
export const configResetShortcuts = () => call<AppConfig>("config_reset_shortcuts");
export const profilesList = () => call<ShellProfile[]>("profiles_list");
export const profilesRedetect = () => call<ShellProfile[]>("profiles_redetect");
export const diagnosticsInfo = () => call<DiagnosticsInfo>("diagnostics_info");
export const diagnosticsReport = () => call<string>("diagnostics_report");
export const systemOpenExternal = (url: string) => call<void>("system_open_external", { url });
export const systemOpenPath = (path: string) => call<void>("system_open_path", { path });
export const systemPendingOpenHere = () => call<string[]>("system_pending_open_here");
export const windowSaveState = (windowState: WindowStateCfg) =>
  call<void>("window_save_state", { windowState });
export const bootInfo = () => call<BootInfo>("boot_info");
export const updaterCheck = () => call<UpdateInfo>("updater_check");
export const contextMenuSet = (enabled: boolean) =>
  call<void>("context_menu_set", { enabled });

export type { PaneChunk, TemplateNode };
