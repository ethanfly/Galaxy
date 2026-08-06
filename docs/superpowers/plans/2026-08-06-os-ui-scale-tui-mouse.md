# OS UI Scale and TUI Mouse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make app chrome density rem-based so OS scaling and `uiFontSize` grow the shell together; fix Agent TUI mouse via stacking hit-tests + activation/DPR re-fit; persist window geometry in logical DIPs.

**Architecture:** CSS shell tokens switch from fixed px to rem on `--ui-font-size`. Session surfaces keep visibility stacking; active gets z-index and inactive gets `inert`. Terminal registry gains `refitMetrics` for tab activate + global DPR. Rust window capture/apply use logical size/position.

**Tech Stack:** React, CSS custom properties, xterm FitAddon, Tauri 2 window APIs (`LogicalSize`/`scale_factor`), Vitest, Playwright UI e2e.

## Global Constraints

- Do not double-scale: never set `--ui-scale: devicePixelRatio` into CSS layout multipliers.
- Do not use `display: none` or unmount inactive session terminals.
- Keep synchronous `pty_write` and per-pane write queues.
- Default `uiFontSize = 13` at 100% OS scale must match prior shell metrics within ±1px.
- “新窗口” means new terminal session tab, not `--new-window` multi-process.
- No `transform: scale()` on terminal ancestors.

## File Map

| File | Responsibility |
|------|----------------|
| `src/index.css` | rem shell tokens, active session z-index, control hit-target rem |
| `src/features/terminal/Workspace.tsx` | `inert` on inactive surfaces |
| `src/features/terminal/TerminalView.tsx` | activate re-fit + refresh; register refit on handle |
| `src/shared/stores/terminalStore.ts` | `refitMetrics` on handle; `refitAllTerminals()` |
| `src/shared/dpr.ts` (new) | subscribe to devicePixelRatio changes |
| `src/App.tsx` | wire DPR → refitAllTerminals |
| `src-tauri/src/platform/window_state.rs` | logical capture/apply/clamp |
| `src-tauri/src/core/config.rs` | document WindowState as logical DIPs |
| Tests | density e2e, stacking inert, window_state unit, dpr helper unit |

---

### Task 1: Density tokens (rem chrome)

**Files:**
- Modify: `src/index.css`
- Test: `e2e/smoke.ui.spec.ts` (extend appearance/font tests)

**Produces:** Shell metrics scale with root `font-size`.

- [ ] **Step 1: Convert shell metrics and primary hit targets to rem**

In `:root` replace:

```css
--h-titlebar: 2.7692rem;   /* 36/13 */
--h-tabbar: 2.9231rem;     /* 38/13 */
--h-statusbar: 2rem;       /* 26/13 */
--w-sidebar: 17.8462rem;   /* 232/13 */
--w-panel: 26.1538rem;     /* 340/13 */
```

Convert `.icon-btn` and titlebar tool fixed 28px/38px sizes to rem (`2.1538rem` / `2.9231rem`). Keep heatmap/chart cell exceptions as px if needed (comment).

- [ ] **Step 2: E2E assert titlebar height scales with uiFontSize**

Extend smoke appearance test: after setting ui font 18, expect computed titlebar height > baseline at 13.

- [ ] **Step 3: Commit**

```bash
git add src/index.css e2e/smoke.ui.spec.ts
git commit -m "feat(ui): scale shell chrome with rem density tokens"
```

---

### Task 2: Session stacking hit-test + activate refresh

**Files:**
- Modify: `src/index.css` (`.session-surface.active { z-index: 1 }`)
- Modify: `src/features/terminal/Workspace.tsx` (`inert={!active}`)
- Modify: `src/features/terminal/TerminalView.tsx` (on activate: fit + refresh)
- Test: `e2e/ime.ui.spec.ts` or new assertion in existing multi-session tests

**Produces:** Active session is topmost hit target; activate refreshes cell metrics.

- [ ] **Step 1: CSS active z-index + Workspace inert**

```tsx
<div
  className={`session-surface ${active ? "active" : "inactive"}`}
  aria-hidden={!active}
  // @ts-expect-error React 18 types may lag inert
  inert={active ? undefined : ""}
>
```

Prefer boolean `inert={!active}` if TS supports it; otherwise set via ref/effect.

- [ ] **Step 2: After fit on session show, call `term.refresh(0, term.rows - 1)`**

- [ ] **Step 3: E2E — inactive surface has inert; active does not**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(terminal): pin active session hit-test and refresh metrics"
```

---

### Task 3: Terminal refit registry + DPR listener

**Files:**
- Modify: `src/shared/stores/terminalStore.ts`
- Modify: `src/features/terminal/TerminalView.tsx`
- Create: `src/shared/dpr.ts`
- Create: `src/shared/dpr.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**

```ts
// TerminalHandle extension
refitMetrics(): { cols: number; rows: number } | null;

export function refitAllTerminals(
  onResize?: (paneId: string, cols: number, rows: number) => void,
): void;

// dpr.ts
export function subscribeDevicePixelRatio(onChange: (dpr: number) => void): () => void;
```

- [ ] **Step 1: Unit test subscribeDevicePixelRatio re-subscribes on change (mock matchMedia)**

- [ ] **Step 2: Implement dpr helper + handle.refitMetrics + refitAllTerminals**

- [ ] **Step 3: App.tsx effect: subscribe → refitAll + ptyResize**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(terminal): re-fit all panes when devicePixelRatio changes"
```

---

### Task 4: Logical window state

**Files:**
- Modify: `src-tauri/src/platform/window_state.rs`
- Modify: `src-tauri/src/core/config.rs` (doc comment on WindowState)
- Test: unit tests in `window_state.rs` for pure helpers if extracted

**Produces:** capture/apply use logical DIPs; clamp compares logical rects.

- [ ] **Step 1: Implement logical capture/apply/clamp**

```rust
// capture: outer_size/position → to_logical(scale_factor)
// apply: LogicalSize / LogicalPosition
// clamp: monitor physical → logical via each monitor's scale_factor
```

- [ ] **Step 2: `cargo test` for any pure conversion helpers**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(window): persist and restore geometry in logical DIPs"
```

---

### Task 5: Verification

- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] Relevant e2e UI specs
- [ ] `cargo test --lib` from `src-tauri` (window helpers)

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| rem density tokens | 1 |
| no double DPR CSS | 1 (constraint) |
| active z-index + inert | 2 |
| activate fit + refresh | 2 |
| DPR re-fit all | 3 |
| logical window state | 4 |
| tests | 1–5 |
