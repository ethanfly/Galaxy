# Monochrome Galaxy Brand and Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Galaxy Terminal's green/pixel visual language with a verified deep-black and brilliant-white system, one flat Galaxy mark, one rounded operation-icon family, and a rebuilt Windows installer.

**Architecture:** `public/brand/galaxy-mark.svg` is the only authored brand source. A deterministic Node generator rasterizes it for web and Tauri packaging, while `src/shared/icons/Icons.tsx` owns semantic Lucide adapters for all interface controls. CSS tokens own routine monochrome UI color; the terminal keeps ANSI semantics, and Rust persistence migrates only the retired built-in project green.

**Tech Stack:** React 18, TypeScript 5.8, Lucide React 1.28, CSS custom properties, Vitest/jsdom, Playwright, Node test runner, resvg, Rust, Tauri 2, NSIS.

## Global Constraints

- The title bar is the only in-app brand entry; `.rail-brand` must not render.
- The authored mark is `public/brand/galaxy-mark.svg`, `viewBox="0 0 64 64"`, with transparent rounded outside corners and flat neutral black/white geometry only.
- No gradient, glow, texture, bevel, decorative star field, or drop shadow is allowed in the brand mark.
- Routine UI uses `#030405`, `#050607`, `#0a0c0e`, `#111418`, `#1b1f23`, `#f7f8f8`, `#c6c9cc`, `#8b9196`, and the neutral accent ramp from the approved specification.
- Success green `#5bd6a2`, blocked amber `#f2bd65`, and error red `#ff667f` are semantic exceptions only.
- Terminal canvas values are background `#030405`, foreground `#f7f8f8`, cursor `#ffffff`, cursor accent `#030405`, and selection `#34383d`; ANSI colors remain functional colors.
- Operation icons use a 24x24 Lucide grid, `currentColor`, round caps/joins, default rendered size 16px, and absolute `strokeWidth=1.8`.
- Feature modules import icons only from `src/shared/icons/Icons.tsx`; no control-local SVG or font glyph substitutes remain.
- Icon-only controls have an accessible name and a minimum 28x28px target, except 24x24px dense native window controls.
- User-selected project colors are preserved. Only the retired built-in green `#39b98a` migrates to `#f5f6f7`.
- Preserve PTY lifecycles, IPC contracts, workspace state behavior, keyboard workflows, and terminal ANSI semantics.
- Use ASCII in new source comments and documents; preserve existing localized strings rather than rewriting unrelated copy.

---

### Task 1: Single Galaxy Brand Source and Reproducible Package Assets

**Files:**
- Create: `public/brand/galaxy-mark.svg`
- Create: `scripts/gen-icons.test.mjs`
- Modify: `scripts/gen-icons.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`
- Modify: `src/features/titlebar/TitleBar.tsx`
- Modify: `src/features/titlebar/TitleBar.test.tsx`
- Modify: `src/features/navigation/NavigationRail.tsx`
- Modify: `src/features/navigation/NavigationRail.test.tsx`
- Modify: `src/index.css`
- Modify: `README.md`
- Modify: `docs/RELEASE.md`
- Regenerate: `public/icon.png`
- Create: `public/apple-touch-icon.png`
- Regenerate: `src-tauri/icons/32x32.png`
- Regenerate: `src-tauri/icons/128x128.png`
- Regenerate: `src-tauri/icons/128x128@2x.png`
- Regenerate: `src-tauri/icons/icon.png`
- Regenerate: `src-tauri/icons/icon.ico`
- Delete: `public/logo.png`
- Delete: `public/logo.svg`
- Delete: `src-tauri/icons/logo-master.png`

**Interfaces:**
- Consumes: approved mark geometry and monochrome colors from the design specification.
- Produces: `generateIconAssets({ masterPath, publicDir, tauriDir })`, the master SVG URL `./brand/galaxy-mark.svg`, and deterministic web/Tauri raster outputs.

- [ ] **Step 1: Add failing brand placement tests**

Add to `TitleBar.test.tsx`:

```tsx
it("uses the single authored Galaxy mark in the title bar", () => {
  const { container } = render(<TitleBar />);
  const mark = container.querySelector<HTMLImageElement>("img.icon-logo");
  expect(mark?.getAttribute("src")).toBe("./brand/galaxy-mark.svg");
  expect(container.querySelectorAll("img.icon-logo")).toHaveLength(1);
});
```

Add to `NavigationRail.test.tsx`:

```tsx
it("starts with navigation and does not repeat the product brand", () => {
  const { container } = render(<NavigationRail />);
  expect(container.querySelector(".rail-brand")).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(4);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run src/features/titlebar/TitleBar.test.tsx src/features/navigation/NavigationRail.test.tsx`

Expected: the title-bar source is still `./icon.png`, and `.rail-brand` still exists.

- [ ] **Step 3: Add a failing generator behavior test**

Create `scripts/gen-icons.test.mjs` with Node's test runner. Execute the real generator CLI into a temporary directory, decode PNG files with `pngjs`, and assert literal output contracts:

```js
test("renders neutral package icons with transparent outside corners", async () => {
  const root = mkdtempSync(join(tmpdir(), "galaxy-icons-"));
  const publicDir = join(root, "public");
  const tauriDir = join(root, "tauri");
  execFileSync(process.execPath, [GENERATOR, "--master", MASTER,
    "--public-dir", publicDir, "--tauri-dir", tauriDir]);

  const icon = PNG.sync.read(readFileSync(join(tauriDir, "icon.png")));
  assert.deepEqual([icon.width, icon.height], [256, 256]);
  assert.equal(icon.data[3], 0);
  for (let i = 0; i < icon.data.length; i += 4) {
    if (icon.data[i + 3] === 0) continue;
    assert.ok(Math.max(icon.data[i], icon.data[i + 1], icon.data[i + 2]) -
      Math.min(icon.data[i], icon.data[i + 1], icon.data[i + 2]) <= 2);
  }
  assert.deepEqual(readIcoSizes(readFileSync(join(tauriDir, "icon.ico"))), [16, 32, 48, 256]);
});
```

Also compare a fresh temporary generation byte-for-byte with every committed web/Tauri output. Add these scripts to `package.json` so CI's existing `npm test` gate includes assets:

```json
"test": "npm run test:unit && npm run test:icons",
"test:unit": "vitest run",
"test:icons": "node --test scripts/gen-icons.test.mjs"
```

- [ ] **Step 4: Run the generator test and verify RED**

Run: `npm run test:icons`

Expected: temporary outputs are missing because the current generator does not support the CLI output arguments and there is no `public/brand/galaxy-mark.svg`.

- [ ] **Step 5: Implement the flat master and deterministic generator**

Install exact tooling:

```powershell
npm install --save-dev @resvg/resvg-js@2.6.2 pngjs@7.0.0
```

Author the 64x64 SVG with a rounded `#030405` field and one `#ffffff` orbital-G path with rounded caps/joins. Rewrite `gen-icons.mjs` to:

```js
export async function generateIconAssets({ masterPath, publicDir, tauriDir }) {
  const svg = readFileSync(masterPath);
  const png = (size) => new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0,0,0,0)",
  }).render().asPng();
  // Write web 180/256 PNGs, Tauri 32/128/256 PNGs, and ICO 16/32/48/256.
}
```

Keep the existing standards-compliant ICO directory writer, but remove `drawSingularity`, raster fallback logic, and every procedural duplicate of the mark.

- [ ] **Step 6: Wire the single mark into the app and docs**

Use `<img className="icon-logo" src="./brand/galaxy-mark.svg" ...>` in `TitleBar`. Remove `.rail-brand` and `IconLogo` from `NavigationRail`. Remove the mark shadow from `.icon-logo`. Point favicon/Apple links and README imagery at the new master/generated outputs. Update release documentation so `npm run gen:icons` is described as SVG-driven.

- [ ] **Step 7: Regenerate, verify GREEN, and inspect the source image**

Run:

```powershell
npm run gen:icons
npm run test:icons
npx vitest run src/features/titlebar/TitleBar.test.tsx src/features/navigation/NavigationRail.test.tsx
```

Expected: all commands exit 0. Open `public/brand/galaxy-mark.svg` and `src-tauri/icons/icon.png`; confirm one flat mark, transparent outer corners, and legibility at 16px.

- [ ] **Step 8: Commit Task 1**

```powershell
git add package.json package-lock.json scripts/gen-icons.mjs scripts/gen-icons.test.mjs public src-tauri/icons index.html src/features/titlebar src/features/navigation src/index.css README.md docs/RELEASE.md
git commit -m "feat: unify Galaxy brand assets"
```

---

### Task 2: Rounded Semantic Operation Icon System

**Files:**
- Create: `src/shared/icons/Icons.test.tsx`
- Modify: `src/shared/icons/Icons.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/index.css`
- Modify: `src/shared/components/Modal.tsx`
- Modify: `src/features/navigation/ContextSidebar.tsx`
- Modify: `src/features/navigation/NavigationRail.tsx`
- Modify: `src/features/titlebar/TitleBar.tsx`
- Modify: `src/features/tabs/TabBar.tsx`
- Modify: `src/features/statusbar/StatusBar.tsx`
- Modify: `src/features/terminal/Workspace.tsx`
- Modify: `src/features/search/FindBar.tsx`
- Modify: `src/features/search/BlockSearchModal.tsx`
- Modify: `src/features/search/HistorySearchModal.tsx`
- Modify: `src/features/panels/GitPanel.tsx`
- Modify: `src/features/panels/HistoryPanel.tsx`
- Modify: `src/features/panels/RightPanel.tsx`
- Modify: `src/features/insights/RecentActivity.tsx`
- Modify: `src/features/settings/SettingsModal.tsx`
- Modify: `src/shared/i18n.ts`
- Modify: relevant existing component tests

**Interfaces:**
- Consumes: Lucide React components and the single title-bar brand decision from Task 1.
- Produces: semantic `Icon*` exports with `GalaxyIconProps`, class `galaxy-icon`, absolute 1.8px strokes, and an `IconStar` `filled` state.

- [ ] **Step 1: Add failing icon contract tests**

Create `Icons.test.tsx`:

```tsx
it("applies the Galaxy rounded stroke contract", () => {
  const { container } = render(<IconTerminal />);
  const svg = container.querySelector("svg");
  expect(svg?.classList.contains("galaxy-icon")).toBe(true);
  expect(svg?.getAttribute("stroke")).toBe("currentColor");
  expect(svg?.getAttribute("stroke-width")).toBe("1.8");
  expect(svg?.classList.contains("pixel-icon")).toBe(false);
});

it("fills only the active favorite", () => {
  const { rerender, container } = render(<IconStar />);
  expect(container.querySelector("svg")?.getAttribute("fill")).toBe("none");
  rerender(<IconStar filled />);
  expect(container.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
});
```

Add component assertions that rerun, favorite, copy, remove, and close icon buttons are addressable by accessible name, not by their glyph text.

- [ ] **Step 2: Run icon tests and verify RED**

Run: `npx vitest run src/shared/icons/Icons.test.tsx src/features/navigation/NavigationRail.test.tsx src/features/settings/SettingsModal.test.tsx`

Expected: current icons use `.pixel-icon`, filled pixel paths, and unnamed setting icon buttons.

- [ ] **Step 3: Install Lucide and build the semantic adapter**

Run: `npm install lucide-react@1.28.0`

Replace the pixel path file with an adapter factory:

```tsx
type GalaxyIconProps = Omit<LucideProps, "size"> & { size?: number };

function galaxyIcon(Component: LucideIcon, name: string) {
  const Icon = ({ size = 16, className, ...props }: GalaxyIconProps) => (
    <Component
      {...props}
      className={["galaxy-icon", className].filter(Boolean).join(" ")}
      size={size}
      stroke="currentColor"
      strokeWidth={1.8}
      absoluteStrokeWidth
      aria-hidden="true"
      focusable="false"
    />
  );
  Icon.displayName = name;
  return Icon;
}
```

Export semantic wrappers for terminal, insights, history, sidebar, agent, Git, notifications, settings, folder, sessions, plus, close, copy, favorite, split right/down, move, sync input, prompt, refresh, rerun, play, alert, minimize, maximize, restore, and chevrons. Implement active star fill explicitly.

- [ ] **Step 4: Replace local SVGs and operation glyphs**

Use `IconInsights` from the adapter in `NavigationRail`, `IconCopy` in `RecentActivity`, and semantic adapters in History, Block Search, Settings, Git, Status Bar, and Workspace. Replace control glyphs for rotate, star, copy, plus, x, and check. Convert non-control Git branch/dirty indicators to neutral CSS state marks. Keep `ActivityTrend` SVG because it is data visualization.

For every icon-only button, add `type="button"`, localized `aria-label`, and matching `title`. Use `<IconPlus />` next to text for add commands and `<IconClose />` for remove commands. Do not import `lucide-react` outside `Icons.tsx`.

- [ ] **Step 5: Replace pixel CSS with stable icon geometry**

Remove `.pixel-icon`, `shape-rendering: crispEdges`, and `image-rendering: pixelated`. Add:

```css
.galaxy-icon {
  display: block;
  flex: none;
  width: var(--icon-size, 16px);
  height: var(--icon-size, 16px);
  overflow: visible;
}

.icon-btn {
  min-width: 28px;
  min-height: 28px;
}
```

Retain the 46x36 native window targets and render their glyphs at 12px.

- [ ] **Step 6: Verify GREEN and scan ownership boundaries**

Run:

```powershell
npx vitest run src/shared/icons/Icons.test.tsx src/features/navigation/NavigationRail.test.tsx src/features/settings/SettingsModal.test.tsx
npx tsc --noEmit
rg -n "pixel-icon|<svg|★|☆|↻|✕|＋|⧉" src -g "*.tsx" -g "*.css"
rg -n 'from "lucide-react"' src
```

Expected: tests/typecheck pass; the first scan only returns the data chart SVG or non-control factual content; the Lucide import scan returns only `src/shared/icons/Icons.tsx`.

- [ ] **Step 7: Commit Task 2**

```powershell
git add package.json package-lock.json src
git commit -m "feat: replace pixel controls with Galaxy icons"
```

---

### Task 3: Deep Black and Brilliant White Interface Theme

**Files:**
- Modify: `src/index.css`
- Modify: `src/features/terminal/terminalTheme.ts`
- Modify: `src/features/terminal/TerminalView.test.tsx`
- Modify: `src/features/insights/AgentDistribution.tsx`
- Modify: `src/features/statusbar/StatusBar.tsx`
- Modify: `index.html`
- Modify: `e2e/smoke.ui.spec.ts`
- Modify: `e2e/ime.ui.spec.ts`
- Modify: `e2e/insights.ui.spec.ts`

**Interfaces:**
- Consumes: exact color tokens and semantic exception rules from the approved design specification.
- Produces: a monochrome app chrome, matching terminal canvas, grayscale insight charts, and CSS series classes shared by Agent distribution bars and legends.

- [ ] **Step 1: Change the terminal test first**

Replace the existing palette assertions with:

```ts
it("uses the deep-space monochrome canvas while preserving ANSI semantics", () => {
  expect(GALAXY_THEME.background).toBe("#030405");
  expect(GALAXY_THEME.foreground).toBe("#f7f8f8");
  expect(GALAXY_THEME.cursor).toBe("#ffffff");
  expect(GALAXY_THEME.cursorAccent).toBe("#030405");
  expect(GALAXY_THEME.selectionBackground).toBe("#34383d");
  expect(GALAXY_THEME.red).not.toBe(GALAXY_THEME.green);
  expect(GALAXY_THEME.blue).not.toBe(GALAXY_THEME.cyan);
});
```

- [ ] **Step 2: Add failing UI color assertions**

In `smoke.ui.spec.ts`, assert `--space-0` is `#030405`, title bar background is `rgb(3, 4, 5)`, settings active background is `rgb(24, 27, 31)`, and its text is near-white. In `insights.ui.spec.ts`, assert heatmap levels 0/4 are `rgb(23, 26, 29)` and `rgb(238, 240, 241)`, trend stroke is `rgb(245, 246, 247)`, and each distribution bar segment matches its row marker.

- [ ] **Step 3: Run targeted tests and verify RED**

Run:

```powershell
npx vitest run src/features/terminal/TerminalView.test.tsx
npx playwright test e2e/smoke.ui.spec.ts e2e/insights.ui.spec.ts --project=ui
```

Expected: old charcoal/green values fail every new monochrome assertion.

- [ ] **Step 4: Replace the root palette and all routine hard-coded green**

Set the approved token values in `:root`, add `--status-success`, and make `--status-run` white. Replace direct green values in title bar, tabs, buttons, focus, rail, context sidebar, settings, loading, Git, selection, insights, and results with neutral tokens. Remove `--cyan-*` from application chrome. Preserve semantic green only on explicit success results.

Use the five literal heatmap levels and five neutral Agent series variables. In `AgentDistribution.tsx`, assign the same `agent-series-${index % 5}` class to each bar segment and corresponding row marker.

- [ ] **Step 5: Update terminal and design contract**

Apply the exact terminal values while retaining distinct ANSI red/green/yellow/blue/magenta/cyan colors. Replace the first-body design contract in `index.html` with:

```html
<!--
  THESIS: Galaxy Terminal is a black-space operating surface where brilliant white marks action and focus; it refuses colored dashboard chrome.
  OWN-WORLD: Near-black planes, neutral rules, soft-white text, one flat orbital-G mark, and rounded line icons with no glow or gradient.
  STORY: Developers scan live terminal, project, Git, Agent, and activity state without decorative color competing with terminal content.
  FIRST VIEWPORT: One title-bar brand anchors a compact rail, context panel, terminal or insights canvas, and optional inspector in one continuous dark field.
  FORM: User-pinned monochrome orbital instrument; seed 7d6e5872.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->
```

- [ ] **Step 6: Verify GREEN and perform a color scan**

Run:

```powershell
npx vitest run src/features/terminal/TerminalView.test.tsx
npx playwright test e2e/smoke.ui.spec.ts e2e/insights.ui.spec.ts --project=ui
rg -n "#67d9ad|#39b98a|#7ce5bd|#51cda0|#a7f3d0|#21302a|#17221e" src e2e index.html
npm run build
rg -n "7d6e5872" dist/index.html
```

Expected: tests/build pass; the retired routine colors do not appear; the emitted HTML retains the direction contract.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/index.css src/features/terminal src/features/insights/AgentDistribution.tsx src/features/statusbar/StatusBar.tsx index.html e2e
git commit -m "feat: apply monochrome Galaxy theme"
```

---

### Task 4: Migrate the Built-In Project Color Without Touching Custom Colors

**Files:**
- Modify: `src-tauri/src/core/models.rs`
- Modify: `src-tauri/src/services/persistence.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: affected Rust fixtures/tests
- Modify: affected frontend fixtures using the old built-in green

**Interfaces:**
- Consumes: schema v4 stores and the old built-in default `#39b98a`.
- Produces: schema v5 stores with `DEFAULT_PROJECT_COLOR = "#f5f6f7"`; all other project colors remain byte-for-byte unchanged.

- [ ] **Step 1: Add the failing v4-to-v5 migration test**

Add to persistence tests:

```rust
#[test]
fn migration_v4_replaces_only_the_previous_default_project_color() {
    let (_tmp, paths) = tmp_paths();
    let p = Persistence::new(paths).unwrap();
    let mut store = Store::default();
    store.schema_version = 4;
    store.projects = vec![project("old-default", "#39B98A"), project("custom", "#d04f4f")];

    let migrated = p.migrate(store).unwrap();

    assert_eq!(migrated.projects[0].color, "#f5f6f7");
    assert_eq!(migrated.projects[1].color, "#d04f4f");
    assert_eq!(migrated.schema_version, 5);
}
```

Use the existing project fixture shape rather than introducing a production helper solely for tests.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `cargo test --lib migration_v4_replaces_only_the_previous_default_project_color`

Expected: schema 4 is already current and old green is unchanged.

- [ ] **Step 3: Implement one stepwise migration**

Set `STORE_SCHEMA_VERSION` to 5 and `DEFAULT_PROJECT_COLOR` to `#f5f6f7`. Keep the v3-to-v4 purple migration intact. Add `PREVIOUS_DEFAULT_PROJECT_COLOR = "#39b98a"` and:

```rust
fn migrate_v4_to_v5(mut store: Store) -> Store {
    for project in &mut store.projects {
        if project.color.eq_ignore_ascii_case(PREVIOUS_DEFAULT_PROJECT_COLOR) {
            project.color = DEFAULT_PROJECT_COLOR.into();
        }
    }
    store.schema_version = 5;
    store
}
```

Register only `4 => migrate_v4_to_v5(store)` in the migration loop. Update default-color assertions and fixtures that intentionally represent the built-in color; leave custom-color fixtures unchanged.

- [ ] **Step 4: Verify GREEN and the full Rust library**

Run:

```powershell
cargo test --lib migration_v4_replaces_only_the_previous_default_project_color
cargo test --lib
cargo fmt -- --check
```

Expected: all migration and library tests pass, and formatting is clean.

- [ ] **Step 5: Commit Task 4**

```powershell
git add src-tauri/src src
git commit -m "feat: migrate default project color to white"
```

---

### Task 5: Finish Review, Design-System Record, Full Verification, and NSIS Package

**Files:**
- Modify: `DESIGN.md`
- Modify: `.impeccable/design.json`
- Modify: `docs/THIRD_PARTY_LICENSES.md`
- Modify: any test/CSS/component files required by reviewer findings
- Verify (git-ignored): `test-results/terminal-theme.png`
- Verify (git-ignored): `test-results/settings-theme-desktop.png`
- Verify (git-ignored): `test-results/settings-theme-narrow.png`
- Verify (git-ignored): `test-results/insights-desktop.png`
- Verify (git-ignored): `test-results/insights-narrow.png`
- Generate: `src-tauri/target/release/bundle/nsis/Galaxy Terminal_0.1.8_x64-setup.exe`

**Interfaces:**
- Consumes: completed Tasks 1-4 and the approved design specification.
- Produces: audited visual evidence, durable design-system documentation, license inventory, complete test evidence, and the Windows installer.

- [ ] **Step 1: Run the complete static and unit verification**

```powershell
npm run gen:icons
npm run test:icons
npx tsc --noEmit
npm test
npm run build
Set-Location src-tauri
cargo fmt -- --check
cargo test --locked
Set-Location ..
```

Expected: every command exits 0 with no failed tests.

- [ ] **Step 2: Run UI Playwright and capture both viewport classes in one pass**

Run: `npx playwright test --project=ui`

The smoke, terminal, settings, and insights specs must write the five named screenshots. Inspect desktop and narrow screenshots together for nonblank content, one visible brand mark, stable 16px icons, no overlaps, no green/purple routine chrome, and usable controls.

- [ ] **Step 3: Run the single Impeccable detector pass**

```powershell
node C:\Users\ethan\.agents\skills\impeccable\scripts\detect.mjs --json src\App.tsx src\index.css src\features src\shared\icons index.html
```

Fix mechanical findings in one batch, rerun the affected tests once, and do not run the detector a second time.

- [ ] **Step 4: Dispatch the fresh visual finish reviewer**

Provide the reviewer with the original request, approved option A, the design specification, `index.html` direction contract, all five screenshot paths, detector findings, and `C:\Users\ethan\.agents\skills\impeccable\reference\craft-floor.md`. Apply material findings in one batch, recapture the same viewports once, and obtain a verdict against every finding.

- [ ] **Step 5: Record the built design system**

Dispatch the fresh Impeccable documenter with the project root, `src/App.tsx`, the final direction contract, `PRODUCT.md`, and the final screenshots. Replace the obsolete cyan-green `DESIGN.md` and `.impeccable/design.json` with the built monochrome world: exact tokens, Starlight Rule, icon geometry, single-brand placement, grayscale data series, semantic exceptions, and terminal ANSI boundary.

- [ ] **Step 6: Refresh licenses and run the final source audit**

```powershell
npm run gen:licenses
rg -n "pixel-icon|rail-brand|IconLogo|#67d9ad|#39b98a|#7ce5bd|#51cda0|#a7f3d0" src public scripts index.html DESIGN.md .impeccable README.md
rg -n 'from "lucide-react"' src
git diff --check
```

Expected: no retired brand/pixel/routine green references; Lucide import appears only in `Icons.tsx`; generated license inventory includes `lucide-react`; diff check is clean.

- [ ] **Step 7: Build and exercise the desktop package**

```powershell
npm run tauri build
$env:GALAXY_APP_E2E = "1"
npx playwright test --project=app
Remove-Item Env:GALAXY_APP_E2E
```

Expected: Tauri build and app visual regression exit 0; the NSIS installer exists at the named path. Inspect the final ICO/PNG and app screenshot for transparent rounded corners and the same orbital-G geometry used by the title bar.

- [ ] **Step 8: Request whole-branch code review and resolve findings**

Generate a review package from commit `8f0f7c6` through current HEAD. Ask a fresh reviewer to evaluate the approved specification requirement-by-requirement, with emphasis on duplicate assets, icon accessibility, semantic color exceptions, persistence migration safety, responsive screenshots, and packaging. Apply one consolidated fix wave for Critical/Important findings and run one scoped re-review.

- [ ] **Step 9: Commit finish artifacts**

```powershell
git add DESIGN.md .impeccable/design.json docs/THIRD_PARTY_LICENSES.md src public scripts e2e index.html package.json package-lock.json src-tauri/src src-tauri/icons README.md docs/RELEASE.md
git commit -m "chore: verify and package monochrome Galaxy client"
```

- [ ] **Step 10: Start the local preview for user inspection**

Start `npm run dev` on the fixed Vite port 1420 after confirming the port is free. Keep the server running and report `http://localhost:1420` plus the absolute installer path.
