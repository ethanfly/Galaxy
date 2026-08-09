import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { ShellProfile } from "../ipc/types";
import { sortSessions, useAppStore } from "./appStore";
import { useTerminalStore } from "./terminalStore";

type ProfilesListFn = () => Promise<ShellProfile[]>;

const ipcMocks = vi.hoisted(() => {
  let resolveRestore: ((n: number) => void) | null = null;
  // Typed explicitly — bare vi.fn(async () => []) becomes Mock of never[] under tsc.
  const profilesList = vi.fn() as Mock<ProfilesListFn>;
  profilesList.mockResolvedValue([]);

  return {
    bootInfo: vi.fn(async () => ({ recoveredFromCrash: false, readOnly: false, dataDir: "D" })),
    projectList: vi.fn(async () => [
      {
        id: "p1",
        name: "proj",
        path: "C:\\proj",
        color: "#f5f6f7",
        createdAt: "2026-01-01T00:00:00Z",
        lastAccessedAt: "2026-01-01T00:00:00Z",
      },
    ]),
    sessionList: vi.fn(async () => [
      {
        id: "s1",
        projectId: "p1",
        title: "终端 1",
        sortOrder: 1,
        layout: {
          pane: {
            id: "pane-1",
            cwd: "C:\\proj",
            profile: { id: "pwsh", name: "pwsh", program: "pwsh", args: [], icon: null, env: {}, source: "detected" },
            cols: 80,
            rows: 24,
            title: "终端 1",
            active: true,
          },
        },
        syncInput: false,
        createdAt: "2026-01-01T00:00:01Z",
      },
      {
        id: "s2",
        projectId: "p1",
        title: "终端 2",
        sortOrder: 0,
        layout: { pane: null },
        syncInput: false,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]),
    configGet: vi.fn(async () => ({
      schemaVersion: 3,
      language: "zh-CN",
      terminalFontSize: 14,
      uiFontSize: 13,
      theme: "dark",
      customProfiles: [],
      statusbarComponents: ["git"],
      windowState: { width: 1440, height: 900, maximized: false },
      layoutTemplates: [],
      workflows: [],
      triggers: [],
      shortcuts: [],
      featureFlags: {
        commandBlocks: true,
        agentPanel: true,
        gitPanel: true,
        workflows: true,
        triggers: true,
      },
      contextMenuEnabled: true,
      agentNotifications: true,
      triggerNotifications: true,
      autoCheckUpdate: true,
      hardwareAcceleration: true,
    })),
    profilesList,
    notificationList: vi.fn(async () => [
      { id: "n1", at: "2026-01-01T00:00:00Z", title: "t", body: "b", read: false },
    ]),
    systemPendingOpenHere: vi.fn(async () => ["C:\\open-here"]),
    sessionClose: vi.fn(async () => {}),
    workspaceRestore: vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveRestore = resolve;
        }),
    ),
    /** Resolve a pending workspaceRestore from a test. */
    finishRestore(n = 1) {
      resolveRestore?.(n);
      resolveRestore = null;
    },
  };
});

vi.mock("../ipc/client", () => ipcMocks);

function reset() {
  useAppStore.setState({
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
  });
  ipcMocks.workspaceRestore.mockClear();
  ipcMocks.systemPendingOpenHere.mockClear();
  ipcMocks.profilesList.mockReset();
  ipcMocks.profilesList.mockResolvedValue([]);
  ipcMocks.bootInfo.mockReset();
  ipcMocks.bootInfo.mockResolvedValue({
    recoveredFromCrash: false,
    readOnly: false,
    dataDir: "D",
  });
}

describe("appStore init", () => {
  beforeEach(reset);

  it("loads boot data, sorts sessions and selects defaults", async () => {
    await useAppStore.getState().init();
    const s = useAppStore.getState();
    expect(s.loadState).toBe("ready");
    expect(s.sessions.map((x) => x.id)).toEqual(["s2", "s1"]); // sortOrder ascending
    expect(s.currentProjectId).toBe("p1");
    expect(s.unreadCount).toBe(1);
    expect(s.openHereQueue).toEqual(["C:\\open-here"]);
    ipcMocks.finishRestore();
  });

  it("cross-project session switch syncs current project", async () => {
    await useAppStore.getState().init();
    useAppStore.getState().selectSession("s1");
    expect(useAppStore.getState().currentProjectId).toBe("p1");
    ipcMocks.finishRestore();
  });

  it("reaches ready before workspaceRestore settles and prioritizes the focused session", async () => {
    const initDone = useAppStore.getState().init();
    await initDone;

    // Critical path finished while restore is still pending.
    expect(useAppStore.getState().loadState).toBe("ready");
    expect(useAppStore.getState().sessions.length).toBe(2);
    expect(ipcMocks.workspaceRestore).toHaveBeenCalledTimes(1);
    // First sorted session is the default focus.
    expect(ipcMocks.workspaceRestore).toHaveBeenCalledWith("s2");

    ipcMocks.finishRestore(1);
    await Promise.resolve();
  });

  it("drains open-here queue at ready without waiting on PTY restore", async () => {
    await useAppStore.getState().init();
    expect(useAppStore.getState().loadState).toBe("ready");
    expect(useAppStore.getState().openHereQueue).toEqual(["C:\\open-here"]);
    expect(useAppStore.getState().drainOpenHere()).toEqual(["C:\\open-here"]);
    expect(useAppStore.getState().openHereQueue).toEqual([]);
    // Restore was kicked off but need not have finished for open-here drain.
    expect(ipcMocks.workspaceRestore).toHaveBeenCalled();
    ipcMocks.finishRestore();
  });

  it("skips automatic workspaceRestore after a crash so clean-start cannot race", async () => {
    ipcMocks.bootInfo.mockResolvedValueOnce({
      recoveredFromCrash: true,
      readOnly: false,
      dataDir: "D",
    });
    await useAppStore.getState().init();
    expect(useAppStore.getState().loadState).toBe("ready");
    expect(useAppStore.getState().boot?.recoveredFromCrash).toBe(true);
    expect(ipcMocks.workspaceRestore).not.toHaveBeenCalled();
  });

  it("restoreWorkspace invokes backend with the focused session id", async () => {
    await useAppStore.getState().init();
    ipcMocks.finishRestore(1);
    await Promise.resolve();
    ipcMocks.workspaceRestore.mockClear();
    ipcMocks.workspaceRestore.mockResolvedValueOnce(1);

    await useAppStore.getState().restoreWorkspace();
    expect(ipcMocks.workspaceRestore).toHaveBeenCalledWith("s2");
  });

  it("refreshProfiles replaces the shell list from IPC", async () => {
    await useAppStore.getState().init();
    ipcMocks.finishRestore(1);
    const pwsh: ShellProfile = {
      id: "pwsh",
      name: "PowerShell 7",
      program: "C:\\pwsh.exe",
      args: [],
      icon: null,
      env: {},
      source: "detected",
    };
    ipcMocks.profilesList.mockResolvedValueOnce([pwsh]);
    await useAppStore.getState().refreshProfiles();
    expect(useAppStore.getState().profiles.map((p) => p.id)).toEqual(["pwsh"]);
  });
});

describe("sortSessions", () => {
  it("orders by sortOrder then createdAt", () => {
    const mk = (id: string, so: number, at: string) =>
      ({
        id,
        projectId: "p",
        title: id,
        sortOrder: so,
        layout: { pane: null },
        syncInput: false,
        createdAt: at,
      }) as never;
    const sorted = sortSessions([
      mk("b", 1, "2026-01-01T00:00:02Z"),
      mk("a", 1, "2026-01-01T00:00:01Z"),
      mk("c", 0, "2026-01-01T00:00:03Z"),
    ]);
    expect(sorted.map((s: { id: string }) => s.id)).toEqual(["c", "a", "b"]);
  });
});

describe("closeSession", () => {
  beforeEach(reset);

  it("clears runtime terminal state for the closed session's panes and focus", async () => {
    await useAppStore.getState().init();
    ipcMocks.finishRestore(1);
    await Promise.resolve();

    // Seed runtime state: a pane under s1 plus a session-level focus entry.
    useTerminalStore.setState({
      focusedPane: { s1: "pane-1", s2: "pane-2" },
      lastSeq: { "pane-1": 42 },
      agentStatus: { "pane-1": { kind: "claudeCode", status: "working" } },
    });

    await useAppStore.getState().closeSession("s1");

    const ts = useTerminalStore.getState();
    expect(ts.focusedPane.s1).toBeUndefined();
    // Other sessions' focus entries are untouched.
    expect(ts.focusedPane.s2).toBe("pane-2");
    expect(ts.lastSeq["pane-1"]).toBeUndefined();
    expect(ts.agentStatus["pane-1"]).toBeUndefined();
    expect(useAppStore.getState().sessions.map((s) => s.id)).toEqual(["s2"]);
    expect(useAppStore.getState().currentSessionId).toBe("s2");
  });

  it("keeps currentSessionId when closing a non-current session", async () => {
    await useAppStore.getState().init();
    ipcMocks.finishRestore(1);
    await Promise.resolve();
    useAppStore.getState().selectSession("s1");

    useTerminalStore.setState({ focusedPane: { s1: "pane-1", s2: "pane-2" } });
    await useAppStore.getState().closeSession("s2");

    expect(useAppStore.getState().sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(useAppStore.getState().currentSessionId).toBe("s1");
    expect(useTerminalStore.getState().focusedPane.s2).toBeUndefined();
    expect(useTerminalStore.getState().focusedPane.s1).toBe("pane-1");
  });
});
