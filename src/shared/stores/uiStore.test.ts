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

  it("toggles the contextual sidebar independently", () => {
    useUiStore.getState().toggleContextSidebar();
    expect(useUiStore.getState().contextSidebarOpen).toBe(false);
    expect(useUiStore.getState().workspaceView).toBe("terminal");
  });
});
