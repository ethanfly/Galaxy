import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "../../shared/stores/uiStore";
import { NavigationRail } from "./NavigationRail";

describe("NavigationRail", () => {
  beforeEach(() => {
    useUiStore.setState({ workspaceView: "terminal", contextSidebarOpen: true });
  });

  it("switches the primary workspace view using accessible controls", () => {
    render(<NavigationRail />);

    const terminal = screen.getByRole("button", { name: "终端" });
    const insights = screen.getByRole("button", { name: "洞察" });
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
});
