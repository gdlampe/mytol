import type { AnnotationRow, Node, Tree } from "./types";

// ============================================================
// Annotation search — find leaves by the value of one annotation column
// ============================================================

export type NumericOp = "gt" | "gte" | "lt" | "lte" | "eq" | "between";

export type AnnotationFilter =
  | { kind: "categorical"; key: string; values: Set<string>; invert: boolean }
  | { kind: "continuous"; key: string; op: NumericOp; a: number; b: number; invert: boolean };

/** Category key used for leaves that have no value in the chosen column. */
export const NO_VALUE = "\x00none";

/** Cell value as a string ("" when missing). */
export function cellValue(row: AnnotationRow | undefined, key: string): string {
  const v = row?.[key];
  return v === null || v === undefined ? "" : String(v);
}

function rawMatch(row: AnnotationRow | undefined, f: AnnotationFilter): boolean {
  const v = cellValue(row, f.key);
  if (f.kind === "categorical") return f.values.has(v === "" ? NO_VALUE : v);
  if (v.trim() === "") return false;
  const n = Number(v);
  if (isNaN(n)) return false;
  const lo = Math.min(f.a, f.b), hi = Math.max(f.a, f.b);
  switch (f.op) {
    case "gt": return n > f.a;
    case "gte": return n >= f.a;
    case "lt": return n < f.a;
    case "lte": return n <= f.a;
    case "eq": return n === f.a;
    case "between": return n >= lo && n <= hi;
  }
}

/** Leaf node ids, in leaf (display) order, whose annotation row satisfies the filter. */
export function findMatchingLeaves(
  tree: Tree,
  annotations: Map<string, AnnotationRow>,
  f: AnnotationFilter
): number[] {
  const out: number[] = [];
  for (const id of tree.leaves) {
    const row = annotations.get(tree.nodes[id].name || "");
    if (rawMatch(row, f) !== f.invert) out.push(id);
  }
  return out;
}

/** Smallest clade containing every given leaf (uses the contiguous L/R leaf intervals). */
export function commonAncestor(tree: Tree, leafIds: number[]): number | null {
  if (leafIds.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const id of leafIds) {
    const li = tree.nodes[id].leafIndex;
    if (li < lo) lo = li;
    if (li > hi) hi = li;
  }
  let u: number | null = tree.leaves[lo];
  while (u !== null) {
    const nd: Node = tree.nodes[u];
    if (nd.L <= hi && hi < nd.R) return u;
    u = nd.parent;
  }
  return tree.root;
}
