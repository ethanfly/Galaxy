interface CursorOptionsTarget {
  options: { cursorBlink?: boolean };
}

export function enforceNonBlinkingCursor(terminal: CursorOptionsTarget): void {
  if (terminal.options.cursorBlink) terminal.options.cursorBlink = false;
}
