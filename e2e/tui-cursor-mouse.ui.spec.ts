// Regression harness for agent TUI cursor/mouse behavior:
// 1. Codex-style frames must not reactivate cursor blink (DECSCUSR / DEC 12).
// 2. Grok mouse reports must survive tab switching and idle healing.
import { expect, Page, test } from "playwright/test";

async function mockTwoSessions(page: Page) {
  await page.addInitScript(() => {
    const project = {
      id: "project-diag",
      name: "DIAG",
      path: "C:\\workspace\\diag",
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
    const sessionA = {
      id: "session-a",
      projectId: project.id,
      title: "agent-a",
      sortOrder: 0,
      layout: {
        pane: {
          id: "pane-a",
          cwd: project.path,
          profile,
          cols: 100,
          rows: 30,
          title: "agent-a",
          active: true,
        },
      },
      syncInput: false,
      createdAt: "2026-08-03T00:00:00Z",
    };
    const sessionB = {
      ...sessionA,
      id: "session-b",
      title: "agent-b",
      sortOrder: 1,
      layout: { pane: { ...sessionA.layout.pane, id: "pane-b", title: "agent-b" } },
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
      autoCheckUpdate: false,
      shortcuts: [],
      statusbarComponents: ["sessions"],
      windowState: { width: 1440, height: 900, maximized: false },
      layoutTemplates: [],
      workflows: [],
      triggers: [],
      featureFlags: {
        commandBlocks: false,
        agentPanel: false,
        gitPanel: false,
        workflows: false,
        triggers: false,
      },
      hardwareAcceleration: true,
      defaultProfileId: null,
    };
    type InvokeArgs = Record<string, unknown>;
    const invokes: Array<{ command: string; args?: InvokeArgs }> = [];
    (window as unknown as { __tauriInvokes: typeof invokes }).__tauriInvokes = invokes;
    const responses: Record<string, (args?: InvokeArgs) => unknown> = {
      boot_info: () => ({ recoveredFromCrash: false, readOnly: false, dataDir: "D" }),
      project_list: () => [project],
      session_list: () => [sessionA, sessionB],
      config_get: () => config,
      profiles_list: () => [profile],
      notification_list: () => [],
      updater_check: () => ({ available: false, notes: "skip" }),
      app_relaunch: () => undefined,
      system_pending_open_here: () => [],
      workspace_restore: () => 0,
      pty_resize: () => undefined,
      pty_write: () => undefined,
      pty_write_bytes: () => undefined,
      pty_broadcast: () => undefined,
      pty_observe_screen: () => undefined,
      session_close: () => undefined,
    };
    const callbacks = new Map<number, (data: unknown) => void>();
    const eventListeners = new Map<string, number[]>();
    let nextCallbackId = 1;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args?: InvokeArgs) => {
        invokes.push({ command: cmd, args });
        if (cmd === "plugin:event|listen" && args?.event && args.handler != null) {
          const ids = eventListeners.get(args.event as string) ?? [];
          ids.push(args.handler as number);
          eventListeners.set(args.event as string, ids);
          return Promise.resolve(args.handler);
        }
        if (cmd === "plugin:event|unlisten") return Promise.resolve(undefined);
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
  });
}

async function emit(page: Page, paneId: string, seq: number, data: string) {
  await page.evaluate(
    ({ paneId, seq, data }) => {
      (window as unknown as { __emitTauri: (event: string, payload: unknown) => void }).__emitTauri(
        "pty://output",
        { chunks: [{ paneId, generation: 1, seq, data }] },
      );
    },
    { paneId, seq, data },
  );
}

interface CursorSnapshot {
  optionBlink: boolean | undefined;
  cursorCells: number;
  blinkCells: number;
  cursorRows: number[];
  cursorHidden: boolean;
}

async function cursorSnapshot(page: Page, paneId: string): Promise<CursorSnapshot> {
  return page.evaluate(async (id) => {
    const terminalViewUrl = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => url.includes("/src/features/terminal/TerminalView.tsx"));
    let optionBlink: boolean | undefined;
    let cursorHidden = false;
    if (terminalViewUrl) {
      const modulePath = new URL(terminalViewUrl).pathname + new URL(terminalViewUrl).search;
      const { terminals } = await import(/* @vite-ignore */ modulePath);
      const term = terminals.get(id);
      optionBlink = term?.options.cursorBlink;
      cursorHidden = Boolean((term as unknown as { _core?: { coreService?: { isCursorHidden?: boolean } } })?._core?.coreService?.isCursorHidden);
    }
    const host = document.querySelector<HTMLElement>(`[data-pane-id="${id}"]`);
    const cursors = Array.from(host?.querySelectorAll(".xterm-cursor") ?? []);
    const rows = cursors.map((el) => {
      const row = el.closest(".xterm-rows > div");
      return row ? Array.from(row.parentElement?.children ?? []).indexOf(row) : -1;
    });
    return {
      optionBlink,
      cursorCells: cursors.length,
      blinkCells: host?.querySelectorAll(".xterm-cursor-blink").length ?? 0,
      cursorRows: rows,
      cursorHidden,
    };
  }, paneId);
}

test("CODex-like frames: does any blink class or multiple cursors survive?", async ({ page }) => {
  await mockTwoSessions(page);
  await page.goto("/");
  await expect(page.locator('[data-pane-id="pane-a"] .xterm-screen')).toBeVisible();

  // Enter alt screen, header with project path, input box line.
  await emit(
    page,
    "pane-a",
    1,
    "\u001b[?1049h\u001b[H\u001b[2J" +
      "\u001b[1;1Hproject: C:\\workspace\\diag" +
      "\u001b[3;1H> ask anything_" +
      "\u001b[5 q", // DECSCUSR blinking bar, like a TUI input cursor
  );
  await page.waitForTimeout(80);
  let snap = await cursorSnapshot(page, "pane-a");
  console.log("after init:", JSON.stringify(snap));

  // Simulated working frames: cursor jumps between header (project path),
  // working line, and input box. Each emit = one PTY batch with its own write.
  const frames: Array<[number, string]> = [
    [2, "\u001b[2;1H\u280b Working\u2026\u001b[1;29H\u001b[3;15H"],
    [3, "\u001b[2;1H\u2819 Working\u2026\u001b[3;15H"],
    [4, "\u001b[2;1H\u2839 Working\u2026\u001b[1;29H"],
    [5, "\u001b[2;1H\u2838 Working\u2026\u001b[3;15H"],
    [6, "\u001b[?12h\u001b[2;1H\u281c Working\u2026\u001b[1;29H"], // DEC mode 12 too
    [7, "\u001b[2;1H\u2804 Working\u2026\u001b[3;15H"],
    [8, "\u001b[2;1H\u2826 Working\u2026\u001b[1;29H"],
    [9, "\u001b[2;1H\u2827 Working\u2026\u001b[3;15H"],
    [10, "\u001b[5 q\u001b[2;1H\u2807 Working\u2026\u001b[3;15H"], // DECSCUSR again mid-stream
  ];
  for (const [seq, data] of frames) {
    await emit(page, "pane-a", seq, data);
    await page.waitForTimeout(40); // let rAF render between PTY batches
    snap = await cursorSnapshot(page, "pane-a");
    console.log(`frame ${seq}:`, JSON.stringify(snap));
  }

  // Settle, then sample twice across a blink interval.
  await page.waitForTimeout(700);
  const settled1 = await cursorSnapshot(page, "pane-a");
  await page.waitForTimeout(700);
  const settled2 = await cursorSnapshot(page, "pane-a");
  console.log("settled1:", JSON.stringify(settled1), "settled2:", JSON.stringify(settled2));

  expect(settled1.optionBlink).toBe(false);
  expect(settled1.blinkCells).toBe(0);
  expect(settled1.cursorCells).toBeLessThanOrEqual(1);
});

test("DECSCUSR blink alone between batches: is a blink frame ever painted?", async ({ page }) => {
  await mockTwoSessions(page);
  await page.goto("/");
  await expect(page.locator('[data-pane-id="pane-a"] .xterm-screen')).toBeVisible();

  await emit(page, "pane-a", 1, "\u001b[?1049h\u001b[H\u001b[2Jtext line");
  await page.waitForTimeout(60);

  // A batch that ONLY toggles blink on — Galaxy must never paint a blinking cursor.
  await emit(page, "pane-a", 2, "\u001b[5 q");
  // Sample immediately and across the next frames.
  const samples: CursorSnapshot[] = [];
  for (let i = 0; i < 6; i += 1) {
    samples.push(await cursorSnapshot(page, "pane-a"));
    await page.waitForTimeout(50);
  }
  console.log("blink-only batches:", JSON.stringify(samples));
  const anyBlinkPainted = samples.some((s) => s.blinkCells > 0 || s.optionBlink === true);
  expect(anyBlinkPainted).toBe(false);
});

interface MouseProbe {
  trackingMode: string;
  encoding: string;
  paused: boolean;
  hasValidCharSize: boolean;
  cellWidth: number;
  cellHeight: number;
  writes: number;
  byteWrites: number;
  lastWriteData?: string;
}

async function mouseProbe(page: Page, paneId: string): Promise<MouseProbe> {
  return page.evaluate(async (id) => {
    const terminalViewUrl = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => url.includes("/src/features/terminal/TerminalView.tsx"));
    const modulePath = terminalViewUrl
      ? new URL(terminalViewUrl).pathname + new URL(terminalViewUrl).search
      : "";
    const { terminals } = await import(/* @vite-ignore */ modulePath);
    const term = terminals.get(id) as unknown as {
      modes: { mouseTrackingMode: string };
      _core: {
        coreMouseService: { activeProtocol: string; activeEncoding: string };
        _renderService: {
          _isPaused: boolean;
          dimensions: { css: { cell: { width: number; height: number } } };
        };
        _charSizeService: { hasValidSize: boolean };
      };
    };
    const invokes = (window as unknown as {
      __tauriInvokes: Array<{ command: string; args?: Record<string, unknown> }>;
    }).__tauriInvokes;
    const writes = invokes.filter((i) => i.command === "pty_write" && i.args?.paneId === id);
    const byteWrites = invokes.filter(
      (i) => i.command === "pty_write_bytes" && i.args?.paneId === id,
    );
    return {
      trackingMode: term?.modes?.mouseTrackingMode ?? "?",
      encoding: term?._core?.coreMouseService?.activeEncoding ?? "?",
      paused: Boolean(term?._core?._renderService?._isPaused),
      hasValidCharSize: Boolean(term?._core?._charSizeService?.hasValidSize),
      cellWidth: term?._core?._renderService?.dimensions?.css?.cell?.width ?? 0,
      cellHeight: term?._core?._renderService?.dimensions?.css?.cell?.height ?? 0,
      writes: writes.length,
      byteWrites: byteWrites.length,
      lastWriteData: writes.at(-1)?.args?.data as string | undefined,
    };
  }, paneId);
}

async function clickTerminal(page: Page, paneId: string) {
  const screen = page.locator(`[data-pane-id="${paneId}"] .xterm-screen`);
  const box = await screen.boundingBox();
  if (!box) throw new Error("no terminal box");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(60);
}

test("GROK-like mouse: click reports across tab switch", async ({ page }) => {
  await mockTwoSessions(page);
  await page.goto("/");
  await expect(page.locator('[data-pane-id="pane-a"] .xterm-screen')).toBeVisible();

  // Grok-style mouse init: normal tracking + SGR encoding, alt screen.
  await emit(
    page,
    "pane-a",
    1,
    "\u001b[?1049h\u001b[H\u001b[2J\u001b[?1000h\u001b[?1002h\u001b[?1003h\u001b[?1006hGrok TUI",
  );
  await page.waitForTimeout(80);

  let probe = await mouseProbe(page, "pane-a");
  console.log("before clicks:", JSON.stringify(probe));
  expect(probe.trackingMode).not.toBe("none");

  await clickTerminal(page, "pane-a");
  probe = await mouseProbe(page, "pane-a");
  console.log("after click 1:", JSON.stringify(probe));
  const clicksBefore = probe.writes + probe.byteWrites;
  expect(clicksBefore).toBeGreaterThan(0); // press + release → at least one report

  // Switch to tab B, spend time there, come back.
  await page.locator('div[role="tab"]', { hasText: "agent-b" }).click();
  await page.waitForTimeout(300);
  // Interact with session B a bit.
  await page.waitForTimeout(500);

  // Back to tab A.
  await page.locator('div[role="tab"]', { hasText: "agent-a" }).click();
  await page.waitForTimeout(400);

  probe = await mouseProbe(page, "pane-a");
  console.log("after tab round-trip:", JSON.stringify(probe));

  await clickTerminal(page, "pane-a");
  probe = await mouseProbe(page, "pane-a");
  console.log("after click 2:", JSON.stringify(probe));
  const clicksAfter = probe.writes + probe.byteWrites;
  console.log(`mouse reports: before=${clicksBefore} after=${clicksAfter}`);

  expect(probe.trackingMode).not.toBe("none");
  expect(clicksAfter).toBeGreaterThan(clicksBefore);
});
