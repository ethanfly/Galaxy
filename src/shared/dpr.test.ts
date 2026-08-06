import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribeDevicePixelRatio } from "./dpr";

describe("subscribeDevicePixelRatio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-subscribes and notifies when the resolution media query fires", () => {
    const listeners = new Map<string, Set<() => void>>();
    let currentDpr = 1;

    const matchMedia = vi.fn((query: string) => {
      const mql = {
        matches: true,
        media: query,
        addEventListener: (_type: string, listener: () => void) => {
          const set = listeners.get(query) ?? new Set();
          set.add(listener);
          listeners.set(query, set);
        },
        removeEventListener: (_type: string, listener: () => void) => {
          listeners.get(query)?.delete(listener);
        },
      };
      return mql as MediaQueryList;
    });

    const fakeWindow = {
      get devicePixelRatio() {
        return currentDpr;
      },
      matchMedia,
    } as unknown as Window;

    const onChange = vi.fn();
    const dispose = subscribeDevicePixelRatio(onChange, fakeWindow);

    expect(matchMedia).toHaveBeenCalledWith("screen and (resolution: 1dppx)");
    expect(onChange).not.toHaveBeenCalled();

    currentDpr = 1.5;
    const firstListeners = [...(listeners.get("screen and (resolution: 1dppx)") ?? [])];
    expect(firstListeners.length).toBe(1);
    firstListeners[0]!();

    expect(onChange).toHaveBeenCalledWith(1.5);
    expect(matchMedia).toHaveBeenCalledWith("screen and (resolution: 1.5dppx)");

    dispose();
    // After dispose, firing old listeners must not throw or notify again.
    firstListeners[0]!();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
