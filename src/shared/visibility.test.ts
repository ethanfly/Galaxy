import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribeResumeInteraction } from "./visibility";

describe("subscribeResumeInteraction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires when document becomes visible again", () => {
    const listeners = new Map<string, Set<EventListener>>();
    let visibility: DocumentVisibilityState = "hidden";
    const doc = {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (type: string, listener: EventListener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      },
    };
    const win = {
      document: doc,
      addEventListener: (type: string, listener: EventListener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      },
    } as unknown as Window & typeof globalThis;

    const onResume = vi.fn();
    const dispose = subscribeResumeInteraction(onResume, win);

    visibility = "visible";
    for (const listener of listeners.get("visibilitychange") ?? []) {
      listener(new Event("visibilitychange"));
    }
    expect(onResume).toHaveBeenCalledTimes(1);

    dispose();
  });
});
