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

describe("uiStore appearance preview", () => {
  beforeEach(() => {
    useUiStore.setState({ appearancePreview: null, settingsOpen: false });
  });

  it("starts without an appearance preview", () => {
    expect(useUiStore.getInitialState().appearancePreview).toBeNull();
  });

  it("stores a complete appearance preview pair", () => {
    useUiStore.getState().setAppearancePreview({ terminalFontSize: 20, uiFontSize: 18 });

    expect(useUiStore.getState().appearancePreview).toEqual({
      terminalFontSize: 20,
      uiFontSize: 18,
    });
  });

  it("clears the appearance preview when settings close", () => {
    useUiStore.setState({
      settingsOpen: true,
      appearancePreview: { terminalFontSize: 20, uiFontSize: 18 },
    });

    useUiStore.getState().closeSettings();

    expect(useUiStore.getState().settingsOpen).toBe(false);
    expect(useUiStore.getState().appearancePreview).toBeNull();
  });

  it("retains an active preview when navigating to a settings chapter", () => {
    useUiStore.setState({ appearancePreview: { terminalFontSize: 20, uiFontSize: 18 } });

    useUiStore.getState().openSettings("templates");

    expect(useUiStore.getState().appearancePreview).toEqual({
      terminalFontSize: 20,
      uiFontSize: 18,
    });
  });
});
