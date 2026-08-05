// Business state cache — short-lived mirrors of Rust-owned truth.
// The backend stays authoritative; actions here refresh from commands.
import { create } from "zustand";

import * as ipc from "../ipc/client";
import type {
  AppConfig,
  BootInfo,
  NotificationItem,
  Project,
  Session,
  ShellProfile,
} from "../ipc/types";
import { setLanguage } from "../i18n";

export type LoadState = "idle" | "loading" | "ready" | "error";

interface AppStoreState {
  boot: BootInfo | null;
  loadState: LoadState;
  error: string | null;
  projects: Project[];
  sessions: Session[];
  config: AppConfig | null;
  profiles: ShellProfile[];
  currentProjectId: string | null;
  currentSessionId: string | null;
  notifications: NotificationItem[];
  unreadCount: number;
  openHereQueue: string[];

  init(): Promise<void>;
  refreshProjects(): Promise<void>;
  refreshSessions(): Promise<void>;
  refreshConfig(): Promise<void>;
  refreshProfiles(): Promise<void>;
  refreshNotifications(): Promise<void>;
  /** Kick deferred PTY restore for the focused session (no-op path when gated). */
  restoreWorkspace(prioritySessionId?: string | null): Promise<void>;

  selectProject(id: string): void;
  selectSession(id: string): void;
  addProject(path: string): Promise<Project | null>;
  removeProject(id: string, force?: boolean): Promise<boolean>;
  createSession(projectId: string): Promise<Session | null>;
  closeSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  reorderSessions(ids: string[]): Promise<void>;
  setSessionSync(id: string, sync: boolean): Promise<void>;
  updateSessionLocal(session: Session): void;
  updatePaneAgent(paneId: string, agentKind: string): void;
  updatePaneTitle(paneId: string, sessionId: string, title: string): void;
  setConfig(config: AppConfig): Promise<boolean>;
  markNotificationsRead(ids?: string[]): Promise<void>;
  enqueueOpenHere(path: string): void;
  drainOpenHere(): string[];
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  boot: null,
  loadState: "idle",
  error: null,
  projects: [],
  sessions: [],
  config: null,
  profiles: [],
  currentProjectId: null,
  currentSessionId: null,
  notifications: [],
  unreadCount: 0,
  openHereQueue: [],

  async init() {
    if (get().loadState === "loading") return;
    set({ loadState: "loading" });
    try {
      const [boot, projects, sessions, config, profiles, notifications, pendingOpenHere] =
        await Promise.all([
          ipc.bootInfo(),
          ipc.projectList(),
          ipc.sessionList(),
          ipc.configGet(),
          ipc.profilesList(),
          ipc.notificationList(),
          ipc.systemPendingOpenHere(),
        ]);
      setLanguage(config.language);
      const sorted = sortSessions(normalizeSessions(sessions));
      const currentSessionId = get().currentSessionId ?? sorted[0]?.id ?? null;
      set({
        boot,
        projects,
        sessions: sorted,
        config,
        profiles,
        notifications,
        unreadCount: notifications.filter((n) => !n.read).length,
        // Critical path ends here — UI is interactive. PTY restore is deferred
        // and must not delay loadState: "ready".
        loadState: "ready",
        currentProjectId: get().currentProjectId ?? projectOfFirst(sorted, projects),
        currentSessionId,
        openHereQueue: pendingOpenHere,
      });
      // After a crash, wait for RecoveryDialog — do not race clean-start with
      // multi-session background restore. Normal boot restores immediately.
      if (!boot.recoveredFromCrash) {
        void get().restoreWorkspace(currentSessionId);
      }
    } catch (e) {
      set({ loadState: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  async restoreWorkspace(prioritySessionId) {
    const focus =
      prioritySessionId ?? get().currentSessionId ?? get().sessions[0]?.id ?? null;
    try {
      await ipc.workspaceRestore(focus);
      await get().refreshSessions();
    } catch {
      /* per-pane failures are tolerated on the backend */
    }
  },

  async refreshProjects() {
    const projects = await ipc.projectList();
    set({ projects });
  },

  async refreshSessions() {
    const sessions = await ipc.sessionList();
    set({ sessions: sortSessions(normalizeSessions(sessions)) });
  },

  async refreshConfig() {
    const config = await ipc.configGet();
    setLanguage(config.language);
    set({ config });
  },

  async refreshProfiles() {
    const profiles = await ipc.profilesList();
    set({ profiles });
  },

  async refreshNotifications() {
    const notifications = await ipc.notificationList();
    set({ notifications, unreadCount: notifications.filter((n) => !n.read).length });
  },

  selectProject(id) {
    const project = get().projects.find((p) => p.id === id);
    if (!project) return;
    const inProject = get().sessions.find((s) => s.projectId === id);
    set({
      currentProjectId: id,
      // Cross-project tab switch syncs current project (spec §5.1).
      currentSessionId:
        get().currentSessionId &&
        get().sessions.find((s) => s.id === get().currentSessionId)?.projectId === id
          ? get().currentSessionId
          : inProject?.id ?? null,
    });
  },

  selectSession(id) {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;
    set({ currentSessionId: id, currentProjectId: session.projectId });
  },

  async addProject(path) {
    try {
      const project = await ipc.projectAdd(path);
      await get().refreshProjects();
      get().selectProject(project.id);
      return project;
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  async removeProject(id, force = false) {
    try {
      await ipc.projectRemove(id, force);
      await Promise.all([get().refreshProjects(), get().refreshSessions()]);
      if (get().currentProjectId === id) {
        const first = get().projects[0]?.id ?? null;
        set({ currentProjectId: first });
      }
      return true;
    } catch (e) {
      const err = e as ipc.IpcError;
      if (err.code === "PROJECT_HAS_RUNNING_SESSIONS" && !force) {
        return get().removeProject(id, true);
      }
      set({ error: err.message });
      return false;
    }
  },

  async createSession(projectId) {
    try {
      const session = await ipc.sessionCreate(projectId);
      await get().refreshSessions();
      get().selectSession(session.id);
      return session;
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  async closeSession(id) {
    await ipc.sessionClose(id);
    const remaining = get().sessions.filter((s) => s.id !== id);
    set({ sessions: remaining });
    if (get().currentSessionId === id) {
      set({ currentSessionId: remaining[0]?.id ?? null });
    }
  },

  async renameSession(id, title) {
    await ipc.sessionRename(id, title);
    await get().refreshSessions();
  },

  async reorderSessions(ids) {
    await ipc.sessionReorder(ids);
    await get().refreshSessions();
  },

  async setSessionSync(id, sync) {
    await ipc.sessionSetSyncInput(id, sync);
    await get().refreshSessions();
  },

  updateSessionLocal(session) {
    const normalized = { ...session, layout: normalizeLayout(session.layout) };
    set({
      sessions: sortSessions(
        get().sessions.map((s) => (s.id === normalized.id ? normalized : s)),
      ),
    });
  },

  updatePaneAgent(paneId, agentKind) {
    set({
      sessions: get().sessions.map((s) => ({
        ...s,
        layout: mapLayout(s.layout, (p) =>
          p.id === paneId ? { ...p, agentKind: agentKind as never } : p,
        ),
      })),
    });
  },

  updatePaneTitle(paneId, sessionId, title) {
    set({
      sessions: get().sessions.map((s) =>
        s.id !== sessionId
          ? s
          : {
              ...s,
              // Show most recent pane title on the tab when there's a single pane.
              layout: mapLayout(s.layout, (p) => (p.id === paneId ? { ...p, title } : p)),
            },
      ),
    });
  },

  async setConfig(config) {
    try {
      await ipc.configUpdate(config);
      set({ config, error: null });
      return true;
    } catch (e) {
      set({ error: (e as Error).message });
      return false;
    }
  },

  async markNotificationsRead(ids) {
    await ipc.notificationMarkRead(ids);
    await get().refreshNotifications();
  },

  enqueueOpenHere(path) {
    set({ openHereQueue: [...get().openHereQueue, path] });
  },

  drainOpenHere() {
    const q = get().openHereQueue;
    set({ openHereQueue: [] });
    return q;
  },
}));

export function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

function projectOfFirst(sessions: Session[], projects: Project[]): string | null {
  if (sessions.length > 0) return sessions[0].projectId;
  return projects[0]?.id ?? null;
}

import type { LayoutNodeRust, Pane } from "../ipc/types";
import { unwrapPane } from "../utils";

function mapLayout(node: LayoutNodeRust, f: (p: Pane) => Pane): LayoutNodeRust {
  if ("pane" in node) {
    const base = unwrapPane(node.pane as Pane | { pane: Pane });
    if (!base) return node;
    return { pane: f(base) };
  }
  return {
    split: {
      direction: node.split.direction,
      ratio: node.split.ratio,
      first: mapLayout(node.split.first, f),
      second: mapLayout(node.split.second, f),
    },
  };
}

/** Coerce any legacy double-nested layout nodes into the flat pane contract. */
function normalizeLayout(node: LayoutNodeRust): LayoutNodeRust {
  return mapLayout(node, (p) => p);
}

function normalizeSessions(sessions: Session[]): Session[] {
  return sessions.map((s) => ({ ...s, layout: normalizeLayout(s.layout) }));
}
