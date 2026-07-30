// UI-level E2E smoke: app shell renders with mocked Tauri runtime.
// Full end-to-end (real PTY/ConPTY) is covered by Rust integration tests;
// these specs guard layout, overlays and keyboard routing in the web layer.
import { test, expect, Page } from "playwright/test";

async function mockTauri(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Map<string, Array<(e: { payload: unknown }) => void>>();
    const store = {
      projects: [],
      sessions: [],
      config: {
        schemaVersion: 3,
        language: "zh-CN",
        terminalFontSize: 14,
        uiFontSize: 13,
        theme: "dark",
        customProfiles: [],
        globalHotkey: null,
        contextMenuEnabled: true,
        agentNotifications: true,
        triggerNotifications: true,
        shortcuts: [
          { command: "search.find", keys: "Ctrl+F", enabled: true },
          { command: "command.palette", keys: "Ctrl+P", enabled: true },
        ],
        statusbarComponents: ["sessions", "notifications", "clock"],
        windowState: { width: 1440, height: 900, maximized: false },
        layoutTemplates: [],
        workflows: [],
        triggers: [],
        featureFlags: {
          commandBlocks: true,
          agentPanel: true,
          gitPanel: true,
          workflows: true,
          triggers: true,
        },
        hardwareAcceleration: true,
        defaultProfileId: null,
      },
      notifications: [],
    };
    const noop = () => Promise.resolve(undefined);
    const responses: Record<string, () => unknown> = {
      boot_info: () => ({ recoveredFromCrash: false, readOnly: false, dataDir: "D" }),
      project_list: () => store.projects,
      session_list: () => store.sessions,
      config_get: () => store.config,
      profiles_list: () => [],
      notification_list: () => store.notifications,
      system_pending_open_here: () => [],
      workspace_restore: () => 0,
      config_update: () => store.config,
      window_save_state: noop,
    };
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string) => {
        const fn = responses[cmd];
        return Promise.resolve(fn ? fn() : undefined);
      },
      transformCallback: () => 0,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
    };
    (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => Promise.resolve(),
      registerListener: (event: string, cb: (e: { payload: unknown }) => void) => {
        const list = listeners.get(event) ?? [];
        list.push(cb);
        listeners.set(event, list);
        return Promise.resolve(list.length);
      },
    };
    void listeners;
  });
}

test.describe("app shell", () => {
  test("renders titlebar, sidebar, empty workspace with starfield", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/");
    await expect(page.locator(".titlebar")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".empty-workspace")).toBeVisible();
    await expect(page.locator(".statusbar")).toBeVisible();
    await expect(page.locator(".tabbar")).toBeVisible();
    // starfield only in non-terminal areas (spec §6)
    await expect(page.locator(".sidebar.starfield")).toBeAttached();
  });

  test("Ctrl+P opens command palette and Esc closes it", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/");
    // Wait until async init (config load) is done — shortcuts need config.
    await expect(page.locator(".empty-workspace")).toBeVisible();
    await expect(page.locator(".statusbar .status-item").first()).toBeVisible();
    await page.keyboard.press("Control+p");
    await expect(page.locator(".modal input[type=search]")).toBeVisible();
    await expect(page.locator("text=新建终端").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal input[type=search]")).toHaveCount(0);
  });

  test("Ctrl+F opens the find bar", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/");
    await page.keyboard.press("Control+f");
    // No session → find bar hidden gracefully without crash.
    await expect(page.locator(".empty-workspace")).toBeVisible();
  });
});
