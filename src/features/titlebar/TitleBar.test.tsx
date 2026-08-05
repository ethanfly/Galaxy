import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowMocks = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  minimize: vi.fn(async () => {}),
  onResized: vi.fn(),
  startDragging: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMocks,
}));

import { TitleBar } from "./TitleBar";
import { t } from "../../shared/i18n";
import { useUiStore } from "../../shared/stores/uiStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("TitleBar resize listener lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windowMocks.isMaximized.mockResolvedValue(false);
    windowMocks.onResized.mockResolvedValue(() => {});
    useUiStore.setState({ workspaceView: "terminal", contextSidebarOpen: true });
  });

  afterEach(cleanup);

  it("unlistens a StrictMode registration that resolves after its effect was cleaned up", async () => {
    const first = deferred<() => void>();
    const second = deferred<() => void>();
    const unlistenFirst = vi.fn();
    const unlistenSecond = vi.fn();
    windowMocks.onResized
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const view = render(
      <StrictMode>
        <TitleBar />
      </StrictMode>,
    );

    expect(windowMocks.onResized).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve(unlistenFirst);
      await first.promise;
    });
    expect(unlistenFirst).toHaveBeenCalledOnce();

    await act(async () => {
      second.resolve(unlistenSecond);
      await second.promise;
    });
    expect(unlistenSecond).not.toHaveBeenCalled();

    view.unmount();
    expect(unlistenSecond).toHaveBeenCalledOnce();
  });

  it("handles rejected native window queries and listener registration", async () => {
    const queryError = new Error("query failed");
    const listenError = new Error("listen failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    windowMocks.isMaximized.mockRejectedValueOnce(queryError);
    windowMocks.onResized.mockRejectedValueOnce(listenError);

    render(<TitleBar />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).toHaveBeenCalledWith("Failed to query maximized window state", queryError);
    expect(consoleError).toHaveBeenCalledWith("Failed to register window resize listener", listenError);
    consoleError.mockRestore();
  });

  it("opens the terminal context sidebar when invoked from insights", async () => {
    useUiStore.setState({ workspaceView: "insights", contextSidebarOpen: false });
    render(<TitleBar />);
    await act(async () => {
      await Promise.resolve();
    });

    const sidebarButton = screen.getByRole("button", { name: t("toggleSidebar") });
    expect(sidebarButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(sidebarButton);

    expect(useUiStore.getState().workspaceView).toBe("terminal");
    expect(useUiStore.getState().contextSidebarOpen).toBe(true);
    expect(sidebarButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("uses the single generated Galaxy PNG in the title bar", () => {
    const { container } = render(<TitleBar />);
    const mark = container.querySelector<HTMLImageElement>("img.icon-logo");

    expect(mark?.getAttribute("src")).toBe("./icon.png");
    expect(container.querySelectorAll("img.icon-logo")).toHaveLength(1);
  });

  it("keeps native window icon controls accessible", () => {
    render(<TitleBar />);

    expect(screen.getByRole("button", { name: "最小化" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "最大化" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  });

  it("keeps settings and window controls as separate titlebar groups", () => {
    const { container } = render(<TitleBar />);

    const settings = container.querySelector(".titlebar-settings");
    const windowControls = container.querySelector(".window-controls");
    const tools = container.querySelector(".titlebar-tools");

    expect(settings).toBeTruthy();
    expect(windowControls).toBeTruthy();
    expect(tools?.contains(settings)).toBe(true);
    expect(windowControls?.contains(settings)).toBe(false);
    expect(settings?.textContent).toContain(t("settings"));
    // Settings sits immediately before native window chrome, not inside it.
    expect(tools?.nextElementSibling).toBe(windowControls);
  });
});
