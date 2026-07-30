// Mock for @tauri-apps/api/core in unit tests.
import { vi } from "vitest";

export const invoke = vi.fn(async (_cmd: string, _args?: unknown) => {
  throw new Error(`invoke(${_cmd}) called without a registered mock`);
});
