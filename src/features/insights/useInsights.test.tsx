import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightsSummary } from "../../shared/ipc/types";

const mocks = vi.hoisted(() => ({
  insightsSummary: vi.fn(),
  blocksCallback: null as null | (() => void),
  unlisten: vi.fn(),
}));

vi.mock("../../shared/ipc/client", () => ({ insightsSummary: mocks.insightsSummary }));
vi.mock("../../shared/ipc/events", () => ({
  onBlocksUpdated: (callback: () => void) => {
    mocks.blocksCallback = callback;
    return Promise.resolve(mocks.unlisten);
  },
}));

import { useInsights } from "./useInsights";

const summary: InsightsSummary = {
  range: "thirtyDays",
  rangeStart: "2026-07-06",
  rangeEnd: "2026-08-04",
  generatedAt: "2026-08-04T12:00:00Z",
  summary: {
    commandCount: 1,
    activeDays: 1,
    completedCount: 1,
    successCount: 1,
    successRate: 1,
    activeDurationMs: 2000,
  },
  daily: [],
  projects: [],
  agents: [],
  recent: [],
  invalidRecordCount: 0,
};

describe("useInsights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.blocksCallback = null;
    mocks.insightsSummary.mockResolvedValue(summary);
  });

  afterEach(() => vi.useRealTimers());

  it("loads data and retains it while a filtered refresh is pending", async () => {
    const pending = new Promise<InsightsSummary>(() => {});
    const { result, rerender } = renderHook(
      ({ projectId }) => useInsights({ projectId, range: "thirtyDays" }),
      { initialProps: { projectId: null as string | null } },
    );

    expect(result.current.loading).toBe(true);
    await act(async () => { await Promise.resolve(); });
    expect(result.current.data).toEqual(summary);

    mocks.insightsSummary.mockReturnValueOnce(pending);
    rerender({ projectId: "p2" });

    expect(result.current.data).toEqual(summary);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("debounces block updates before refreshing", async () => {
    vi.useFakeTimers();
    renderHook(() => useInsights({ projectId: null, range: "thirtyDays" }));
    await act(async () => Promise.resolve());
    expect(mocks.insightsSummary).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.blocksCallback?.();
      mocks.blocksCallback?.();
      vi.advanceTimersByTime(199);
    });
    expect(mocks.insightsSummary).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mocks.insightsSummary).toHaveBeenCalledTimes(2);
  });

  it("exposes an error and retries without discarding the contract", async () => {
    mocks.insightsSummary.mockRejectedValueOnce(new Error("统计不可用"));
    const { result } = renderHook(() =>
      useInsights({ projectId: null, range: "thirtyDays" }),
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toBe("统计不可用");

    await act(async () => result.current.refresh());

    expect(result.current.data).toEqual(summary);
    expect(result.current.error).toBeNull();
  });
});
