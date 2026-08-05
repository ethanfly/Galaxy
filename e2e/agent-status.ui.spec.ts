import { expect, Page, test } from "playwright/test";

async function mockAgentTerminal(page: Page) {
  await page.addInitScript(() => {
    const project = {
      id: "project-agent",
      name: "Agent",
      path: "C:\\workspace\\agent",
      color: "#f5f6f7",
      createdAt: "2026-08-05T00:00:00Z",
      lastAccessedAt: "2026-08-05T00:00:00Z",
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
      id: "session-agent",
      projectId: project.id,
      title: "Codex",
      sortOrder: 0,
      layout: {
        pane: {
          id: "pane-agent",
          cwd: project.path,
          profile,
          cols: 100,
          rows: 30,
          title: "codex",
          active: true,
          agentKind: "codex",
        },
      },
      syncInput: false,
      createdAt: "2026-08-05T00:00:00Z",
    };
    const config = {
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
      shortcuts: [],
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
    type InvokeArgs = Record<string, unknown> & {
      event?: string;
      handler?: number;
      eventId?: number;
    };
    const invokes: Array<{ command: string; args?: InvokeArgs; at: number }> = [];
    (window as unknown as { __tauriInvokes: typeof invokes }).__tauriInvokes = invokes;
    const responses: Record<string, () => unknown> = {
      boot_info: () => ({ recoveredFromCrash: false, readOnly: false, dataDir: "D" }),
      project_list: () => [project],
      session_list: () => [session],
      config_get: () => config,
      profiles_list: () => [profile],
      notification_list: () => [],
      system_pending_open_here: () => [],
      workspace_restore: () => 0,
      pty_resize: () => undefined,
      pty_write: () => undefined,
      pty_observe_screen: () => undefined,
    };
    const callbacks = new Map<number, (data: unknown) => void>();
    const eventListeners = new Map<string, number[]>();
    let nextCallbackId = 1;
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      invoke: (command: string, args?: InvokeArgs) => {
        invokes.push({ command, args, at: performance.now() });
        if (command === "plugin:event|listen" && args?.event && args.handler != null) {
          const ids = eventListeners.get(args.event) ?? [];
          ids.push(args.handler);
          eventListeners.set(args.event, ids);
          return Promise.resolve(args.handler);
        }
        if (command === "plugin:event|unlisten" && args?.event && args.eventId != null) {
          eventListeners.set(
            args.event,
            (eventListeners.get(args.event) ?? []).filter((id) => id !== args.eventId),
          );
          return Promise.resolve(undefined);
        }
        return Promise.resolve(responses[command]?.());
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

test("Agent panes send a capped and throttled rendered Working screen", async ({ page }) => {
  await mockAgentTerminal(page);
  await page.goto("/");
  await expect(page.locator(".xterm-screen")).toBeVisible();

  await page.evaluate(() => {
    const emit = (
      window as unknown as {
        __emitTauri: (event: string, payload: unknown) => void;
      }
    ).__emitTauri;
    for (let index = 1; index <= 12; index += 1) {
      const data =
        index === 1
          ? `\u001b[999B>> Run /review on my changes\r\n* Working (1s * esc to interrupt)`
          : `\r\u001b[2K* Working (${index}s * esc to interrupt)`;
      emit("pty://output", {
        chunks: [{ paneId: "pane-agent", generation: 1, seq: index, data }],
      });
    }
  });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __tauriInvokes: Array<{ command: string }>;
            }
          ).__tauriInvokes.filter((entry) => entry.command === "pty_observe_screen").length,
      ),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(850);

  const observations = await page.evaluate(() =>
    (
      window as unknown as {
        __tauriInvokes: Array<{
          command: string;
          args?: {
            paneId?: string;
            screen?: string;
            renderedGeneration?: number;
            renderedSeq?: number;
          };
          at: number;
        }>;
      }
    ).__tauriInvokes.filter((entry) => entry.command === "pty_observe_screen"),
  );
  expect(observations.length).toBeGreaterThan(0);
  expect(observations.length).toBeLessThanOrEqual(3);
  expect(observations.length).toBeLessThan(12);
  for (const observation of observations) {
    expect(observation.args?.paneId).toBe("pane-agent");
    expect(observation.args?.renderedGeneration).toBe(1);
    expect(observation.args?.renderedSeq).toEqual(expect.any(Number));
    expect(new TextEncoder().encode(observation.args?.screen ?? "").byteLength).toBeLessThanOrEqual(
      4096,
    );
  }
  for (let index = 1; index < observations.length; index += 1) {
    expect(observations[index].at - observations[index - 1].at).toBeGreaterThanOrEqual(180);
  }
  const latest = observations.at(-1)?.args?.screen ?? "";
  expect(observations.at(-1)?.args?.renderedSeq).toBe(12);
  expect(
    latest.split("\n").some((line) => /^\* Working \(.+esc to interrupt\)$/.test(line.trim())),
  ).toBe(true);

  await page.evaluate(() => {
    (
      window as unknown as {
        __emitTauri: (event: string, payload: unknown) => void;
      }
    ).__emitTauri("pty://output", {
      chunks: [
        {
          paneId: "pane-agent",
          generation: 2,
          seq: 1,
          data: "\r\u001b[2K* Working (restarted * esc to interrupt)",
        },
      ],
    });
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __tauriInvokes: Array<{
              command: string;
              args?: { renderedGeneration?: number; renderedSeq?: number };
            }>;
          }
        ).__tauriInvokes
          .filter((entry) => entry.command === "pty_observe_screen")
          .at(-1)?.args?.renderedSeq,
      ),
    )
    .toBe(1);
  const restartedGeneration = await page.evaluate(() =>
    (
      window as unknown as {
        __tauriInvokes: Array<{
          command: string;
          args?: { renderedGeneration?: number };
        }>;
      }
    ).__tauriInvokes
      .filter((entry) => entry.command === "pty_observe_screen")
      .at(-1)?.args?.renderedGeneration,
  );
  expect(restartedGeneration).toBe(2);
});
