import { beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "./uiStore";

describe("uiStore workspace navigation", () => {
  beforeEach(() => {
    useUiStore.setState({
      workspaceView: "terminal",
      contextSidebarOpen: true,
    });
  });

  it("switches between terminal and insights views", () => {
    useUiStore.getState().setWorkspaceView("insights");
    expect(useUiStore.getState().workspaceView).toBe("insights");

    useUiStore.getState().setWorkspaceView("terminal");
    expect(useUiStore.getState().workspaceView).toBe("terminal");
  });

  it("toggles the contextual sidebar from the terminal workspace", () => {
    useUiStore.getState().toggleWorkspaceContext();
    expect(useUiStore.getState().contextSidebarOpen).toBe(false);
    expect(useUiStore.getState().workspaceView).toBe("terminal");
  });

  it("reveals the terminal context when toggled from insights", () => {
    useUiStore.setState({ workspaceView: "insights", contextSidebarOpen: false });

    useUiStore.getState().toggleWorkspaceContext();

    expect(useUiStore.getState().workspaceView).toBe("terminal");
    expect(useUiStore.getState().contextSidebarOpen).toBe(true);
  });
});
