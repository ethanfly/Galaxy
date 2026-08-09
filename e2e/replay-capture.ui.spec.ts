// Replay REAL codex/grok PTY captures (framed: [t u64le][len u32le][bytes])
// through the actual TerminalView write path and observe cursor state.
import { expect, Page, test } from "playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

interface Frame {
  t: number;
  data: string;
}

function loadFrames(file: string): Frame[] {
  const buf = readFileSync(join(here, "fixtures", file));
  const frames: Frame[] = [];
  // Streaming decode mirrors Galaxy's Rust StreamDecoder: incomplete multi-byte
  // sequences carry over between reader chunks.
  const decoder = new TextDecoder("utf-8");
  let i = 0;
  while (i + 12 <= buf.length) {
    const t = Number(buf.readBigUInt64LE(i));
    i += 8;
    const n = buf.readUInt32LE(i);
    i += 4;
    frames.push({ t, data: decoder.decode(buf.subarray(i, i + n), { stream: true }) });
    i += n;
  }
  return frames;
}

async function mockSession(page: Page) {
  await page.addInitScript(() => {
    const project = {
      id: "project-rp",
      name: "RP",
      path: "C:\\workspace\\rp",
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
      id: "session-rp",
      projectId: project.id,
      title: "replay",
      sortOrder: 0,
      layout: {
        pane: {
          id: "pane-rp",
          cwd: project.path,
          profile,
          cols: 120,
          rows: 32,
          title: "replay",
          active: true,
        },
      },
      syncInput: false,
      createdAt: "2026-08-03T00:00:00Z",
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
      session_list: () => [session],
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

interface Sample {
  at: number;
  optionBlink: boolean | undefined;
  cursorStyle: string | undefined;
  cursorCells: number;
  blinkCells: number;
  cursorHidden: boolean;
  cursorPos: Array<{ row: number; text: string }>;
  focusedRowContainer: boolean;
}

async function sample(page: Page): Promise<Sample> {
  return page.evaluate(async () => {
    const terminalViewUrl = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((url) => url.includes("/src/features/terminal/TerminalView.tsx"));
    let optionBlink: boolean | undefined;
    let cursorStyle: string | undefined;
    let cursorHidden = false;
    if (terminalViewUrl) {
      const modulePath = new URL(terminalViewUrl).pathname + new URL(terminalViewUrl).search;
      const { terminals } = await import(/* @vite-ignore */ modulePath);
      const term = terminals.get("pane-rp") as unknown as {
        options: { cursorBlink: boolean; cursorStyle: string };
        _core?: { coreService?: { isCursorHidden?: boolean } };
      } | undefined;
      optionBlink = term?.options.cursorBlink;
      cursorStyle = term?.options.cursorStyle;
      cursorHidden = Boolean(term?._core?.coreService?.isCursorHidden);
    }
    const host = document.querySelector<HTMLElement>('[data-pane-id="pane-rp"]');
    const cursors = Array.from(host?.querySelectorAll<HTMLElement>(".xterm-cursor") ?? []);
    const rowsContainer = host?.querySelector(".xterm-rows");
    const cursorPos = cursors.map((el) => {
      const row = el.closest(".xterm-rows > div");
      return {
        row: row ? Array.from(rowsContainer?.children ?? []).indexOf(row) : -1,
        text: (el.textContent ?? "").slice(0, 12),
      };
    });
    return {
      at: performance.now(),
      optionBlink,
      cursorStyle,
      cursorCells: cursors.length,
      blinkCells: host?.querySelectorAll(".xterm-cursor-blink").length ?? 0,
      cursorHidden,
      cursorPos,
      focusedRowContainer: Boolean(
        host?.querySelector(".xterm-rows.xterm-focus, .xterm-rows .xterm-focus"),
      ),
    };
  });
}

test("replay REAL codex capture: observe cursor blink/jump", async ({ page }) => {
  await mockSession(page);
  await page.goto("/");
  await expect(page.locator('[data-pane-id="pane-rp"] .xterm-screen')).toBeVisible();

  const frames = loadFrames("codex-capture.bin");
  const samples: Sample[] = [];
  let seq = 1;
  const start = Date.now();
  let lastT = 0;

  // Emit each captured chunk as its own PTY batch, preserving relative gaps
  // (scaled down 4x to keep the test fast while keeping ordering/multiplicity).
  for (const frame of frames) {
    const gap = Math.min(120, Math.max(0, Math.round((frame.t - lastT) / 4)));
    if (gap > 0) await page.waitForTimeout(gap);
    lastT = frame.t;
    // latin1 → JS string preserved byte-for-byte through IPC mock.
    await page.evaluate(
      ({ seq: s, data }) => {
        (window as unknown as { __emitTauri: (event: string, payload: unknown) => void })
          .__emitTauri("pty://output", {
            chunks: [{ paneId: "pane-rp", generation: 1, seq: s, data }],
          });
      },
      { seq, data: frame.data },
    );
    seq += 1;
    // Sample during the dense startup region where DECSCUSR and frames arrive.
    if (frame.t < 6500 || frame.t > 17000) {
      samples.push(await sample(page));
    }
  }
  // Settle and sample across a blink interval.
  for (let i = 0; i < 4; i += 1) {
    await page.waitForTimeout(350);
    samples.push(await sample(page));
  }

  const elapsed = Date.now() - start;
  console.log(`replayed ${frames.length} frames in ${elapsed}ms`);
  for (const s of samples) {
    console.log(
      JSON.stringify({
        at: Math.round(s.at),
        blink: s.optionBlink,
        style: s.cursorStyle,
        cells: s.cursorCells,
        blinkCells: s.blinkCells,
        hidden: s.cursorHidden,
        pos: s.cursorPos,
      }),
    );
  }

  const anyBlinkClass = samples.some((s) => s.blinkCells > 0);
  const anyOptionBlink = samples.some((s) => s.optionBlink === true);
  const multiCursor = samples.some((s) => s.cursorCells > 1);
  console.log(
    `RESULT: anyBlinkClass=${anyBlinkClass} anyOptionBlink=${anyOptionBlink} multiCursor=${multiCursor}`,
  );

  // Galaxy's cursor policy must hold against the real agent stream: no blink
  // option re-activation (DECSCUSR 0 / DEC mode 12), no painted blink class,
  // never more than one cursor cell.
  expect(anyOptionBlink).toBe(false);
  expect(anyBlinkClass).toBe(false);
  expect(multiCursor).toBe(false);
});

test("replay REAL grok capture: click works, then idle-heal + re-click", async ({ page }) => {
  await mockSession(page);
  await page.goto("/");
  await expect(page.locator('[data-pane-id="pane-rp"] .xterm-screen')).toBeVisible();

  const frames = loadFrames("grok-capture.bin");
  let seq = 1;
  let lastT = 0;
  for (const frame of frames) {
    const gap = Math.min(80, Math.max(0, Math.round((frame.t - lastT) / 6)));
    if (gap > 0) await page.waitForTimeout(gap);
    lastT = frame.t;
    await page.evaluate(
      ({ seq: s, data }) => {
        (window as unknown as { __emitTauri: (event: string, payload: unknown) => void })
          .__emitTauri("pty://output", {
            chunks: [{ paneId: "pane-rp", generation: 1, seq: s, data }],
          });
      },
      { seq, data: frame.data },
    );
    seq += 1;
  }
  await page.waitForTimeout(120);

  const probe = async () =>
    page.evaluate(async () => {
      const terminalViewUrl = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) => url.includes("/src/features/terminal/TerminalView.tsx"));
      const modulePath = terminalViewUrl
        ? new URL(terminalViewUrl).pathname + new URL(terminalViewUrl).search
        : "";
      const { terminals } = await import(/* @vite-ignore */ modulePath);
      const term = terminals.get("pane-rp") as unknown as {
        modes: { mouseTrackingMode: string };
        _core: {
          coreMouseService: { activeProtocol: string; activeEncoding: string };
          _renderService: { _isPaused: boolean; dimensions: { css: { cell: { width: number; height: number } } } };
          _charSizeService: { hasValidSize: boolean; width: number; height: number };
        };
      };
      const invokes = (window as unknown as {
        __tauriInvokes: Array<{ command: string; args?: Record<string, unknown> }>;
      }).__tauriInvokes;
      return {
        mode: term?.modes?.mouseTrackingMode,
        protocol: term?._core?.coreMouseService?.activeProtocol,
        encoding: term?._core?.coreMouseService?.activeEncoding,
        paused: term?._core?._renderService?._isPaused,
        charOk: term?._core?._charSizeService?.hasValidSize,
        charW: term?._core?._charSizeService?.width,
        charH: term?._core?._charSizeService?.height,
        cellW: term?._core?._renderService?.dimensions?.css?.cell?.width,
        cellH: term?._core?._renderService?.dimensions?.css?.cell?.height,
        writes: invokes.filter(
          (x) => (x.command === "pty_write" || x.command === "pty_write_bytes") && x.args?.paneId === "pane-rp",
        ).length,
      };
    });

  const click = async () => {
    const box = await page.locator('[data-pane-id="pane-rp"] .xterm-screen').boundingBox();
    if (!box) throw new Error("no box");
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.waitForTimeout(60);
  };

  console.log("after grok replay:", JSON.stringify(await probe()));
  await click();
  const p1 = await probe();
  console.log("after click 1:", JSON.stringify(p1));

  // Let the heal timer (20s) tick a couple of times while visible.
  await page.waitForTimeout(21_500);
  const p2 = await probe();
  console.log("after 21s idle (heal ticks):", JSON.stringify(p2));

  await click();
  const p3 = await probe();
  console.log("after click 2 (post-idle):", JSON.stringify(p3));

  console.log(
    `MOUSE REPORTS: initial=${p1.writes} afterIdle=${p3.writes} (delta ${p3.writes - p1.writes})`,
  );
  expect(p3.writes).toBeGreaterThan(p1.writes);
});



// Deterministic proof that the DEC 2026 gate makes a split synchronized frame
// atomic: a frame whose intermediate state parks the cursor on one row and whose
// final state parks it on another must never paint the intermediate row.
test("DEC 2026 gate renders a split sync frame atomically", async ({ page }) => {
  await mockSession(page);
  await page.goto("/");
  await expect(page.locator('[data-pane-id="pane-rp"] .xterm-screen')).toBeVisible();

  const BEGIN = "\u001b[?2026h";
  const END = "\u001b[?2026l";

  const emit = (seq: number, data: string) =>
    page.evaluate(
      ({ seq: s, data: d }) => {
        (window as unknown as { __emitTauri: (event: string, payload: unknown) => void })
          .__emitTauri("pty://output", {
            chunks: [{ paneId: "pane-rp", generation: 1, seq: s, data: d }],
          });
      },
      { seq, data },
    );

  const cursorRows = () => sample(page).then((s) => s.cursorPos.map((p) => p.row));

  // Baseline: visible cursor parked on row 3 (0-based row 2).
  await emit(1, "\u001b[2J\u001b[3;1H\u001b[?25h");
  await page.waitForTimeout(60);
  expect(await cursorRows()).toEqual([2]);

  // A synchronized frame split across two PTY chunks: the intermediate state
  // parks the cursor on row 10, the final state on row 20.
  await emit(2, `${BEGIN}\u001b[10;1HINTER`);
  await page.waitForTimeout(80); // > a render frame, < the 250ms hold timeout

  // The gate holds the whole frame: the intermediate cursor row (9, 0-based)
  // must never be painted. The cursor is still at the baseline row.
  expect(await cursorRows()).toEqual([2]);

  await emit(3, `\u001b[20;1HFINAL${END}`);
  await page.waitForTimeout(60);

  // After the end marker the frame flushes as one write; the cursor lands on
  // the final row and never on the intermediate one.
  expect(await cursorRows()).toEqual([19]);
});
