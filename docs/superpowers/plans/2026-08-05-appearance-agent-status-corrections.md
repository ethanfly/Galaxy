# Appearance and Agent Status Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both font-size settings visibly effective with reversible live preview, keep xterm cursors solid, and eliminate false/repeated Agent completion notifications by classifying xterm's rendered screen through a stabilized Rust state machine.

**Architecture:** Persisted `AppConfig` remains backend-owned; a UI-only preview in `uiStore` overrides it while Settings is open. React applies effective UI size to a root CSS variable and effective terminal size to each xterm. Agent panes send capped, throttled snapshots of xterm's parsed bottom rows through one typed Tauri command. Rust treats stream text as positive evidence only, classifies rendered screens, serializes observations in the existing PTY aggregator, and emits only stable status transitions.

**Tech Stack:** React 18, TypeScript 5.8, Zustand 5, xterm.js 5.5, Vitest/jsdom, Playwright, Tauri 2, Rust 2021, `parking_lot`.

## Global Constraints

- Follow red-green-refactor for every behavior change: add one focused failing test, run it and confirm the expected failure, implement the minimum, then rerun it.
- Keep backend config as the only persisted truth. Never write preview values to `appStore` or IPC before Save.
- Keep the observation command narrow: `paneId` plus at most 4096 UTF-8 bytes of rendered text. Never persist or log that text.
- Never infer live `Idle` merely because a marker is absent from raw PTY bytes.
- Do not add a Rust VT emulator or another terminal parser.
- Keep Agent status callbacks serialized through the PTY aggregator. Do not dispatch a captured status from the keyboard-input thread.
- Do not change the existing font validation ranges: terminal 8-32, UI 8-24.
- While a number input is empty or outside those ranges, retain the last valid preview pair; never apply `0`, `NaN`, or an out-of-range xterm/UI size.
- Preserve user-owned untracked `.superpowers/` and `AGENTS.md` files; stage only paths named by each task.
- Use the existing typed IPC wrapper convention and register every Rust command in `commands::all_commands!()`.

---

## Task 1: Model Effective Appearance and Preview Lifecycle

**Files:**

- Create: `src/shared/appearance.ts`
- Create: `src/shared/appearance.test.ts`
- Modify: `src/shared/stores/uiStore.ts`
- Modify: `src/shared/stores/uiStore.test.ts`
- Modify: `src/features/settings/SettingsModal.tsx`
- Modify: `src/features/settings/SettingsModal.test.tsx`

- [ ] **Step 1: Add failing resolver and store tests**

Add tests covering defaults, persisted values, preview precedence, and clearing preview:

```ts
import { DEFAULT_APPEARANCE, resolveAppearance } from "./appearance";

it("resolves preview before persisted config before boot defaults", () => {
  expect(resolveAppearance(null, null)).toEqual(DEFAULT_APPEARANCE);
  expect(resolveAppearance({ terminalFontSize: 16, uiFontSize: 15 }, null)).toEqual({
    terminalFontSize: 16,
    uiFontSize: 15,
  });
  expect(resolveAppearance(
    { terminalFontSize: 16, uiFontSize: 15 },
    { terminalFontSize: 22, uiFontSize: 19 },
  )).toEqual({ terminalFontSize: 22, uiFontSize: 19 });
});
```

In `uiStore.test.ts`, assert `setAppearancePreview(...)` stores the complete pair and `closeSettings()` clears it.

- [ ] **Step 2: Run the focused tests and confirm red**

Run:

```powershell
npx vitest run src/shared/appearance.test.ts src/shared/stores/uiStore.test.ts
```

Expected: imports/actions do not exist yet.

- [ ] **Step 3: Implement the effective appearance model**

Create `src/shared/appearance.ts`:

```ts
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
```

Add `appearancePreview: Appearance | null` and `setAppearancePreview(...)` to `UiState`. Initialize it to `null`. Make `closeSettings()` atomically set both `settingsOpen: false` and `appearancePreview: null`.

- [ ] **Step 4: Add failing Settings preview/rollback tests**

Use `fireEvent.change` on the two number inputs and assert:

```ts
expect(useUiStore.getState().appearancePreview).toEqual({
  terminalFontSize: 20,
  uiFontSize: 18,
});
```

Then click Cancel and assert preview is `null` while `useAppStore.getState().config` remains the original config. Add a successful-save test where mocked `setConfig` installs the draft before resolving; assert the modal closes and the preview clears. Add a failed-save test where `setConfig` returns `false`; assert modal and preview remain.

- [ ] **Step 5: Run Settings tests and confirm red**

Run:

```powershell
npx vitest run src/features/settings/SettingsModal.test.tsx
```

Expected: editing the draft does not publish preview and Cancel has no preview state to restore.

- [ ] **Step 6: Wire Settings draft changes to preview**

In `SettingsModal`, add a single draft handoff so both values remain coherent:

```ts
const setAppearancePreview = useUiStore((s) => s.setAppearancePreview);

const changeDraft = (next: AppConfig) => {
  setDraft(next);
  if (
    next.terminalFontSize >= 8 && next.terminalFontSize <= 32 &&
    next.uiFontSize >= 8 && next.uiFontSize <= 24
  ) {
    setAppearancePreview({
      terminalFontSize: next.terminalFontSize,
      uiFontSize: next.uiFontSize,
    });
  }
};
```

Pass `changeDraft` to every settings section. When Settings opens from persisted config, explicitly clear any stale preview before cloning. Route Modal dismissal and Cancel through `closeSettings()`. On successful Save, rely on `appStore.setConfig` updating persisted config before `closeSettings()` clears the preview. On failed Save, do not close or clear. Add effect cleanup so app teardown cannot leave a preview behind. Test that an empty or out-of-range field retains the last valid preview instead of applying an invalid size.

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
npx vitest run src/shared/appearance.test.ts src/shared/stores/uiStore.test.ts src/features/settings/SettingsModal.test.tsx
npx tsc --noEmit
```

Commit only the task files:

```powershell
git add src/shared/appearance.ts src/shared/appearance.test.ts src/shared/stores/uiStore.ts src/shared/stores/uiStore.test.ts src/features/settings/SettingsModal.tsx src/features/settings/SettingsModal.test.tsx
git commit -m "fix: add reversible appearance preview"
```

---

## Task 2: Apply UI Font Size Through a Relative Type Scale

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/index.css`
- Modify: `src/features/panels/AgentPanel.tsx`
- Modify: `src/features/panels/GitPanel.tsx`
- Modify: `src/features/panels/NotificationsPanel.tsx`
- Modify: `src/features/search/BlockSearchModal.tsx`
- Modify: `src/features/settings/SettingsModal.tsx`
- Modify: `src/features/statusbar/StatusBar.tsx`
- Create: `src/appearance-css.test.ts`

- [ ] **Step 1: Add a failing root-variable test**

In `App.test.tsx`, set a ready app config with `uiFontSize: 17`, render `App`, and assert:

```ts
await waitFor(() => {
  expect(document.documentElement.style.getPropertyValue("--ui-font-size")).toBe("17px");
});

act(() => {
  useUiStore.getState().setAppearancePreview({ terminalFontSize: 20, uiFontSize: 19 });
});
expect(document.documentElement.style.getPropertyValue("--ui-font-size")).toBe("19px");
```

Clear preview and assert the variable returns to `17px`.

- [ ] **Step 2: Add a failing CSS audit test**

Create `src/appearance-css.test.ts` to read source files using Node's `readFileSync` and reject fixed text sizes:

```ts
const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");
expect(css.match(/font-size:\s*(?:9|10|11|12|13|14|15|21|24|42)px/g) ?? []).toEqual([]);

for (const relativePath of INLINE_STYLE_FILES) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  expect(source.match(/fontSize:\s*(?:9|10|11|12|13|14|15|21|24|42)\b/g) ?? []).toEqual([]);
}
```

List every TSX file currently reported by `rg -n "fontSize:\\s*[0-9]+" src` so the audit cannot silently ignore an inline fixed text size.

- [ ] **Step 3: Run tests and confirm red**

Run:

```powershell
npx vitest run src/App.test.tsx src/appearance-css.test.ts
```

Expected: root variable is not set, and the audit reports the current fixed declarations.

- [ ] **Step 4: Apply effective UI size at the application root**

Subscribe to persisted and preview sizes in `App` and apply the variable with `useLayoutEffect` so a non-default persisted size is installed before paint:

```ts
const persistedUiFontSize = useAppStore((s) => s.config?.uiFontSize);
const previewUiFontSize = useUiStore((s) => s.appearancePreview?.uiFontSize);
const uiFontSize = previewUiFontSize ?? persistedUiFontSize ?? DEFAULT_APPEARANCE.uiFontSize;

useLayoutEffect(() => {
  document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
}, [uiFontSize]);
```

Do not remove the variable during StrictMode cleanup; the next effective value must remain stable without a 13px flash.

- [ ] **Step 5: Define and consume semantic relative tokens**

At `:root`, replace the static UI token with:

```css
--ui-font-size: 13px;
--fs-micro: 0.6923rem;
--fs-caption: 0.7692rem;
--fs-small: 0.8462rem;
--fs-body-small: 0.9231rem;
--fs-ui: 1rem;
--fs-heading-sm: 1.0769rem;
--fs-heading-md: 1.1538rem;
--fs-metric: 1.6154rem;
--fs-heading-xl: 1.8462rem;
--fs-empty-glyph: 3.2308rem;
```

Set `html { font-size: var(--ui-font-size); }` and `body, #root { font-size: var(--fs-ui); }`. Replace only textual `font-size` values and React `fontSize` values with the corresponding tokens. Preserve all fixed heights, widths, icon sizes, chart cells, and terminal line-height values.

- [ ] **Step 6: Run the CSS scan and focused tests**

Run:

```powershell
rg -n "font-size:\s*[0-9]+px|fontSize:\s*[0-9]+" src
npx vitest run src/App.test.tsx src/appearance-css.test.ts
npx tsc --noEmit
```

Expected: `rg` has no user-facing fixed font sizes; tests pass. Any legitimate non-text glyph discovered during the scan must be documented in the test allowlist by exact selector/path, not hidden with a broad regex exemption.

- [ ] **Step 7: Commit the UI scale**

```powershell
git add src/App.tsx src/App.test.tsx src/index.css src/appearance-css.test.ts src/features/panels/AgentPanel.tsx src/features/panels/GitPanel.tsx src/features/panels/NotificationsPanel.tsx src/features/search/BlockSearchModal.tsx src/features/settings/SettingsModal.tsx src/features/statusbar/StatusBar.tsx
git commit -m "fix: apply interface font scale"
```

---

## Task 3: Apply Live Terminal Size and Disable Cursor Blinking

**Files:**

- Modify: `src/features/terminal/TerminalView.tsx`
- Modify: `src/features/terminal/TerminalView.test.tsx`

- [ ] **Step 1: Add failing terminal-option tests**

Extract a testable options factory and first write:

```ts
it("constructs a solid cursor at the effective terminal size", () => {
  const options = terminalOptions(21);
  expect(options.fontSize).toBe(21);
  expect(options.cursorBlink).toBe(false);
});
```

Add a pure `effectiveTerminalFontSize(config, preview)` test or reuse `resolveAppearance` to prove preview wins over persisted size.

- [ ] **Step 2: Run the focused test and confirm red**

```powershell
npx vitest run src/features/terminal/TerminalView.test.tsx
```

Expected: options factory does not exist and production still hardcodes `cursorBlink: true`.

- [ ] **Step 3: Use effective appearance when constructing xterm**

Build the initial options from both stores:

```ts
const appearance = resolveAppearance(
  useAppStore.getState().config,
  useUiStore.getState().appearancePreview,
);
const term = new Terminal(terminalOptions(appearance.terminalFontSize));
```

The factory must include `cursorBlink: false` and preserve all current font family, line height, theme, scrollback, and Windows-mode options.

- [ ] **Step 4: Subscribe to both appearance sources**

Replace the config-only subscription with one `applyTerminalAppearance` callback subscribed to `appStore` and `uiStore`:

```ts
const applyTerminalAppearance = () => {
  const size = resolveAppearance(
    useAppStore.getState().config,
    useUiStore.getState().appearancePreview,
  ).terminalFontSize;
  if (term.options.fontSize === size) return;
  term.options.fontSize = size;
  try {
    fit.fit();
    void ptyResize(pane.id, term.cols, term.rows);
  } catch {
    // The host may be between layout and teardown.
  }
};
```

Dispose both subscriptions in the existing terminal cleanup. This makes edit, Cancel, and successful Save use the same path.

- [ ] **Step 5: Run focused tests and commit**

```powershell
npx vitest run src/features/terminal/TerminalView.test.tsx
npx tsc --noEmit
git add src/features/terminal/TerminalView.tsx src/features/terminal/TerminalView.test.tsx
git commit -m "fix: preview terminal font with solid cursor"
```

---

## Task 4: Build and Test the Frontend Rendered-Screen Observer

**Files:**

- Create: `src/features/terminal/agentScreenObserver.ts`
- Create: `src/features/terminal/agentScreenObserver.test.ts`
- Modify: `src/features/terminal/TerminalView.tsx`
- Modify: `src/shared/ipc/client.ts`
- Modify: `src/shared/__mocks__/@tauri-apps/api/core.ts` if the shared invoke mock has an explicit command map

- [ ] **Step 1: Add failing snapshot extraction tests**

Use a small fake xterm buffer. Assert extraction reads only the last 12 rows of the active bottom viewport, trims insignificant right whitespace, preserves line boundaries, and never exceeds 4096 encoded bytes. Include multibyte Chinese content at the limit.

The production interface is:

```ts
export interface RenderedScreenSource {
  rows: number;
  buffer: {
    active: {
      baseY: number;
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
}

export function readAgentScreen(
  terminal: RenderedScreenSource,
  rowCount = 12,
  maxBytes = 4096,
): string;
```

- [ ] **Step 2: Add failing scheduler tests with fake timers**

Define `createAgentScreenObserver(read, send, options?)` returning `{ schedule, dispose }`. Tests must prove:

- the first parsed write can observe immediately;
- rapid schedules emit no more often than 250ms;
- the last change emits one settled sample 600ms later;
- duplicate snapshots are not resent;
- `dispose()` cancels pending timers;
- a rejected `send` promise is swallowed and does not stop later observations.

- [ ] **Step 3: Run observer tests and confirm red**

```powershell
npx vitest run src/features/terminal/agentScreenObserver.test.ts
```

Expected: observer module does not exist.

- [ ] **Step 4: Implement capped extraction and scheduling**

Use `TextEncoder` to measure bytes and `TextDecoder` after advancing past UTF-8 continuation bytes when truncating from the front. Preserve the newest rows. The scheduler owns one throttle timer, one trailing timer, `lastSent`, and a disposed flag; it never logs screen text or a rejected error.

- [ ] **Step 5: Add the typed IPC wrapper**

In `client.ts`:

```ts
export const ptyObserveScreen = (paneId: string, screen: string) =>
  call<void>("pty_observe_screen", { paneId, screen });
```

- [ ] **Step 6: Attach observation after xterm parsing**

In `TerminalView`, register `term.onWriteParsed(...)` after the terminal handle is created. Each scheduled read must dynamically check current pane metadata so restored and newly detected Agents both work:

```ts
const isAgentPane = () => {
  if (useTerminalStore.getState().agentStatus[pane.id]) return true;
  const current = useAppStore.getState().sessions.find((item) => item.id === session.id);
  return !!current && !!layoutPanes(current.layout).find((item) => item.id === pane.id)?.agentKind;
};
```

Only call `observer.schedule()` when `isAgentPane()` is true. Also subscribe to Agent state and schedule once when the pane first becomes recognized, so an already-rendered idle composer can be classified even if no later PTY write arrives. Dispose the xterm subscription, Zustand subscription, and observer during terminal cleanup.

- [ ] **Step 7: Run tests and commit**

```powershell
npx vitest run src/features/terminal/agentScreenObserver.test.ts src/features/terminal/TerminalView.test.tsx
npx tsc --noEmit
git add src/features/terminal/agentScreenObserver.ts src/features/terminal/agentScreenObserver.test.ts src/features/terminal/TerminalView.tsx src/shared/ipc/client.ts src/shared/__mocks__/@tauri-apps/api/core.ts
git commit -m "feat: observe rendered agent terminal screens"
```

If the shared mock file required no change, omit it from `git add`.

---

## Task 5: Implement the Rust Agent Classifier and Stable State Machine

**Files:**

- Create: `src-tauri/src/pty/agent_status.rs`
- Modify: `src-tauri/src/pty/mod.rs`
- Modify: `src-tauri/src/pty/tracker.rs`
- Modify: `src-tauri/src/services/agents/claude.rs`

- [ ] **Step 1: Add failing classifier tests**

Create the module with tests first, using this public surface:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentObservation {
    Working,
    Blocked,
    Idle,
    Unknown,
}

pub fn infer_stream_observation(kind: AgentKind, text: &str) -> AgentObservation;
pub fn infer_screen_observation(kind: AgentKind, screen: &str) -> AgentObservation;
```

Cover these exact regressions:

```rust
assert_eq!(
    infer_stream_observation(AgentKind::Codex, "ordinary output without a footer"),
    AgentObservation::Unknown,
);
assert_eq!(
    infer_screen_observation(
        AgentKind::Codex,
        ">> Run /review\n* Working (1m 25s * esc to interrupt)",
    ),
    AgentObservation::Working,
);
assert_eq!(
    infer_screen_observation(
        AgentKind::Codex,
        "let label = \"Working (1m * esc to interrupt)\";",
    ),
    AgentObservation::Unknown,
);
assert_eq!(
    infer_screen_observation(AgentKind::Codex, ">> Run /review on my changes"),
    AgentObservation::Idle,
);
```

Use the real Codex prompt/status glyphs in additional test cases if the source file is already UTF-8; keep ASCII equivalents so Windows code-page display cannot make the regression unreadable.

- [ ] **Step 2: Add failing state-machine tests**

Define:

```rust
pub struct AgentStateMachine {
    stable: AgentStatus,
    idle_candidate_since: Option<Instant>,
    working_epoch: u64,
    completed_epoch: Option<u64>,
}

pub struct AgentTransition {
    pub previous: AgentStatus,
    pub current: AgentStatus,
    pub completed_epoch: Option<u64>,
}
```

Tests must prove:

- initial `Unknown` emits nothing and remains `Idle`;
- `Working` applies immediately and starts epoch 1;
- one `Idle` sample emits nothing;
- a second `Idle` before 500ms emits nothing;
- a second `Idle` at/after 500ms emits exactly `Working -> Idle`, completion epoch 1;
- repeated Idle emits nothing;
- `Idle -> Working` starts epoch 2 and may later complete epoch 2 once;
- `Working -> Blocked -> Working` stays in the same epoch;
- `Unknown` never changes the stable state;
- `finish()` emits `Working -> Done` once and repeated finish emits nothing.

Use explicit `Instant + Duration` values; do not sleep in tests.

- [ ] **Step 3: Run Rust tests and confirm red**

From `src-tauri/`:

```powershell
cargo test --lib pty::agent_status
```

Expected: module/types are absent.

- [ ] **Step 4: Implement conservative classification**

For Codex, a Working line must be an anchored footer after removing only known leading status glyphs/whitespace, begin with `working (`, contain `esc to interrupt`, and end with `)`. Working has priority over Blocked and Idle because the composer remains visible during a turn. Codex Idle requires a known composer prefix (`>>`, Unicode single/double angle, or heavy prompt) at line start; do not treat an ASCII shell `>` as an Agent composer.

For other adapters, translate existing markers into explicit positive observations. Stream classification may return only `Working`, `Blocked`, or `Unknown`; it must never return `Idle`.

- [ ] **Step 5: Implement stable transitions and epoch dedupe**

Use `IDLE_CONFIRMATION = Duration::from_millis(500)`. Working/Blocked clear a pending idle candidate and apply immediately. Unknown keeps the stable state. Idle records a first candidate and requires a second sample at/after the interval. Increment `working_epoch` only for Idle/Done to Working, not Blocked to Working. Set `completed_epoch` only once when leaving Working for Idle/Done.

- [ ] **Step 6: Clarify the historical tracker API**

Rename the old tail helper to `infer_historical_agent_status` and update `services/agents/claude.rs`. It may continue returning Idle for a historical conversation because it is not used for live transition inference. Remove all live-manager imports of the old function in Task 6.

- [ ] **Step 7: Run tests and commit**

```powershell
cargo fmt --check
cargo test --lib pty::agent_status
cargo test --lib pty::tracker
git add src-tauri/src/pty/agent_status.rs src-tauri/src/pty/mod.rs src-tauri/src/pty/tracker.rs src-tauri/src/services/agents/claude.rs
git commit -m "fix: stabilize rendered agent status inference"
```

---

## Task 6: Serialize Observations Through PTY Manager and Harden Notifications

**Files:**

- Modify: `src-tauri/src/pty/manager.rs`
- Modify: `src-tauri/src/commands/pty_cmds.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/tests/pty_integration.rs`

- [ ] **Step 1: Add failing manager integration tests**

Extend `CollectSink` to record Agent status and detection callbacks. With the existing fake backend/process harness, cover:

- `observe_screen` rejects an unknown pane;
- a non-Agent pane ignores a valid snapshot;
- an Agent pane accepts a <=4096-byte snapshot and rejects an oversized snapshot;
- Working screen followed by one Idle screen emits no Idle;
- a later settled Idle observation emits exactly one Idle;
- repeated settled observations emit no duplicate Idle;
- a new Working epoch can emit one later Idle;
- detection never emits a captured stale Idle after a newer Working status;
- process exit emits Done through the manager state machine once.

Give `PtyEventSink::agent_detected` a default no-op implementation so unrelated test sinks do not need mechanical edits.

- [ ] **Step 2: Run integration tests and confirm red**

From `src-tauri/`:

```powershell
cargo test --test pty_integration agent_status -- --nocapture
```

Expected: observation API and detection callback do not exist, and current live tail logic can emit Idle without positive screen evidence.

- [ ] **Step 3: Extend the narrow sink/message surfaces**

Add:

```rust
fn agent_detected(&self, _pane_id: &str, _session_id: &str, _kind: AgentKind) {}
```

Replace `PaneCtx.last_status`/`last_status_at` with `AgentStateMachine` plus a stream-throttle timestamp. Add PTY messages:

```rust
AgentDetected { pane_id: String, generation: u64, kind: AgentKind },
ScreenObserved { pane_id: String, generation: u64, screen: String, observed_at: Instant },
```

When keyboard input detects an Agent, update `ctx.agent_kind` under the pane lock, then enqueue `AgentDetected`; never construct `PaneSideEffect::Agent` with a captured status.

- [ ] **Step 4: Add the manager observation API**

```rust
pub fn observe_screen(&self, pane_id: &str, screen: String) -> Result<(), AppError> {
    if screen.len() > MAX_SCREEN_OBSERVATION_BYTES {
        return Err(AppError::InvalidInput("Agent screen observation exceeds 4096 bytes".into()));
    }
    let (generation, is_agent) = self.panes.lock().get(pane_id)
        .map(|ctx| (ctx.generation, ctx.agent_kind.is_some()))
        .ok_or_else(|| AppError::NotFound(format!("pane {pane_id}")))?;
    if !is_agent {
        return Ok(());
    }
    self.tx.send(PtyMsg::ScreenObserved {
        pane_id: pane_id.to_string(),
        generation,
        screen,
        observed_at: Instant::now(),
    }).map_err(|_| AppError::Pty("PTY aggregator is unavailable".into()))
}
```

Keep observation text out of all tracing fields.

- [ ] **Step 5: Process all status changes on the aggregator thread**

Within each `process_window`:

1. Dispatch matching AgentDetected messages without a status value.
2. Process grouped PTY output and feed only `infer_stream_observation` into each pane's state machine.
3. Process matching screen observations in receive order and feed `infer_screen_observation` into the same state machine.
4. Convert only returned transitions into `PaneSideEffect::Agent`.
5. Process lifecycle/exit after observations.

Move Done into `finalize_pane_exit`: call `state_machine.finish()`, dispatch its Agent status transition, then emit PTY exit. Remove the re-entrant `PtyManager::mark_exit` call from `state::Sink::exit` and remove `mark_exit` if no caller remains.

- [ ] **Step 6: Register the typed Tauri command**

In `pty_cmds.rs`:

```rust
#[tauri::command]
pub async fn pty_observe_screen(
    state: State<'_, Arc<AppState>>,
    pane_id: String,
    screen: String,
) -> CmdResult<()> {
    state.pty().observe_screen(&pane_id, screen).cmd()
}
```

Register it beside the other PTY commands in `commands::all_commands!()`.

- [ ] **Step 7: Make state updates atomic and notification mapping testable**

Implement `Sink::agent_detected` to persist `pane.agent_kind`, then emit the current map status without producing a notification. Extract `update_pane_agent_kind` so detection/status paths do not duplicate store traversal.

In `agent_status`, read previous and write current within one write lock. Do not return before the pane-kind persistence path: a new kind can arrive with the same status.

```rust
let (prev, status_changed) = {
    let mut statuses = self.state.agent_status.write();
    let prev = statuses.get(pane_id).copied().unwrap_or(AgentStatus::Idle);
    statuses.insert(pane_id.to_string(), status);
    (prev, prev != status)
};
```

Extract a pure notification discriminator and unit-test only `Working -> Idle`, `Working -> Done`, and entry into Blocked. Repeated identical states and Idle/Done detection events must return no notification.

- [ ] **Step 8: Run Rust verification and commit**

```powershell
cargo fmt --check
cargo test --lib
cargo test --test pty_integration --test services_integration
git add src-tauri/src/pty/manager.rs src-tauri/src/commands/pty_cmds.rs src-tauri/src/commands/mod.rs src-tauri/src/state.rs src-tauri/tests/pty_integration.rs
git commit -m "fix: prevent false agent completion notifications"
```

---

## Task 7: Add UI Regression Coverage and Verify End to End

**Files:**

- Modify: `e2e/smoke.ui.spec.ts`
- Modify: `e2e/ime.ui.spec.ts`
- Create: `e2e/agent-status.ui.spec.ts` only if the existing terminal mock would become less clear by adding Agent fixtures

- [ ] **Step 1: Add a failing appearance preview E2E test**

Make the mock `config_update` store the supplied config rather than always returning the original object. Open Settings and capture baseline computed sizes for a UI label and `.xterm-helper-textarea`/`.xterm-rows` text. Change UI 13 -> 18 and terminal 14 -> 24 before Save. Assert both computed sizes increase and at least one `pty_resize` call is recorded. Click Cancel and assert both return to baseline.

Also reload with mocked persisted values and assert the non-default values apply on startup.

- [ ] **Step 2: Add a failing Agent observation UI test**

Use an Agent pane fixture (`agentKind: "codex"`) and record all `pty_observe_screen` invocations. Emit a `pty://output` payload that renders a Codex composer plus Working footer. Assert the latest observation contains the anchored Working footer, is <=4096 UTF-8 bytes, and observation frequency respects the throttle under rapid output. This test validates frontend rendering/observation; Rust unit/integration tests validate notification decisions.

- [ ] **Step 3: Run UI specs and confirm red**

```powershell
npx playwright test --project=ui e2e/smoke.ui.spec.ts e2e/ime.ui.spec.ts e2e/agent-status.ui.spec.ts
```

If the separate Agent spec was not created, omit it from the command.

- [ ] **Step 4: Complete the smallest mock/test-support changes**

Expose recorded invokes through a test-only `window` property inside the Playwright init script. Do not add production selectors unless an existing semantic locator cannot identify the control; if needed, add a narrowly named `data-testid` to the two font inputs.

- [ ] **Step 5: Run the full verification matrix**

From repository root:

```powershell
npx tsc --noEmit
npm test
npm run build
npx playwright test --project=ui
```

From `src-tauri/`:

```powershell
cargo fmt --check
cargo test --lib
cargo test --test pty_integration --test services_integration
```

- [ ] **Step 6: Inspect desktop and narrow screenshots**

Run the appearance spec at 1440x900 and 560x720 with screenshots after preview and after Cancel. Inspect them for clipped labels/buttons, overlapping text, modal overflow, and terminal/workspace layout shifts. Use the existing `test-results/` location; do not commit generated screenshots unless the repository already tracks the exact snapshot.

- [ ] **Step 7: Run a live manual smoke check**

Start/reuse Vite on `http://localhost:1420`. In the Tauri app, verify:

- UI and terminal sizes change before Save;
- Cancel restores both;
- Save persists both across restart;
- the cursor stays solid for at least five seconds;
- a real Codex turn remains Working throughout tool output;
- exactly one completion notification appears only after the ready composer settles;
- a second turn produces exactly one new notification.

If a real Codex session is unavailable in the verification environment, record that limitation explicitly and rely on the deterministic classifier/manager regression tests rather than claiming a live result.

- [ ] **Step 8: Commit regression coverage**

```powershell
git add e2e/smoke.ui.spec.ts e2e/ime.ui.spec.ts e2e/agent-status.ui.spec.ts
git commit -m "test: cover appearance and agent status regressions"
```

Omit any non-created path from `git add`.

---

## Completion Review

- [ ] Confirm every acceptance criterion in `docs/superpowers/specs/2026-08-05-appearance-agent-status-corrections-design.md` maps to at least one passing automated test or the explicitly reported live-check limitation.
- [ ] Run `git status --short` and verify only intentional files remain changed; preserve `.superpowers/` and `AGENTS.md`.
- [ ] Review `git diff --check` and ensure no placeholder comments, broad error swallowing outside best-effort observation, terminal-content logging, or unrelated refactors were introduced.
- [ ] Confirm the final response includes the verification commands/results and the dev URL.
