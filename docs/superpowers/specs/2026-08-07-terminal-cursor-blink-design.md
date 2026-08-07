# Terminal Cursor Blink Fix

## Problem

Galaxy initializes xterm with `cursorBlink: false`, but terminal applications can later send
DEC private mode 12 (`CSI ? 12 h`) and enable blinking again. Codex redraws several screen rows
while working, so a blinking renderer cursor can appear to jump between the working line, project
path, and input row.

The existing Playwright assertion counts `.xterm-cursor` elements. Galaxy uses xterm's Canvas or
WebGL renderer, where the cursor is not represented by that DOM element, so the assertion can pass
without checking the rendered cursor.

## Design

Keep Galaxy's terminal cursor policy authoritative. After every xterm write has been parsed, restore
`term.options.cursorBlink` to `false` before reporting the write as rendered. Apply the same policy
to normal output, replayed output, and direct notices because they all use the terminal write path.
Do not hide the cursor and do not alter cursor position, shape, TUI output, or Codex's working
spinner.

Put the policy in a small terminal helper rather than duplicating assignment logic in callbacks.
The helper accepts the minimal terminal options surface needed by unit tests.

## Testing

Add a unit test that starts with blinking enabled, applies the policy, and verifies blinking is
disabled. Update the terminal write-path test coverage so a simulated application re-enabling blink
is corrected after output parsing.

Remove or replace the `.xterm-cursor` count assertion because it does not observe Canvas/WebGL
pixels. The UI regression should instead inspect the live terminal option after TUI frame writes.
Existing IME composition and rapid split-frame assertions remain in place.

## Scope

This fix does not change renderer selection, PTY batching, Codex output, IME anchoring, or mouse
handling. It prevents blinking but does not suppress the single visible terminal cursor.
