import { useEffect } from "react";

import { TitleBar } from "./features/titlebar/TitleBar";
import { TabBar } from "./features/tabs/TabBar";
import { ProjectSidebar } from "./features/projects/ProjectSidebar";
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

import { onAgentStatus, onOpenHere, onPtyExit, onPtyOutput, onRecoveryAvailable, onSessionTitle, onTriggerFire, onNotification, onGitChanged } from "./shared/ipc/events";
import { useAppStore } from "./shared/stores/appStore";
import { useTerminalStore } from "./shared/stores/terminalStore";
import { useUiStore } from "./shared/stores/uiStore";
import { useShortcuts } from "./features/shortcuts/useShortcuts";
import { t } from "./shared/i18n";

export default function App() {
  const init = useAppStore((s) => s.init);
  const loadState = useAppStore((s) => s.loadState);
  const boot = useAppStore((s) => s.boot);
  const error = useAppStore((s) => s.error);
  const ingest = useTerminalStore((s) => s.ingest);

  useShortcuts();

  useEffect(() => {
    void init();
  }, [init]);

  // Global IPC event wiring (single subscriptions at app root).
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    const add = (p: Promise<() => void>) => {
      void p.then((u) => unlisteners.push(u));
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
      void handleOpenHere(path);
    }));
    add(onRecoveryAvailable(() => {
      useUiStore.getState().openRecovery();
    }));
    add(onGitChanged(() => {
      // GitPanel/StatusBar refresh on their own cadence trigger
      window.dispatchEvent(new CustomEvent("galaxy:git-refresh"));
    }));

    return () => unlisteners.forEach((u) => u());
  }, [ingest]);

  // Drain queued --open-here paths after init.
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
      <div className="empty-workspace starfield">
        <div className="big-glyph">✧</div>
        <div>初始化失败：{error}</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <TabBar />
      <ProjectSidebar />
      <div className="workspace">
        {boot?.readOnly && <div className="banner">⚠ {t("readOnlyWarning")}</div>}
        <Workspace />
        <FindBar />
      </div>
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

async function handleOpenHere(path: string) {
  const app = useAppStore.getState();
  const project = await app.addProject(path);
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
