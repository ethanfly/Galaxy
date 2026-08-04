import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "../../shared/stores/uiStore";
import { NavigationRail } from "./NavigationRail";

describe("NavigationRail", () => {
  beforeEach(() => {
    useUiStore.setState({
      workspaceView: "terminal",
      contextSidebarOpen: true,
      blockSearchOpen: false,
      historySearchOpen: false,
      settingsOpen: false,
    });
  });

  it("switches the primary workspace view using accessible controls", () => {
    render(<NavigationRail />);

    const terminal = screen.getByRole("button", { name: "终端" });
    const insights = screen.getByRole("button", { name: "洞察" });
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "历史" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "会话" })).toBeNull();
    expect(screen.queryByRole("button", { name: "项目" })).toBeNull();
    expect(terminal.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(insights);

    expect(useUiStore.getState().workspaceView).toBe("insights");
    expect(insights.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens settings from the persistent rail", () => {
    render(<NavigationRail />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it("opens the unified command history dialog", () => {
    render(<NavigationRail />);
    const history = screen.getByRole("button", { name: "历史" });
    expect(history.getAttribute("aria-haspopup")).toBe("dialog");
    expect(history.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(history);

    expect(useUiStore.getState().historySearchOpen).toBe(true);
    expect(useUiStore.getState().blockSearchOpen).toBe(false);
    expect(history.getAttribute("aria-expanded")).toBe("true");
  });
});
