import { useEffect, useLayoutEffect } from "react";

import { TitleBar } from "./features/titlebar/TitleBar";
import { TabBar } from "./features/tabs/TabBar";
import { NavigationRail } from "./features/navigation/NavigationRail";
import { ContextSidebar } from "./features/navigation/ContextSidebar";
import { Workspace } from "./features/terminal/Workspace";
import { RightPanel } from "./features/panels/RightPanel";
import { StatusBar } from "./features/statusbar/StatusBar";
import { FindBar } from "./features/search/FindBar";
import { BlockSearchModal } from "./features/search/BlockSearchModal";
import { HistorySearchModal } from "./features/search/HistorySearchModal";
import { CommandPalette } from "./features/search/CommandPalette";
import { SettingsModal } from "./features/settings/SettingsModal";
import { RecoveryDialog } from "./features/recovery/RecoveryDialog";
import { WorkflowRunModal } from "./features/workflow/WorkflowRunModal";
import { MovePaneModal } from "./features/terminal/MovePaneModal";
import { InsightsView } from "./features/insights/InsightsView";

import { onAgentStatus, onOpenHere, onPtyExit, onPtyOutput, onRecoveryAvailable, onSessionTitle, onTriggerFire, onNotification, onGitChanged, onStoreChanged } from "./shared/ipc/events";
import { ptyResize } from "./shared/ipc/client";
import { useAppStore } from "./shared/stores/appStore";
import { refitAllTerminals, useTerminalStore } from "./shared/stores/terminalStore";
import { useUiStore } from "./shared/stores/uiStore";
import { DEFAULT_APPEARANCE } from "./shared/appearance";
import { subscribeDevicePixelRatio } from "./shared/dpr";
import { useShortcuts } from "./features/shortcuts/useShortcuts";
import { t } from "./shared/i18n";
import { IconAlert } from "./shared/icons/Icons";

export default function App() {
  const init = useAppStore((s) => s.init);
  const loadState = useAppStore((s) => s.loadState);
  const boot = useAppStore((s) => s.boot);
  const error = useAppStore((s) => s.error);
  const ingest = useTerminalStore((s) => s.ingest);
  const workspaceView = useUiStore((s) => s.workspaceView);
  const persistedUiFontSize = useAppStore((s) => s.config?.uiFontSize);
  const previewUiFontSize = useUiStore((s) => s.appearancePreview?.uiFontSize);
  const uiFontSize = previewUiFontSize ?? persistedUiFontSize ?? DEFAULT_APPEARANCE.uiFontSize;

  useShortcuts();

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
  }, [uiFontSize]);

  // OS display scale / multi-monitor DPR changes → re-fit all terminals so
  // TUI mouse cell metrics stay correct (spec 2026-08-06).
  useEffect(() => {
    return subscribeDevicePixelRatio(() => {
      refitAllTerminals((paneId, cols, rows) => {
        void ptyResize(paneId, cols, rows);
      });
    });
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  // Suppress the browser's native context menu everywhere. Custom menus call
  // preventDefault themselves; this covers empty/welcome surfaces that do not.
  useEffect(() => {
    const blockNativeMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", blockNativeMenu);
    return () => document.removeEventListener("contextmenu", blockNativeMenu);
  }, []);

  // Global IPC event wiring (single subscriptions at app root).
  // StrictMode mounts/unmounts once in dev: async listen() must cancel if the
  // effect cleaned up before the promise resolved, otherwise we keep two
  // pty://output listeners and every keystroke is painted twice.
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const add = (p: Promise<() => void>) => {
      void p.then(
        (u) => {
          if (cancelled) {
            u();
            return;
          }
          unlisteners.push(u);
        },
        (err) => {
          console.error("Failed to register global IPC listener", err);
        },
      );
    };

    add(onPtyOutput((batch) => ingest(batch.chunks)));
    add(onPtyExit(({ paneId }) => {
      // keep pane model fresh; exit_code already persisted backend-side
      void useAppStore.getState().refreshSessions();
      void paneId;
    }));
    add(onSessionTitle(({ paneId, sessionId, title }) => {
      useAppStore.getState().updatePaneTitle(paneId, sessionId, title);
    }));
    add(onAgentStatus(({ paneId, agentKind, status }) => {
      useTerminalStore.getState().setAgent(paneId, agentKind, status);
      useAppStore.getState().updatePaneAgent(paneId, agentKind);
    }));
    add(onTriggerFire((fire) => {
      const ts = useTerminalStore.getState();
      if (fire.actions.includes("mark")) ts.addMark(fire.paneId);
      if (fire.actions.includes("stopScroll")) ts.setScrollLocked(fire.paneId, true);
      if (fire.actions.includes("bell")) playBell();
    }));
    add(onNotification(() => {
      void useAppStore.getState().refreshNotifications();
    }));
    add(onOpenHere(({ path }) => {
      // Warm single-instance path: app is already ready.
      // If init is still running, stash for the drain effect.
      if (useAppStore.getState().loadState !== "ready") {
        useAppStore.getState().enqueueOpenHere(path);
        return;
      }
      void handleOpenHere(path);
    }));
    add(onRecoveryAvailable(() => {
      useUiStore.getState().openRecovery();
    }));
    add(onGitChanged(() => {
      // GitPanel/StatusBar refresh on their own cadence trigger
      window.dispatchEvent(new CustomEvent("galaxy:git-refresh"));
    }));
    add(onStoreChanged((payload) => {
      // Background shell re-detect emits { kind: "profiles" } after first paint.
      if (payload?.kind === "profiles") {
        void useAppStore.getState().refreshProfiles();
      }
    }));

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [ingest]);

  // Drain queued --open-here paths after init (cold start only).
  useEffect(() => {
    if (loadState !== "ready") return;
    const queued = useAppStore.getState().drainOpenHere();
    for (const path of queued) void handleOpenHere(path);
    if (useAppStore.getState().boot?.recoveredFromCrash) {
      useUiStore.getState().openRecovery();
    }
  }, [loadState]);

  if (loadState === "error") {
    return (
      <div className="empty-workspace">
        <div className="big-glyph">✧</div>
        <div>初始化失败：{error}</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <NavigationRail />
      <ContextSidebar />
      <main className="main-stage">
        <section
          className={`terminal-surface ${workspaceView === "terminal" ? "active" : "inactive"}`}
          data-testid="terminal-surface"
          aria-hidden={workspaceView !== "terminal"}
        >
          <TabBar />
          <div className="workspace">
            {boot?.readOnly && (
              <div className="banner">
                <IconAlert size={14} />
                {t("readOnlyWarning")}
              </div>
            )}
            <Workspace />
            <FindBar />
          </div>
        </section>
        <section
          className={`insights-surface ${workspaceView === "insights" ? "active" : "inactive"}`}
          data-testid="insights-surface"
          aria-hidden={workspaceView !== "insights"}
        >
          <InsightsView />
        </section>
      </main>
      <RightPanel />
      <StatusBar />
      <BlockSearchModal />
      <HistorySearchModal />
      <CommandPalette />
      <SettingsModal />
      <RecoveryDialog />
      <WorkflowRunModal />
      <MovePaneModal />
    </div>
  );
}

/** Dedup consecutive identical Explorer "open here" requests (same path). */
let lastOpenHere: { path: string; at: number } | null = null;

async function handleOpenHere(path: string) {
  const normalized = path.trim();
  if (!normalized) return;
  const now = Date.now();
  if (
    lastOpenHere &&
    lastOpenHere.path.toLowerCase() === normalized.toLowerCase() &&
    now - lastOpenHere.at < 2500
  ) {
    return;
  }
  lastOpenHere = { path: normalized, at: now };

  const app = useAppStore.getState();
  const project = await app.addProject(normalized);
  if (project) await app.createSession(project.id);
}

let bellCtx: AudioContext | null = null;
function playBell() {
  try {
    bellCtx ??= new AudioContext();
    const osc = bellCtx.createOscillator();
    const gain = bellCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.05, bellCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, bellCtx.currentTime + 0.25);
    osc.connect(gain).connect(bellCtx.destination);
    osc.start();
    osc.stop(bellCtx.currentTime + 0.25);
  } catch {
    /* audio unavailable */
  }
}
