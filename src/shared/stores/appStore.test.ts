import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/client", () => ({
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
      layout: { pane: null },
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
    hardwareAcceleration: true,
  })),
  profilesList: vi.fn(async () => []),
  notificationList: vi.fn(async () => [
    { id: "n1", at: "2026-01-01T00:00:00Z", title: "t", body: "b", read: false },
  ]),
  systemPendingOpenHere: vi.fn(async () => ["C:\\open-here"]),
  workspaceRestore: vi.fn(async () => 1),
}));

import { sortSessions, useAppStore } from "./appStore";

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
  });

  it("cross-project session switch syncs current project", async () => {
    await useAppStore.getState().init();
    useAppStore.getState().selectSession("s1");
    expect(useAppStore.getState().currentProjectId).toBe("p1");
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
