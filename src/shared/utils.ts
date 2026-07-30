// Shared formatting / matching / key-chord helpers (unit-tested).
import type { LayoutNodeRust, Pane } from "./ipc/types";

/** Flatten a layout tree into panes, depth-first (stable order). */
export function layoutPanes(node: LayoutNodeRust | null | undefined): Pane[] {
  if (!node) return [];
  if ("pane" in node) return [node.pane];
  return [...layoutPanes(node.split.first), ...layoutPanes(node.split.second)];
}

/** Paths of all split nodes (used for divider ratio updates). */
export function layoutSplitPaths(node: LayoutNodeRust, cur: boolean[] = [], out: boolean[][] = []): boolean[][] {
  if ("split" in node) {
    out.push([...cur]);
    cur.push(true);
    layoutSplitPaths(node.split.first, cur, out);
    cur.pop();
    cur.push(false);
    layoutSplitPaths(node.split.second, cur, out);
    cur.pop();
  }
  return out;
}

export function formatTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** basename of a path, os-agnostic */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/** Fuzzy subsequence matching for the command palette & searches. */
export function fuzzyMatch(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, ti);
    if (idx === -1) return null;
    streak = idx === ti ? streak + 1 : 0;
    score += 1 + streak * 2 - (idx - ti === 0 ? 0 : 0.1);
    ti = idx + 1;
  }
  // Earlier first-match is better.
  score -= t.indexOf(q[0]) * 0.01;
  return score;
}

/** Parse a "Ctrl+Shift+F" style chord into a comparable event signature. */
export function chordSignature(parts: {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}): string {
  const mods: string[] = [];
  if (parts.ctrl) mods.push("Ctrl");
  if (parts.alt) mods.push("Alt");
  if (parts.shift) mods.push("Shift");
  if (parts.meta) mods.push("Meta");
  let key = parts.key;
  if (key.length === 1) key = key.toUpperCase();
  if (key === " ") key = "Space";
  return [...mods, key].join("+");
}

export function eventSignature(e: KeyboardEvent): string {
  return chordSignature({
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    key: e.key,
  });
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\[[0-9;]*[A-Za-z]|\].*?(?:|\\)/g, "");
}

let idCounter = 0;
export function localId(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}
