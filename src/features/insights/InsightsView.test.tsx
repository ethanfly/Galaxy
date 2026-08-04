import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InsightsSummary } from "../../shared/ipc/types";

const hook = vi.hoisted(() => ({
  value: null as unknown,
  refresh: vi.fn(async () => {}),
}));
vi.mock("./useInsights", () => ({ useInsights: () => hook.value }));

import { useAppStore } from "../../shared/stores/appStore";
import { InsightsView } from "./InsightsView";

const data: InsightsSummary = {
  range: "year",
  rangeStart: "2025-08-05",
  rangeEnd: "2026-08-04",
  generatedAt: "2026-08-04T12:00:00Z",
  summary: {
    commandCount: 12,
    activeDays: 4,
    completedCount: 10,
    successCount: 8,
    successRate: 0.8,
    activeDurationMs: 3_600_000,
  },
  daily: Array.from({ length: 365 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 7, 5 + index)).toISOString().slice(0, 10),
    commandCount: index === 364 ? 12 : 0,
    successCount: index === 364 ? 8 : 0,
    failureCount: index === 364 ? 2 : 0,
    agentCommandCount: index === 364 ? 6 : 0,
    activeDurationMs: index === 364 ? 3_600_000 : 0,
    level: index === 364 ? 4 : 0,
  })),
  projects: [
    {
      projectId: "p1",
      projectName: "Galaxy",
      commandCount: 12,
      completedCount: 10,
      failureCount: 2,
      failureRate: 0.2,
      activeDurationMs: 3_600_000,
      lastActivityAt: "2026-08-04T10:00:00Z",
    },
  ],
  agents: [
    {
      agentKind: "codex",
      commandCount: 6,
      sessionCount: 2,
      lastActivityAt: "2026-08-04T10:00:00Z",
    },
  ],
  recent: [
    {
      id: "b1",
      projectId: "p1",
      projectName: "Galaxy",
      sessionId: "s1",
      paneId: "pn1",
      command: "cargo test --lib",
      startedAt: "2026-08-04T10:00:00Z",
      endedAt: "2026-08-04T10:00:02Z",
      exitCode: 0,
      agentKind: "codex",
      favorite: false,
      durationMs: 2000,
    },
  ],
  invalidRecordCount: 0,
};

describe("InsightsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      projects: [
        {
          id: "p1",
          name: "Galaxy",
          path: "C:\\Galaxy",
          color: "#00aa88",
          createdAt: "2026-01-01T00:00:00Z",
          lastAccessedAt: "2026-08-04T00:00:00Z",
        },
      ],
      sessions: [],
      currentProjectId: "p1",
    });
  });

  it("shows the complete analysis hierarchy for real activity", () => {
    hook.value = { data, loading: false, refreshing: false, error: null, refresh: hook.refresh };
    render(<InsightsView />);

    expect(screen.getByRole("heading", { level: 1, name: "工作区洞察" })).toBeTruthy();
    expect(screen.getByText("活动热力图")).toBeTruthy();
    expect(screen.getByText("活动趋势")).toBeTruthy();
    expect(screen.getByText("项目排行")).toBeTruthy();
    expect(screen.getByText("Agent 分布")).toBeTruthy();
    expect(screen.getByText("最近活动")).toBeTruthy();
    expect(screen.getByText("cargo test --lib")).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
  });

  it("shows a factual empty state", () => {
    hook.value = {
      data: { ...data, summary: { ...data.summary, commandCount: 0 }, daily: [], recent: [] },
      loading: false,
      refreshing: false,
      error: null,
      refresh: hook.refresh,
    };
    render(<InsightsView />);
    expect(screen.getByText("还没有可统计的命令活动")).toBeTruthy();
  });

  it("offers recovery after a query error", () => {
    hook.value = { data: null, loading: false, refreshing: false, error: "统计不可用", refresh: hook.refresh };
    render(<InsightsView />);
    expect(screen.getByText("统计不可用")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(hook.refresh).toHaveBeenCalledOnce();
  });
});
