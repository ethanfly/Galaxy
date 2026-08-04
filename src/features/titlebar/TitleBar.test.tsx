import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
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
});
