import type { AppConfig } from "./ipc/types";

export type Appearance = Pick<AppConfig, "terminalFontSize" | "uiFontSize">;

export const DEFAULT_APPEARANCE: Appearance = {
  terminalFontSize: 14,
  uiFontSize: 13,
};

export function resolveAppearance(
  config: Appearance | null | undefined,
  preview: Appearance | null | undefined,
): Appearance {
  return preview ?? config ?? DEFAULT_APPEARANCE;
}
