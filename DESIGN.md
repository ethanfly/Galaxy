---
name: Galaxy Terminal
description: A monochrome operating surface for terminals, agents, and local activity intelligence.
colors:
  abyss-black: "#030405"
  app-black: "#050607"
  input-black: "#07090b"
  panel-black: "#0a0c0e"
  hover-graphite: "#111418"
  active-graphite: "#181b1f"
  raised-graphite: "#1b1f23"
  selected-graphite: "#202429"
  subtle-rule: "#24282c"
  strong-rule: "#3d4349"
  active-rule: "#4c5258"
  quiet-gray: "#8b9196"
  secondary-gray: "#c6c9cc"
  soft-silver: "#d9dde0"
  active-white: "#f5f6f7"
  interface-white: "#f7f8f8"
  brilliant-white: "#ffffff"
  success-green: "#5bd6a2"
  warning-amber: "#f2bd65"
  error-red: "#ff667f"
typography:
  micro:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "9px"
    fontWeight: 400
    letterSpacing: "0"
  compact:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    letterSpacing: "0"
  ui:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0"
  headline:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 620
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    letterSpacing: "0"
  label:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0"
  data:
    fontFamily: "Cascadia Mono, JetBrains Mono, Microsoft YaHei UI, monospace"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0"
  control:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "0"
  emphasis:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "0"
  metric:
    fontFamily: "Cascadia Mono, JetBrains Mono, Microsoft YaHei UI, monospace"
    fontSize: "21px"
    fontWeight: 600
    letterSpacing: "0"
  empty:
    fontFamily: "Segoe UI, Microsoft YaHei UI, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 400
    letterSpacing: "0"
rounded:
  cell: "1px"
  state: "2px"
  control: "3px"
  navigation: "4px"
  overlay: "5px"
  scroll: "6px"
spacing:
  hairline: "1px"
  tight: "4px"
  control: "8px"
  region: "28px"
  rail: "56px"
components:
  button-primary:
    backgroundColor: "{colors.active-white}"
    textColor: "{colors.abyss-black}"
    rounded: "{rounded.control}"
    padding: "5px 12px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.secondary-gray}"
    rounded: "{rounded.control}"
    size: "28px"
  segmented-selected:
    backgroundColor: "{colors.selected-graphite}"
    textColor: "{colors.brilliant-white}"
    rounded: "{rounded.control}"
    height: "26px"
  field:
    backgroundColor: "{colors.input-black}"
    textColor: "{colors.interface-white}"
    rounded: "{rounded.control}"
    height: "30px"
  navigation-active:
    backgroundColor: "{colors.active-graphite}"
    textColor: "{colors.brilliant-white}"
    rounded: "{rounded.navigation}"
    size: "38px"
---

# Design System: Galaxy Terminal

## Overview

**Creative North Star: "The Monochrome Observatory"**

Galaxy Terminal is a deep-black operating field cut by brilliant-white signals. It should feel like looking through a precisely calibrated observatory instrument: expansive and unmistakably galactic, but flat, quiet, and operational rather than decorative.

Terminal and insights surfaces share one continuous dark plane. Hierarchy comes from measured grayscale steps, fine rules, white focus, and exact data typography. A single flat orbital-G mark anchors the title bar; rounded Lucide line icons carry every familiar action without competing with the work.

**Key Characteristics:**

- Near-black planes with brilliant-white active and focus states.
- A single flat orbital-G brand mark in the title bar only.
- Rounded Lucide line icons mapped by product meaning.
- Dense analytical layouts separated by fine neutral rules.
- Semantic green, amber, and red reserved for outcome states.

## Colors

The routine interface is strictly monochrome. Five near-black surfaces and a silver-to-white text ramp create depth without a colored theme accent.

**The White Signal Rule.** Brilliant white and neutral silver are the only routine accent colors for selection, focus, navigation, charts, and primary actions.

**The Semantic Color Rule.** Green means success, amber means warning or blocked, and red means error or danger. These hues never decorate neutral controls or establish the brand.

**The No Legacy Accent Rule.** Purple, violet, cyan-green, and the previous signal-green palette are prohibited as regular theme colors, gradients, glows, or selected-state fills.

## Typography

**Display Font:** Segoe UI with Microsoft YaHei UI fallback  
**Body Font:** Segoe UI with Microsoft YaHei UI fallback  
**Label/Mono Font:** Cascadia Mono with JetBrains Mono fallback

Interface type is compact, neutral, and naturally spaced. The implemented scale uses 9px micro marks, 10px dense metadata, 11px labels and data, 12px secondary interface text, 13px body text, 14px controls and section titles, 15px empty-state emphasis, 21px metrics, 24px workspace headlines, and 42px empty-workspace symbols. Monospace is reserved for commands, paths, durations, counts, timestamps, and ranked measurements.

**The Natural Spacing Rule.** Default letter spacing is zero. Hierarchy comes from weight, size, alignment, and whitespace rather than tracked labels.

## Layout

The application uses a persistent 56px navigation rail, an optional 220px context sidebar, a flexible main stage, and an optional 340px inspector. The 36px title bar spans the window, and the 26px status bar closes the shared operating field.

Analytical regions form a two-column asymmetric grid at desktop widths; primary time-series regions span both columns. Below 1280px the inspector overlays. Below 900px the context sidebar overlays and insights collapse to one column. Settings become a horizontal chapter strip below 900px and stack form rows below 600px. Dense visualizations scroll rather than shrink below legibility.

## Elevation & Depth

Surfaces are flat by default. Depth is expressed through tonal black steps and one-pixel neutral rules. Shadows appear only on modals, tooltips, find bars, and responsive overlay panels where they clarify stacking.

**The Flat Observatory Rule.** Never add resting card shadows, luminous halos, glass blur, or floating dashboard tiles to the main canvas.

## Shapes

The authored brand asset is a rounded black square containing one white orbital-G stroke. It appears once in application chrome, at the left of the title-bar name.

Controls remain compact: activity cells use 1px rounding, status marks and tags use 2px, controls use 3px, navigation uses 4px, modal surfaces use 5px, and scrollbar thumbs use 6px. Lucide icons use a 24px source grid, 1.8 stroke weight, rounded line caps, and rounded joins. Pill shapes are reserved for true status or segmented-selection semantics.

## Components

### Buttons

Primary buttons invert the field with active white on abyss black. Ghost and icon buttons are transparent at rest, move to hover graphite on interaction, and use a two-pixel white focus outline. Danger remains red and is never reused as decoration.

### Inputs / Fields

Fields use input black, a one-pixel strong neutral rule, 3px corners, and a 30px default height. Focus uses a white border plus an external white ring so dimensions never jump.

### Iconography

All operation icons come through the semantic adapter in `src/shared/icons/Icons.tsx`. It wraps Lucide icons with `currentColor`, a 24px source grid, 1.8 stroke weight, and the shared `galaxy-icon` class. Feature components do not draw substitute SVGs or use Unicode glyphs as operation icons.

The semantic set is: SquareTerminal for terminal, ChartNoAxesColumnIncreasing for insights, History for history, PanelLeft for workspace context, Bot for agents, GitBranch for Git, Bell for notifications, Settings for settings, Folder for project paths, PanelsTopLeft for sessions, Plus for add, X for close, Copy for copy and window restore, Columns2 and Rows2 for pane splits, MoveRight for moving panes, RadioTower for synchronized input, ChevronRight for the prompt, RefreshCw for refresh, RotateCcw for rerun, Play for run, TriangleAlert for blocked or alert, Minus and Square for native window controls, ChevronUp and ChevronDown for search traversal, Check for confirmation, Trash2 for delete, and Star for favorite.

Icons are decorative inside named buttons and remain hidden from assistive technology; the owning button supplies the localized accessible name.

### Brand

`public/brand/galaxy-mark.svg` is the single authored brand source. The visible application mark appears only in the title bar beside the product name. The navigation rail never repeats it. Browser, installer, and Tauri raster assets are generated from the same SVG master.

### Navigation

The rail is icon-led and 56px wide. Active destinations use active graphite, brilliant-white icon color, and a narrow white leading indicator. The title bar owns the terminal/insights mode switch; navigation and title-bar controls point to the same workspace state.

### Terminal

The terminal uses abyss black (`#030405`) with interface white (`#f7f8f8`), a brilliant-white cursor (`#ffffff`), abyss-black cursor contrast, and graphite selection (`#34383d`). ANSI normal colors are black `#101415`, red `#ff667f`, green `#5bd6a2`, yellow `#f2bd65`, blue `#78b7c9`, magenta `#d9899e`, cyan `#70d7e8`, and white `#c6c9cc`. Bright colors are black `#60666c`, red `#ff7d93`, green `#83e5ba`, yellow `#ffd07f`, blue `#b1dce5`, magenta `#ffb4c2`, cyan `#a9edf5`, and white `#ffffff`.

Terminal ANSI hues represent shell content only. They do not become routine application accents.

### Activity Heatmap

Cells remain fixed at 11px with 3px gaps and seven rows per week. Five monochrome levels progress from `#171a1d` through `#2a2e32`, `#4d5358`, and `#858b91` to `#eef0f1`. Keyboard navigation follows days horizontally and weeks vertically.

## Do's and Don'ts

### Do:

- **Do** use white, silver, and graphite to communicate routine hierarchy and interaction.
- **Do** use the shared Lucide semantic adapter for every familiar operation icon.
- **Do** keep exactly one visible brand mark in the title bar.
- **Do** reserve green, amber, and red for success, warning or blocked, and error or danger.
- **Do** preserve fixed heatmap density and keep terminal instances mounted across workspace views.

### Don't:

- **Don't** restore purple, violet, cyan-green, or signal-green as a regular theme accent.
- **Don't** add gradients, glow, star fields, texture, or decorative pixel motion.
- **Don't** duplicate the Galaxy mark in the navigation rail or feature panels.
- **Don't** draw one-off operation SVGs or use emoji and Unicode symbols in place of shared icons.
- **Don't** nest cards inside cards or turn analytical sections into floating tiles.
