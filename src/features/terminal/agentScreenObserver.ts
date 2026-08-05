const DEFAULT_ROW_COUNT = 12;
const DEFAULT_MAX_BYTES = 4096;
const DEFAULT_THROTTLE_MS = 250;
const DEFAULT_TRAILING_MS = 600;

export interface RenderedScreenSource {
  rows: number;
  buffer: {
    active: {
      baseY: number;
      getLine(index: number):
        | { isWrapped?: boolean; translateToString(trimRight?: boolean): string }
        | undefined;
    };
  };
}

export function readAgentScreen(
  terminal: RenderedScreenSource,
  rowCount = DEFAULT_ROW_COUNT,
  maxBytes = DEFAULT_MAX_BYTES,
): string {
  const buffer = terminal.buffer.active;
  const end = buffer.baseY + Math.max(terminal.rows, 1) - 1;
  const start = Math.max(buffer.baseY, end - Math.max(rowCount, 1) + 1);
  const lines: string[] = [];
  for (let index = start; index <= end; index += 1) {
    const line = buffer.getLine(index);
    const nextLine = index < end ? buffer.getLine(index + 1) : undefined;
    const text = line?.translateToString(!nextLine?.isWrapped) ?? "";
    if (line?.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }
  return utf8Tail(lines.join("\n").trimEnd(), maxBytes);
}

function utf8Tail(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || value.length === 0) return "";
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;

  let start = encoded.byteLength - maxBytes;
  while (start < encoded.byteLength && (encoded[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return new TextDecoder().decode(encoded.subarray(start));
}

interface ObserverOptions {
  throttleMs?: number;
  trailingMs?: number;
}

export interface AgentScreenSnapshot {
  screen: string;
  renderedGeneration: number;
  renderedSeq: number;
}

export function createAgentScreenObserver(
  read: () => AgentScreenSnapshot,
  send: (snapshot: AgentScreenSnapshot) => Promise<void>,
  options: ObserverOptions = {},
): { schedule(): void; dispose(): void } {
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const trailingMs = options.trailingMs ?? DEFAULT_TRAILING_MS;
  let disposed = false;
  let lastSent: AgentScreenSnapshot | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  function armTrailing() {
    if (trailingTimer) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      transmit(true);
    }, trailingMs);
  }

  function transmit(force = false) {
    if (disposed) return;
    const snapshot = read();
    if (
      !snapshot.screen ||
      (!force &&
        snapshot.screen === lastSent?.screen &&
        snapshot.renderedGeneration === lastSent.renderedGeneration &&
        snapshot.renderedSeq === lastSent.renderedSeq)
    ) {
      return;
    }
    lastSent = snapshot;
    lastSentAt = Date.now();
    try {
      void send(snapshot).catch(() => undefined);
    } catch {
      // Observation is best-effort and must never interrupt terminal rendering.
    }
    if (!force) armTrailing();
  }

  const schedule = () => {
    if (disposed) return;
    const remaining = throttleMs - (Date.now() - lastSentAt);
    if (remaining <= 0) {
      if (throttleTimer) clearTimeout(throttleTimer);
      throttleTimer = null;
      transmit();
    } else if (!throttleTimer) {
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        transmit();
      }, remaining);
    }

    armTrailing();
  };

  const dispose = () => {
    disposed = true;
    if (throttleTimer) clearTimeout(throttleTimer);
    if (trailingTimer) clearTimeout(trailingTimer);
    throttleTimer = null;
    trailingTimer = null;
  };

  return { schedule, dispose };
}
