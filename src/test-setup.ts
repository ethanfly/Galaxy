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
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  });
}
