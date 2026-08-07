import { expect, Page, test } from "playwright/test";

async function mockTerminalSession(page: Page, includeHiddenSession = false) {
  await page.addInitScript((withHiddenSession) => {
    const project = {
      id: "project-ime",
      name: "IME",
      path: "C:\\workspace\\ime",
      color: "#f5f6f7",
      createdAt: "2026-08-03T00:00:00Z",
      lastAccessedAt: "2026-08-03T00:00:00Z",
    };
    const profile = {
      id: "windows-powershell",
      name: "Windows PowerShell",
      program: "powershell.exe",
      args: [],
      icon: ">_",
      env: {},
      source: "detected",
    };
    const session = {
      id: "session-ime",
      projectId: project.id,
      title: "IME terminal",
      sortOrder: 0,
      layout: {
        pane: {
          id: "pane-ime",
          cwd: project.path,
          profile,
          cols: 100,
          rows: 30,
          title: "powershell.exe",
          active: true,
        },
      },
      syncInput: false,
      createdAt: "2026-08-03T00:00:00Z",
    };
    const hiddenSession = {
      ...session,
      id: "session-ime-hidden",
      title: "Second IME terminal",
      sortOrder: 1,
      layout: {
        pane: {
          ...session.layout.pane,
          id: "pane-ime-hidden",
          title: "hidden-powershell.exe",
        },
      },
      createdAt: "2026-08-03T00:00:01Z",
    };
    let config = {
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
      autoCheckUpdate: true,
      shortcuts: [
        { command: "command.palette", keys: "Ctrl+P", enabled: true },
        { command: "search.find", keys: "Ctrl+F", enabled: true },
        { command: "pane.focusLeft", keys: "Alt+ArrowLeft", enabled: true },
      ],
      statusbarComponents: ["sessions"],
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
    };
    const persistedConfig = localStorage.getItem("galaxy-ime-e2e-config");
    if (persistedConfig) {
      config = { ...config, ...JSON.parse(persistedConfig) };
    }
    type InvokeArgs = Record<string, unknown> & {
      event?: string;
      handler?: number;
      eventId?: number;
    };
    const invokes: Array<{ command: string; args?: InvokeArgs }> = [];
    (window as unknown as { __tauriInvokes: typeof invokes }).__tauriInvokes = invokes;
    const responses: Record<string, (args?: InvokeArgs) => unknown> = {
      boot_info: () => ({ recoveredFromCrash: false, readOnly: false, dataDir: "D" }),
      project_list: () => [project],
      session_list: () => (withHiddenSession ? [session, hiddenSession] : [session]),
      config_get: () => config,
      profiles_list: () => [profile],
      notification_list: () => [],
      updater_check: () => ({ available: false, notes: "开发构建跳过更新检查" }),
      updater_download_and_install: () => ({ installed: false, message: "skip" }),
      app_relaunch: () => undefined,
      system_pending_open_here: () => [],
      workspace_restore: () => 0,
      config_update: (args) => {
        config = args?.config as typeof config;
        localStorage.setItem("galaxy-ime-e2e-config", JSON.stringify(config));
        return config;
      },
      pty_resize: () => undefined,
      pty_write: () => undefined,
      pty_observe_screen: () => undefined,
      pane_split: () => ({
        ...session,
        layout: {
          split: {
            direction: "row",
            ratio: 0.5,
            first: {
              pane: { ...session.layout.pane, active: false },
            },
            second: {
              pane: {
                ...session.layout.pane,
                id: "pane-ime-split",
                title: "split-powershell.exe",
                active: true,
              },
            },
          },
        },
      }),
      session_close: () => undefined,
    };
    const callbacks = new Map<number, (data: unknown) => void>();
    const eventListeners = new Map<string, number[]>();
    let nextCallbackId = 1;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args?: InvokeArgs) => {
        invokes.push({ command: cmd, args });
        if (cmd === "plugin:event|listen" && args?.event && args.handler != null) {
          const ids = eventListeners.get(args.event) ?? [];
          ids.push(args.handler);
          eventListeners.set(args.event, ids);
          return Promise.resolve(args.handler);
        }
        if (cmd === "plugin:event|unlisten" && args?.event && args.eventId != null) {
          eventListeners.set(
            args.event,
            (eventListeners.get(args.event) ?? []).filter((id) => id !== args.eventId),
          );
          return Promise.resolve(undefined);
        }
        return Promise.resolve(responses[cmd]?.(args));
      },
      transformCallback: (callback: (data: unknown) => void) => {
        const id = nextCallbackId++;
        callbacks.set(id, callback);
        return id;
      },
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
    };
    (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown })
      .__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => Promise.resolve(),
      registerListener: () => Promise.resolve(1),
    };
    (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri =
      (event, payload) => {
        for (const id of eventListeners.get(event) ?? []) {
          callbacks.get(id)?.({ event, id, payload });
        }
      };
  }, includeHiddenSession);
}

async function terminalCursorBlink(page: Page, paneId: string): Promise<boolean | undefined> {
  return page.evaluate(async (id) => {
    const terminalViewUrl = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => url.includes("/src/features/terminal/TerminalView.tsx"));
    if (!terminalViewUrl) return undefined;
    const modulePath = new URL(terminalViewUrl).pathname + new URL(terminalViewUrl).search;
    const { terminals } = await import(/* @vite-ignore */ modulePath);
    return terminals.get(id)?.options.cursorBlink;
  }, paneId);
}

async function terminalMetrics(page: Page) {
  return page.evaluate(() => {
    const invokes = (
      window as unknown as {
        __tauriInvokes: Array<{
          command: string;
          args?: Record<string, unknown>;
        }>;
      }
    ).__tauriInvokes;
    const resizes = invokes.filter(
      (entry) => entry.command === "pty_resize" && entry.args?.paneId === "pane-ime",
    );
    const last = resizes.at(-1)?.args;
    const cols = Number(last?.cols ?? 0);
    const screen = document.querySelector<HTMLElement>(".xterm-screen");
    if (!screen || cols <= 0) throw new Error("terminal metrics are not ready");
    return {
      cellWidth: screen.getBoundingClientRect().width / cols,
      cols,
      resizeCount: resizes.length,
    };
  });
}

async function resizeCount(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __tauriInvokes: Array<{ command: string }>;
        }
      ).__tauriInvokes.filter((entry) => entry.command === "pty_resize").length,
  );
}

test("terminal font previews, restores, and persists through xterm fitting", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await expect.poll(() => resizeCount(page)).toBeGreaterThan(0);
  const baseline = await terminalMetrics(page);

  await page.locator(".titlebar-settings").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton").nth(0).fill("24");
  await expect.poll(() => resizeCount(page)).toBeGreaterThan(baseline.resizeCount);
  const preview = await terminalMetrics(page);
  expect(preview.cellWidth).toBeGreaterThan(baseline.cellWidth * 1.25);
  expect(preview.cols).toBeLessThan(baseline.cols);

  await dialog.getByRole("button", { name: "取消" }).click();
  await expect.poll(() => resizeCount(page)).toBeGreaterThan(preview.resizeCount);
  const restored = await terminalMetrics(page);
  expect(restored.cellWidth).toBeCloseTo(baseline.cellWidth, 1);
  expect(restored.cols).toBe(baseline.cols);

  await page.locator(".titlebar-settings").click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton").nth(0).fill("22");
  await dialog.getByRole("spinbutton").nth(1).fill("18");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.locator(".xterm-screen")).toBeVisible();
  await expect(page.locator(":root")).toHaveCSS("font-size", "18px");
  await expect.poll(() => resizeCount(page)).toBeGreaterThan(0);
  const persisted = await terminalMetrics(page);
  expect(persisted.cellWidth).toBeGreaterThan(baseline.cellWidth * 1.15);
  expect(persisted.cols).toBeLessThan(baseline.cols);
  await page.locator(".titlebar-settings").click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("spinbutton").nth(0)).toHaveValue("22");
  await expect(dialog.getByRole("spinbutton").nth(1)).toHaveValue("18");
});

test("composition start restores the IME anchor from a stale far-right position", async ({
  page,
}) => {
  await mockTerminalSession(page);
  await page.goto("/");
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();

  const anchor = await page.locator(".xterm-helper-textarea").evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    const screen = textarea.closest(".xterm")?.querySelector<HTMLElement>(".xterm-screen");
    if (!screen) throw new Error("xterm screen missing");

    // This is what xterm's right-click/stale-render paths can leave behind in
    // WebView2. Native IME positioning reads these coordinates immediately.
    textarea.style.left = "5000px";
    textarea.style.top = "5000px";
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const result = {
      left: Number.parseFloat(textarea.style.left),
      top: Number.parseFloat(textarea.style.top),
      screenWidth: screen.clientWidth,
      screenHeight: screen.clientHeight,
    };
    textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return result;
  });

  expect(anchor.left).toBeGreaterThanOrEqual(0);
  expect(anchor.left).toBeLessThan(anchor.screenWidth);
  expect(anchor.top).toBeGreaterThanOrEqual(0);
  expect(anchor.top).toBeLessThan(anchor.screenHeight);
});

test("long Chinese composition stays inside the terminal at the last column", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();

  await page.evaluate(() => {
    (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri(
      "pty://output",
      { chunks: [{ paneId: "pane-ime", generation: 1, seq: 1, data: "\u001b[999C" }] },
    );
  });
  await page.waitForTimeout(50);

  const bounds = await page.locator(".xterm-helper-textarea").evaluate(async (node) => {
    const textarea = node as HTMLTextAreaElement;
    const xterm = textarea.closest(".xterm")!;
    const screen = xterm.querySelector<HTMLElement>(".xterm-screen")!;
    const composition = xterm.querySelector<HTMLElement>(".composition-view")!;
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    textarea.value = "这是一个很长的中文组合输入候选文本";
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", {
        bubbles: true,
        data: "这是一个很长的中文组合输入候选文本",
      }),
    );
    // xterm performs one more zero-delay composition layout pass. Assert the
    // settled position, not only the synchronous event-handler position.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = {
      compositionLeft: composition.getBoundingClientRect().left,
      compositionRight: composition.getBoundingClientRect().right,
      compositionWidth: composition.getBoundingClientRect().width,
      compositionScrollWidth: composition.scrollWidth,
      compositionDirection: getComputedStyle(composition).direction,
      textareaLeft: textarea.getBoundingClientRect().left,
      textareaRight: textarea.getBoundingClientRect().right,
      screenWidth: screen.getBoundingClientRect().width,
      screenRight: screen.getBoundingClientRect().right,
    };
    textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return result;
  });

  expect(bounds.compositionRight).toBeLessThanOrEqual(bounds.screenRight + 1);
  expect(bounds.textareaRight).toBeLessThanOrEqual(bounds.screenRight + 1);
  expect(bounds.compositionDirection).toBe("ltr");
  expect(bounds.compositionLeft).toBeLessThan(bounds.textareaLeft);
  expect(bounds.compositionWidth).toBeGreaterThanOrEqual(
    Math.min(bounds.compositionScrollWidth, bounds.screenWidth) - 1,
  );
});

test("active Chinese composition stays bounded when the terminal narrows", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();

  await page.evaluate(() => {
    (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri(
      "pty://output",
      { chunks: [{ paneId: "pane-ime", generation: 1, seq: 1, data: "\u001b[70C" }] },
    );
  });
  await page.waitForTimeout(50);
  await page.locator(".xterm-helper-textarea").evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    textarea.value = "正在输入一段不会跑出终端边界的中文";
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", {
        bubbles: true,
        data: "正在输入一段不会跑出终端边界的中文",
      }),
    );
  });

  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(100);
  const bounds = await page.locator(".xterm-helper-textarea").evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    const xterm = textarea.closest(".xterm")!;
    const screen = xterm.querySelector<HTMLElement>(".xterm-screen")!;
    const composition = xterm.querySelector<HTMLElement>(".composition-view")!;
    return {
      compositionRight: composition.getBoundingClientRect().right,
      textareaRight: textarea.getBoundingClientRect().right,
      screenRight: screen.getBoundingClientRect().right,
    };
  });

  expect(bounds.compositionRight).toBeLessThanOrEqual(bounds.screenRight + 1);
  expect(bounds.textareaRight).toBeLessThanOrEqual(bounds.screenRight + 1);
});

test("rapid TUI renders do not continuously reposition an active IME", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  const textarea = page.locator(".xterm-helper-textarea");
  await expect(textarea).toBeFocused();

  await textarea.evaluate((node) => {
    const input = node as HTMLTextAreaElement;
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // Some Windows IMEs restart composition without an intervening end event.
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.value = "zhong";
    input.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "zhong" }),
    );
  });
  await page.waitForTimeout(40);

  await page.evaluate(() => {
    const textareaNode = document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    const composition = document.querySelector<HTMLElement>(".composition-view");
    if (!textareaNode || !composition) throw new Error("IME elements are missing");
    let styleMutations = 0;
    const observer = new MutationObserver((records) => {
      styleMutations += records.filter((record) => record.attributeName === "style").length;
    });
    observer.observe(textareaNode, { attributes: true, attributeFilter: ["style"] });
    observer.observe(composition, { attributes: true, attributeFilter: ["style"] });
    (
      window as unknown as {
        __imeStyleAudit: { observer: MutationObserver; count: () => number };
      }
    ).__imeStyleAudit = { observer, count: () => styleMutations };
  });

  for (let seq = 1; seq <= 8; seq += 1) {
    await page.evaluate((outputSeq) => {
      (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri(
        "pty://output",
        {
          chunks: [
            {
              paneId: "pane-ime",
              generation: 1,
              seq: outputSeq,
              // TUI frames often arrive split while the renderer cursor is
              // temporarily visiting status rows before the final input row.
              data: `\u001b[${5 + outputSeq};${10 + outputSeq}H*`,
            },
          ],
        },
      );
    }, seq);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(40);

  const imeAudit = await page.evaluate(() => {
    const audit = (
      window as unknown as {
        __imeStyleAudit: { observer: MutationObserver; count: () => number };
      }
    ).__imeStyleAudit;
    audit.observer.disconnect();
    const composition = document.querySelector<HTMLElement>(".composition-view");
    if (!composition) throw new Error("IME composition view is missing");
    const style = getComputedStyle(composition);
    const result = {
      styleMutations: audit.count(),
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      height: composition.getBoundingClientRect().height,
      lineHeight: style.lineHeight,
    };
    document
      .querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
      ?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return result;
  });

  expect(imeAudit.styleMutations).toBe(0);
  expect(imeAudit.fontFamily).toContain("Cascadia Mono");
  expect(imeAudit.fontSize).toBe("14px");
  expect(Number.parseFloat(imeAudit.lineHeight)).toBeCloseTo(imeAudit.height, 0);
  await expect(page.locator(".xterm-rows")).toContainText("*");
});

test("terminal output cannot reactivate cursor blink during rapid split TUI frames", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();

  const cursorBlinkStates: Array<boolean | undefined> = [];
  for (let seq = 1; seq <= 12; seq += 1) {
    await page.evaluate((outputSeq) => {
      (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri(
        "pty://output",
        {
          chunks: [
            {
              paneId: "pane-ime",
              generation: 1,
              seq: outputSeq,
              data: `${outputSeq === 1 ? "\u001b[?12h" : ""}\u001b[${2 + (outputSeq % 10)};${4 + outputSeq}H${outputSeq % 10}`,
            },
          ],
        },
      );
    }, seq);
    await page.waitForTimeout(20);
    cursorBlinkStates.push(await terminalCursorBlink(page, "pane-ime"));
  }

  expect(cursorBlinkStates).not.toContain(undefined);
  expect(cursorBlinkStates.every((state) => state === false)).toBe(true);
});

test("closing a pane during IME composition does not raise a page error", async ({ page }) => {
  await mockTerminalSession(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();

  await page.locator(".xterm-helper-textarea").evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    textarea.value = "中";
    textarea.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "中" }),
    );
    document.querySelector<HTMLButtonElement>(".tab-close")?.click();
  });
  await page.waitForTimeout(50);

  expect(pageErrors).toEqual([]);
});

test("global shortcuts do not intercept an active IME composition", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  const textarea = page.locator(".xterm-helper-textarea");
  await expect(textarea).toBeAttached();

  await textarea.evaluate((node) => {
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        isComposing: true,
        key: "p",
      }),
    );
  });

  await expect(page.locator(".modal input[type=search]")).toHaveCount(0);
});

test("directional pane focus ignores terminals in hidden sessions", async ({ page }) => {
  await mockTerminalSession(page, true);
  await page.goto("/");
  const visiblePane = page.locator(".pane-cell:visible").first();
  await visiblePane.click();
  await expect(visiblePane).toHaveClass(/focused/);

  await page.keyboard.press("Alt+ArrowLeft");

  await expect(visiblePane).toHaveClass(/focused/);
});

test("inactive session surfaces are inert and active ones stay hit-testable", async ({ page }) => {
  await mockTerminalSession(page, true);
  await page.goto("/");
  await expect(page.locator(".session-surface")).toHaveCount(2);

  const active = page.locator(".session-surface.active");
  const inactive = page.locator(".session-surface.inactive");
  await expect(active).toHaveCount(1);
  await expect(inactive).toHaveCount(1);
  await expect(active).toHaveAttribute("data-session-id", "session-ime");
  await expect
    .poll(async () =>
      inactive.evaluate((el) => (el as HTMLElement & { inert?: boolean }).inert === true),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      active.evaluate((el) => (el as HTMLElement & { inert?: boolean }).inert === true),
    )
    .toBe(false);

  await page.locator(".tabbar [role=tab]").nth(1).click();
  await expect(page.locator(".session-surface.active")).toHaveAttribute(
    "data-session-id",
    "session-ime-hidden",
  );
  await expect
    .poll(async () =>
      page
        .locator('.session-surface[data-session-id="session-ime"]')
        .evaluate((el) => (el as HTMLElement & { inert?: boolean }).inert === true),
    )
    .toBe(true);
});

test("switching tabs restores focus to that session's terminal", async ({ page }) => {
  await mockTerminalSession(page, true);
  await page.goto("/");
  const sessionTabs = page.locator(".tabbar [role=tab]");
  await expect(sessionTabs).toHaveCount(2);

  await sessionTabs.nth(1).click();
  await expect(sessionTabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(50);

  const focusedPane = await page.evaluate(() =>
    document.activeElement?.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId,
  );
  expect(focusedPane).toBe("pane-ime-hidden");
});

test("old TUI keeps DEFAULT mouse clicks and wheel after switching tabs", async ({ page }) => {
  await mockTerminalSession(page, true);
  await page.goto("/");
  await expect(page.locator(".xterm-screen").first()).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri(
      "pty://output",
      {
        chunks: [
          {
            paneId: "pane-ime",
            generation: 1,
            seq: 1,
            // VT200 tracking with legacy DEFAULT encoding.
            data: "\u001b[?1000h\u001b[?1006l",
          },
        ],
      },
    );
  });
  await expect(page.locator('[data-pane-id="pane-ime"] .xterm')).toHaveClass(
    /enable-mouse-events/,
  );

  const tabs = page.locator(".tabbar [role=tab]");
  await tabs.nth(1).click();
  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");

  await page.evaluate(() => {
    (
      window as unknown as {
        __tauriInvokes: Array<{ command: string; args?: Record<string, unknown> }>;
      }
    ).__tauriInvokes.length = 0;
    const now = Date.now();
    Date.now = () => now + 30_000;
  });

  const screen = page.locator('[data-pane-id="pane-ime"] .xterm-screen');
  const box = await screen.boundingBox();
  if (!box) throw new Error("active terminal screen has no bounds");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __tauriInvokes: Array<{
              command: string;
              args?: { paneId?: string; bytes?: number[] };
            }>;
          }
        ).__tauriInvokes.filter(
          (entry) => entry.command === "pty_write_bytes" && entry.args?.paneId === "pane-ime",
        ),
      ),
    )
    .toHaveLength(3);

  const reports = await page.evaluate(() =>
    (
      window as unknown as {
        __tauriInvokes: Array<{
          command: string;
          args?: { paneId?: string; bytes?: number[] };
        }>;
      }
    ).__tauriInvokes
      .filter(
        (entry) => entry.command === "pty_write_bytes" && entry.args?.paneId === "pane-ime",
      )
      .map((entry) => entry.args?.bytes),
  );
  for (const bytes of reports) {
    expect(bytes?.slice(0, 3)).toEqual([0x1b, 0x5b, 0x4d]);
  }
});

test("splitting a pane focuses the backend-selected new terminal", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  await expect(page.locator(".xterm-helper-textarea")).toBeAttached();

  await page.locator('.pane-cell:visible button[title="向右分屏"]').click();
  const splitTerminal = page.locator('[data-pane-id="pane-ime-split"]');
  await expect(splitTerminal).toBeAttached();
  await expect(splitTerminal.locator("xpath=ancestor::div[contains(@class, 'pane-cell')]")).toHaveClass(
    /focused/,
  );
  await expect(splitTerminal.locator(".xterm-helper-textarea")).toBeFocused();
});

test("splitting while an overlay is open does not steal its input focus", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  const terminal = page.locator(".xterm-helper-textarea");
  await expect(terminal).toBeFocused();

  await terminal.press("Control+p");
  const search = page.locator('.modal input[type="search"]');
  await expect(search).toBeFocused();
  await page.evaluate(() => {
    (window as unknown as { __focusTrail: string[] }).__focusTrail = [];
    document.addEventListener("focusin", (event) => {
      const target = event.target as HTMLElement;
      (window as unknown as { __focusTrail: string[] }).__focusTrail.push(
        target.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ?? target.tagName,
      );
    });
  });

  // Exercise the real split workflow while the backdrop prevents pointer
  // interaction, matching async layout changes initiated from an overlay.
  await page.locator('.pane-cell:visible button[title="\u5411\u53f3\u5206\u5c4f"]').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await expect(page.locator('[data-pane-id="pane-ime-split"]')).toBeAttached();
  await page.waitForTimeout(50);

  expect(
    await page.evaluate(() => (window as unknown as { __focusTrail: string[] }).__focusTrail),
  ).not.toContain("pane-ime-split");
  await expect(search).toBeFocused();
});

test("splitting while the find bar is active does not steal its input focus", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  const terminal = page.locator(".xterm-helper-textarea");
  await expect(terminal).toBeFocused();

  await terminal.press("Control+f");
  const search = page.locator('.find-bar input[type="search"]');
  await expect(search).toBeFocused();

  await page.locator('.pane-cell:visible button[title="\u5411\u53f3\u5206\u5c4f"]').evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await expect(page.locator('[data-pane-id="pane-ime-split"]')).toBeAttached();
  await page.waitForTimeout(50);

  await expect(search).toBeFocused();
});

test("terminal metadata updates do not steal focus from an overlay", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  await page.locator(".xterm-helper-textarea").evaluate((node) => {
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "p",
      }),
    );
  });
  const search = page.locator(".modal input[type=search]");
  await expect(search).toBeFocused();
  await page.locator(".xterm-helper-textarea").evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    const focus = textarea.focus.bind(textarea);
    (window as unknown as { __terminalFocusCalls: number }).__terminalFocusCalls = 0;
    textarea.focus = (...args) => {
      (window as unknown as { __terminalFocusCalls: number }).__terminalFocusCalls += 1;
      focus(...args);
    };
  });

  await page.evaluate(() => {
    (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri(
      "session://title",
      { paneId: "pane-ime", sessionId: "session-ime", title: "updated title" },
    );
  });
  await expect(page.locator(".tab-title")).toHaveText("updated title");
  await page.waitForTimeout(50);

  expect(
    await page.evaluate(
      () => (window as unknown as { __terminalFocusCalls: number }).__terminalFocusCalls,
    ),
  ).toBe(0);
  await expect(search).toBeFocused();
});

test("terminal canvas uses the deep-space monochrome surface", async ({ page }) => {
  await mockTerminalSession(page);
  await page.goto("/");
  const terminal = page.locator(".terminal-host").first();
  await expect(terminal.locator(".xterm-screen")).toBeVisible();
  await expect(terminal).toHaveCSS("background-color", "rgb(3, 4, 5)");

  await page.evaluate(() => {
    (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri(
      "pty://output",
      { chunks: [{ paneId: "pane-ime", generation: 1, seq: 1, data: "PS C:\\workspace\\ime> npm test\r\n33 tests passed\r\nPS C:\\workspace\\ime> " }] },
    );
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: "test-results/terminal-theme.png", fullPage: true });
});
