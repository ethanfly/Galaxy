# TUI Atomic Frames (DEC 2026) and Recreated-Terminal Rehydration

**Status:** Implemented  
**Date:** 2026-08-07  
**Scope:** Agent TUI cursor artifacts (乱跳/闪烁) and TUI mouse loss after split/move/idle

## 1. Problem

Two recurring field reports:

1. **Codex cursor chaos.** The cursor jumps and appears to blink at several
   places at once — behind `Working…`, at the project path, and in the input
   box — despite the earlier non-blinking policy (`enforceNonBlinkingCursor`).
2. **Grok mouse death.** After long idle, tab switching, splitting, or moving
   panes, the Grok TUI stops responding to clicks and scroll. Exiting and
   re-entering the agent "fixes" it.

Five prior releases patched symptoms (blink policy, mouse rebind, raw DEFAULT
mouse bytes, resize/unpause cycles) without eliminating either problem.

## 2. Investigation

Instead of another speculative patch, the real agent binaries were captured
through a ConPTY harness matching Galaxy's reader (`codex-cli 0.146.1`,
`grok 1.0.0`, 120×32, same 64KB reads). Captures live in `e2e/fixtures/`.

### 2.1 Cursor findings (codex-capture.bin)

- Every Codex redraw is wrapped in **DEC 2026 synchronized output**
  (`CSI ? 2026 h` … `CSI ? 2026 l`); Grok does the same.
- Inside each synchronized block the cursor sweeps the screen
  (`CUP 8;2 → 9;44 → 16;2 → 18;27 → 19;2 → 20;36 → 22;32`, with DECTCEM
  hide/show pairs) — exactly the working line / project path / input box
  positions from the report.
- xterm.js 5.5 **does not implement DEC 2026** (verified in source), and
  ConPTY delivers each frame split across chunks (1–20 ms apart, crossing
  Galaxy's 8 ms batch windows). Each chunk parsed and rendered independently,
  so mid-frame states were painted: the cursor visibly swept the three UI
  regions and hide/show pairs flickered — perceived as 乱跳/闪烁.
- Codex also sends `CSI 0 q` (DECSCUSR, param 0 → blink block) each frame;
  the existing write-callback policy suppresses that part, but it cannot stop
  torn frames.

### 2.2 Mouse findings (grok-capture.bin + code audit)

- Grok enables `CSI ?1003;1006 h` (any-motion, SGR) **once at startup**.
- Splitting a pane or moving it to another session changes the layout tree
  shape, which remounts `TerminalView` → a **fresh xterm instance**. The store
  only replayed history on sequence gaps, never on remount, so the new
  instance never received the agent's early DEC mouse modes (or alt screen).
  `mouseTrackingMode` stayed `none` → xterm generated no reports → clicks and
  scroll were dead until the agent was restarted. This matches
  "exit/re-enter fixes it" exactly.
- Mocked long-idle + tab-round-trip replays keep producing reports, so pure
  idle/tab-switch loss is not reproducible outside WebView2; remaining
  real-environment triggers need field evidence (see §4.3).

## 3. Fix

### 3.1 Synchronized-output gate (`syncOutput.ts`)

Per-pane gate wrapping the xterm write path:

- Streams are scanned for the BSU/ESU markers, nesting-aware.
- All bytes inside a block are buffered and flushed as a **single
  `term.write`** on ESU → one parse, one rAF render, no torn frames.
- Markers may be split across chunks (carry of the longest partial-marker
  suffix); marker bytes are retained so flushed frames stay byte-identical
  (xterm ignores 2026).
- Safety valves: 1 MB buffered cap and 250 ms hold timeout force-flush if an
  end marker never arrives; `flushAll()`/`dispose()` on teardown and before
  injected notices.

### 3.2 Ring rehydration on terminal re-creation (`terminalStore.ts`)

`registerTerminal` now detects a remounted pane that already has committed
history and replays the ring (`pty_replay` from seq 0) into the fresh
instance before live delivery resumes. Live chunks defer behind a
`hydrating` flag so ordering holds; truncated rings still show the notice.
This restores alt screen, DEC mouse modes, bracketed paste, etc. after
split/move.

### 3.3 Mouse recovery hardening

- Wheel events now deep-recover immediately when `isTerminalMouseBroken`,
  not only after the 20 s idle window (a broken-but-active pane kept bumping
  the activity timestamp and never healed).
- New field diagnostic `window.__galaxyTermDiag([paneId])` snapshots the full
  mouse pipeline (tracking mode, protocol/encoding, char size, cell metrics,
  render pause, focus) so the next real recurrence yields evidence instead of
  guesses.

## 4. Testing

- `syncOutput.test.ts` — 12 unit tests: pass-through, coalescing, split
  markers, nesting, unbalanced END, timeout/cap force-flush, dispose.
- `terminalStore.test.ts` — rehydration on remount and live-output deferral.
- `e2e/replay-capture.ui.spec.ts` — replays the **real codex capture** (asserts
  blink policy holds against the real stream) and a deterministic split-frame
  test proven to fail with the gate bypassed; grok capture mouse round-trip.
- Full gates: `tsc --noEmit`, unit suite, `playwright --project=ui` (33 specs).

### 4.1 Known limitation

If the ring has evicted the very early setup of a long session (>1 MB output),
rehydration cannot restore the original mouse modes. A backend terminal-state
snapshot (current DEC modes per pane, re-applied on remount) is the follow-up
if that case surfaces.

### 4.2 Verification note

The atomicity e2e fails without the gate (intermediate cursor row painted)
and passes with it — verified by temporarily bypassing the gate.

### 4.3 If mouse loss recurs

Run `__galaxyTermDiag("<paneId>")` in DevTools while the pane is dead and
share the snapshot; it identifies which pipeline stage failed.
