import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openDirectory = vi.hoisted(() => vi.fn(async () => "C:\\work\\new-project"));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDirectory }));

import { useAppStore } from "../../shared/stores/appStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { ContextSidebar } from "./ContextSidebar";

describe("ContextSidebar", () => {
  const addProject = vi.fn(async () => null);

  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ workspaceView: "terminal", contextSidebarOpen: true });
    useAppStore.setState({
      projects: [],
      sessions: [],
      currentProjectId: null,
      currentSessionId: null,
      addProject,
    });
  });

  it("adds a project chosen from the directory picker", async () => {
    render(<ContextSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "添加项目" }));

    await waitFor(() => expect(addProject).toHaveBeenCalledWith("C:\\work\\new-project"));
  });
});
