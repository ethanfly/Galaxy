# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Galaxy Terminal serves developers who work across multiple repositories, terminal sessions, and coding agents on Windows 10 or 11. Their primary job is to keep concurrent work visible, move between projects without losing context, and understand what has happened across terminal and Agent activity.

## Product Purpose

Galaxy Terminal is a commercial multi-terminal desktop workspace. It combines projects, persistent terminal layouts, command history, Git state, workflows, notifications, and read-only views of coding Agent conversations. Success means users can operate several workstreams quickly, recognize active or blocked work, resume prior context, and recover their workspace after restart.

## Positioning

The product's distinguishing mechanism is a Rust-owned workspace model that joins real PTY lifecycles and replayable terminal output with project, command-block, Git, and multi-Agent context in one desktop application. The webview renders this state but does not own persisted business truth.

## Operating Context

- Windows desktop development with PowerShell, pwsh, cmd, Git Bash, or WSL terminals.
- Repeated switching among projects, terminal sessions, panes, Git state, and Agent conversations.
- Long-running Agent tasks whose working, blocked, done, and idle states must remain visible.
- Local command history and application-owned statistics derived from persisted command blocks.
- Keyboard-heavy operation, window resizing, split terminals, and application restart recovery.

## Capabilities and Constraints

- Tauri 2 Rust backend with React, TypeScript, Zustand, and xterm.js frontend.
- Rust is the single source of truth for persisted state and PTY lifecycles.
- Frontend IPC calls are narrow, typed wrappers; no generic filesystem or process access is exposed.
- Agent-owned files and databases are always opened read-only.
- PTY output uses per-pane batching, sequence tracking, ring-buffer replay, and truncation recovery.
- Command blocks retain at most 500 non-favorites; favorites are never silently discarded.
- Persisted writes are atomic and failures degrade to application read-only mode.
- The statistics surface reports factual activity and does not infer a productivity score.
- No remote analytics service, keyboard-content telemetry, or cross-device statistics sync is part of the product.

## Brand Commitments

- Product name: Galaxy Terminal.
- The application identity and logo remain recognizable during interface redesigns.
- User-facing application copy supports Simplified Chinese and English.
- The product voice is concise, operational, and factual rather than promotional.

## Evidence on Hand

- Authoritative architecture and product design: `docs/superpowers/specs/2026-07-30-galaxy-terminal-design.md`.
- Confirmed workspace and insights redesign: `docs/superpowers/specs/2026-08-04-workspace-insights-redesign.md`.
- Existing application icon and generated icon assets under `public/` and `src/shared/icons/`.
- Real local activity data is available through application-owned `blocks.jsonl` command blocks.
- No testimonials, customer logos, productivity benchmarks, or remote usage evidence may be fabricated.

## Product Principles

1. Preserve terminal speed and continuity before adding secondary capability.
2. Show real state and explain uncertainty rather than inventing precision.
3. Keep backend ownership and narrow security boundaries visible in architecture decisions.
4. Let individual Agent, Git, or PTY failures degrade locally instead of blocking the workspace.
5. Make repeated keyboard and scanning workflows efficient at desktop information density.

## Accessibility & Inclusion

Core workflows must be keyboard accessible. Focus, text, controls, and status presentation meet WCAG AA; state is not conveyed by color alone. The UI supports Simplified Chinese and English, stable layout under dynamic content, reduced motion, and up to 200% UI scaling without overlap.
