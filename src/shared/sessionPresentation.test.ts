import { describe, expect, it } from "vitest";

import type { Session } from "./ipc/types";
import { sessionDisplayTitle, sessionPrimaryAgent } from "./sessionPresentation";

function session(partial: Partial<Session> & Pick<Session, "id" | "title" | "layout">): Session {
  return {
    projectId: "p1",
    sortOrder: 0,
    syncInput: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

function pane(id: string, title = "", agentKind: Session["agentKind"] = null) {
  return {
    id,
    cwd: "C:\\work",
    profile: {
      id: "pwsh",
      name: "PowerShell",
      program: "pwsh",
      args: [],
      env: {},
      source: "detected" as const,
    },
    cols: 80,
    rows: 24,
    title,
    active: true,
    agentKind,
  };
}

describe("sessionDisplayTitle", () => {
  it("prefers the live pane title over the static session name", () => {
    const s = session({
      id: "s1",
      title: "终端 1",
      layout: { pane: pane("pane-1", "codex · Galaxy") },
    });
    expect(sessionDisplayTitle(s)).toBe("codex · Galaxy");
  });

  it("falls back to the session title when the pane title is empty", () => {
    const s = session({
      id: "s1",
      title: "终端 1",
      layout: { pane: pane("pane-1", "   ") },
    });
    expect(sessionDisplayTitle(s)).toBe("终端 1");
  });
});

describe("sessionPrimaryAgent", () => {
  it("reads agent kind from live status first, then the pane, then the session", () => {
    const s = session({
      id: "s1",
      title: "终端 1",
      agentKind: "aider",
      layout: { pane: pane("pane-1", "shell", "codex") },
    });

    expect(sessionPrimaryAgent(s, { "pane-1": { kind: "claudeCode", status: "working" } })).toBe(
      "claudeCode",
    );
    expect(sessionPrimaryAgent(s, {})).toBe("codex");
    expect(
      sessionPrimaryAgent(
        session({
          id: "s2",
          title: "终端 2",
          agentKind: "gemini",
          layout: { pane: pane("pane-2", "shell", null) },
        }),
        {},
      ),
    ).toBe("gemini");
  });

  it("returns null when no agent is present", () => {
    const s = session({
      id: "s1",
      title: "终端 1",
      layout: { pane: pane("pane-1") },
    });
    expect(sessionPrimaryAgent(s, {})).toBeNull();
  });
});
