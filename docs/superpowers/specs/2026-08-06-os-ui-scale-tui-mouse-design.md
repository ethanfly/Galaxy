# OS UI Scale and TUI Mouse Design

**Status:** Approved for implementation  
**Date:** 2026-08-06  
**Scope:** System display scaling for app chrome density, window geometry in logical units, and Agent TUI mouse hit-testing after multi-session stacking

## 1. Problem Statement

Galaxy Terminal must look correct under Windows display scaling (100% / 125% / 150% / 200%). The product design already requires visual regression at those scales, but layout chrome still uses fixed CSS pixel tokens for title bar, tab bar, status bar, sidebar, and panel widths. Appearance work (2026-08-05) deliberately kept layout fixed while only text followed `uiFontSize`. Users want the **entire interface density**—chrome, hit targets, and type—to grow with the operating system scale, with default `uiFontSize = 13` still matching today’s 100% look.

Separately, Agent TUI mouse interaction is broken in a way that leaves keyboard control intact: left-clicks do not drive menus/buttons. Prior fixes covered PTY input ordering (`pty_write` synchronous + per-pane write queue) and inactive-session metrics (`visibility: hidden` stacking instead of `display: none`). The failure still reproduces after creating another terminal session, and currently affects new sessions as well. That pattern points to **stale or incorrect cell metrics**, **ambiguous hit-testing across stacked session surfaces**, and/or **missing re-fit after DPR / session changes**—not a total input-path outage.

Window geometry is captured and restored with **physical** sizes (`PhysicalSize` / `outer_size`). Restoring the same physical pixels after a scale change shrinks or enlarges the logical window, which further desynchronizes FitAddon metrics and TUI mouse coordinates.

## 2. Goals

- Under Windows display scaling 100%–200%, app chrome and text scale together, remain sharp (no bitmap upscale of a 100% surface), and keep primary actions usable.
- At default appearance (`uiFontSize = 13`, `terminalFontSize = 14`) and 100% OS scale, visual hierarchy matches the current monochrome shell within ±1px rounding.
- Raising `uiFontSize` increases interface density (chrome height/width as well as type), not type alone.
- Agent TUI left-clicks work in a single session and after creating/switching sessions; keyboard input does not regress.
- Device pixel ratio changes (scale change or move across monitors) re-fit all mounted terminals and update PTY cols/rows when needed.
- Persisted window size/position is stable across OS scale changes (logical units).

## 3. Non-Goals

- Adding a separate in-app “UI zoom %” setting (OS scale + existing font settings are enough).
- Unmounting or `display: none` inactive sessions (that zeroed xterm cell size and broke TUI mouse).
- Changing PTY protocol, Agent adapters, or mouse-report encoding beyond ensuring ordered delivery and correct dimensions.
- Redesigning insights charts, brand marks, or a second theme system.
- Implementing multi-process multi-window (`--new-window` remains parsed but out of scope for this work).

## 4. Relationship to Prior Specs

| Spec | Interaction |
|------|-------------|
| `2026-07-30-galaxy-terminal-design.md` | Visual regression already lists 100%/150%/200% scale. This design implements density + geometry so those gates are meaningful. |
| `2026-08-05-appearance-agent-status-corrections-design.md` | **Revises §5.3**: layout dimensions are no longer permanently fixed px. Text remains rem-based on `--ui-font-size`. Layout chrome becomes rem-based on the same root so density tracks `uiFontSize` and OS scale together. Font validation ranges unchanged. |
| Commits `e23db54`, `262af0f` | Keep synchronous `pty_write`, write queue, and visibility stacking. This design adds hit-test priority, `inert`, DPR re-fit, and logical window state. |

## 5. Considered Approaches

### 5.1 Minimal repair (layout stays fixed px)

Fix only TUI stacking hit-tests, DPR re-fit, and logical window state. Smallest diff; does not make chrome density follow `uiFontSize` or express an explicit density system. **Rejected** after product choice for full rem density.

### 5.2 Full rem / density scale (chosen)

Convert primary layout tokens and control geometry to rem relative to `--ui-font-size`. Rely on WebView2 Per-Monitor DPI so OS scale multiplies CSS once (no double multiply by raw `devicePixelRatio` into CSS). Fix TUI mouse and window logic in the same delivery. **Chosen.**

### 5.3 Unload inactive sessions

Hide inactive tabs with `display: none` or dispose xterm. Simplifies hit-testing but collapses metrics and reintroduces the TUI mouse failure. **Rejected.**

## 6. Architecture

```
Windows display scale
        │
        ▼
WebView2 Per-Monitor V2 (CSS px = DIP, devicePixelRatio = scale)
        │
        ▼
:root
  --ui-font-size: <uiFontSize>px     // existing App.tsx wiring
  --h-titlebar, --h-tabbar, …       // rem tokens (density)
  --w-sidebar, --w-panel, …
        │
        ├─► Shell / panels / modals (CSS)
        │
        └─► TerminalView
              xterm fontSize (CSS px from terminalFontSize)
              FitAddon + ResizeObserver
              on DPR change / session activate → fit + ptyResize
```

### 6.1 Density tokens

Baseline at `uiFontSize = 13` (1rem = 13px):

| Token | Current px | Rem (÷13) |
|-------|------------|-----------|
| `--h-titlebar` | 36 | `2.7692rem` |
| `--h-tabbar` | 38 | `2.9231rem` |
| `--h-statusbar` | 26 | `2rem` |
| `--w-sidebar` | 232 | `17.8462rem` |
| `--w-panel` | 340 | `26.1538rem` |

Rules:

- Prefer these CSS variables for shell geometry; avoid new hard-coded layout px in components.
- Icon buttons and titlebar tools that use fixed `28px` / `38px` move to rem or `em` so hit targets grow with density.
- Heatmap cells, SVG brand assets, and xterm canvas rasterization may remain device-pixel aware; do not force chart cell geometry through root font size if it breaks grid alignment—document any intentional exceptions in code comments.
- Do **not** set `--ui-scale: devicePixelRatio` on the document and multiply layout by it. That double-scales on top of WebView DIP scaling.

### 6.2 DPI awareness

- Ensure the Windows process is Per-Monitor DPI aware (Tauri 2 / WebView2 default path; verify no conflicting manifest or env forces unaware mode).
- `CAPTURE_SCREEN` software-render flags remain for visual tests only and must not disable DPI awareness.

### 6.3 Window state (logical units)

`WindowState` continues to store integer `x`, `y`, `width`, `height`, `maximized`, but the meaning of width/height/position becomes **logical** (DIP), not physical pixels.

| Operation | Behavior |
|-----------|----------|
| Capture | Read logical outer size and position (or convert physical → logical via current scale factor). |
| Apply | `set_size` / `set_position` with logical types. |
| Clamp | Compare against monitor work areas in the same unit system (all logical or all physical with consistent conversion). |
| Migration | On load, if a stored size is implausibly large for logical space (e.g. width > max monitor logical width × 1.25 and matches typical physical storage), optionally scale by the inverse of current factor once—or clamp into view. Prefer: clamp to monitors; users who only ever used 100% see no change. |

Min window sizes in `tauri.conf.json` stay logical (`minWidth` / `minHeight`).

### 6.4 Session stacking and TUI mouse

Keep every loaded session mounted in `.session-stack` with shared grid area so inactive sessions retain real layout metrics.

| Session | CSS / DOM |
|---------|-----------|
| Active | `session-surface active`, `z-index: 1` (or higher than inactive), full pointer events, not `inert` |
| Inactive | `visibility: hidden`, `pointer-events: none`, **`inert`**, no elevated z-index |

Activation path (current session becomes active, including first paint after create):

1. Update store `currentSessionId` (existing).
2. For each pane in that session: if host has non-zero client size, `FitAddon.fit()`; if cols/rows changed, `ptyResize`.
3. After fit on activation, call `terminal.refresh(0, rows - 1)` so the render service cell size matches input mapping (required, not optional—stale metrics are a primary TUI mouse failure mode).
4. Focus the session’s remembered pane unless a modal or find bar owns focus (existing guard).

Global DPR path:

1. Subscribe once at app root (or a small terminal metrics helper) to resolution / `devicePixelRatio` changes (same approach as xterm `CoreBrowserService`: `matchMedia(\`screen and (resolution: ${dpr}dppx)\`)` re-register pattern).
2. For every registered terminal handle: fit; resize PTY when dimensions change.
3. No-op if host is collapsed (`clientWidth/Height < 1`).

Input path (unchanged contracts, must remain):

- `pty_write` / `pty_broadcast` stay **synchronous** on the Rust command side.
- Frontend keeps per-pane / per-session write queues so mouse DOWN then UP cannot reorder.
- Copy-on-select stays disabled while `mouseTrackingMode !== "none"`.

### 6.5 Terminal host layout

`.terminal-host` padding remains allowed; FitAddon must continue to measure the host content box. After density token changes, verify fit still accounts for padding so mouse column/row mapping matches the visible grid. Do not introduce CSS `transform: scale()` on terminal ancestors (breaks coordinate mapping).

## 7. Frontend Structure

| Area | Change |
|------|--------|
| `src/index.css` | Convert shell metrics and primary control sizes to rem; active session z-index; keep inactive visibility rules. |
| `src/App.tsx` | Existing `--ui-font-size` wiring; add DPR subscription that asks terminal registry to re-fit. |
| `src/features/terminal/Workspace.tsx` | Set `inert` on inactive surfaces; keep stack mounting. |
| `src/features/terminal/TerminalView.tsx` | Harden activate re-fit; export or register fit-all for DPR; skip collapsed hosts. |
| `src/shared/stores/terminalStore.ts` (or small helper) | Enumerate registered terminals for global fit without putting xterm instances into reactive state. |
| Inline styles in features | Replace remaining chrome-critical fixed px with CSS variables or rem where they define hit targets. |

## 8. Rust Structure

| Area | Change |
|------|--------|
| `src-tauri/src/platform/window_state.rs` | Capture/apply logical geometry; clamp in consistent units. |
| `src-tauri/src/core/config.rs` | Document that `WindowState` sizes are logical DIPs; no schema version bump required if field types stay `u32`/`i32` and migration is best-effort clamp. |
| DPI / manifest | Only if verification shows unaware mode; prefer minimal platform fix over custom scaling math. |

## 9. Error Handling and Degradation

- Fit/resize failures are non-fatal (log at debug/trace only; never block input).
- If DPR listener APIs are missing, skip global re-fit; ResizeObserver and tab-activate re-fit still run.
- Window apply failures leave the default shown window; do not crash startup.
- Persistence failures remain read-only mode per core design §8.

## 10. Testing

### 10.1 Automated

- **CSS / density:** unit or E2E checks that root `font-size` change scales a shell metric (e.g. titlebar height or computed `--h-titlebar`) proportionally; default 13px matches baseline within rounding.
- **ptyWrite ordering:** existing queue test retained.
- **Session stacking:** E2E or component test that inactive surfaces are `inert` / non-hit-testable and active surface remains on top; switching tabs re-invokes fit (spy or resize count).
- **Window state:** Rust unit tests for logical clamp helpers with mocked monitor rects (if extracted as pure functions).

### 10.2 Manual / visual

| Scale | Checks |
|-------|--------|
| 100% | Default density matches pre-change screenshots within tolerance. |
| 150% / 200% | Titlebar, sidebar, panel, statusbar readable; primary buttons clickable; no overlapping text in settings/insights. |
| TUI | Start Agent TUI → click menus; open second terminal → switch back → clicks still work; new session clicks work. |
| Window | Set size at 100%, switch OS to 150%, restart → logical size preserved (window not ~⅔ previous visual size). |

### 10.3 Out of scope for this plan’s CI

Full CAPTURE_SCREEN matrix at three scales may remain manual or nightly; document in release checklist if not automated yet.

## 11. Implementation Phases

1. **Density tokens** — convert shell CSS variables and critical control sizes to rem; verify default 13px baseline.
2. **Session hit-testing** — active z-index, `inert` on inactive, activate re-fit/refresh.
3. **DPR re-fit** — global listener + terminal registry fit-all.
4. **Logical window state** — capture/apply/clamp; smoke on multi-monitor if available.
5. **Regression tests** — density + stacking + keep write-order tests green.

## 12. Acceptance Criteria

1. At OS 150% and 200%, chrome and text are larger than at 100%, sharp, and usable.
2. Default appearance at 100% matches current hierarchy (no intentional redesign).
3. Changing `uiFontSize` in settings preview grows type **and** chrome density.
4. Agent TUI: keyboard and mouse both work; multi-session create/switch does not kill mouse.
5. Window restore uses logical sizing so OS scale changes do not silently shrink the window to physical-pixel leftovers.
6. No `transform: scale` on terminal ancestors; no double DPR multiply in CSS.
7. Existing appearance font ranges and Agent status observation behavior remain intact.

## 13. Open Implementation Notes

- Exact rem fractions may use four-decimal rem or `calc()` from a single base; pick one style and stay consistent in `index.css`.
- If logical window migration mis-detects old physical sizes on 100% primary displays, prefer clamp-to-monitor over aggressive downscaling.
- `--new-window` multi-window is explicitly out of scope; “新窗口” in bug reports maps to **new terminal session tab** in this design.
