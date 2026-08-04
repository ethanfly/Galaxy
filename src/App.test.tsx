import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eventMocks = vi.hoisted(() => ({
  onAgentStatus: vi.fn(),
  onGitChanged: vi.fn(),
  onNotification: vi.fn(),
  onOpenHere: vi.fn(),
  onPtyExit: vi.fn(),
  onPtyOutput: vi.fn(),
  onRecoveryAvailable: vi.fn(),
  onSessionTitle: vi.fn(),
  onTriggerFire: vi.fn(),
}));

vi.mock("./shared/ipc/events", () => eventMocks);
vi.mock("./features/shortcuts/useShortcuts", () => ({ useShortcuts: () => {} }));
vi.mock("./features/titlebar/TitleBar", () => ({ TitleBar: () => null }));
vi.mock("./features/tabs/TabBar", () => ({ TabBar: () => null }));
vi.mock("./features/projects/ProjectSidebar", () => ({ ProjectSidebar: () => null }));
vi.mock("./features/terminal/Workspace", () => ({
  Workspace: () => <div data-testid="workspace-instance" />,
}));
vi.mock("./features/panels/RightPanel", () => ({ RightPanel: () => null }));
vi.mock("./features/statusbar/StatusBar", () => ({ StatusBar: () => null }));
vi.mock("./features/search/FindBar", () => ({ FindBar: () => null }));
vi.mock("./features/search/BlockSearchModal", () => ({ BlockSearchModal: () => null }));
vi.mock("./features/search/HistorySearchModal", () => ({ HistorySearchModal: () => null }));
vi.mock("./features/search/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("./features/settings/SettingsModal", () => ({ SettingsModal: () => null }));
vi.mock("./features/recovery/RecoveryDialog", () => ({ RecoveryDialog: () => null }));
vi.mock("./features/workflow/WorkflowRunModal", () => ({ WorkflowRunModal: () => null }));
vi.mock("./features/terminal/MovePaneModal", () => ({ MovePaneModal: () => null }));
vi.mock("./features/insights/InsightsView", () => ({ InsightsView: () => null }));

import App from "./App";
import { useAppStore } from "./shared/stores/appStore";
import { useUiStore } from "./shared/stores/uiStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const allEventMocks = Object.values(eventMocks);

describe("App global event listener lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const subscribe of allEventMocks) {
      subscribe.mockResolvedValue(vi.fn());
    }
    useAppStore.setState({
      boot: null,
      config: null,
      currentProjectId: null,
      currentSessionId: null,
      error: null,
      init: vi.fn(async () => {}),
      loadState: "ready",
      notifications: [],
      openHereQueue: [],
      profiles: [],
      projects: [],
      sessions: [],
      unreadCount: 0,
    });
    useUiStore.setState({ workspaceView: "terminal", contextSidebarOpen: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("handles a rejected global listener registration", async () => {
    const failure = new Error("listen failed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    eventMocks.onPtyOutput.mockRejectedValueOnce(failure);

    render(<App />);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to register global IPC listener",
        failure,
      );
    });
  });

  it("unlistens a registration that resolves after App cleanup", async () => {
    const late = deferred<() => void>();
    const unlisten = vi.fn();
    eventMocks.onPtyOutput.mockReturnValueOnce(late.promise);

    const view = render(<App />);
    view.unmount();

    await act(async () => {
      late.resolve(unlisten);
      await late.promise;
    });

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("keeps the terminal workspace mounted while insights is active", () => {
    render(<App />);
    const terminalSurface = document.querySelector<HTMLElement>("[data-testid=terminal-surface]");
    const workspace = document.querySelector<HTMLElement>("[data-testid=workspace-instance]");

    expect(terminalSurface).not.toBeNull();
    expect(workspace).not.toBeNull();
    expect(terminalSurface?.getAttribute("aria-hidden")).toBe("false");

    act(() => useUiStore.getState().setWorkspaceView("insights"));

    expect(document.querySelector("[data-testid=terminal-surface]")).toBe(terminalSurface);
    expect(document.querySelector("[data-testid=workspace-instance]")).toBe(workspace);
    expect(terminalSurface?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("[data-testid=insights-surface]")).not.toBeNull();
  });
});
