# Auto Update Implementation Plan

> **For agentic workers:** Inline execution in this session (user confirmed 开工).

**Goal:** Startup auto-check (default on), in-app notifications, silent download/install, restart prompt, settings toggle.

**Architecture:** Real Tauri updater commands in Rust; frontend schedules delayed check when `autoCheckUpdate`; install posts notifications with optional `action: app.relaunch`.

**Tech Stack:** tauri-plugin-updater 2, tauri-plugin-process, React settings + notifications.

## Global Constraints

- `autoCheckUpdate` default **true**
- No forced restart
- Dev builds skip real network update
- Failures never block PTY/boot
- Single-flight install

## Tasks

1. Config + types + i18n + settings toggle
2. Rust updater_check / download_and_install / app_relaunch + notifications action field
3. Frontend auto-check + NotificationsPanel relaunch button + diagnostics status
4. Tests + verify

---
