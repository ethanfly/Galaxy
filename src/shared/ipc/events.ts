// Typed event subscriptions mirroring src-tauri/src/state.rs `events` module.
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  AgentKind,
  AgentStatus,
  NotificationItem,
  OutputBatch,
  TriggerFire,
} from "./types";

export const EV = {
  PTY_OUTPUT: "pty://output",
  PTY_EXIT: "pty://exit",
  PTY_ERROR: "pty://error",
  SESSION_TITLE: "session://title",
  BLOCKS_UPDATED: "blocks://updated",
  AGENT_STATUS: "agent://status",
  AGENT_SCAN_DONE: "agent://scan-done",
  TRIGGER_FIRE: "trigger://fire",
  NOTIFICATION_NEW: "notification://new",
  GIT_CHANGED: "git://changed",
  OPEN_HERE: "system://open-here",
  RECOVERY: "system://recovery",
  STORE_CHANGED: "store://changed",
  LAYOUT_CHANGED: "layout://changed",
} as const;

export function onPtyOutput(cb: (batch: OutputBatch) => void): Promise<UnlistenFn> {
  return listen<OutputBatch>(EV.PTY_OUTPUT, (e) => cb(e.payload));
}

export function onPtyExit(
  cb: (p: { paneId: string; exitCode: number | null }) => void,
): Promise<UnlistenFn> {
  return listen<{ paneId: string; exitCode: number | null }>(EV.PTY_EXIT, (e) => cb(e.payload));
}

export function onPtyError(cb: (p: { paneId: string; message: string }) => void) {
  return listen<{ paneId: string; message: string }>(EV.PTY_ERROR, (e) => cb(e.payload));
}

export function onSessionTitle(
  cb: (p: { paneId: string; sessionId: string; title: string }) => void,
) {
  return listen<{ paneId: string; sessionId: string; title: string }>(
    EV.SESSION_TITLE,
    (e) => cb(e.payload),
  );
}

export function onBlocksUpdated(cb: (p: { sessionId: string }) => void) {
  return listen<{ sessionId: string }>(EV.BLOCKS_UPDATED, (e) => cb(e.payload));
}

export function onAgentStatus(
  cb: (p: {
    paneId: string;
    sessionId: string;
    agentKind: AgentKind;
    status: AgentStatus;
  }) => void,
) {
  return listen<{
    paneId: string;
    sessionId: string;
    agentKind: AgentKind;
    status: AgentStatus;
  }>(EV.AGENT_STATUS, (e) => cb(e.payload));
}

export function onAgentScanDone(cb: (p: { projectPath: string; count: number }) => void) {
  return listen<{ projectPath: string; count: number }>(EV.AGENT_SCAN_DONE, (e) => cb(e.payload));
}

export function onTriggerFire(cb: (fire: TriggerFire) => void) {
  return listen<TriggerFire>(EV.TRIGGER_FIRE, (e) => cb(e.payload));
}

export function onNotification(cb: (n: NotificationItem) => void) {
  return listen<NotificationItem>(EV.NOTIFICATION_NEW, (e) => cb(e.payload));
}

export function onGitChanged(cb: (p: { projectId: string }) => void) {
  return listen<{ projectId: string }>(EV.GIT_CHANGED, (e) => cb(e.payload));
}

export function onOpenHere(cb: (p: { path: string }) => void) {
  return listen<{ path: string }>(EV.OPEN_HERE, (e) => cb(e.payload));
}

export function onRecoveryAvailable(cb: () => void) {
  return listen(EV.RECOVERY, () => cb());
}

export function onStoreChanged(cb: (p: { kind?: string }) => void) {
  return listen<{ kind?: string }>(EV.STORE_CHANGED, (e) => cb(e.payload ?? {}));
}
