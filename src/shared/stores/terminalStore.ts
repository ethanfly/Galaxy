// Terminal runtime state: sequence tracking, activity pulses, agent status,
// and the xterm instance registry (non-reactive, pane-scoped).
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

import { ptyReplay } from "../ipc/client";
import type { AgentKind, AgentStatus, PaneChunk } from "../ipc/types";

export interface TerminalHandle {
  paneId: string;
  write(data: string, seq: number, generation: number): void;
  replay(chunks: PaneChunk[]): void;
  truncatedNotice(): void;
}

// Non-reactive registry of live terminal instances.
const registry = new Map<string, TerminalHandle>();
export function registerTerminal(handle: TerminalHandle) {
  registry.set(handle.paneId, handle);
  const delivery = deliveries.get(handle.paneId);
  if (!delivery) return;
  flushContiguous(handle.paneId, delivery);
  startGapRecovery(handle.paneId, delivery);
}
/** Only remove if this handle is still the registered one (StrictMode race). */
export function unregisterTerminal(paneId: string, handle?: TerminalHandle) {
  if (handle && registry.get(paneId) !== handle) return;
  registry.delete(paneId);
}
export function terminalFor(paneId: string): TerminalHandle | undefined {
  return registry.get(paneId);
}

interface PaneDeliveryState {
  generation: number;
  committedSeq: number;
  buffered: Map<number, PaneChunk>;
  recovering: boolean;
}

// Gap recovery is pane-scoped and non-reactive. Later live chunks stay here
// until the missing range has been replayed into xterm in sequence order.
const deliveries = new Map<string, PaneDeliveryState>();

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

export const useTerminalStore = create<TerminalStoreState>()(
  subscribeWithSelector((set, get) => ({
    lastSeq: {},
    activity: {},
    agentStatus: {},
    marks: {},
    scrollLocked: {},
    focusedPane: {},

    ingest(chunks) {
      const nextActivity = { ...get().activity };
      const now = Date.now();
      for (const chunk of chunks) {
        enqueueChunk(chunk);
        nextActivity[chunk.paneId] = now;
      }
      set({ activity: nextActivity });
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
      deliveries.delete(paneId);
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
  })),
);

function enqueueChunk(chunk: PaneChunk) {
  let delivery = deliveries.get(chunk.paneId);
  if (delivery && chunk.generation < delivery.generation) return;
  if (!delivery || chunk.generation > delivery.generation) {
    delivery = {
      generation: chunk.generation,
      committedSeq: 0,
      buffered: new Map(),
      recovering: false,
    };
    deliveries.set(chunk.paneId, delivery);
    useTerminalStore.setState((state) => {
      const lastSeq = { ...state.lastSeq };
      delete lastSeq[chunk.paneId];
      return { lastSeq };
    });
  }
  if (chunk.seq <= delivery.committedSeq) return;

  delivery.buffered.set(chunk.seq, chunk);
  flushContiguous(chunk.paneId, delivery);
  startGapRecovery(chunk.paneId, delivery);
}

function flushContiguous(paneId: string, delivery: PaneDeliveryState) {
  const terminal = terminalFor(paneId);
  if (!terminal) return;
  let advanced = false;
  while (true) {
    const nextSeq = delivery.committedSeq + 1;
    const chunk = delivery.buffered.get(nextSeq);
    if (!chunk) break;
    delivery.buffered.delete(nextSeq);
    terminal.write(chunk.data, chunk.seq, chunk.generation);
    delivery.committedSeq = chunk.seq;
    advanced = true;
  }
  if (advanced) {
    useTerminalStore.setState((state) => ({
      lastSeq: { ...state.lastSeq, [paneId]: delivery.committedSeq },
    }));
  }
}

function hasGap(delivery: PaneDeliveryState) {
  return delivery.buffered.size > 0 && !delivery.buffered.has(delivery.committedSeq + 1);
}

function startGapRecovery(paneId: string, delivery: PaneDeliveryState) {
  if (delivery.recovering || !terminalFor(paneId) || !hasGap(delivery)) return;
  delivery.recovering = true;

  void (async () => {
    try {
      while (deliveries.get(paneId) === delivery && hasGap(delivery)) {
        const afterSeq = delivery.committedSeq;
        let replay;
        try {
          replay = await ptyReplay(paneId, afterSeq, delivery.generation);
        } catch {
          break;
        }
        if (
          deliveries.get(paneId) !== delivery ||
          replay.generation !== delivery.generation ||
          !terminalFor(paneId)
        ) {
          break;
        }

        if (replay.truncated) {
          terminalFor(paneId)?.truncatedNotice();
          const firstAvailable =
            replay.fromSeq ??
            replay.chunks.reduce<number | undefined>(
              (lowest, chunk) =>
                lowest == null ? chunk.seq : Math.min(lowest, chunk.seq),
              undefined,
            );
          if (firstAvailable != null && firstAvailable > delivery.committedSeq + 1) {
            delivery.committedSeq = firstAvailable - 1;
          }
        }

        for (const chunk of [...replay.chunks].sort((a, b) => a.seq - b.seq)) {
          if (
            chunk.generation === delivery.generation &&
            chunk.seq > delivery.committedSeq
          ) {
            delivery.buffered.set(chunk.seq, chunk);
          }
        }
        flushContiguous(paneId, delivery);
        if (delivery.committedSeq === afterSeq) break;
      }
    } finally {
      if (deliveries.get(paneId) === delivery) delivery.recovering = false;
    }
  })();
}
