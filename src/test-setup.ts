// Vitest setup: jsdom environment + Tauri API mocks.
import { vi } from "vitest";

// The Tauri runtime is unavailable under jsdom; all @tauri-apps/api calls are
// mocked through the virtual module in vitest config (see vite.config.ts).
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

if (!("clipboard" in navigator)) {
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: vi.fn(async () => {}),
      readText: vi.fn(async () => ""),
    },
    configurable: true,
  });
} else if (navigator.clipboard && !("readText" in navigator.clipboard)) {
  Object.defineProperty(navigator.clipboard, "readText", {
    value: vi.fn(async () => ""),
    configurable: true,
  });
}
