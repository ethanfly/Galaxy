// IPC DTOs — mirror of src-tauri serde contracts (camelCase).
// Any change here must be mirrored in the Rust models (contract tests cover this).

export type SplitDirection = "row" | "column";

export interface ShellProfile {
  id: string;
  name: string;
  program: string;
  args: string[];
  icon?: string | null;
  env: Record<string, string>;
  source: "detected" | "custom";
}

export interface ResumeMeta {
  agentKind: AgentKind;
  externalId: string;
  resumeCommand: string;
  injected: boolean;
}

export interface Pane {
  id: string;
  cwd: string;
  profile: ShellProfile;
  cols: number;
  rows: number;
  title: string;
  active: boolean;
  exitCode?: number | null;
  agentKind?: AgentKind | null;
  resume?: ResumeMeta | null;
}

// Rust serializes the enum externally tagged with camelCase variants:
export type LayoutNodeRust =
  | { pane: Pane }
  | {
      split: {
        direction: SplitDirection;
        ratio: number;
        first: LayoutNodeRust;
        second: LayoutNodeRust;
      };
    };

export interface Session {
  id: string;
  projectId: string;
  title: string;
  sortOrder: number;
  agentKind?: AgentKind | null;
  layout: LayoutNodeRust;
  syncInput: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  defaultProfileId?: string | null;
  createdAt: string;
  lastAccessedAt: string;
}

export type AgentKind =
  | "claudeCode"
  | "codex"
  | "openCode"
  | "omp"
  | "grok"
  | "crush"
  | "gemini"
  | "copilot"
  | "aider"
  | "goose"
  | "qwen"
  | "kimi"
  | "cline"
  | "roo"
  | "continue"
  | "cursor"
  | "pi"
  | "hermes"
  | "openClaw"
  | "antigravity"
  | "amp"
  | "reasonix";

export type AgentStatus = "idle" | "working" | "blocked" | "done";

export interface CommandBlock {
  id: string;
  projectId: string;
  sessionId: string;
  paneId: string;
  command: string;
  output: string;
  startedAt: string;
  endedAt?: string | null;
  exitCode?: number | null;
  agentKind?: AgentKind | null;
  favorite: boolean;
}

export type InsightsRange = "sevenDays" | "thirtyDays" | "ninetyDays" | "year";

export interface InsightsMetrics {
  commandCount: number;
  activeDays: number;
  completedCount: number;
  successCount: number;
  successRate: number | null;
  activeDurationMs: number;
}

export interface DailyActivity {
  date: string;
  commandCount: number;
  successCount: number;
  failureCount: number;
  agentCommandCount: number;
  activeDurationMs: number;
  level: number;
}

export interface ProjectInsight {
  projectId: string;
  projectName: string;
  commandCount: number;
  completedCount: number;
  failureCount: number;
  failureRate: number | null;
  activeDurationMs: number;
  lastActivityAt: string;
}

export interface AgentInsight {
  agentKind: AgentKind | null;
  commandCount: number;
  sessionCount: number;
  lastActivityAt: string;
}

export interface RecentActivity {
  id: string;
  projectId: string;
  projectName: string;
  sessionId: string;
  paneId: string;
  command: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  agentKind: AgentKind | null;
  favorite: boolean;
  durationMs: number | null;
}

export interface InsightsSummary {
  range: InsightsRange;
  rangeStart: string;
  rangeEnd: string;
  generatedAt: string;
  summary: InsightsMetrics;
  daily: DailyActivity[];
  projects: ProjectInsight[];
  agents: AgentInsight[];
  recent: RecentActivity[];
  invalidRecordCount: number;
}

export interface AgentConversation {
  agentKind: AgentKind;
  externalId: string;
  projectPath: string;
  summary: string;
  lastMessageAt?: string | null;
  status: AgentStatus;
  resumeCommand: string;
  source: string;
}

export interface AgentMessage {
  role: string;
  text: string;
  at?: string | null;
}

export interface AgentAvailability {
  kind?: AgentKind | null;
  available: boolean;
  reason: string;
}

export interface AgentScanResult {
  conversations: AgentConversation[];
  availability: AgentAvailability[];
}

export interface NotificationItem {
  id: string;
  at: string;
  title: string;
  body: string;
  read: boolean;
  projectId?: string | null;
  paneId?: string | null;
  /** Optional UI action, e.g. `app.relaunch` after silent update install. */
  action?: string | null;
}

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string | null;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  gitAvailable: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface ShortcutBinding {
  command: string;
  keys: string;
  enabled: boolean;
}

export interface WindowStateCfg {
  x?: number | null;
  y?: number | null;
  width: number;
  height: number;
  maximized: boolean;
}

export interface LayoutTemplate {
  id: string;
  name: string;
  createdAt: string;
  node: TemplateNode;
}

export type TemplateNode =
  | "slot"
  | {
      split: {
        direction: SplitDirection;
        ratio: number;
        first: TemplateNode;
        second: TemplateNode;
      };
    };

export type ParamType =
  | "string"
  | "int"
  | "bool"
  | "path"
  | { choice: string[] };

export interface WorkflowParam {
  name: string;
  type: ParamType;
  default?: string | null;
  required: boolean;
  allowShellChars: boolean;
}

export type CwdMode = "project" | "currentPane" | { fixed: string };

export interface Workflow {
  id: string;
  name: string;
  description: string;
  commandTemplate: string;
  params: WorkflowParam[];
  cwd?: CwdMode | null;
  profileId?: string | null;
  confirmBeforeRun: boolean;
}

export interface ResolvedWorkflow {
  command: string;
  cwd?: string | null;
  requiresConfirmation: boolean;
}

export type TriggerScope =
  | "global"
  | { project: string }
  | { session: string }
  | { pane: string };

export type TriggerAction = "notify" | "mark" | "bell" | "stopScroll";

export interface Trigger {
  id: string;
  name: string;
  pattern: string;
  scope: TriggerScope;
  cooldownMs: number;
  actions: TriggerAction[];
  enabled: boolean;
  caseSensitive: boolean;
}

export interface FeatureFlags {
  commandBlocks: boolean;
  agentPanel: boolean;
  gitPanel: boolean;
  workflows: boolean;
  triggers: boolean;
}

export interface AppConfig {
  schemaVersion: number;
  language: string;
  terminalFontSize: number;
  uiFontSize: number;
  theme: string;
  defaultProfileId?: string | null;
  customProfiles: ShellProfile[];
  globalHotkey?: string | null;
  contextMenuEnabled: boolean;
  agentNotifications: boolean;
  triggerNotifications: boolean;
  /** Check for updates shortly after startup (default true). */
  autoCheckUpdate: boolean;
  shortcuts: ShortcutBinding[];
  statusbarComponents: string[];
  windowState: WindowStateCfg;
  layoutTemplates: LayoutTemplate[];
  workflows: Workflow[];
  triggers: Trigger[];
  featureFlags: FeatureFlags;
  hardwareAcceleration: boolean;
}

export interface PaneChunk {
  paneId: string;
  generation: number;
  seq: number;
  data: string;
}

export interface OutputBatch {
  chunks: PaneChunk[];
}

export interface ReplayDto {
  paneId: string;
  generation: number;
  truncated: boolean;
  fromSeq?: number | null;
  chunks: PaneChunk[];
}

export interface BlockListResult {
  blocks: CommandBlock[];
  favoriteOverflow: boolean;
}

export interface TriggerFire {
  paneId: string;
  sessionId: string;
  projectId: string;
  triggerId: string;
  triggerName: string;
  actions: TriggerAction[];
  snippet: string;
}

export interface DiagnosticsInfo {
  appVersion: string;
  os: string;
  arch: string;
  ptyBackend: string;
  configPath: string;
  dataDir: string;
  logDir: string;
  shells: string[];
  featureFlags: string[];
  capturesScreenMode: boolean;
  gitAvailable: boolean;
  schemaVersion: number;
  profileCount: number;
  gpuAcceleration: boolean;
}

export interface BootInfo {
  recoveredFromCrash: boolean;
  readOnly: boolean;
  dataDir: string;
}

export interface UpdateInfo {
  available: boolean;
  version?: string | null;
  notes?: string | null;
}

export interface UpdaterInstallResult {
  installed: boolean;
  version?: string | null;
  message?: string | null;
}

export interface CmdError {
  code: string;
  message: string;
  detail?: string;
}
