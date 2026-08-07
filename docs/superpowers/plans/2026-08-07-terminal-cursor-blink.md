# Terminal Cursor Blink Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Galaxy's xterm cursor non-blinking even when a terminal application sends DEC private mode 12, while preserving the single visible cursor and Codex TUI animations.

**Architecture:** A focused helper owns Galaxy's cursor policy and mutates only xterm's `cursorBlink` option. `TerminalView` invokes it after each parsed write, including normal, replay, scroll-locked, and truncation-notice output; tests assert terminal state rather than counting nonexistent DOM cursor elements.

**Tech Stack:** React 18, TypeScript 5.8, xterm.js 5.5, Vitest 3, Playwright 1.52

## Global Constraints

- Do not hide or reposition the terminal cursor.
- Do not alter Codex's `Working` spinner, TUI output, IME anchoring, mouse handling, renderer selection, or PTY batching.
- Keep `cursorBlink` false after every parsed xterm write.
- Do not add dependencies.

---

### Task 1: Authoritative Cursor Policy

**Files:**
- Create: `src/features/terminal/terminalCursor.ts`
- Create: `src/features/terminal/terminalCursor.test.ts`

**Interfaces:**
- Consumes: An object with `options.cursorBlink?: boolean`.
- Produces: `enforceNonBlinkingCursor(terminal: CursorOptionsTarget): void`.

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, expect, it } from "vitest";

import { enforceNonBlinkingCursor } from "./terminalCursor";

describe("enforceNonBlinkingCursor", () => {
  it("disables blinking re-enabled by terminal output", () => {
    const terminal = { options: { cursorBlink: true } };

    enforceNonBlinkingCursor(terminal);

    expect(terminal.options.cursorBlink).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npx vitest run src/features/terminal/terminalCursor.test.ts`

Expected: FAIL because `./terminalCursor` does not exist.

- [ ] **Step 3: Add the minimal policy helper**

```ts
interface CursorOptionsTarget {
  options: { cursorBlink?: boolean };
}

export function enforceNonBlinkingCursor(terminal: CursorOptionsTarget): void {
  if (terminal.options.cursorBlink) terminal.options.cursorBlink = false;
}
```

- [ ] **Step 4: Run the test to verify GREEN**

Run: `npx vitest run src/features/terminal/terminalCursor.test.ts`

Expected: PASS with one test.

- [ ] **Step 5: Commit the policy**

```bash
git add src/features/terminal/terminalCursor.ts src/features/terminal/terminalCursor.test.ts
git commit -m "fix(terminal): enforce non-blinking cursor policy"
```

### Task 2: Apply Policy After Parsed Writes

**Files:**
- Modify: `src/features/terminal/TerminalView.tsx:250-304`
- Modify: `e2e/ime.ui.spec.ts:420-505`

**Interfaces:**
- Consumes: `enforceNonBlinkingCursor(terminal)` from Task 1 and xterm's parsed-write callback.
- Produces: Every Galaxy-managed write restores `cursorBlink` to false before downstream rendered-output bookkeeping.

- [ ] **Step 1: Replace the invalid DOM assertion with a failing live-option assertion**

Expose the already exported `terminals` map to the test through the existing page module-loading pattern, then simulate terminal output enabling DEC private mode 12:

```ts
data: "\u001b[?12h\u001b[12;20H*",
```

After the write settles, assert the active terminal reports:

```ts
expect(cursorBlink).toBe(false);
```

Remove both `.xterm-cursor` count assertions because Canvas/WebGL does not represent its cursor with that DOM class. Keep the rapid split-frame screen-content assertions.

- [ ] **Step 2: Run the focused UI test to verify RED**

Run: `npx playwright test e2e/ime.ui.spec.ts --project=ui --grep "cursor blink"`

Expected: FAIL because DECSET 12 changes the active terminal's `cursorBlink` option to true.

- [ ] **Step 3: Restore policy in every parsed-write callback**

Import `enforceNonBlinkingCursor` into `TerminalView.tsx`. Add a local callback that enforces the policy before calling `recordRenderedOutput`, and use it in both the normal and scroll-locked `term.write` callbacks:

```ts
const finishRenderedOutput = (generation: number, seq: number) => {
  enforceNonBlinkingCursor(term);
  recordRenderedOutput(generation, seq);
};
```

For `truncatedNotice`, supply a parsed-write callback that calls `enforceNonBlinkingCursor(term)`. Replay already delegates to `writeOutput`, so it inherits the same behavior without a second implementation.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `npx vitest run src/features/terminal/terminalCursor.test.ts src/features/terminal/TerminalView.test.tsx`

Expected: PASS.

Run: `npx playwright test e2e/ime.ui.spec.ts --project=ui --grep "cursor blink|rapid split TUI"`

Expected: PASS with the active option false after DECSET 12 and the TUI content still rendered.

- [ ] **Step 5: Run frontend verification**

Run: `npx tsc --noEmit`

Expected: exit code 0.

Run: `npm test`

Expected: all unit and icon tests pass.

Run: `npm run build`

Expected: TypeScript and Vite production build complete successfully.

- [ ] **Step 6: Commit the integration**

```bash
git add src/features/terminal/TerminalView.tsx e2e/ime.ui.spec.ts
git commit -m "fix(terminal): prevent TUI cursor blink reactivation"
```
