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
  test("renders the navigation rail, context sidebar, and terminal workspace", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/");
    await expect(page.locator(".titlebar")).toBeVisible();
    await expect(page.locator(".navigation-rail")).toBeVisible();
    await expect(page.locator(".context-sidebar")).toBeVisible();
    await expect(page.locator(".empty-workspace")).toBeVisible();
    await expect(page.locator(".statusbar")).toBeVisible();
    await expect(page.locator(".tabbar")).toBeVisible();
    // starfield only in non-terminal areas (spec §6)
    await expect(page.locator(".starfield")).toHaveCount(0);
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

  test("uses compact navigation and responsive monochrome settings chapters", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/");

    await expect(page.locator(".navigation-rail button")).toHaveCount(4);
    await expect(page.locator(".titlebar img.icon-logo")).toHaveCount(1);
    await expect(page.locator(".navigation-rail .rail-brand")).toHaveCount(0);
    expect(await page.locator(":root").evaluate((root) => getComputedStyle(root).getPropertyValue("--space-0").trim())).toBe("#030405");
    await expect(page.locator(".titlebar")).toHaveCSS("background-color", "rgb(3, 4, 5)");
    await page.getByRole("button", { name: "设置", exact: true }).last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".settings-nav button")).toHaveCount(6);
    const general = dialog.getByRole("button", { name: "通用", exact: true });
    await expect(general).toHaveAttribute("aria-current", "page");
    await expect(general).toHaveCSS("background-color", "rgb(24, 27, 31)");
    await expect(general).toHaveCSS("color", "rgb(255, 255, 255)");
    await page.screenshot({ path: "test-results/settings-theme-desktop.png", fullPage: true });

    await page.setViewportSize({ width: 560, height: 720 });
    await expect(dialog.locator(".settings-shell")).toHaveCSS("flex-direction", "column");
    await expect(dialog.locator(".settings-nav")).toHaveCSS("flex-direction", "row");
    await page.screenshot({ path: "test-results/settings-theme-narrow.png", fullPage: true });
  });
});
