import { isDeepStrictEqual } from "node:util";

import z from "zod";

const JsonSchema = z.json();
type Json = z.infer<typeof JsonSchema>;

export type MergeResult = { clean: true; content: string | undefined } | { clean: false };
type JsonMergeResult = { clean: true; value: Json | undefined } | { clean: false };
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

/** Deterministic line diff. Bound quadratic memory; large ambiguous edits fail closed. */
function diff(base: string[], next: string[]): Hunk[] | undefined {
  let prefix = 0;
  while (prefix < base.length && prefix < next.length && base[prefix] === next[prefix]) prefix++;
  let endBase = base.length;
  let endNext = next.length;
  while (endBase > prefix && endNext > prefix && base[endBase - 1] === next[endNext - 1]) {
    endBase--;
    endNext--;
  }
  const n = endBase - prefix;
  const m = endNext - prefix;
  if (!n || !m)
    return n || m ? [{ start: prefix, end: endBase, lines: next.slice(prefix, endNext) }] : [];
  if ((n + 1) * (m + 1) > 4_000_000) return undefined;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        base[prefix + i] === next[prefix + j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && base[prefix + i] === next[prefix + j]) {
      i++;
      j++;
      continue;
    }
    const start = i;
    const lines: string[] = [];
    while (i < n || j < m) {
      if (i < n && j < m && base[prefix + i] === next[prefix + j]) break;
      if (j < m && (i === n || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) {
        lines.push(next[prefix + j]!);
        j++;
      } else {
        i++;
      }
    }
    hunks.push({ start: prefix + start, end: prefix + i, lines });
  }
  return hunks;
}

function object(value: Json | undefined): value is { [key: string]: Json } {
  return value !== undefined && value !== null && !Array.isArray(value) && Object(value) === value;
}

function mergeJson(
  base: Json | undefined,
  local: Json | undefined,
  next: Json | undefined,
): JsonMergeResult {
  if (isDeepStrictEqual(local, base)) return { clean: true, value: next };
  if (isDeepStrictEqual(next, base) || isDeepStrictEqual(local, next))
    return { clean: true, value: local };
  if (!object(base) || !object(local) || !object(next)) return { clean: false };
  const value: { [key: string]: Json } = Object.create(null);
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(next)])) {
    const merged = mergeJson(base[key], local[key], next[key]);
    if (!merged.clean) return { clean: false };
    if (merged.value !== undefined) value[key] = merged.value;
  }
  return { clean: true, value };
}

/** Missing files are first-class values: local deletions survive unchanged generation. */
export function mergeGeneratedFile(
  base: string | undefined,
  local: string | undefined,
  next: string | undefined,
  filePath: string,
): MergeResult {
  if (local === base) return { clean: true, content: next };
  if (next === base || local === next) return { clean: true, content: local };
  if (base === undefined || local === undefined || next === undefined) return { clean: false };
  if (base.includes("\0") || local.includes("\0") || next.includes("\0")) return { clean: false };
  if (filePath.endsWith(".json")) {
    try {
      const merged = mergeJson(
        JsonSchema.parse(JSON.parse(base)),
        JsonSchema.parse(JSON.parse(local)),
        JsonSchema.parse(JSON.parse(next)),
      );
      if (merged.clean)
        return { clean: true, content: `${JSON.stringify(merged.value, null, 2)}\n` };
      return { clean: false };
    } catch {
      /* JSON-like text still has ordinary line merge semantics. */
    }
  }
  const lines = base.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const left = diff(lines, local.match(/[^\n]*\n|[^\n]+$/g) ?? []);
  const right = diff(lines, next.match(/[^\n]*\n|[^\n]+$/g) ?? []);
  if (!left || !right) return { clean: false };
  const combined = [...left];
  for (const hunk of right) {
    let duplicate = false;
    for (const other of left) {
      if (isDeepStrictEqual(hunk, other)) {
        duplicate = true;
        break;
      }
      const overlap =
        hunk.start === other.start ||
        (hunk.start < other.end && other.start < hunk.end) ||
        (hunk.start === hunk.end && hunk.start > other.start && hunk.start < other.end) ||
        (other.start === other.end && other.start > hunk.start && other.start < hunk.end);
      if (overlap) return { clean: false };
    }
    if (!duplicate) combined.push(hunk);
  }
  combined.sort((a, b) => a.start - b.start || a.end - b.end);
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of combined) {
    output.push(...lines.slice(cursor, hunk.start), ...hunk.lines);
    cursor = hunk.end;
  }
  output.push(...lines.slice(cursor));
  return { clean: true, content: output.join("") };
}
