import { expect, test, type Page } from "playwright/test";

async function mockInsightsApp(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Map<string, Array<(event: { payload: unknown }) => void>>();
    const daily = Array.from({ length: 365 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 7, 5 + index));
      const commandCount = index % 9 === 0 ? 0 : (index * 7) % 18 + 1;
      const failureCount = commandCount ? (index % 11 === 0 ? 2 : index % 6 === 0 ? 1 : 0) : 0;
      return {
        date: date.toISOString().slice(0, 10), commandCount,
        successCount: Math.max(0, commandCount - failureCount), failureCount,
        activeDurationMs: commandCount * 48_000,
        level: commandCount === 0 ? 0 : Math.min(4, Math.ceil(commandCount / 5)),
      };
    });
    const config = {
      schemaVersion: 3, language: "zh-CN", terminalFontSize: 14, uiFontSize: 13,
      theme: "dark", customProfiles: [], globalHotkey: null, contextMenuEnabled: true,
      agentNotifications: true, triggerNotifications: true, shortcuts: [],
      statusbarComponents: ["sessions", "notifications", "clock"],
      windowState: { width: 1440, height: 900, maximized: false },
      layoutTemplates: [], workflows: [], triggers: [], hardwareAcceleration: true,
      defaultProfileId: null,
      featureFlags: { commandBlocks: true, agentPanel: true, gitPanel: true, workflows: true, triggers: true },
    };
    const projects = [
      { id: "p1", name: "Galaxy Terminal", path: "E:\\workspace\\galaxy", color: "#67d9ad", createdAt: "2025-01-01T00:00:00Z" },
      { id: "p2", name: "Telemetry Lab", path: "E:\\workspace\\telemetry", color: "#d0b36d", createdAt: "2025-01-02T00:00:00Z" },
    ];
    const insights = {
      range: "year", startDate: daily[0].date, endDate: daily[daily.length - 1].date,
      summary: { commandCount: 2418, activeDays: 324, successRate: 0.91, activeDurationMs: 524_400_000 },
      daily,
      projects: [
        { projectId: "p1", projectName: "Galaxy Terminal", commandCount: 1480, activeDurationMs: 318_000_000, failureRate: 0.07 },
        { projectId: "p2", projectName: "Telemetry Lab", commandCount: 938, activeDurationMs: 206_400_000, failureRate: 0.12 },
      ],
      agents: [
        { agentKind: "claudeCode", commandCount: 1120, sessionCount: 48 },
        { agentKind: "codex", commandCount: 876, sessionCount: 39 },
        { agentKind: null, commandCount: 422, sessionCount: 21 },
      ],
      recent: [
        { id: "b1", paneId: "pane-1", sessionId: "s1", projectId: "p1", projectName: "Galaxy Terminal", command: "cargo test --locked", startedAt: "2026-08-04T04:20:00Z", durationMs: 84_200, exitCode: 0, favorite: true, agentKind: "codex" },
        { id: "b2", paneId: "pane-2", sessionId: "s2", projectId: "p2", projectName: "Telemetry Lab", command: "npm run build", startedAt: "2026-08-04T03:42:00Z", durationMs: 18_700, exitCode: 1, favorite: false, agentKind: null },
      ],
      invalidRecordCount: 0,
    };
    const responses: Record<string, unknown> = {
      boot_info: { recoveredFromCrash: false, readOnly: false, dataDir: "D" },
      project_list: projects, session_list: [], config_get: config, profiles_list: [],
      notification_list: [], system_pending_open_here: [], workspace_restore: 0,
      insights_summary: insights,
    };
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: (command: string) => Promise.resolve(responses[command]),
      transformCallback: () => 0,
      metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    };
    (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => Promise.resolve(),
      registerListener: (event: string, callback: (payload: { payload: unknown }) => void) => {
        const entries = listeners.get(event) ?? [];
        entries.push(callback);
        listeners.set(event, entries);
        return Promise.resolve(entries.length);
      },
    };
  });
}

test.describe("workspace insights", () => {
  test("renders a dense year overview and remains usable on narrow screens", async ({ page }) => {
    await mockInsightsApp(page);
    await page.goto("/");
    await page.getByRole("button", { name: "洞察", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "工作区洞察" })).toBeVisible();
    await expect(page.getByRole("gridcell")).toHaveCount(365);
    await expect(page.getByText("cargo test --locked")).toBeVisible();
    await page.screenshot({ path: "test-results/insights-desktop.png", fullPage: true });

    await page.setViewportSize({ width: 800, height: 760 });
    await expect(page.getByRole("heading", { name: "项目排行" })).toBeVisible();
    await page.screenshot({ path: "test-results/insights-narrow.png", fullPage: true });
  });
});
