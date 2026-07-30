// Contract smoke test: event name constants must stay aligned with
// src-tauri/src/state.rs (guarded by a Rust-side test as well).
import { describe, expect, it } from "vitest";

import { EV } from "./events";

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
    });
  });
});
