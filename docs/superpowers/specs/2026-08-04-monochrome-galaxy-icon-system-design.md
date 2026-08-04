# Galaxy Terminal Monochrome Brand and Icon System

## Status

- Date: 2026-08-04
- Direction: approved by the user (option A)
- Implementation: pending review of this specification

## Intent

Galaxy Terminal should read as a deep-space instrument: nearly black surfaces, brilliant white controls, and restrained neutral tones. The interface must not use green or purple as routine decoration. Product branding must have one source of truth, and every operation icon must share one geometry, stroke, and interaction language.

The design references the bold, geometric simplicity of modern AI products such as Grok without copying any existing mark. The Galaxy mark is original and must remain recognizable at title-bar and taskbar sizes.

## Brand placement

The title bar is the only in-app brand entry. It displays the Galaxy mark and the product name. The navigation rail starts with its first destination and does not repeat a brand mark. This removes the current title-bar raster/rail SVG mismatch and leaves more room for destinations on narrow windows.

All product surfaces use the same master mark:

- title bar and app shell;
- browser favicon and Apple touch icon;
- Tauri window, taskbar, installer, and updater assets.

No old `logo.png`, `logo.svg`, `logo-master.png`, or procedural logo variant may remain as an authored source. Generated raster files are outputs only.

## Galaxy mark

Create `public/brand/galaxy-mark.svg` as the authored master:

- a deep-black rounded-square/squircle field with transparent outside corners;
- one brilliant-white continuous orbital stroke forming an abstract `G` and a small terminal-like opening;
- rounded line caps and joins;
- flat fills/strokes only;
- no gradient, glow, texture, star field, bevel, or drop shadow;
- sufficient negative space to remain legible at 16px;
- viewBox `0 0 64 64` and no embedded raster data.

The component used in React should render this exact source, not redraw a second approximation. Tauri and web assets are generated from the same SVG. The visible app mark is the same at every size; only the surrounding optical size changes.

## Color system

### Brand and routine UI

```text
--space-0: #030405
--space-1: #050607
--space-2: #0a0c0e
--space-3: #111418
--space-4: #1b1f23

--text-hi: #f7f8f8
--text-md: #c6c9cc
--text-lo: #8b9196

--bg-input: #07090b
--border-subtle: #24282c
--border-strong: #3d4349

--focus-ring: #ffffff
--accent-soft: #ffffff
--accent-main: #f5f6f7
--accent-deep: #d9dde0
--accent-muted: #181b1f
--accent-surface: #202429
--accent-border: #4c5258
```

Routine navigation, tabs, buttons, selections, focus, loading, Git context, and active terminal state use only this black/white/gray system. Pure white is reserved for the mark, primary focus, cursor, and highest-intensity data; body text uses the softer white/gray values to reduce glare.

### Semantic exceptions

```text
--status-run: #f5f6f7
--status-success: #5bd6a2
--status-blocked: #f2bd65
--status-error: #ff667f
```

Success green, amber, and red are allowed only when they communicate an explicit result or exception. They must not be used for routine active controls, navigation, focus, Git branch decoration, or loading animation.

### Data visualization

Activity heatmap levels use a five-step grayscale ramp:

```text
level-0 #171a1d
level-1 #2a2e32
level-2 #4d5358
level-3 #858b91
level-4 #eef0f1
```

Trend lines use `#f5f6f7`; data points use a white outline; baselines use `#2a2e32`. Agent distribution bars use shared grayscale series tokens so the bar and its legend row cannot drift.

### Terminal exception

The terminal canvas, foreground, cursor, cursor accent, and selection become monochrome:

```text
background #030405
foreground #f7f8f8
cursor #ffffff
cursorAccent #030405
selectionBackground #34383d
```

ANSI colors emitted by shells remain colored because they are terminal-content semantics, not Galaxy chrome.

## Operation icon system

Use `lucide-react` for familiar controls. Feature modules import semantic Galaxy names only from `src/shared/icons/Icons.tsx`; they never import Lucide directly and never add one-off control SVGs. The adapter is the ownership boundary where size, stroke, and accessibility defaults are enforced.

Icon rules:

- 24x24 coordinate grid;
- default rendered size 16px, compact inline size 12-13px;
- `currentColor` only;
- default `strokeWidth=1.8`;
- round line caps and joins;
- no pixelation or crisp-edge rendering;
- minimum icon-only button hit area 28x28px (24x24px for dense window controls);
- every icon-only control has an accessible name and a tooltip where the meaning is not obvious.

Semantic mapping:

| Galaxy name | Lucide icon |
| --- | --- |
| Terminal | `SquareTerminal` |
| Insights | `ChartNoAxesColumnIncreasing` |
| History | `History` |
| Sidebar | `PanelLeft` |
| Agent | `Bot` |
| Git | `GitBranch` |
| Notifications | `Bell` |
| Settings | `Settings` |
| Folder | `Folder` |
| Sessions | `PanelsTopLeft` |
| Plus | `Plus` |
| Close | `X` |
| Copy | `Copy` |
| Favorite | `Star` (filled when active) |
| SplitRight | `Columns2` |
| SplitDown | `Rows2` |
| Move | `MoveRight` |
| SyncInput | `RadioTower` |
| Prompt | `ChevronRight` |
| Refresh | `RefreshCw` |
| Rerun | `RotateCcw` |
| Play | `Play` |
| Alert | `TriangleAlert` |
| Minimize | `Minus` |
| Maximize | `Square` |
| Restore | overlapping-square adapter |
| ChevronUp/Down | `ChevronUp` / `ChevronDown` |

Replace operation glyphs such as plus, x, rotate, star, and copy characters with these adapters. Decorative data marks may remain CSS or chart geometry when they are not controls. The chart SVG in `ActivityTrend` remains data visualization, not an operation icon.

## Layout and component behavior

The rail remains 56px wide. Active navigation uses a neutral raised surface and a white leading indicator; it does not depend on hue. Title-bar and rail controls share the same icon sizing and focus ring. Existing dense layouts, PTY lifecycles, workspace state, and IPC contracts remain unchanged.

Project colors supplied by users are preserved. The built-in default green project color migrates to the new white/gray default through one explicit store migration and does not overwrite custom colors.

## Asset generation

The icon generation script must consume `public/brand/galaxy-mark.svg` and produce the web and Tauri raster/ICO outputs. It must not contain a second procedural drawing algorithm. Generated files are reproducible from the SVG and checked for required sizes, transparency, and no purple/green pixels in the brand mark.

## Verification gates

Before the implementation is considered complete:

1. `npx tsc --noEmit`, Vitest, and `npm run build` pass.
2. UI Playwright covers title-bar/rail brand count, icon accessible names, terminal theme values, settings active states, and grayscale insights colors.
3. Screenshots are captured at desktop and narrow viewports for terminal, settings, and insights; no green/purple routine UI remains.
4. The final source scan finds no `.pixel-icon`, authored duplicate Logo source, or operation glyphs in controls.
5. `npm run tauri build` succeeds and the NSIS installer contains the generated monochrome icon set.
