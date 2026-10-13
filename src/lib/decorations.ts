import type { AnnotationRow, Tree } from "./types";
import type { ShapeKind } from "./rings/band";

// ============================================================
// Tree decorations driven by annotation columns (iTOL TREE_COLORS /
// DATASET_STYLE / LABELS / DATASET_SYMBOL / DATASET_PIECHART /
// DATASET_CONNECTION equivalents, but configured from TSV columns).
// ============================================================

export type TreeDecor = {
  /** Column whose values colour branches (category colours, or the column's ring style for numbers). */
  branchColorBy: string | null;
  /** "clades": an internal branch takes a colour when every leaf below shares it. */
  branchColorMode: "leaves" | "clades";
  /** Branch width multiplier from a numeric column (null = off). */
  branchWidthBy: string | null;
  labelColorBy: string | null;
  labelBgBy: string | null;
  labelBgAlpha: number;
  /** Column whose text replaces the leaf label. */
  labelRenameBy: string | null;
  /** Column whose values ("bold", "italic", "bold-italic") style the label. */
  labelStyleBy: string | null;
  /** Node symbols: column, shape, size (px), position. */
  symbolBy: string | null;
  symbolShape: ShapeKind;
  symbolSize: number;
  symbolFilled: boolean;
  /** Node pies: numeric columns, radius (px), scale by row total. */
  pieFields: string[];
  pieRadius: number;
  pieScaled: boolean;
  /** Connections between leaves / clades (from connection files). */
  connShow: boolean;
  connColor: string;
  connWidth: number;
  connOpacity: number;
  connArrows: boolean;
  connCurve: "root" | "center" | "straight";
};

export const DEFAULT_DECOR: TreeDecor = {
  branchColorBy: null,
  branchColorMode: "clades",
  branchWidthBy: null,
  labelColorBy: null,
  labelBgBy: null,
  labelBgAlpha: 0.35,
  labelRenameBy: null,
  labelStyleBy: null,
  symbolBy: null,
  symbolShape: "circle",
  symbolSize: 7,
  symbolFilled: true,
  pieFields: [],
  pieRadius: 9,
  pieScaled: false,
  connShow: true,
  connColor: "#d62728",
  connWidth: 1.5,
  connOpacity: 0.6,
  connArrows: false,
  connCurve: "root",
};

/** Lowest common ancestor of two nodes (via L/R leaf intervals). */
export function lca(tree: Tree, a: number, b: number): number {
  const nb = tree.nodes[b];
  let u: number | null = a;
  while (u !== null) {
    const n: Tree["nodes"][number] = tree.nodes[u];
    if (n.L <= nb.L && nb.R <= n.R) return u;
    u = n.parent;
  }
  return tree.root;
}

/**
 * Node id for a reference: a leaf name, an internal node name, or "A|B" /
 * "A---B" meaning the last common ancestor of A and B (iTOL syntax).
 */
export function resolveNodeRef(tree: Tree, byName: Map<string, number>, ref: string): number | null {
  const s = ref.trim();
  if (!s) return null;
  const direct = byName.get(s);
  if (direct !== undefined) return direct;
  const parts = s.includes("---") ? s.split("---") : s.split("|");
  if (parts.length >= 2) {
    const a = byName.get(parts[0].trim()), b = byName.get(parts[1].trim());
    if (a !== undefined && b !== undefined) return lca(tree, a, b);
  }
  return null;
}

/** Name → node id for every named node (leaves first, so leaf names win). */
export function nodeNameIndex(tree: Tree): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of tree.leaves) { const n = tree.nodes[id].name; if (n && !m.has(n)) m.set(n, id); }
  for (const nd of tree.nodes) if (!nd.isLeaf && nd.label && !m.has(nd.label)) m.set(nd.label, nd.id);
  return m;
}

/**
 * Annotation rows attached to internal nodes ("A|B" ids or internal node
 * names). Leaves use their own rows directly.
 */
export function internalNodeRows(tree: Tree, rows: Iterable<AnnotationRow>, byName: Map<string, number>): Map<number, AnnotationRow> {
  const out = new Map<number, AnnotationRow>();
  for (const row of rows) {
    const id = resolveNodeRef(tree, byName, row.id);
    if (id !== null && !tree.nodes[id].isLeaf) out.set(id, row);
  }
  return out;
}

/**
 * Per-node colour (null = default). Leaves take colorOf(their row). Internal
 * rows colour their whole clade (larger clades first, inner ones override).
 * In "clades" mode an internal branch without its own row is coloured when
 * all its children share one colour.
 */
export function computeNodeColors(
  tree: Tree,
  leafRow: (leafId: number) => AnnotationRow | undefined,
  internalRows: Map<number, AnnotationRow>,
  colorOf: (row: AnnotationRow | undefined) => string | null,
  mode: "leaves" | "clades"
): Array<string | null> {
  const colors: Array<string | null> = new Array(tree.nodes.length).fill(null);
  for (const id of tree.leaves) colors[id] = colorOf(leafRow(id));
  if (mode === "clades") {
    // Post-order: children before parents (DFS order reversed).
    const order: number[] = [];
    const stack = [tree.root];
    while (stack.length) { const u = stack.pop()!; order.push(u); for (const c of tree.nodes[u].children) stack.push(c); }
    for (let i = order.length - 1; i >= 0; i--) {
      const nd = tree.nodes[order[i]];
      if (nd.isLeaf || nd.children.length === 0) continue;
      const c0 = colors[nd.children[0]];
      colors[nd.id] = c0 !== null && nd.children.every(c => colors[c] === c0) ? c0 : null;
    }
  }
  // Explicit clade rows paint their whole subtree, outermost first.
  const clades = [...internalRows.entries()]
    .map(([id, row]) => ({ id, color: colorOf(row) }))
    .filter(c => c.color !== null)
    .sort((a, b) => (tree.nodes[b.id].R - tree.nodes[b.id].L) - (tree.nodes[a.id].R - tree.nodes[a.id].L));
  for (const { id, color } of clades) {
    const stack = [id];
    while (stack.length) { const u = stack.pop()!; colors[u] = color; for (const c of tree.nodes[u].children) stack.push(c); }
  }
  return colors;
}

/** Label style from a cell: "bold", "italic", "bold-italic"/"bolditalic". */
export function labelStyleOf(v: unknown): { bold: boolean; italic: boolean } {
  const s = v === null || v === undefined ? "" : String(v).toLowerCase();
  return { bold: s.includes("bold"), italic: s.includes("italic") };
}

/**
 * Control point for a connection curve between screen points p and q.
 * "root": bows towards the root (rect: to the left; radial: towards the centre),
 * growing with the distance, like iTOL. "center": through the tree centre.
 */
export function connectionControl(
  p: [number, number], q: [number, number], curve: "root" | "center" | "straight",
  layout: "rect" | "radial", center: [number, number]
): [number, number] | null {
  if (curve === "straight") return null;
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  if (curve === "center" && layout === "radial") return center;
  if (layout === "rect") {
    const d = Math.abs(q[1] - p[1]);
    return [Math.min(p[0], q[0]) - d * 0.5, my];
  }
  // Radial "root": pull the midpoint towards the centre in proportion to the chord length.
  const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const vx = center[0] - mx, vy = center[1] - my;
  const len = Math.hypot(vx, vy) || 1;
  const pull = Math.min(len, chord * 0.5);
  return [mx + (vx / len) * pull, my + (vy / len) * pull];
}

