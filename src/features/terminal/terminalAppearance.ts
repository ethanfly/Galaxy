import type { ITerminalInitOnlyOptions, ITerminalOptions } from "@xterm/xterm";

import { GALAXY_THEME } from "./terminalTheme";

// Latin monospace faces first, then CJK-capable fallbacks shipped on common platforms.
export const TERMINAL_FONT_FAMILY = [
  "Cascadia Mono",
  "Cascadia Code",
  "JetBrains Mono",
  "Sarasa Mono SC",
  "Sarasa Term SC",
  "Noto Sans Mono CJK SC",
  "Source Han Mono SC",
  "Consolas",
  "Courier New",
  "Microsoft YaHei UI",
  "Microsoft YaHei",
  "PingFang SC",
  "Hiragino Sans GB",
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  "SimHei",
  "Segoe UI",
  "monospace",
]
  .map((font) => (font.includes(" ") ? `"${font}"` : font))
  .join(", ");

export function terminalOptions(
  fontSize: number,
): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorBlink: false,
    allowProposedApi: true,
    scrollback: 10_000,
    theme: GALAXY_THEME,
    rightClickSelectsWord: true,
    windowsMode: true,
  };
}

interface TerminalFontTarget {
  options: { fontSize?: number };
  cols: number;
  rows: number;
}

interface FitTarget {
  fit(): void;
}

export function applyTerminalFontSize(
  terminal: TerminalFontTarget,
  fit: FitTarget,
  fontSize: number,
): { cols: number; rows: number } | null {
  if (terminal.options.fontSize === fontSize) return null;
  terminal.options.fontSize = fontSize;
  fit.fit();
  return { cols: terminal.cols, rows: terminal.rows };
}
