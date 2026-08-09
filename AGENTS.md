# AGENTS.md — Galaxy Terminal (银河终端)

Windows-only (Win 10/11 x64) commercial multi-terminal workspace built on **Tauri 2 + Rust** (backend, ConPTY via `portable-pty`) and **React 18 + TypeScript + Zustand + Vite** (frontend, xterm.js). Docs and default UI language are **zh-CN** (bilingual zh/en via `src/shared/i18n.ts`); code comments and tracing logs are commonly in Chinese — match the surrounding style.

## Essential commands

| Task | Command |
| --- | --- |
| Dev (Vite + Rust hot reload) | `npm run tauri dev` |
| Frontend unit tests | `npm test` (= `vitest run` + icon generator test) |
| TS typecheck | `npm run typecheck` |
| Frontend prod build | `npm run build` |
| Rust tests | `cd src-tauri && cargo test --locked` |
| UI E2E (mocked Tauri) | `npx playwright test --project=ui` |
| Full-app visual E2E | `GALAXY_APP_E2E=1 npx playwright test --project=app` (release pipeline only; needs built exe + `CAPTURE_SCREEN` software rendering) |
| Desktop installer | `npm run tauri build` (NSIS output in `src-tauri/target/release/bundle/nsis/`) |
| Regenerate icons | `npm run gen:icons` (master is `src-tauri/icons/logo-master.png`; never hand-edit generated icons) |
| Third-party licenses | `npm run gen:licenses` |
| Version | `npm run version:show` / `version:patch` — syncs `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` |

CI gate (mirrors `.github/workflows/test.yml`): `npm run typecheck` → `npm test` → `npm run build` → Playwright `ui` project → `cargo test --locked` (Windows runner). Rust integration tests (`src-tauri/tests/pty_integration.rs`, `services_integration.rs`) need real ConPTY and only run on Windows.

## Architecture

**Rust backend is the single source of truth** for persisted/business state; the frontend only holds short-lived mirrors.

```
React UI (src/)  ──Tauri IPC (invoke) / Events (listen)──►  Rust core (src-tauri/)  ──portable-pty──►  ConPTY shells
```

- **Frontend `src/`**: `features/<area>/` (terminal, tabs, panels, search, settings, insights, navigation, …) and `shared/` (stores, ipc, components, icons, i18n, appearance).
  - Three Zustand stores with distinct roles — don't blur them:
    - `shared/stores/appStore.ts` — business cache (projects/sessions/config); actions refresh from IPC.
    - `shared/stores/uiStore.ts` — pure UI state (open panels/modals); no business truth.
    - `shared/stores/terminalStore.ts` — terminal runtime: xterm instance registry (non-reactive Map), PTY sequence tracking, gap recovery/replay.
  - `shared/ipc/client.ts` — **every Tauri command has exactly one typed wrapper here**. Adding a Rust command means adding it to the `all_commands!` macro (`src-tauri/src/commands/mod.rs`) *and* a typed wrapper.
  - `shared/ipc/events.ts` — event names must match `pub mod events` in `src-tauri/src/state.rs` (`pty://output`, `agent://status`, …). Keep both files in sync.
- **Backend `src-tauri/src/`**: `commands/` (whitelisted typed commands only — no generic fs/process execution exposed to the WebView), `core/` (models, layout tree, config, triggers, workflows), `pty/` (manager with output batching + ring buffer replay, decode, agent_status), `services/` (agents/ — 21 read-only agent adapters, git, blocks, insights, persistence, shell_detect), `platform/` (Windows args/registry/window state), `state.rs` (AppState + event emission).
- Persisted user data: `store.json` (projects/sessions/layout/config), `blocks.jsonl` (command blocks, cap 500, favorites exempt), under `%APPDATA%\com.galaxyterminal.app`. Agent histories stay in agents' own locations and are scanned **read-only** — never write them.

## Conventions & style

- Conventional commits (`fix(terminal): …`, `feat: …`, `docs: …`); releases are bot commits `chore(release): vX.Y.Z` — don't write those yourself.
- TypeScript strict mode, path alias `@/*` → `src/*` (though most imports are relative). Tests are colocated: `foo.test.ts(x)` next to `foo.ts(x)`.
- Rust: edition 2021, `rustfmt.toml` max_width 100. Errors flow through `error.rs` (`CmdError`/`AppError` with code strings like `"GLOBAL_HOTKEY"`); frontend wraps all invoke failures in `IpcError`.
- UI is a monochrome dark design surface; design tokens live in `DESIGN.md` / `.impeccable/design.json` (abyss-black scale, semantic color only for success/warning/error). Don't introduce ad-hoc colors.
- User-visible strings go through `t()` with both `zh` and `en` entries in `src/shared/i18n.ts`.
- Never modify agent-owned data; never auto `git stash`/`reset` in the Git panel.

## Gotchas

- **Version files are bot-managed.** Any push to `main` triggers the "Version & Tag" workflow (patch bump + tag + Windows release). Commits whose subject starts with `chore(release):` or `[skip release]` are skipped. Do not hand-bump `version` fields; use `scripts/bump-version.mjs` if alignment is truly needed.
- **PTY writes must be serialized.** `client.ts` queues writes per pane/session (`enqueuePtyWrite`) because mouse DOWN/UP and multi-byte sequences are separate events; concurrent invokes can reorder through the async backend and break TUI clicks. Don't call `invoke("pty_write")` directly.
- **`--open-here` has two paths**: cold start queues (`queue_open_here`, UI drains via `system_pending_open_here`); warm second-instance start emits only. Doing both double-creates a session — see comments in `lib.rs`.
- **`[profile.release] panic = "unwind"` is deliberate**: with `panic=abort`, any worker-thread panic kills the process (Windows 0xc0000409/"闪退"). Don't "optimize" it back.
- **React StrictMode** double-mounts in dev: async `listen()` subscriptions in `App.tsx` must be cancelled if the effect cleaned up before the promise resolved, or every PTY output paints twice. Follow that pattern for new listeners.
- **Vitest runs under jsdom with no Tauri runtime.** `@tauri-apps/api` is mocked via `src/shared/__mocks__/@tauri-apps/` (wired through `src/test-setup.ts`, which also stubs `ResizeObserver`/`navigator.clipboard`). New code touching Tauri APIs needs test coverage through these mocks.
- **`npm run typecheck`/`build` use `tsconfig.build.json`**, which excludes `e2e/`, `src-tauri/` and all `*.test.*` files — test files are typechecked by Vitest, not the build. A green typecheck doesn't mean tests compile.
- **Vite dev server is pinned to port 1420** (`strictPort`) because Tauri's `devUrl` expects it; `base: "./"` is required for the packaged WebView.
- **Playwright**: `ui` project (`*.ui.spec.ts`) mocks Tauri via `page.addInitScript` and runs anywhere; `app` project (`*.app.spec.ts`) self-skips unless `GALAXY_APP_E2E=1`. `workers: 1` by design.
- **Cold start is deliberately staged** (see `docs/PERFORMANCE.md`): minimal shell detection before `window.show`, full PATH/pwsh/git-bash/WSL detection deferred to a background thread, PTY restore deferred until frontend `ready`. Don't move work onto the critical path.
- `CAPTURE_SCREEN` env var at app start forces WebView2 software rendering (used for stable E2E screenshots).
- Windows shell environment: `head`/`sed`/`cat` etc. may be unavailable in plain shells — prefer the file tools over Unix pipes when working here.

## Key docs

- `README.md` — features, shortcuts, agent support matrix (21 agents), dev/release flow.
- `PRODUCT.md`, `设计文档.md` — product spec (Chinese).
- `DESIGN.md` / `.impeccable/design.json` — visual design system tokens.
- `docs/PERFORMANCE.md` — perf baselines and release gates; `docs/RELEASE.md` — signing/updater/CI details.
