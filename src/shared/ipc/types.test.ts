// Contract smoke test: event name constants must stay aligned with
// src-tauri/src/state.rs (guarded by a Rust-side test as well).
import { describe, expect, it } from "vitest";

import { EV } from "./events";
import type { InsightsSummary } from "./types";

describe("IPC event contract", () => {
  it("uses the agreed channel names", () => {
    expect(EV).toMatchObject({
      PTY_OUTPUT: "pty://output",
      PTY_EXIT: "pty://exit",
      SESSION_TITLE: "session://title",
      BLOCKS_UPDATED: "blocks://updated",
      AGENT_STATUS: "agent://status",
      TRIGGER_FIRE: "trigger://fire",
      NOTIFICATION_NEW: "notification://new",
      GIT_CHANGED: "git://changed",
      OPEN_HERE: "system://open-here",
      RECOVERY: "system://recovery",
      STORE_CHANGED: "store://changed",
    });
  });
});

describe("insights IPC contract", () => {
  it("matches the Rust camelCase response shape", () => {
    const response = {
      range: "thirtyDays",
      rangeStart: "2026-07-06",
      rangeEnd: "2026-08-04",
      generatedAt: "2026-08-04T12:00:00Z",
      summary: {
        commandCount: 3,
        activeDays: 2,
        completedCount: 2,
        successCount: 1,
        successRate: 0.5,
        activeDurationMs: 2000,
      },
      daily: [
        {
          date: "2026-08-04",
          commandCount: 1,
          successCount: 1,
          failureCount: 0,
          agentCommandCount: 1,
          activeDurationMs: 2000,
          level: 4,
        },
      ],
      projects: [
        {
          projectId: "p1",
          projectName: "Galaxy",
          commandCount: 3,
          completedCount: 2,
          failureCount: 1,
          failureRate: 0.5,
          activeDurationMs: 2000,
          lastActivityAt: "2026-08-04T10:00:00Z",
        },
      ],
      agents: [
        {
          agentKind: "codex",
          commandCount: 2,
          sessionCount: 1,
          lastActivityAt: "2026-08-04T10:00:00Z",
        },
      ],
      recent: [
        {
          id: "b1",
          projectId: "p1",
          projectName: "Galaxy",
          sessionId: "s1",
          paneId: "pn1",
          command: "cargo test",
          startedAt: "2026-08-04T10:00:00Z",
          endedAt: "2026-08-04T10:00:02Z",
          exitCode: 0,
          agentKind: "codex",
          favorite: false,
          durationMs: 2000,
        },
      ],
      invalidRecordCount: 0,
    } satisfies InsightsSummary;

    expect(response.summary.successRate).toBe(0.5);
    expect(response.daily[0].level).toBe(4);
    expect(response.recent[0].agentKind).toBe("codex");
  });
});
