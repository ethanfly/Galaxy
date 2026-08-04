# Workspace Insights Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Galaxy Terminal around terminal and insights top-level views, backed by real Rust-aggregated command activity statistics and a restrained, high-density visual system.

**Architecture:** Rust extends persisted command blocks with optional Agent identity and exposes a narrow `insights_summary` aggregation command. React adds a UI-only top-level view state, a persistent terminal surface, and a focused insights feature whose components consume one typed IPC response. Existing PTY ownership, terminal registry, persistence, shortcuts, and Inspector functions remain intact.

**Tech Stack:** Rust, Tauri 2, chrono, serde, parking_lot, React 18, TypeScript strict mode, Zustand, native SVG/CSS, Vitest, Testing Library, Playwright.

## Global Constraints

- The Rust backend remains the single source of truth; frontend stores only cache backend results or UI-only state.
- Every new Tauri command is registered in `src-tauri/src/commands/mod.rs` and wrapped exactly once in `src/shared/ipc/client.ts`.
- Shared Rust models serialize with camelCase fields.
- Command and Agent history access remains read-only except for Galaxy-owned `blocks.jsonl` persistence.
- The redesign removes starfield textures, purple gradients, decorative glow, looping pixel animation, and repeated KPI cards.
- The palette uses charcoal surfaces, cool neutral text, one cyan-green primary accent, and semantic success/warning/error colors.
- UI radii are limited to 2px, 4px, and 6px; letter spacing is `0`.
- Motion intensity is 3/10 and all motion obeys `prefers-reduced-motion`.
- The terminal view must not destroy PTYs or xterm instances when insights is active.
- Supported verification viewports are 1440x900, 1024x768, and 800x700.
- No charting dependency is added; charts use native SVG/CSS and accessible text.

## File Map

- `src-tauri/src/core/models.rs`: persist optional `agent_kind` on command blocks.
- `src-tauri/src/pty/tracker.rs`: populate command block Agent identity supplied by PTY manager context.
- `src-tauri/src/pty/manager.rs`: pass pane Agent identity into finalized blocks.
- `src-tauri/src/services/insights.rs`: define aggregation inputs/outputs and pure aggregation logic.
- `src-tauri/src/services/mod.rs`: export the insights service.
- `src-tauri/src/commands/features.rs`: expose `insights_summary`.
- `src-tauri/src/commands/mod.rs`: register the command.
- `src/shared/ipc/types.ts`: mirror insights DTOs.
- `src/shared/ipc/client.ts`: add the typed insights wrapper.
- `src/shared/stores/uiStore.ts`: own `workspaceView` and context navigation state.
- `src/features/navigation/NavigationRail.tsx`: primary view navigation and project context expansion.
- `src/features/navigation/ContextSidebar.tsx`: project and session lists using existing app-store actions.
- `src/features/titlebar/TitleBar.tsx`: reduce the top bar and add terminal/insights segmented control.
- `src/features/tabs/TabBar.tsx`: render inside the terminal surface rather than as a shell grid row.
- `src/features/insights/useInsights.ts`: load, debounce-refresh, and retain stale insights results.
- `src/features/insights/InsightsView.tsx`: compose the analysis canvas and its states.
- `src/features/insights/ActivityHeatmap.tsx`: accessible 365-day heatmap.
- `src/features/insights/ActivityTrend.tsx`: accessible native SVG trend chart.
- `src/features/insights/ProjectRanking.tsx`: sortable compact project ranking.
- `src/features/insights/AgentDistribution.tsx`: Agent and Shell distribution.
- `src/features/insights/RecentActivity.tsx`: compact activity rows and actions.
- `src/App.tsx`: compose the new shell while preserving global event wiring.
- `src/index.css`: replace the old visual system and responsive shell layout.
- `src/shared/i18n.ts`: add all visible navigation and insights strings.
- Unit and E2E tests listed in each task below.

---

### Task 1: Persist Command Block Agent Identity

**Files:**
- Modify: `src-tauri/src/core/models.rs`
- Modify: `src-tauri/src/pty/tracker.rs`
- Modify: `src-tauri/src/pty/manager.rs`
- Modify: `src-tauri/src/services/blocks.rs`
- Test: `src-tauri/src/pty/tracker.rs`
- Test: `src-tauri/src/services/blocks.rs`

**Interfaces:**
- Produces: `CommandBlock.agent_kind: Option<AgentKind>` with serde default compatibility.
- Produces: tracker block finalization that accepts the pane's current `Option<AgentKind>`.

- [ ] **Step 1: Add failing compatibility and capture tests**

Add a block-store test that deserializes a legacy JSON line without `agentKind` and asserts `agent_kind == None`. Add tracker tests that finalize one block with `Some(AgentKind::Codex)` and one with `None`.

```rust
assert_eq!(legacy.agent_kind, None);
assert_eq!(agent_block.agent_kind, Some(AgentKind::Codex));
assert_eq!(shell_block.agent_kind, None);
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `cargo test --lib services::blocks::tests pty::tracker::tests`

Expected: compilation fails because `CommandBlock` has no `agent_kind` field or tracker finalization has no Agent argument.

- [ ] **Step 3: Add the model field and populate it at finalization**

Add the optional field:

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub agent_kind: Option<AgentKind>,
```

Thread the pane Agent identity already known by PTY manager into the tracker block constructor. Update all literal `CommandBlock` constructors to set `agent_kind` explicitly.

- [ ] **Step 4: Format and run focused tests**

Run: `cargo fmt --all -- --check`

Run: `cargo test --lib services::blocks::tests pty::tracker::tests`

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/models.rs src-tauri/src/pty/tracker.rs src-tauri/src/pty/manager.rs src-tauri/src/services/blocks.rs
git commit -m "feat: preserve agent identity on command blocks"
```

### Task 2: Implement Rust Insights Aggregation

**Files:**
- Create: `src-tauri/src/services/insights.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/commands/features.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Test: `src-tauri/src/services/insights.rs`

**Interfaces:**
- Consumes: `CommandBlock.agent_kind: Option<AgentKind>` from Task 1.
- Produces: `InsightsRange`, `InsightsQuery`, `InsightsSummary`, `DailyActivity`, `ProjectInsight`, `AgentInsight`, and `RecentActivity` serde DTOs.
- Produces: `aggregate(blocks, projects, sessions, query, now) -> InsightsSummary`.
- Produces: Tauri command `insights_summary(project_id, range, timezone_offset_minutes)`.

- [ ] **Step 1: Write failing aggregation tests**

Use fixed RFC3339 timestamps and cover empty input, local-date offset, cross-year ranges, success-rate denominator, invalid/negative duration, quantile levels, project filter, Agent grouping, and invalid timestamps.

```rust
let result = aggregate(&blocks, &projects, &sessions, query, fixed_now());
assert_eq!(result.summary.command_count, 3);
assert_eq!(result.summary.completed_count, 2);
assert_eq!(result.summary.success_count, 1);
assert_eq!(result.summary.success_rate, Some(0.5));
assert_eq!(result.invalid_record_count, 1);
```

- [ ] **Step 2: Verify the service tests fail**

Run: `cargo test --lib services::insights::tests`

Expected: compilation fails because `services::insights` and its DTOs do not exist.

- [ ] **Step 3: Implement DTOs and pure aggregation**

Define range values with camelCase serde names:

```rust
pub enum InsightsRange { SevenDays, ThirtyDays, NinetyDays, Year }
```

Take a cloned block snapshot using `BlockStore::list(None).blocks`, normalize dates with `chrono::FixedOffset`, calculate duration only when end is not before start, and calculate success rate only over blocks with an exit code. Generate a complete day vector including zero days. Quantile thresholds are computed from non-zero daily counts.

- [ ] **Step 4: Expose and register the command**

Add `pub mod insights;`, implement `insights_summary` in `commands/features.rs`, and register it adjacent to block commands in `commands/mod.rs`. Clone projects and sessions under short store read locks before aggregation.

- [ ] **Step 5: Run formatting and tests**

Run: `cargo fmt --all -- --check`

Run: `cargo test --lib services::insights::tests`

Run: `cargo test --lib services::blocks::tests pty::tracker::tests`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/insights.rs src-tauri/src/services/mod.rs src-tauri/src/commands/features.rs src-tauri/src/commands/mod.rs
git commit -m "feat: aggregate workspace activity insights"
```

### Task 3: Add the Typed Frontend Contract and View State

**Files:**
- Modify: `src/shared/ipc/types.ts`
- Modify: `src/shared/ipc/client.ts`
- Modify: `src/shared/ipc/types.test.ts`
- Modify: `src/shared/stores/uiStore.ts`
- Create: `src/shared/stores/uiStore.test.ts`

**Interfaces:**
- Consumes: Rust `InsightsSummary` JSON from Task 2.
- Produces: `InsightsRange = "sevenDays" | "thirtyDays" | "ninetyDays" | "year"`.
- Produces: `insightsSummary(projectId, range, timezoneOffsetMinutes): Promise<InsightsSummary>`.
- Produces: `workspaceView: "terminal" | "insights"`, `setWorkspaceView(view)`, and `contextSidebarOpen` UI state.

- [ ] **Step 1: Write failing DTO and store tests**

Add a JSON fixture asserting camelCase DTO shape, and reset the Zustand store before asserting view transitions:

```ts
useUiStore.getState().setWorkspaceView("insights");
expect(useUiStore.getState().workspaceView).toBe("insights");
useUiStore.getState().setWorkspaceView("terminal");
expect(useUiStore.getState().workspaceView).toBe("terminal");
```

- [ ] **Step 2: Verify failures**

Run: `npm test -- --run src/shared/ipc/types.test.ts src/shared/stores/uiStore.test.ts`

Expected: TypeScript compilation fails because the insights types and store actions do not exist.

- [ ] **Step 3: Implement types, wrapper, and UI state**

Mirror every Rust DTO exactly in `types.ts`. Add:

```ts
export const insightsSummary = (
  projectId: string | null,
  range: InsightsRange,
  timezoneOffsetMinutes: number,
) => call<InsightsSummary>("insights_summary", { projectId, range, timezoneOffsetMinutes });
```

Add only presentation state to `uiStore`; do not cache insights business data there.

- [ ] **Step 4: Run tests and type checking**

Run: `npm test -- --run src/shared/ipc/types.test.ts src/shared/stores/uiStore.test.ts`

Run: `npx tsc --noEmit`

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc/types.ts src/shared/ipc/client.ts src/shared/ipc/types.test.ts src/shared/stores/uiStore.ts src/shared/stores/uiStore.test.ts
git commit -m "feat: add typed insights frontend contract"
```

### Task 4: Build the New Application Shell Without Terminal Lifecycle Regression

**Files:**
- Create: `src/features/navigation/NavigationRail.tsx`
- Create: `src/features/navigation/ContextSidebar.tsx`
- Create: `src/features/navigation/NavigationRail.test.tsx`
- Modify: `src/features/titlebar/TitleBar.tsx`
- Modify: `src/features/tabs/TabBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/shared/icons/Icons.tsx`
- Modify: `src/shared/i18n.ts`
- Modify: `src/index.css`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `workspaceView` UI state from Task 3.
- Produces: persistent `.terminal-surface` and conditional `.insights-surface` shell regions.
- Produces: `NavigationRail` and `ContextSidebar` components using existing app-store actions.

- [ ] **Step 1: Write failing shell tests**

Mock existing IPC calls and assert the navigation rail, segmented view control, and terminal surface exist. Toggle to insights and assert the terminal surface remains mounted but hidden with `aria-hidden`, then toggle back and assert the same DOM node remains.

```tsx
const terminal = screen.getByTestId("terminal-surface");
await user.click(screen.getByRole("tab", { name: /洞察|Insights/ }));
expect(terminal).toHaveAttribute("aria-hidden", "true");
expect(screen.getByTestId("terminal-surface")).toBe(terminal);
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- --run src/App.test.tsx src/features/navigation/NavigationRail.test.tsx`

Expected: tests fail because the navigation and top-level views do not exist.

- [ ] **Step 3: Implement the shell and navigation**

Render the titlebar across the top, navigation rail on the left, optional context sidebar next, and workspace/Inspector to the right. Move `TabBar` into `.terminal-surface`. Keep `<Workspace />` mounted for both top-level views and hide its surface with CSS/ARIA when insights is active.

Add project, session, insights, favorites, search, and settings icons using the existing icon component conventions; every unfamiliar icon button gets localized `title` and `aria-label`.

- [ ] **Step 4: Add responsive shell CSS**

Implement stable 56px rail, 220px context sidebar, 36px titlebar, responsive Inspector overlay below 1280px, and context overlay below 900px. This step only establishes geometry and neutral tokens; detailed insights styling belongs to Task 6.

- [ ] **Step 5: Run focused tests and type checking**

Run: `npm test -- --run src/App.test.tsx src/features/navigation/NavigationRail.test.tsx`

Run: `npx tsc --noEmit`

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/navigation src/features/titlebar/TitleBar.tsx src/features/tabs/TabBar.tsx src/App.tsx src/shared/icons/Icons.tsx src/shared/i18n.ts src/index.css src/App.test.tsx
git commit -m "feat: rebuild the workspace navigation shell"
```

### Task 5: Build the Insights Data Layer and Components

**Files:**
- Create: `src/features/insights/useInsights.ts`
- Create: `src/features/insights/useInsights.test.tsx`
- Create: `src/features/insights/InsightsView.tsx`
- Create: `src/features/insights/InsightsView.test.tsx`
- Create: `src/features/insights/ActivityHeatmap.tsx`
- Create: `src/features/insights/ActivityHeatmap.test.tsx`
- Create: `src/features/insights/ActivityTrend.tsx`
- Create: `src/features/insights/ProjectRanking.tsx`
- Create: `src/features/insights/AgentDistribution.tsx`
- Create: `src/features/insights/RecentActivity.tsx`
- Modify: `src/App.tsx`
- Modify: `src/shared/i18n.ts`

**Interfaces:**
- Consumes: `insightsSummary` wrapper and DTOs from Task 3.
- Produces: `useInsights({ projectId, range })` returning `{ data, loading, refreshing, error, refresh }`.
- Produces: accessible `InsightsView` rendered by the shell from Task 4.

- [ ] **Step 1: Write failing hook and empty/error state tests**

Use fake timers and a mocked IPC wrapper. Verify first load, retained stale data during refresh, 200ms `blocks://updated` debounce, rejected request, retry, and empty data UI.

```ts
expect(result.current.loading).toBe(true);
await waitFor(() => expect(result.current.data).toEqual(summary));
rerender({ projectId: "p2", range: "thirtyDays" });
expect(result.current.data).toEqual(summary);
expect(result.current.refreshing).toBe(true);
```

- [ ] **Step 2: Write failing heatmap interaction tests**

Render a fixed 365-day fixture. Assert 365 grid cells, accessible date names, intensity classes, tooltip content, and ArrowRight/ArrowLeft focus movement.

- [ ] **Step 3: Verify component tests fail**

Run: `npm test -- --run src/features/insights`

Expected: modules are missing and tests fail.

- [ ] **Step 4: Implement the hook and page states**

The hook computes `new Date().getTimezoneOffset()`, cancels stale request commits, and retains prior data while refreshing. `InsightsView` owns project/range filters and renders loading, error, empty, invalid-record notice, and populated states.

- [ ] **Step 5: Implement the heatmap and trend**

Build heatmap columns from returned dates instead of generating synthetic values. Use semantic buttons for date cells, CSS custom property `--activity-level`, an accessible tooltip, and roving `tabIndex`. Render the trend as native SVG with labeled points and a neighboring text summary.

- [ ] **Step 6: Implement ranking, Agent distribution, and recent activity**

Use compact rows, semantic sort buttons, real project names, Agent identity labels, and existing block action wrappers. Disable rerun when no live target pane exists. Do not add nested cards.

- [ ] **Step 7: Run tests and type checking**

Run: `npm test -- --run src/features/insights`

Run: `npx tsc --noEmit`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/features/insights src/App.tsx src/shared/i18n.ts
git commit -m "feat: add workspace insights experience"
```

### Task 6: Complete the Visual System and Responsive States

**Files:**
- Modify: `src/index.css`
- Modify: `src/features/panels/RightPanel.tsx`
- Modify: `src/features/statusbar/StatusBar.tsx`
- Modify: `src/features/terminal/Workspace.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: shell and insights class names from Tasks 4 and 5.
- Produces: final charcoal/cyan design tokens, component states, and 1280px/900px responsive behavior.

- [ ] **Step 1: Add failing structural style assertions**

Assert the old `starfield` class is absent from the app shell and empty workspace, insights regions expose stable class names, and Inspector receives docked/overlay state classes based on the viewport contract.

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- --run src/App.test.tsx`

Expected: old decorative classes or missing responsive state hooks fail assertions.

- [ ] **Step 3: Replace tokens and legacy decoration**

Replace `--space-*` and nebula-led semantics with neutral surface tokens and one cyan-green accent while retaining compatibility aliases temporarily for untouched feature styles. Remove `.starfield`, `twinkle`, pixel-corner, sparkle, and decorative glow rules from active surfaces. Set UI `letter-spacing: 0` globally.

- [ ] **Step 4: Style the analysis canvas and controls**

Use an asymmetric CSS grid with the heatmap spanning the main width, a compact trend region, and unframed ranking/distribution regions divided by rules and whitespace. Use 2/4/6px radii, fixed heatmap cells, visible focus rings, readable semantic colors, and no nested cards.

- [ ] **Step 5: Implement responsive and reduced-motion behavior**

At 1280px Inspector switches from docked to overlay. Below 900px context sidebar overlays, insights becomes one column, summary metrics wrap without overlap, and heatmap scrolls horizontally. Reduced motion removes transitions and animated refresh indicators.

- [ ] **Step 6: Run frontend verification**

Run: `npm test`

Run: `npx tsc --noEmit`

Run: `npm run build`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/features/panels/RightPanel.tsx src/features/statusbar/StatusBar.tsx src/features/terminal/Workspace.tsx src/App.test.tsx
git commit -m "style: establish the new Galaxy workspace system"
```

### Task 7: Add UI E2E Coverage and Perform Completion Audit

**Files:**
- Modify: `e2e/smoke.ui.spec.ts`
- Modify: `e2e/visual.app.spec.ts`
- Create: `e2e/insights.ui.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-04-workspace-insights-redesign.md`

**Interfaces:**
- Consumes: complete backend/frontend implementation.
- Produces: mocked-Tauri interaction coverage and three-viewport screenshot evidence.

- [ ] **Step 1: Add mocked insights fixture and failing E2E scenarios**

Return a deterministic `insights_summary` response from the mock. Test terminal/insights switching, project filtering, range filtering, heatmap tooltip/focus, recent activity navigation, error retry, and return to the still-mounted terminal surface.

- [ ] **Step 2: Update visual viewport coverage**

Capture populated insights at 1440x900, 1024x768, and 800x700. Capture the empty state at 1024x768. Assert there is no horizontal page overflow; only `.activity-heatmap-scroll` may scroll horizontally.

- [ ] **Step 3: Run UI E2E and fix only observed failures**

Run: `npx playwright test --project=ui`

Expected: all UI specs pass.

- [ ] **Step 4: Run the full automated verification matrix**

Run: `npx tsc --noEmit`

Run: `npm test`

Run: `npm run build`

Run from `src-tauri/`: `cargo test --locked`

Expected: every command passes with zero failing tests.

- [ ] **Step 5: Run the application and inspect screenshots**

Start the Tauri development application with `npm run tauri dev`. Capture the terminal and insights views at the three target sizes. Inspect each screenshot for blank charts, malformed heatmap geometry, overlap, clipping, unreadable text, and accidental legacy purple/starfield decoration.

- [ ] **Step 6: Audit the spec requirement by requirement**

Check sections 3 through 12 of `docs/superpowers/specs/2026-08-04-workspace-insights-redesign.md` against code, tests, and rendered screenshots. Keep this task open for any missing requirement; do not redefine completion around tests that exist.

- [ ] **Step 7: Commit E2E coverage and plan completion marks**

```bash
git add e2e/smoke.ui.spec.ts e2e/visual.app.spec.ts e2e/insights.ui.spec.ts docs/superpowers/plans/2026-08-04-workspace-insights-redesign.md
git commit -m "test: cover workspace insights workflows"
```
