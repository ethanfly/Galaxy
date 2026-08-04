---
name: Galaxy Terminal
description: A precision workspace for terminals, agents, and local activity intelligence.
colors:
  instrument-black: "#080a0b"
  workspace-charcoal: "#0b0e0f"
  panel-charcoal: "#101415"
  raised-charcoal: "#161b1c"
  signal-green: "#67d9ad"
  signal-green-soft: "#a7f3d0"
  cool-white: "#edf3f0"
  secondary-text: "#aab4af"
  quiet-text: "#737e79"
  fine-rule: "#252c2d"
  warning-amber: "#f5b754"
  error-red: "#ef5470"
typography:
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
rounded:
  cell: "1px"
  control: "3px"
  surface: "4px"
spacing:
  hairline: "1px"
  tight: "4px"
  control: "8px"
  region: "28px"
  canvas: "56px"
components:
  segmented-selected:
    backgroundColor: "#21302a"
    textColor: "#c9f9e6"
    rounded: "{rounded.control}"
    height: "26px"
  field:
    backgroundColor: "#0b0f10"
    textColor: "{colors.cool-white}"
    rounded: "{rounded.control}"
    height: "30px"
  navigation-active:
    backgroundColor: "#17221e"
    textColor: "{colors.signal-green}"
    rounded: "{rounded.surface}"
    size: "38px"
---

# Design System: Galaxy Terminal

## Overview

**Creative North Star: "The Precision Instrument Bench"**

Galaxy Terminal feels like a calibrated desktop instrument paired with a technical publication grid. It is dense without being cramped: hierarchy comes from alignment, fine rules, measured whitespace, and data typography rather than decoration or oversized containers.

The system is restrained, local-first, and operational. Terminal and insights surfaces belong to one continuous workbench. The discarded visual anti-reference is the old cosmic/pixel atmosphere: no star fields, purple glow, gratuitous gradients, or card mosaics.

**Key Characteristics:**

- Charcoal materials with one cyan-green signal color.
- Continuous analytical canvases separated by fine rules.
- Compact controls, exact data columns, and flat navigation.
- Monospaced numbers and commands; humanist system type for interface copy.

## Colors

The palette is cool, low-chroma, and technical; signal green is reserved for selection, activity, success, and focus.

**The One Signal Rule.** Cyan-green is the only routine accent. Amber and red communicate exceptional warning and failure states, never decoration.

## Typography

**Display Font:** Segoe UI with Microsoft YaHei UI fallback  
**Body Font:** Segoe UI with Microsoft YaHei UI fallback  
**Label/Mono Font:** Cascadia Mono with JetBrains Mono fallback

Interface type stays quiet and naturally spaced. Mono is reserved for commands, durations, counts, timestamps, and ranked measurements.

**The Natural Spacing Rule.** Do not add tracking to headings, labels, tabs, or buttons. Structure must come from grid and weight.

## Layout

The application uses a persistent 56px navigation rail, an optional 220px context sidebar, a flexible main stage, and an optional 340px inspector. Analytical regions form a two-column asymmetric grid at desktop widths; primary time-series regions span both columns. At widths below 1280px the inspector overlays, and below 900px the context sidebar overlays while insights collapse to one column. Dense visualizations scroll rather than shrink below legibility.

## Elevation & Depth

Surfaces are flat by default. Depth is expressed through tonal steps and one-pixel borders. Shadows appear only on transient overlay panels and tooltips, where they clarify stacking rather than create atmosphere.

**The Flat Workbench Rule.** Never add resting card shadows or floating dashboards inside the main canvas.

## Shapes

Geometry is compact and nearly square. Data cells use 1px rounding, controls use 3px, and small navigation surfaces use 4px. Larger pill shapes are reserved for true status or segmented selection semantics.

## Components

### Buttons

Ghost buttons are flat at rest, receive a charcoal tonal shift on hover, and use a one-pixel green focus outline. Selected segmented controls use a deep green surface with pale green text.

### Inputs / Fields

Fields use an instrument-black fill, a one-pixel strong rule, 3px corners, and 30px height. Focus is an external one-pixel green outline so dimensions never jump.

### Navigation

The rail is icon-led and 56px wide. Active items use a subdued green field plus a narrow leading indicator. The title bar owns the terminal/insights mode switch; both controls point to the same workspace state.

### Activity Heatmap

Cells are fixed at 11px with 3px gaps and seven rows per week. Five tonal activity levels progress from raised charcoal to signal green. Keyboard navigation follows days horizontally and weeks vertically.

## Do's and Don'ts

### Do:

- **Do** use fine rules and alignment to define analytical regions.
- **Do** preserve fixed density for heatmaps and scroll them on narrow screens.
- **Do** keep terminal instances mounted when switching workspace modes.

### Don't:

- **Don't** restore stars, purple glow, gradients, or decorative pixel motion.
- **Don't** nest cards inside cards or turn every statistic into a rounded container.
- **Don't** use filled progress tracks for scores or rankings; prefer exact values and thin measures.
