import { describe, expect, it } from "vitest";

import {
  baseName,
  chordSignature,
  fuzzyMatch,
  layoutPanes,
  layoutSplitPaths,
  truncate,
} from "./utils";
import type { LayoutNodeRust, Pane, ShellProfile } from "./ipc/types";

const profile: ShellProfile = {
  id: "p",
  name: "cmd",
  program: "cmd.exe",
  args: [],
  env: {},
  source: "detected",
};

function pane(id: string): Pane {
  return {
    id,
    cwd: "C:\\x",
    profile,
    cols: 120,
    rows: 32,
    title: "",
    active: true,
    exitCode: null,
  };
}

describe("layout utils", () => {
  it("flattens panes depth-first", () => {
    const tree: LayoutNodeRust = {
      split: {
        direction: "row",
        ratio: 0.5,
        first: { pane: pane("a") },
        second: {
          split: {
            direction: "column",
            ratio: 0.6,
            first: { pane: pane("b") },
            second: { pane: pane("c") },
          },
        },
      },
    };
    expect(layoutPanes(tree).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(layoutSplitPaths(tree).length).toBe(2);
  });
});

describe("fuzzyMatch", () => {
  it("matches subsequences and rejects misses", () => {
    expect(fuzzyMatch("nt", "new terminal")).not.toBeNull();
    expect(fuzzyMatch("xyz", "new terminal")).toBeNull();
    expect(fuzzyMatch("", "anything")).toBe(0);
  });

  it("prefers tighter matches", () => {
    const a = fuzzyMatch("abc", "abc")!;
    const b = fuzzyMatch("abc", "a--b--c")!;
    expect(a).toBeGreaterThan(b);
  });
});

describe("chordSignature", () => {
  it("normalizes modifier order and key case", () => {
    expect(chordSignature({ ctrl: true, shift: true, alt: false, meta: false, key: "f" })).toBe(
      "Ctrl+Shift+F",
    );
    expect(chordSignature({ ctrl: false, shift: false, alt: true, meta: false, key: "ArrowLeft" })).toBe(
      "Alt+ArrowLeft",
    );
  });
});

describe("misc formatting", () => {
  it("baseName handles both separators", () => {
    expect(baseName("C:\\work\\proj\\")).toBe("proj");
    expect(baseName("/home/u/proj")).toBe("proj");
  });

  it("truncate ellipsizes", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
