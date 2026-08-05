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
        | { translateToString(trimRight?: boolean): string }
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
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
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

export function createAgentScreenObserver(
  read: () => string,
  send: (screen: string) => Promise<void>,
  options: ObserverOptions = {},
): { schedule(): void; dispose(): void } {
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const trailingMs = options.trailingMs ?? DEFAULT_TRAILING_MS;
  let disposed = false;
  let lastSent: string | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;

  const transmit = (force = false) => {
    if (disposed) return;
    const screen = read();
    if (!screen || (!force && screen === lastSent)) return;
    lastSent = screen;
    lastSentAt = Date.now();
    try {
      void send(screen).catch(() => undefined);
    } catch {
      // Observation is best-effort and must never interrupt terminal rendering.
    }
  };

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

    if (trailingTimer) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      transmit(true);
    }, trailingMs);
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
