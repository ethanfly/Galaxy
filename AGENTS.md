# AGENTS.md

Guidance for AI agents working in the Galaxy Terminal codebase.

## Project overview

Galaxy Terminal is a commercial multi-terminal desktop workspace for developers and multi-agent workflows. It is a Tauri 2 application: a Rust backend owns all persisted state and PTY lifecycles, a React/TypeScript frontend renders the UI via xterm.js. Target platform is Windows 10/11 (macOS/Linux are architecturally预留 via platform abstractions but not yet implemented).

The design spec at `docs/superpowers/specs/2026-07-30-galaxy-terminal-design.md` is the authoritative reference. Code comments frequently cite it by section (e.g. "spec §5.4").

## Essential commands

```bash
# Install dependencies
npm install

# Dev: Vite + Rust hot reload (Tauri dev server on port 1420)
npm run tauri dev

# Frontend production build only
npm run build

# Full desktop installer (NSIS .exe)
npm run tauri build
# → src-tauri/target/release/bundle/nsis/*-setup.exe

# Frontend unit tests (Vitest jsdom + node --test icon gen tests)
npm test
npm run test:watch

# TypeScript type check (no emit; app/prod sources only, excludes tests)
npm run typecheck

# Rust tests (run from src-tauri/)
cargo test --lib                              # unit tests
cargo test --test pty_integration --test services_integration  # integration
cargo test --locked                           # CI-equivalent (respects lockfile)

# E2E (Playwright)
npx playwright test --project=ui               # mocked Tauri, runs anywhere
GALAXY_APP_E2E=1 npx playwright test --project=app  # full app, needs built binary

# Code generation / version
npm run gen:icons        # regenerate icon set (programmatic fallback if no master)
npm run gen:licenses      # third-party license manifest
npm run version:show      # print current version
npm run version:patch     # bump patch (syncs package.json + Cargo.toml + tauri.conf.json)
```

CI runs on `windows-latest` with Node 22 and stable Rust (`x86_64-pc-windows-msvc`). The test workflow (`.github/workflows/test.yml`) runs `npm run typecheck`, `npm test`, `npm run build`, and Playwright UI specs on every push/PR to `main`. Rust CI runs `cargo test --locked` from `src-tauri/`.

## Architecture

### Two-process model

```
React UI (Vite, port 1420)
    ↕ Tauri IPC (typed commands + events)
Rust backend (Tauri 2)
    ↓ ConPTY / portable-pty
Shells: PowerShell · pwsh · cmd · Git Bash · WSL
```

The Rust backend is the **single source of truth** for all persisted state. The React frontend uses Zustand stores as short-lived caches that mirror backend data — it never owns business truth.

### Rust backend (`src-tauri/src/`)

| Module | Responsibility |
|---|---|
| `lib.rs` | App assembly: plugin registration, single-instance, global hotkey, window lifecycle |
| `state.rs` | `AppState` — central state hub, `PtyEventSink` impl that bridges PTY events to Tauri events |
| `commands/` | Whitelisted Tauri commands (no generic fs/process access exposed to WebView) |
| `core/` | Domain models, recursive layout tree, config, workflows, triggers |
| `pty/` | PTY backend trait, portable-pty (ConPTY) impl, batched output, ring buffer, stream decoder, block tracker |
| `services/` | Agent adapters (21), Git, blocks, persistence, shell detection, logging, diagnostics, paths |
| `platform/` | CLI args, Windows registry (context menu), window state clamping |
| `error.rs` | Unified `AppError` → `CmdError` with machine-readable codes |

Key architectural patterns:

- **PTY output pipeline** (`pty/manager.rs`): Each pane has its own PTY reader thread. Output is collected per-pane and merged into batched `OutputBatch` IPC events within an 8ms scheduling window. Keyboard input, resize, and signals bypass batching. Each pane has a `RingBuffer` (1MB / 2048 chunks) with monotonically increasing sequence numbers. The frontend detects sequence gaps and requests `pty_replay`; if the range was evicted, a truncation marker is shown.

- **Stream decoding** (`pty/decode.rs`): `StreamDecoder` handles split multi-byte UTF-8 sequences across `read()` calls and falls back to GB18030 (GBK superset) for Chinese Windows PowerShell 5.1 / cmd. Pure UTF-8 streams (pwsh 7, Git Bash) stay on the UTF-8 path.

- **Command block extraction** (`pty/tracker.rs`): Uses OSC 133 shell integration marks when available, otherwise a heuristic idle-flush (900ms) to finalize blocks. OSC 0/2 titles are captured and basename-simplified. A rolling 16KB plain-text tail feeds agent status inference and trigger evaluation.

- **Agent adapters** (`services/agents/`): 21 adapters implement the `AgentAdapter` trait (scan, read_messages, resume_command, availability). All agent files and SQLite DBs are opened **read-only** — agent-owned history is never modified. Format drift, DB locks, or missing runtimes degrade to "unavailable," never fatal. The `AgentRegistry` supports incremental scanning via per-project watermarks and a cancellation token for UI responsiveness.

- **Persistence** (`services/persistence.rs`): Atomic write (serialize → temp → flush+sync → rename → backup copy). Load falls back: main → backup → defaults. Corrupted files are moved aside (`.corrupt-<ts>`), never overwritten. Stepwise schema migrations run version N → N+1.

- **Error handling** (`error.rs`): `AppError` is the internal error enum. All Tauri commands return `CmdResult<T>` = `Result<T, CmdError>` where `CmdError` has a machine-readable `code` and user-facing `message` (Chinese). No Rust stack traces reach the UI. Use the `.cmd()` extension (`IntoCmd` trait) to convert `Result<_, AppError>` → `CmdResult`.

### React frontend (`src/`)

| Directory | Responsibility |
|---|---|
| `App.tsx` | Root: global IPC event wiring, layout composition |
| `features/` | Feature modules: terminal, panels, search, settings, tabs, titlebar, statusbar, insights, workflow, recovery, shortcuts, navigation |
| `shared/ipc/` | Typed IPC client (`client.ts`), event subscriptions (`events.ts`), shared types (`types.ts`) |
| `shared/stores/` | Zustand stores: `appStore` (business cache), `terminalStore` (runtime), `uiStore` (UI state) |
| `shared/i18n.ts` | zh-CN / en-US string switcher |
| `shared/components/` | Reusable UI components (Modal) |
| `shared/icons/` | Pixel-art SVG icon set |

Key frontend patterns:

- **IPC client** (`shared/ipc/client.ts`): Every Tauri command has exactly one typed wrapper here. All calls go through `call<T>()` which wraps `invoke` and converts errors to `IpcError`. Never call `invoke` directly — add a wrapper here.

- **Event subscriptions** (`shared/ipc/events.ts`): Mirrors the Rust `events` module in `state.rs`. Event names use `protocol://topic` format (e.g. `pty://output`, `agent://status`). All global event listeners are wired in `App.tsx` root effect with StrictMode-safe cleanup (async `listen()` promises must cancel if the effect cleaned up before resolving, otherwise duplicate listeners cause double-painted keystrokes).

- **Stores**: `appStore` is a business-state cache that refreshes from backend commands. `terminalStore` holds runtime terminal state (sequence tracking, xterm instance registry, agent status, activity pulses). The xterm instance registry is a non-reactive `Map<string, TerminalHandle>` outside Zustand to avoid re-renders on every PTY byte.

### IPC contract

Commands are registered in `commands/mod.rs` via the `all_commands!()` macro. Every command must be listed there. The frontend `client.ts` must have a matching typed wrapper.

Event names are defined in `state.rs::events` (Rust) and mirrored in `shared/ipc/events.ts` (TS). If you add an event, update both.

### Data flow example: typing in a terminal

1. xterm `onData` → `ptyWrite(paneId, data)` IPC command
2. Rust `pty_cmds::pty_write` → `PtyManager::write(paneId, data)` → writes to ConPTY
3. PTY reader thread reads bytes → `StreamDecoder::push` (UTF-8/GB18030) → `PaneTracker` (OSC parse, block extract, tail) → batched into `OutputBatch`
4. `PtyEventSink::output` (impl in `state.rs::Sink`) → `app.emit("pty://output", batch)`
5. Frontend `onPtyOutput` listener → `terminalStore.ingest(chunks)` → sequence gap detection → `terminalFor(paneId).write(data)` → xterm renders

## Conventions

### Rust

- **Formatting**: `rustfmt.toml` — edition 2021, max_width 100. Run `cargo fmt`.
- **Serde**: All structs shared with the frontend use `#[serde(rename_all = "camelCase")]`. This is critical — the frontend expects camelCase keys.
- **Error pattern**: Internal code returns `Result<_, AppError>`. Tauri commands convert with `.cmd()` (the `IntoCmd` trait). Error codes are uppercase SCREAMING_SNAKE (e.g. `NOT_FOUND`, `PTY`, `GIT_CHECKOUT_CONFLICT`).
- **State access**: Commands receive `State<'_, Arc<AppState>>`. The `AppState` holds `RwLock<Store>`, `BlockStore`, `GitService`, `AgentRegistry`, etc. Use `parking_lot::RwLock` (not `std::sync::RwLock`).
- **Logging**: Structured `tracing` macros. User paths and terminal content are **redacted** via `logging::redact()` before logging. Logs roll at 2MB, max 5 files.
- **IDs**: `new_id()` returns UUID v4 strings. Timestamps use `now_rfc3339()`.
- **Windows-specific code**: Guard with `#[cfg(windows)]`. Git subprocess creation uses `CREATE_NO_WINDOW` flag (0x08000000) to avoid console flash.
- **Path normalization**: `dunce_canonicalize` strips the `\\?\` UNC prefix from canonicalized Windows paths. Agent path matching normalizes to backslash and case-insensitive comparison.
- **Sanitized cwd**: Claude/OMP use a convention where `:` and `\` in paths are replaced with `-` (see `agents::sanitize_cwd`).

### TypeScript / React

- **Strict mode**: `tsconfig.json` has `"strict": true`. Path alias `@/*` → `src/*` (though imports use relative paths in practice).
- **State**: Zustand stores. Business state is a cache of backend truth — never mutate locally without a backend call. UI-only state (panel open/close, modal visibility) goes in `uiStore`.
- **IPC**: Always use the typed wrappers in `shared/ipc/client.ts`. Never call `invoke` directly from feature code.
- **i18n**: All user-visible strings go through `t()` from `shared/i18n.ts`. The default language is `zh-CN`. Add new keys to the `dict` object in `i18n.ts`.
- **Tests**: Vitest with jsdom. Setup in `src/test-setup.ts`. Tauri API is mocked via `src/shared/__mocks__/@tauri-apps/api/`. Test files use `*.test.ts` / `*.test.tsx` in `src/`.
- **E2E**: Playwright specs in `e2e/`. `*.ui.spec.ts` runs with mocked Tauri (injects init script). `*.app.spec.ts` runs against the full built app (needs `GALAXY_APP_E2E=1` and a built binary).

## Testing

| Layer | Command | What it covers |
|---|---|---|
| Rust unit | `cargo test --lib` (from `src-tauri/`) | Layout, migrations, shell detection, agent probe, block extraction, decoder |
| Rust integration | `cargo test --test pty_integration --test services_integration` | Real ConPTY, Git, IPC contracts |
| TS unit | `npm test` | Stores, shortcuts, utils, type contracts |
| UI E2E | `npx playwright test --project=ui` | App shell, command palette, keyboard routing (mocked Tauri) |
| Visual regression | `GALAXY_APP_E2E=1 npx playwright test --project=app` | Full app screenshots with `CAPTURE_SCREEN` software rendering |

Rust integration tests are `#![cfg(windows)]` — they only compile on Windows.

The `CollectSink` pattern in `pty_integration.rs` shows how to implement `PtyEventSink` for testing the PTY pipeline in isolation.

Frontend unit tests mock `../ipc/client` with `vi.mock` and provide async return values for each IPC function used in the test.

## Versioning and release

Version is synchronized across three files: `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json`. Always use `scripts/bump-version.mjs` to bump — never edit versions manually across files. Release pipeline details (signing, updater artifacts, visual regression harness) live in `docs/RELEASE.md`.

**Every push to `main` automatically triggers a patch release.** The Version & Tag workflow also runs on plain pushes, bumps patch, tags, and builds. To push without releasing, start the commit subject with `[skip release]` (release-bot commits start with `chore(release):` and are also skipped). Do not hand-write `chore(release): vX.Y.Z` commits — that format is reserved for the bot.

Release flow:
1. GitHub Actions → **Version & Tag** workflow (manual dispatch: patch/minor/major)
2. Bumps version, commits, creates tag `vX.Y.Z`, pushes
3. Tag push triggers **Release** workflow: runs tests, builds NSIS installer, optionally signs, publishes GitHub Release

Optional secrets (build works without them): `SM_CERTIFICATE_BASE64` / `SM_CERTIFICATE_PASSWORD` (code signing), `TAURI_UPDATER_PUBKEY` / `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (updater).

## Gotchas

- **StrictMode double-listener bug**: `App.tsx` global event listeners must guard against async `listen()` promises resolving after effect cleanup. If cleanup ran, immediately call the returned unlisten. Failing to do this causes duplicate `pty://output` listeners and every keystroke is painted twice.

- **Terminal instance registry is non-reactive**: xterm instances live in a plain `Map` outside Zustand (`terminalStore.ts`). This is intentional — wrapping them in reactive state would trigger re-renders on every PTY byte. Use `registerTerminal` / `unregisterTerminal` / `terminalFor` to interact with them.

- **`CAPTURE_SCREEN` env var**: Forces software rendering (disables GPU) for stable automated screenshots. The Rust backend sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` before window creation. Only relevant for visual regression tests.

- **Vite dev port is fixed at 1420**: `strictPort: true` in `vite.config.ts`. Tauri's `tauri.conf.json` `devUrl` points here. Changing the port requires updating both.

- **No generic file/process access**: The Tauri capability (`src-tauri/capabilities/default.json`) only grants narrow, specific permissions. There is no blanket fs or shell permission. All file operations go through typed commands in `commands/`.

- **Git is never destructive**: `services/git.rs` never runs `stash`, `reset`, or `clean` automatically. Git is always invoked with argument arrays (never interpolated into a shell string). On Windows, `CREATE_NO_WINDOW` prevents console flashes.

- **Agent history is read-only**: All 21 agent adapters open files/DBs read-only. The `read_jsonl` helper has a byte ceiling and reads only the tail for large histories. A scan cancellation token must be checked between files to keep the UI responsive.

- **Persistence failure → read-only mode**: If `store.json` save fails, `AppState::persist()` flips a `read_only` atomic flag rather than crashing. The UI shows a warning. This is the spec §8 graceful degradation pattern.

- **Schema migration is stepwise**: `Persistence::migrate` loops `while store.schema_version < STORE_SCHEMA_VERSION`, applying one step per iteration. Each migration step must handle exactly one version bump. Legacy stores may have double-nested pane shapes from serde's externally-tagged enum — `unwrap_legacy_double_nested_panes` handles this during load.

- **Blocks have a 500 cap**: `blocks.jsonl` keeps at most 500 non-favorite command blocks. Favorites are never evicted. If favorites alone exceed 500, a `favorite_overflow` flag prompts the user — nothing is silently discarded.

- **OSC 133 vs heuristic blocks**: Command block extraction prefers OSC 133 shell integration marks. Without shell integration, a heuristic idle-flush (900ms after last output) finalizes the last command. Parsing failures degrade the pane to a plain terminal without blocking output.

- **Trigger regex is linear-time**: The `regex` crate is used (not `regex_dfa` or backtracking engines). Pattern length is capped at 512 chars (`MAX_PATTERN_LEN`). Triggers have per-pane cooldowns (default 5s) to prevent flooding.

- **PTY writes must be serialized**: `client.ts` routes all writes through `enqueuePtyWrite` (per-pane / per-session promise chains). Mouse DOWN/UP and multi-byte key sequences arrive as separate `onData` events; concurrent fire-and-forget `invoke`s can reorder through the async backend and break TUI clicks. Never bypass the queue.

- **`--open-here` has two paths that must not overlap**: a warm second-instance launch emits the `system://open-here` event only (UI is already listening); a cold start queues the path and the UI drains it via `system_pending_open_here`. Emitting on the cold path too would create a duplicate session for one Explorer right-click — see `lib.rs`.

- **`[profile.release] panic = "unwind"` is deliberate**: with `panic = "abort"` any worker-thread panic (PTY reader, agent scan) kills the whole process and Windows reports 0xc0000409 / BEX64 "闪退". Don't "optimize" it back.

- **Typecheck/build exclude tests**: `npm run typecheck` and `npm run build` use `tsconfig.build.json`, which excludes `e2e/`, `src-tauri/` and all `*.test.*` files — test files are typechecked by Vitest, not the build. A green typecheck does not mean test files compile.

- **Icons are generated**: `src-tauri/icons/logo-master.png` is the brand master; `npm run gen:icons` produces web/installer icons. Don't hand-edit generated icon files.