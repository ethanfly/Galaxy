// UI-level E2E smoke: app shell renders with mocked Tauri runtime.
// Full end-to-end (real PTY/ConPTY) is covered by Rust integration tests;
// these specs guard layout, overlays and keyboard routing in the web layer.
import { test, expect, Page } from "playwright/test";

async function mockTauri(page: Page, language = "zh-CN", populated = false) {
  await page.addInitScript(({ initialLanguage, withContent }) => {
    const listeners = new Map<string, Array<(e: { payload: unknown }) => void>>();
    const project = {
      id: "project-smoke",
      name: "Galaxy",
      path: "C:\\workspace\\galaxy",
      color: "#f5f6f7",
      createdAt: "2026-08-05T00:00:00Z",
      lastAccessedAt: "2026-08-05T00:00:00Z",
    };
    const profile = {
      id: "pwsh",
      name: "PowerShell 7",
      program: "pwsh.exe",
      args: [],
      icon: ">_",
      env: {},
      source: "detected",
    };
    const session = {
      id: "session-smoke",
      projectId: project.id,
      title: "Codex implementation review",
      sortOrder: 0,
      layout: {
        pane: {
          id: "pane-smoke",
          cwd: project.path,
          profile,
          cols: 100,
          rows: 30,
          title: "Codex implementation review",
          active: true,
          agentKind: "codex",
        },
      },
      syncInput: false,
      createdAt: "2026-08-05T00:00:00Z",
    };
    const store = {
      projects: withContent ? [project] : [],
      sessions: withContent ? [session] : [],
      config: {
        schemaVersion: 3,
        language: initialLanguage,
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
      notifications: withContent
        ? [
            {
              id: "notification-smoke",
              at: "2026-08-05T00:00:00Z",
              title: "Codex completed",
              body: "Review the generated changes",
              read: false,
              projectId: project.id,
              paneId: "pane-smoke",
            },
          ]
        : [],
    };
    const persistedConfig = localStorage.getItem("galaxy-e2e-config");
    if (persistedConfig) {
      Object.assign(store.config, JSON.parse(persistedConfig));
    }
    const invokes: Array<{ command: string; args?: Record<string, unknown> }> = [];
    (window as unknown as { __tauriInvokes: typeof invokes }).__tauriInvokes = invokes;
    const noop = () => Promise.resolve(undefined);
    const responses: Record<string, (args?: Record<string, unknown>) => unknown> = {
      boot_info: () => ({ recoveredFromCrash: false, readOnly: false, dataDir: "D" }),
      project_list: () => store.projects,
      session_list: () => store.sessions,
      config_get: () => store.config,
      profiles_list: () => [],
      notification_list: () => store.notifications,
      system_pending_open_here: () => [],
      workspace_restore: () => 0,
      config_update: (args) => {
        store.config = args?.config as typeof store.config;
        localStorage.setItem("galaxy-e2e-config", JSON.stringify(store.config));
        return store.config;
      },
      window_save_state: noop,
    };
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        invokes.push({ command: cmd, args });
        const fn = responses[cmd];
        return Promise.resolve(fn ? fn(args) : undefined);
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
  }, { initialLanguage: language, withContent: populated });
}

async function expectAppearanceFits(page: Page) {
  const layout = await page.evaluate(() => {
    const selectors = [
      ".titlebar .app-name",
      ".settings-nav button",
      ".modal-footer button",
      ".form-row label",
      ".statusbar .status-item",
      ".tabbar button",
      ".agent-badge",
      ".pane-chrome",
      ".panel-tabs button[role=tab]",
      ".titlebar-tool-badge",
      ".workspace-switcher button",
      ".context-sidebar button",
    ].join(",");
    const clipped = Array.from(document.querySelectorAll<HTMLElement>(selectors))
      .filter((element) => element.offsetParent !== null && element.textContent?.trim())
      .filter(
        (element) =>
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1,
      )
      .map(
        (element) =>
          `${element.tagName}.${element.className}: ${element.textContent?.trim()} ` +
          `(client ${element.clientWidth}x${element.clientHeight}, scroll ${element.scrollWidth}x${element.scrollHeight})`,
      );
    return {
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped,
    };
  });
  expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(layout.clipped).toEqual([]);
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

  test("keeps the app shell flush with the viewport after window height changes", async ({ page }) => {
    await mockTauri(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();

    for (const height of [1100, 640, 900]) {
      await page.setViewportSize({ width: 1440, height });
      await expect.poll(() => page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>(".app-shell");
        const rect = shell?.getBoundingClientRect();
        return {
          body: document.body.getBoundingClientRect().height,
          document: document.documentElement.getBoundingClientRect().height,
          shell: rect?.height ?? 0,
          viewport: window.innerHeight,
        };
      })).toEqual({ body: height, document: height, shell: height, viewport: height });
    }
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

  test("previews UI font size across the interface and restores it on cancel", async ({ page }) => {
    await mockTauri(page);
    await page.goto("/");
    await expect(page.locator(".empty-workspace")).toBeVisible();
    await page.locator(".titlebar-settings").click();

    const samples = [
      page.locator(".titlebar .app-name"),
      page.locator(".settings-nav button").first(),
      page.locator(".form-row label").first(),
      page.locator(".statusbar .status-item").first(),
    ];
    const fontSize = async (locator: (typeof samples)[number]) =>
      Number.parseFloat(await locator.evaluate((element) => getComputedStyle(element).fontSize));
    const before = await Promise.all(samples.map(fontSize));
    const titlebarHeightBefore = await page
      .locator(".titlebar")
      .evaluate((el) => el.getBoundingClientRect().height);

    await page.getByRole("spinbutton").nth(1).fill("18");
    await expect(page.locator(":root")).toHaveCSS("font-size", "18px");
    const preview = await Promise.all(samples.map(fontSize));
    for (let index = 0; index < samples.length; index += 1) {
      expect(preview[index] / before[index]).toBeCloseTo(18 / 13, 2);
    }
    // Shell chrome density tokens are rem-based and scale with uiFontSize.
    const titlebarHeightPreview = await page
      .locator(".titlebar")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(titlebarHeightPreview / titlebarHeightBefore).toBeCloseTo(18 / 13, 2);

    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.locator(":root")).toHaveCSS("font-size", "13px");
    await page.locator(".titlebar-settings").click();
    const restored = await Promise.all(samples.map(fontSize));
    expect(restored).toEqual(before);
  });

  test("persists font settings and keeps the maximum UI size within desktop and narrow viewports", async ({
    page,
  }) => {
    await mockTauri(page);
    await page.goto("/");
    await page.locator(".titlebar-settings").click();
    let dialog = page.getByRole("dialog");
    const fontInputs = dialog.getByRole("spinbutton");
    await fontInputs.nth(0).fill("24");
    await fontInputs.nth(1).fill("24");
    await expect(page.locator(":root")).toHaveCSS("font-size", "24px");
    await expectAppearanceFits(page);
    await page.screenshot({ path: "test-results/appearance-preview-desktop.png", fullPage: true });

    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.locator(":root")).toHaveCSS("font-size", "13px");
    await expectAppearanceFits(page);
    await page.screenshot({ path: "test-results/appearance-cancel-desktop.png", fullPage: true });

    await page.setViewportSize({ width: 560, height: 720 });
    await page.locator(".titlebar-settings").click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton").nth(0).fill("24");
    await dialog.getByRole("spinbutton").nth(1).fill("24");
    await expect(page.locator(":root")).toHaveCSS("font-size", "24px");
    await expectAppearanceFits(page);
    await page.screenshot({ path: "test-results/appearance-preview-narrow.png", fullPage: true });

    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.locator(":root")).toHaveCSS("font-size", "13px");
    await expectAppearanceFits(page);
    await page.screenshot({ path: "test-results/appearance-cancel-narrow.png", fullPage: true });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".titlebar-settings").click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton").nth(0).fill("22");
    await dialog.getByRole("spinbutton").nth(1).fill("18");
    await dialog.getByRole("button", { name: "保存" }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.locator(":root")).toHaveCSS("font-size", "18px");
    await page.locator(".titlebar-settings").click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("spinbutton").nth(0)).toHaveValue("22");
    await expect(dialog.getByRole("spinbutton").nth(1)).toHaveValue("18");
  });

  test("keeps English right-panel tabs usable at the maximum UI size", async ({ page }) => {
    await mockTauri(page, "en-US", true);
    await page.goto("/");
    await expect(page.locator(".pane-chrome")).toBeVisible();
    // Agent badges appear on both the tab strip and the left session list.
    await expect(page.locator(".tab .agent-badge")).toBeVisible();
    await expect(page.locator(".context-sidebar .agent-badge")).toBeVisible();
    await expect(page.locator(".titlebar-tool-badge")).toBeVisible();
    await page.getByRole("button", { name: "Agent", exact: true }).first().click();
    await expect(page.locator(".right-panel")).toBeVisible();
    await page.locator(".titlebar-settings").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("spinbutton").nth(1).fill("24");
    await expect(page.locator(":root")).toHaveCSS("font-size", "24px");
    const panelTabFontSize = await page
      .locator('.panel-tabs button[role="tab"]')
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(panelTabFontSize).toBeGreaterThan(20);
    const panelTabHeights = await page.locator(".panel-tabs").evaluate((tabList) => ({
      available: tabList.clientHeight,
      required: Math.max(
        ...Array.from(tabList.querySelectorAll<HTMLElement>('button[role="tab"]')).map(
          (tab) => tab.offsetHeight,
        ),
      ),
    }));
    expect(panelTabHeights.available).toBeGreaterThanOrEqual(panelTabHeights.required);
    await expectAppearanceFits(page);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(":root")).toHaveCSS("font-size", "24px");
    await page.screenshot({
      path: "test-results/appearance-english-panel-desktop.png",
      fullPage: true,
    });

    await page.setViewportSize({ width: 560, height: 720 });
    await expectAppearanceFits(page);
    const notificationsTab = page.getByRole("tab", { name: /Notifications/ });
    await notificationsTab.click();
    await expect(notificationsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Review the generated changes")).toBeVisible();
    await page.screenshot({
      path: "test-results/appearance-english-panel-narrow.png",
      fullPage: true,
    });
  });
});
