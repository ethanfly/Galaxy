import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openDirectory = vi.hoisted(() => vi.fn(async () => "C:\\work\\new-project"));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDirectory }));

import { useAppStore } from "../../shared/stores/appStore";
import { useTerminalStore } from "../../shared/stores/terminalStore";
import { useUiStore } from "../../shared/stores/uiStore";
import { ContextSidebar } from "./ContextSidebar";

describe("ContextSidebar", () => {
  const addProject = vi.fn(async () => null);

  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ workspaceView: "terminal", contextSidebarOpen: true });
    useTerminalStore.setState({ agentStatus: {} });
    useAppStore.setState({
      projects: [
        {
          id: "p1",
          name: "Galaxy",
          path: "C:\\work\\galaxy",
          color: "#fff",
          createdAt: "2026-01-01T00:00:00Z",
          lastAccessedAt: "2026-01-01T00:00:00Z",
        },
      ],
      sessions: [
        {
          id: "s1",
          projectId: "p1",
          title: "终端 1",
          sortOrder: 0,
          syncInput: false,
          createdAt: "2026-01-01T00:00:00Z",
          layout: {
            pane: {
              id: "pane-1",
              cwd: "C:\\work\\galaxy",
              profile: {
                id: "pwsh",
                name: "PowerShell",
                program: "pwsh",
                args: [],
                env: {},
                source: "detected",
              },
              cols: 80,
              rows: 24,
              title: "codex · galaxy",
              active: true,
              agentKind: "codex",
            },
          },
        },
      ],
      currentProjectId: "p1",
      currentSessionId: "s1",
      addProject,
    });
  });

  it("adds a project chosen from the directory picker", async () => {
    render(<ContextSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "添加项目" }));

    await waitFor(() => expect(addProject).toHaveBeenCalledWith("C:\\work\\new-project"));
  });

  it("mirrors tab titles and agent badges in the session list", () => {
    render(<ContextSidebar />);

    expect(screen.getByRole("button", { name: /codex · galaxy/i })).toBeTruthy();
    expect(screen.getByLabelText("Codex CLI")).toBeTruthy();
  });

  it("suppresses the native browser context menu", () => {
    const { container } = render(<ContextSidebar />);
    const sidebar = container.querySelector(".context-sidebar");
    expect(sidebar).toBeTruthy();

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    sidebar!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
