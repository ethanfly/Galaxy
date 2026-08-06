# Auto Update Design

**Status:** Approved for implementation  
**Date:** 2026-08-06  
**Scope:** Startup update check, in-app notifications, silent background download/install with restart prompt, and a user setting to enable/disable automatic checks

## 1. Problem Statement

Galaxy Terminal already depends on `tauri-plugin-updater` and documents a signed-release update path, but runtime support is incomplete:

- `updater_check` always reports “no update” (even in release builds).
- Settings exposes a manual “检查更新” button that only shows `alert`.
- There is no startup check, no in-app notification, and no download/install path.

Users need the app to check for updates when opened, surface “new version available” in the existing notification center, download and install quietly in the background, then prompt for restart—without interrupting terminal work. Automatic checking must be controllable from Settings.

## 2. Goals

1. On cold start (when enabled), automatically check for updates without blocking UI.
2. When an update is available, create an in-app notification with the new version.
3. Download and install in the background (`installMode: passive`, no native updater dialog).
4. After successful install, notify that the update is ready and offer **立即重启**; do **not** force-restart.
5. Settings toggle **自动检查更新** (default **on**); manual check remains available regardless of the toggle.
6. Updater failures never break boot, PTY, or core UI.

## 3. Non-Goals

- Stable/preview channel picker UI (keep current endpoint configuration).
- Hosting or redesigning the release CDN topology.
- Forcing real network checks in debug/dev builds.
- System tray-only update UX or Windows Store packaging.
- Changing code-signing or CI secret layout beyond wiring existing updater secrets.

## 4. User-visible behavior

| Moment | Behavior |
|--------|----------|
| First launch after install / every cold start | If `autoCheckUpdate === true`, after UI is interactive, wait ~3s, then check once per process. |
| Update found | Notification: title like「发现新版本」, body includes `vX.Y.Z` and short notes if present. Background download/install starts automatically. |
| Download/install success | Notification:「更新已就绪，重启后生效」with action **立即重启**. |
| Download/install failure | At most one failure notification per version attempt; user can retry from Settings. |
| Toggle off | No automatic check on startup; manual “检查更新” still works and can still download/install. |
| Manual check, already latest | Non-modal feedback in Settings (inline status), not `window.alert`. |
| Dev build | Check returns “开发构建跳过更新检查”; no download. |

## 5. Configuration

### 5.1 Field

Add to `AppConfig` (Rust + TypeScript, camelCase IPC):

```text
autoCheckUpdate: boolean  // default true; serde default_true
```

- Persist in `store.json` with the rest of config.
- No store schema version bump required if the field uses `#[serde(default = "default_true")]` so older stores load as `true`.
- Config validation: boolean only (serde).

### 5.2 Settings UI

- **General** section (near notifications / diagnostics-related prefs): checkbox  
  - zh:「启动时自动检查更新」  
  - en:「Check for updates on startup」
- Diagnostics (or General) retains **检查更新** button:
  - Runs check immediately.
  - Shows inline status: checking / up to date / available vX / error.
  - If available, offers or triggers the same download path as automatic flow (no second parallel install).

Saving the toggle uses existing `config_update` / settings draft save path.

## 6. Architecture

```
Cold start
  App.init OK
       │
       ▼
  config.autoCheckUpdate?
       │ no → stop
       │ yes
       ▼
  delay ~3s (workspace restore first)
       │
       ▼
  updater_check  ──►  no update / inactive / error → quiet log
       │ available
       ▼
  app notification (kind: update)
       │
       ▼
  updater_download_and_install (spawn, single-flight)
       │
       ├─ success → notification + “立即重启” → app_relaunch
       └─ failure → notification (once per version)
```

### 6.1 Rust commands

| Command | Role |
|---------|------|
| `updater_check` | Real `UpdaterExt::updater()?.check().await`. Map to `UpdateInfo { available, version, notes }`. Dev: skip with notes. Inactive/missing pubkey: `available: false`. |
| `updater_download_and_install` | Single-flight: check (or use pending update state) then `download_and_install`. Returns status DTO. Does not relaunch. |
| `app_relaunch` | Relaunch via `tauri_plugin_process` (already a dependency). |

Implementation notes:

- Hold at most one in-flight update operation (`Mutex` / `AtomicBool` on `AppState` or a small updater service).
- Prefer check → if `Some(update)` → download_and_install on that `Update` handle in one async command path for auto and manual “install” to avoid dropping the update object between IPC calls. Split only if the plugin API requires it; document the chosen Tauri 2 API shape in code.
- Never surface Rust panics; convert plugin errors to `CmdError` with stable codes (`UPDATER`, `UPDATER_BUSY`, `UPDATER_DISABLED`).

### 6.2 Notifications

- Use the existing notification store/list + `notification://` event path so the Notifications panel and status-bar badge work.
- Suggested kind: `"update"` (string already flexible) or reuse a system category if kinds are enum-limited—extend enum if required.
- Dedup: do not spam “found vX” more than once per process for the same version; do not re-queue install if already installing or already ready for that version.
- Restart action: frontend invokes `app_relaunch` (or `process.relaunch`).

### 6.3 Frontend wiring

| Piece | Behavior |
|-------|----------|
| `App.tsx` / boot effect | After successful `init`, if `config.autoCheckUpdate`, schedule one delayed auto check. Cancel on unmount. |
| `shared/ipc/client.ts` | Typed wrappers for check, download-and-install, relaunch. |
| Settings General | Toggle bound to draft `autoCheckUpdate`. |
| Settings Diagnostics | Manual check + status; optional install trigger if check found update and auto-install not already running. |
| i18n | New keys for toggle label, notification titles/bodies, button labels, status strings. |

Auto path after check finds update: create “found” notification, then call download-and-install without requiring a click (silent background update). Manual path: user clicked check → same install path when available.

### 6.4 Plugin / release constraints

- Keep `plugins.updater.dialog: false`.
- Keep `windows.installMode: "passive"`.
- Repo `active: false` + empty pubkey for local/dev; CI continues to inject `active: true` + `TAURI_UPDATER_PUBKEY` and `createUpdaterArtifacts` when secrets exist (existing release workflow).
- If updater is inactive at runtime, behave as “no update” for auto path; manual check can show a soft message that updates are not configured (optional, not an error banner).

## 7. Error handling and degradation

| Case | Behavior |
|------|----------|
| Network failure | Log; no modal; auto path silent; manual shows inline error. |
| Signature / pubkey mismatch | Log + failure notification once; do not crash. |
| Concurrent check/install | Second caller gets `UPDATER_BUSY` or waits—prefer reject busy for manual, skip for auto. |
| Install succeeded, relaunch fails | Leave “ready” notification; user can quit manually. |
| Read-only store | Toggle save fails like other config fields; update check still allowed. |

## 8. Testing

### Automated

- Unit: config default `autoCheckUpdate === true` for missing field.
- Frontend: when config true, boot schedules check; when false, does not.
- Mock IPC e2e: check returns available → notification list contains version string; toggle off → no auto invoke after mock boot (spy on invoke list).
- Rust: pure mapping of plugin result → `UpdateInfo` if extracted; busy flag unit test if pure.

### Manual / release

- Build with updater secrets; serve or use real endpoint; verify check → notify → install → restart applies new version.
- Toggle off, restart app, confirm no check traffic (or no notification).
- Manual check still works with toggle off.

## 9. Implementation phases

1. Config field + TS types + settings toggle + i18n.
2. Real `updater_check` + download/install + relaunch commands + single-flight.
3. Notifications for found / ready / failed + restart action.
4. Startup auto-check gated by `autoCheckUpdate`.
5. Replace Settings `alert` with inline status; tests.

## 10. Acceptance criteria

1. With toggle **on**, opening the app eventually checks once and, if a newer signed release exists, shows a notification and starts background install.
2. With toggle **off**, no automatic check; manual check still works.
3. Successful install surfaces “ready, restart to apply” and **立即重启** relaunches the app.
4. No forced restart; running terminals are only stopped if the user chooses restart or quits.
5. Dev builds do not attempt real updates.
6. Updater errors never prevent terminal use.
7. Default for new and migrated configs is automatic check **enabled**.
