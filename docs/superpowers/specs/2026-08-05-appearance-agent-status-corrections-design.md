# Appearance and Agent Status Corrections Design

**Status:** Approved in conversation, pending written-spec review
**Date:** 2026-08-05
**Scope:** UI and terminal font sizing, terminal cursor behavior, and live Agent completion notifications

## 1. Problem Statement

Galaxy Terminal currently persists both font-size settings, but only the terminal setting has a runtime consumer. The UI root keeps a static `13px` token and many descendants use fixed pixel sizes, so `uiFontSize` has no visible effect. Terminal font changes are applied only after saving, which makes the setting appear inert while the dialog remains open.

The xterm cursor is configured to blink unconditionally. The desired behavior is a solid, non-blinking cursor.

Live Agent status is inferred from stripped PTY byte history. Codex uses cursor movement and differential screen rendering, so the recent byte tail is not the same as the screen currently visible in xterm. When a working marker falls outside the text window, the backend returns `Idle` without positive completion evidence. `Working -> Idle` is then treated as completion, causing false and repeated Windows notifications while Codex is still working.

## 2. Goals

- Apply persisted `uiFontSize` on startup and after a successful settings save.
- Preview UI and terminal font-size edits immediately while the settings dialog is open.
- Restore persisted sizes when the user cancels or dismisses the settings dialog.
- Keep terminal cursors solid and non-blinking.
- Infer interactive Agent state from xterm's rendered screen rather than pretending raw PTY bytes are a terminal screen.
- Preserve accurate per-turn completion and blocked notifications.
- Emit at most one completion notification for each observed working epoch.
- Keep terminal rendering and input operational if status observation fails.

## 3. Non-Goals

- Adding a user-configurable cursor-blink setting.
- Implementing another ANSI/VT terminal emulator in Rust.
- Changing Agent history adapters or writing to Agent-owned files.
- Persisting rendered terminal snapshots or including terminal content in logs.
- Changing font-size validation ranges (`terminalFontSize` remains 8-32 and `uiFontSize` remains 8-24).
- Redesigning layout dimensions, icons, charts, or terminal line height.

## 4. Considered Approaches

### 4.1 Minimal notification suppression

Apply the UI font, disable cursor blinking, and stop notifying on `Working -> Idle`. This has the smallest implementation surface, but interactive Agent processes would no longer produce per-turn completion notifications until the PTY exits.

### 4.2 Rendered-screen observation with a backend state machine

Use xterm's parsed buffer as the screen observation source. Send a small, throttled snapshot through a typed Tauri command, then let Rust classify and stabilize state transitions. This retains per-turn notifications without duplicating terminal emulation. This is the selected approach.

### 4.3 A second terminal emulator in Rust

Feed PTY output through a Rust VT parser and inspect its screen model. This keeps inference entirely in the backend, but duplicates xterm's responsibility, adds a stateful dependency for every pane, and conflicts with the project's explicit non-goal of implementing terminal emulation.

## 5. Appearance Architecture

### 5.1 Effective appearance state

Persisted `AppConfig` remains backend-owned business truth. Unsaved appearance preview is UI-only state and therefore belongs in `uiStore` as an optional pair of `terminalFontSize` and `uiFontSize` values.

The effective appearance is:

1. the active settings preview, when present;
2. otherwise the persisted config from `appStore`;
3. otherwise the existing defaults (`14px` terminal, `13px` UI) during boot.

No unsaved preview value is written to `appStore` or sent to Rust.

### 5.2 Preview lifecycle

- Opening settings clones persisted config into the existing draft and starts with no preview override.
- Editing either font field publishes both draft font values as one preview object so the UI and all terminals update together.
- Cancel, backdrop dismissal, Escape, or component teardown clears the preview and restores persisted values.
- A successful save first updates backend config and the Zustand cache, then clears the preview and closes the dialog. The effective values therefore do not flash back to the old settings.
- A failed save keeps the dialog and preview open so the user can correct the error. Cancelling afterward still restores persisted values.

### 5.3 UI font scale

The document root receives a dynamic `--ui-font-size` value from effective appearance state. Root text uses that value as `1rem`.

Fixed textual sizes in CSS and React inline styles are migrated to semantic relative tokens based on the current root size. The scale preserves the existing 13px visual result at the default setting. Layout dimensions, icon geometry, heatmap cells, and other non-text measurements remain fixed so changing font size does not distort the workspace.

This migration covers all user-facing interface text, including title bar, navigation, tabs, panels, modals, settings, status bar, and insights. Deliberately display-sized text may use a larger relative token, but it must still derive from the UI font setting.

### 5.4 Terminal font and cursor

Each `TerminalView` observes effective terminal font size. A change updates xterm's `fontSize`, runs `FitAddon.fit()`, and sends the resulting PTY dimensions through the existing typed resize command.

xterm is constructed with `cursorBlink: false`. Cursor behavior is not tied to Agent state and does not require persistence or a new config field.

## 6. Agent Status Architecture

### 6.1 Rendered screen observation

After xterm parses writes for an Agent pane, `TerminalView` schedules a throttled observation and a trailing settled observation. It reads only the final rendered rows around the active screen footer from `term.buffer.active`, normalizes insignificant whitespace, and caps the snapshot at 4 KiB.

The frontend sends the snapshot using a dedicated typed IPC wrapper and Tauri command. The command accepts only `paneId` and rendered text, validates the pane through `PtyManager`, and exposes no generic process or filesystem capability.

Observations are limited to Agent panes, no more frequent than every 250ms while output changes, with one trailing observation after 600ms. Snapshot text is used in memory only and must never be persisted or logged.

### 6.2 Classification

Stream-tail inference is retained only for positive activity evidence such as a precise working or blocked marker. Absence of a marker in raw PTY bytes becomes `Unknown`, not `Idle`, and cannot finish a task.

Rendered-screen classification produces one of four observations:

- `Working`: an Agent-specific, anchored working status line is present.
- `Blocked`: an Agent-specific authorization or input prompt is present and no working status has priority.
- `Idle`: the Agent-specific ready composer is present and no working or blocked status is present.
- `Unknown`: there is insufficient positive evidence; preserve the prior stable state.

Codex matching uses the status footer shape, including `Working (...)` and `esc to interrupt`, rather than a loose substring search. Text in command output or source files that merely contains `working` must not change state. Working and blocked markers take precedence over a simultaneously visible composer, because Codex keeps its composer visible while a turn is running.

### 6.3 Stable transitions

Each pane keeps its stable status plus a pending idle candidate. `Working` and `Blocked` observations apply immediately. `Unknown` preserves the stable status. `Idle` must be observed again after at least 500ms before a `Working -> Idle` transition is emitted; the frontend trailing observation guarantees a settled sample even when output stops.

An `Idle` or newly detected Agent pane entering `Working` starts a monotonically increasing working epoch. Repeated `Working` observations do not increment it, and `Blocked -> Working` resumes the same epoch after user input. A completion notification is allowed only once for that epoch, after a confirmed `Working -> Idle` or `Working -> Done` transition. A later confirmed `Idle -> Working` transition starts the next epoch and may produce one new completion notification.

PTY exit remains the only source of `Done`. Agent-kind detection and status updates must be ordered through the pane state rather than emitting a captured stale status after releasing its lock. The application status map must read the previous value and write the new value in one write-lock critical section.

### 6.4 Failure behavior

- IPC observation failure is best-effort: terminal output, input, and resizing continue normally.
- Invalid or oversized observations are rejected without changing Agent state.
- Missing observations preserve the last stable status and do not generate completion notifications.
- Closing a pane clears its pending candidate and notification epoch state with the existing pane lifecycle.

## 7. Data Flow

```text
Settings draft -> uiStore preview -> effective appearance
                                   -> document root UI font
                                   -> xterm font + fit + PTY resize

PTY output -> xterm parser -> rendered footer snapshot
                            -> pty_observe_screen IPC
                            -> Rust classifier
                            -> per-pane stable state machine
                            -> agent://status
                            -> at-most-once system notification
```

## 8. Testing Strategy

All production changes follow red-green-refactor with a failing regression test first.

### Frontend unit tests

- Effective appearance selects preview, persisted config, and boot defaults in that order.
- Editing font fields activates preview immediately.
- Cancel and unmount clear preview; successful save hands off to persisted config without a visual rollback.
- Root CSS variable follows effective `uiFontSize`.
- Terminal construction disables cursor blinking.
- Effective terminal size changes update xterm and trigger fit/resize.
- Screen observations are capped, throttled, and restricted to Agent panes.

### Rust unit tests

- Missing raw-tail markers produce `Unknown`, not `Idle`.
- A Codex rendered footer containing `Working (...)` remains working even when a composer is visible.
- Source/output text containing the word `working` does not count as a Codex status footer.
- Idle requires two observations separated by the confirmation interval.
- Unknown observations cannot transition `Working` to `Idle`.
- One working epoch emits at most one completion notification.
- A new working epoch may emit one new completion notification.
- Agent detection cannot deliver a stale `Idle` after a newer `Working` transition.

### UI integration tests

- Changing UI size changes computed interface font sizes.
- Changing terminal size changes xterm's measured font and PTY dimensions before save.
- Cancelling restores both sizes.
- A Codex differential-render fixture keeps `Working` and emits no completion notification until a settled idle screen is observed.

### Verification commands

- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- `npx playwright test --project=ui`
- `cargo fmt --check` from `src-tauri/`
- `cargo test --lib` from `src-tauri/`
- `cargo test --test pty_integration --test services_integration` from `src-tauri/`

## 9. Acceptance Criteria

- Persisted UI and terminal font sizes are visibly applied after restart.
- Both font sizes preview immediately while settings is open.
- Cancelling settings restores the persisted appearance.
- Default size 13 reproduces the current UI hierarchy while non-default values scale all interface text consistently.
- Terminal cursors never blink.
- The screenshot scenario can remain visibly `Working` for arbitrary output without emitting a completion notification.
- A settled Codex idle screen emits exactly one completion notification for the preceding working epoch.
- Blocked and PTY-exit notifications continue to work.
- No terminal content is persisted or logged by the new observation path.
- TypeScript, frontend unit, UI E2E, Rust unit, and Windows integration test suites pass.
