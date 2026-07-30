// Terminal runtime state: sequence tracking, activity pulses, agent status,
// and the xterm instance registry (non-reactive, pane-scoped).
import { create } from "zustand";

import { ptyReplay } from "../ipc/client";
import type { AgentKind, AgentStatus, PaneChunk } from "../ipc/types";

export interface TerminalHandle {
  paneId: string;
  write(data: string): void;
  replay(chunks: PaneChunk[]): void;
  truncatedNotice(): void;
}

// Non-reactive registry of live terminal instances.
const registry = new Map<string, TerminalHandle>();
export function registerTerminal(handle: TerminalHandle) {
  registry.set(handle.paneId, handle);
}
/** Only remove if this handle is still the registered one (StrictMode race). */
export function unregisterTerminal(paneId: string, handle?: TerminalHandle) {
  if (handle && registry.get(paneId) !== handle) return;
  registry.delete(paneId);
}
export function terminalFor(paneId: string): TerminalHandle | undefined {
  return registry.get(paneId);
}

interface TerminalStoreState {
  lastSeq: Record<string, number>;
  /** paneId → last output timestamp; TabBar renders a low-freq pulse. */
  activity: Record<string, number>;
  agentStatus: Record<string, { kind: AgentKind; status: AgentStatus }>;
  marks: Record<string, number>; // trigger marks
  scrollLocked: Record<string, boolean>;

  /** sessionId → focused pane id */
  focusedPane: Record<string, string>;

  ingest(chunks: PaneChunk[]): void;
  markGap(paneId: string, fromSeq: number): void;
  setAgent(paneId: string, kind: AgentKind, status: AgentStatus): void;
  addMark(paneId: string): void;
  clearMarks(paneId: string): void;
  setScrollLocked(paneId: string, locked: boolean): void;
  setFocusedPane(sessionId: string, paneId: string): void;
  resetPane(paneId: string): void;
}

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  lastSeq: {},
  activity: {},
  agentStatus: {},
  marks: {},
  scrollLocked: {},
  focusedPane: {},

  ingest(chunks) {
    const pendingGaps: string[] = [];
    const { lastSeq, activity } = get();
    const nextSeq = { ...lastSeq };
    const nextActivity = { ...activity };
    const now = Date.now();
    for (const chunk of chunks) {
      const prev = nextSeq[chunk.paneId] ?? 0;
      if (chunk.seq > prev + 1 && prev > 0) {
        // Sequence gap → request backend ring replay (spec §3.2).
        pendingGaps.push(chunk.paneId);
        void replayFrom(chunk.paneId, prev).then((latest) => {
          nextSeq[chunk.paneId] = Math.max(nextSeq[chunk.paneId] ?? 0, latest, chunk.seq);
          set({ lastSeq: { ...get().lastSeq, [chunk.paneId]: nextSeq[chunk.paneId] } });
        });
        nextSeq[chunk.paneId] = chunk.seq;
      } else {
        nextSeq[chunk.paneId] = chunk.seq;
        const term = terminalFor(chunk.paneId);
        term?.write(chunk.data);
      }
      nextActivity[chunk.paneId] = now;
    }
    set({ lastSeq: nextSeq, activity: nextActivity });
    for (const paneId of pendingGaps) {
      void paneId;
    }
  },

  markGap(paneId, fromSeq) {
    set({ lastSeq: { ...get().lastSeq, [paneId]: fromSeq } });
  },

  setAgent(paneId, kind, status) {
    set({ agentStatus: { ...get().agentStatus, [paneId]: { kind, status } } });
    void kind;
  },

  addMark(paneId) {
    set({ marks: { ...get().marks, [paneId]: (get().marks[paneId] ?? 0) + 1 } });
  },

  clearMarks(paneId) {
    set({ marks: { ...get().marks, [paneId]: 0 } });
  },

  setScrollLocked(paneId, locked) {
    set({ scrollLocked: { ...get().scrollLocked, [paneId]: locked } });
  },

  setFocusedPane(sessionId, paneId) {
    set({ focusedPane: { ...get().focusedPane, [sessionId]: paneId } });
  },

  resetPane(paneId) {
    const { lastSeq, activity, agentStatus, marks, scrollLocked } = get();
    delete lastSeq[paneId];
    delete activity[paneId];
    delete agentStatus[paneId];
    delete marks[paneId];
    delete scrollLocked[paneId];
    set({
      lastSeq: { ...lastSeq },
      activity: { ...activity },
      agentStatus: { ...agentStatus },
      marks: { ...marks },
      scrollLocked: { ...scrollLocked },
    });
  },
}));

async function replayFrom(paneId: string, afterSeq: number): Promise<number> {
  try {
    const replay = await ptyReplay(paneId, afterSeq);
    const term = terminalFor(paneId);
    if (!term) return afterSeq;
    if (replay.truncated) {
      term.truncatedNotice();
    }
    let latest = afterSeq;
    for (const chunk of replay.chunks) {
      term.write(chunk.data);
      latest = Math.max(latest, chunk.seq);
    }
    return latest;
  } catch {
    return afterSeq;
  }
}
