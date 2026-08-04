# Theme And Navigation Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove residual purple styling, align terminal/settings chrome with the charcoal-green system, and simplify the primary navigation without changing backend behavior.

**Architecture:** Keep semantic CSS tokens for application chrome and a single exported xterm palette for the terminal canvas. Replace duplicated rail actions with three explicit workflow actions, while settings remains a modal with a responsive chapter index. A stepwise v3→v4 store migration replaces only the retired built-in project color.

**Tech Stack:** React, TypeScript, Zustand, xterm.js, CSS, Vitest, Playwright.

## Global Constraints

- Rust remains the source of truth; the only persistence change is the stepwise legacy default-color migration.
- All user-visible copy goes through `t()` where the existing i18n module is used.
- Use existing SVG icon components and preserve keyboard focus behavior.
- Keep the current charcoal / cyan-green visual world; do not introduce gradients, purple chrome, or decorative star effects.

---

### Task 1: Lock terminal theme and rail contract

**Files:**
- Modify: `src/features/terminal/TerminalView.tsx`
- Modify: `src/features/navigation/NavigationRail.tsx`
- Test: `src/features/terminal/TerminalView.test.tsx`
- Test: `src/features/navigation/NavigationRail.test.tsx`

- [x] Write tests asserting the exported terminal theme uses `#0b0e0f` background, `#67d9ad` cursor, and no purple values; assert the rail exposes exactly terminal, insights, history, and settings actions.
- [x] Run the focused tests and confirm they fail against the current theme and five-action rail.
- [x] Export the theme constant, replace the xterm palette with semantic charcoal/green values, and reduce rail actions to the three workflows plus settings.
- [x] Run focused tests and confirm they pass.

### Task 2: Remove legacy purple chrome and restyle settings chapters

**Files:**
- Modify: `src/index.css`
- Modify: `src/features/settings/SettingsModal.tsx`
- Test: `src/features/settings/SettingsModal.test.tsx`

- [x] Add a failing test for `aria-current="page"` on the selected settings chapter and for the translated chapter labels.
- [x] Run the test and confirm it fails.
- [x] Replace legacy hard-coded purple rules in titlebar, tabs, project rows, settings navigation, modal and status accents with semantic tokens; remove pixel corner/star pseudo-elements from active settings chapters.
- [x] Add `type="button"`, `aria-current`, and responsive chapter layout styles; use i18n keys for section labels.
- [x] Run the settings test and typecheck.

### Task 3: Update UI E2E and visual verification

**Files:**
- Modify: `e2e/smoke.ui.spec.ts`
- Modify: `e2e/ime.ui.spec.ts`

- [x] Add a mocked Tauri scenario that opens settings and checks the active chapter plus compact rail count.
- [x] Add a terminal canvas scenario that checks the charcoal host and captures rendered xterm output.
- [x] Implement the smallest selector/fixture updates needed for the approved behavior.
- [x] Run desktop and 560px UI E2E screenshots and inspect them.

### Task 4: Migrate legacy defaults and align shared navigation state

**Files:**
- Modify: `src-tauri/src/core/models.rs`
- Modify: `src-tauri/src/services/persistence.rs`
- Modify: `src/shared/stores/uiStore.ts`
- Modify: `src/features/titlebar/TitleBar.tsx`
- Modify: `src/features/search/CommandPalette.tsx`

- [x] Add failing tests for the legacy project color and insights-to-terminal context action.
- [x] Add the v3→v4 exact-color migration and centralize the workspace context action.
- [x] Run focused Rust, Zustand, titlebar, and navigation tests.

### Task 5: Full verification and commit

- [x] Run `npm test -- --run`.
- [x] Run `npx tsc --noEmit` and `npm run build`.
- [x] Run `npx playwright test --project=ui`.
- [x] Run the Impeccable detector on changed UI files and review findings.
- [x] Commit with `fix: finish theme and navigation correction`.
