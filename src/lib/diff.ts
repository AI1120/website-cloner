import type { DiffHunk, DiffLine } from "@/types/project";

/** Lines of unchanged text kept around each change. */
const CONTEXT = 3;
/** Past this many edits the diff stops looking for the shortest one. */
const MAX_EDITS = 1000;
/** Longer lines are shortened for display. */
const MAX_LINE_LENGTH = 1000;
/** At most this many lines are returned, so a huge new file stays readable. */
const MAX_SHOWN_LINES = 3000;

type Op = "context" | "added" | "removed";

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  // A final newline ends the last line rather than starting an empty one.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * The shortest edit script between two lists of lines (Myers' algorithm), as
 * one operation per line. Gives up and replaces the whole block when the two
 * differ by more than MAX_EDITS lines.
 */
function editScript(before: string[], after: string[]): Op[] {
  const n = before.length;
  const m = after.length;
  if (n === 0 || m === 0) {
    return [...before.map((): Op => "removed"), ...after.map((): Op => "added")];
  }
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;

  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    v = next;
  }

  if (!found) {
    return [...before.map((): Op => "removed"), ...after.map((): Op => "added")];
  }

  // Walk back through the saved states to recover the path.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const state = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && state[offset + k - 1] < state[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = state[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("context");
      x -= 1;
      y -= 1;
    }
    if (d > 0) ops.push(x === prevX ? "added" : "removed");
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

function shorten(line: string): string {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
}

export interface LineDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** True when some changed lines were left out of `hunks`. */
  truncated: boolean;
}

/** A line-by-line comparison of two texts, as hunks of changes with some context. */
export function diffLines(beforeText: string, afterText: string): LineDiff {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);

  // Most changes touch a small part of a file; compare only the part that differs.
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const ops: Op[] = [
    ...Array.from({ length: start }, (): Op => "context"),
    ...editScript(before.slice(start, endBefore), after.slice(start, endAfter)),
    ...Array.from({ length: before.length - endBefore }, (): Op => "context"),
  ];

  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op === "context") {
      lines.push({ kind: op, text: shorten(before[oldLine]), oldLine: oldLine + 1, newLine: newLine + 1 });
      oldLine += 1;
      newLine += 1;
    } else if (op === "removed") {
      lines.push({ kind: op, text: shorten(before[oldLine]), oldLine: oldLine + 1, newLine: null });
      oldLine += 1;
      removed += 1;
    } else {
      lines.push({ kind: op, text: shorten(after[newLine]), oldLine: null, newLine: newLine + 1 });
      newLine += 1;
      added += 1;
    }
  }

  // Keep the changed lines and CONTEXT lines either side; nearby changes share a hunk.
  const keep = new Uint8Array(lines.length);
  lines.forEach((line, index) => {
    if (line.kind === "context") return;
    for (let i = Math.max(0, index - CONTEXT); i <= Math.min(lines.length - 1, index + CONTEXT); i += 1) {
      keep[i] = 1;
    }
  });

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] | null = null;
  let shown = 0;
  let truncated = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (!keep[index]) {
      current = null;
      continue;
    }
    if (shown >= MAX_SHOWN_LINES) {
      truncated = true;
      break;
    }
    if (!current) {
      current = [];
      hunks.push({ lines: current });
    }
    current.push(lines[index]);
    shown += 1;
  }

  return { hunks, added, removed, truncated };
}
