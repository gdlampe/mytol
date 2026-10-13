import type { Node, Tree } from "./types";

// ============================================================
// Newick parsing
// ============================================================

export function parseNewick(newick: string): any {
  let i = 0;

  function skipWs() {
    while (i < newick.length && /\s/.test(newick[i])) i++;
  }

  function sub(): any {
    skipWs();
    const children: any[] = [];
    let name = "";
    let length: number | undefined;

    if (newick[i] === "(") {
      // internal node
      i++;
      while (true) {
        children.push(sub());
        skipWs();
        if (newick[i] === ",") {
          i++;
          continue;
        }
        if (newick[i] === ")") {
          i++;
          break;
        }
        throw new Error("Newick parse error at position " + i);
      }
      skipWs();
      while (i < newick.length && /[A-Za-z0-9_./\-]/.test(newick[i])) {
        name += newick[i++];
      }
    } else {
      // leaf
      while (i < newick.length && !/[:),;\s]/.test(newick[i])) {
        name += newick[i++];
      }
    }

    skipWs();
    if (newick[i] === ":") {
      i++;
      let len = "";
      while (i < newick.length && !/[),;\s]/.test(newick[i])) len += newick[i++];
      length = parseFloat(len);
    }
    skipWs();
    return { name: name || undefined, length: length ?? 0, children };
  }

  const t = sub();
  skipWs();
  if (newick[i] !== ";") {
    throw new Error("Newick parse error: missing trailing ';'");
  }
  return t;
}

// ============================================================
// AST pruning (remove leaves by name before building tree)
// ============================================================

/**
 * Prune an AST (output of parseNewick) by removing leaves whose names are in
 * hideNames. Single-child internal nodes are elided so the result stays a
 * proper tree with no redundant nodes. Elided nodes' branch lengths are merged
 * into the surviving child so cumulative distances remain correct.
 * Returns null if every leaf is removed.
 */
export function pruneAst(node: any, hideNames: Set<string>): any | null {
  if (!node.children || node.children.length === 0) {
    return hideNames.has(node.name || "") ? null : node;
  }
  const kept: any[] = [];
  for (const ch of node.children) {
    const pruned = pruneAst(ch, hideNames);
    if (pruned !== null) kept.push(pruned);
  }
  if (kept.length === 0) return null;
  if (kept.length === 1) {
    return { ...kept[0], length: (kept[0].length || 0) + (node.length || 0) };
  }
  return { ...node, children: kept };
}

// ============================================================
// Tree construction
// ============================================================

export function buildTree(ast: any): Tree {
  const nodes: Node[] = [];
  const nameToNode = new Map<string, number>();

  function add(a: any, parent: number | null): number {
    const id = nodes.length;
    const node: Node = {
      id,
      name: a.children?.length ? undefined : a.name,
      parent,
      children: [],
      length: a.length || 0,
      support: undefined,
      isLeaf: !a.children?.length,
      depth: 0,
      cumLen: 0,
      leafIndex: -1,
      L: 0,
      R: 0,
      propCat: undefined,
    };

    // Numeric internal-node name → support values. Plain numbers ("95", "0.95")
    // or several separated by "/" (IQ-TREE, e.g. "92.7/0.995/93" = SH-aLRT/aBayes/UFBoot).
    if (!node.isLeaf && a.name) {
      const vals = parseSupportLabel(a.name);
      if (vals) node.supports = vals;
    }

    // Non-numeric internal labels (clade names) are kept separately from `name`
    // (which is leaf-only) so annotation rows and connections can refer to them.
    if (!node.isLeaf && a.name && !node.supports) node.label = String(a.name);

    nodes.push(node);
    if (node.name) nameToNode.set(node.name, id);

    const kids: number[] = [];
    for (const ch of a.children || []) kids.push(add(ch, id));
    nodes[id].children = kids;

    return id;
  }

  const root = add(ast, null);

  const leaves: number[] = [];
  function dfs(u: number, depth: number, cumLen: number) {
    const nd = nodes[u];
    nd.depth = depth;
    nd.cumLen = cumLen;
    if (nd.isLeaf) {
      nd.leafIndex = leaves.length;
      nd.L = nd.leafIndex;
      nd.R = nd.leafIndex + 1;
      leaves.push(u);
    } else {
      nd.L = Infinity as any;
      nd.R = -Infinity as any;
      for (const v of nd.children) {
        dfs(v, depth + 1, cumLen + nodes[v].length);
        nd.L = Math.min(nd.L, nodes[v].L);
        nd.R = Math.max(nd.R, nodes[v].R);
      }
    }
  }
  dfs(root, 0, 0);

  const tree: Tree = { nodes, root, leaves, nameToNode };
  indexSupports(tree);
  return tree;
}

/**
 * Largest clades whose leaves all share one value (leafValue → null = none).
 * A value found in several places gives one clade per piece; single leaves and
 * the root are never returned. minSize counts all leaves with the value, so the
 * small pieces of a big split group still count. splitAcrossRoot lists values
 * whose leaves sit under different children of the root (re-rooting may join them).
 */
export function uniformClades(
  tree: Tree,
  leafValue: (leafId: number) => string | null,
  minSize: number
): { clades: Array<{ nodeId: number; value: string; size: number }>; splitAcrossRoot: string[] } {
  const val: Array<string | null> = new Array(tree.nodes.length).fill(null);
  const order: number[] = [];
  const stack = [tree.root];
  while (stack.length) { const u = stack.pop()!; order.push(u); for (const c of tree.nodes[u].children) stack.push(c); }
  const total = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const nd = tree.nodes[order[i]];
    if (nd.isLeaf || nd.children.length === 0) {
      const v = leafValue(nd.id);
      val[nd.id] = v;
      if (v !== null) total.set(v, (total.get(v) ?? 0) + 1);
      continue;
    }
    const v0 = val[nd.children[0]];
    val[nd.id] = v0 !== null && nd.children.every(c => val[c] === v0) ? v0 : null;
  }
  const clades: Array<{ nodeId: number; value: string; size: number }> = [];
  const walk = [tree.root];
  while (walk.length) {
    const u = walk.pop()!;
    const nd = tree.nodes[u];
    const v = val[u];
    if (u !== tree.root && v !== null && !nd.isLeaf && (total.get(v) ?? 0) >= minSize) {
      clades.push({ nodeId: u, value: v, size: nd.R - nd.L });
      continue;
    }
    for (const c of nd.children) walk.push(c);
  }
  // Values whose leaves fall under more than one child of the root.
  const under = new Map<string, Set<number>>();
  for (const c of tree.nodes[tree.root].children) {
    const st = [c];
    while (st.length) {
      const u = st.pop()!;
      const nd = tree.nodes[u];
      if (nd.isLeaf) { const v = val[u]; if (v !== null) { if (!under.has(v)) under.set(v, new Set()); under.get(v)!.add(c); } }
      else st.push(...nd.children);
    }
  }
  const splitAcrossRoot = [...under].filter(([, s]) => s.size > 1).map(([v]) => v);
  return { clades, splitAcrossRoot };
}

/** Numbers in a support label ("95", "0.95", "92.7/0.995/93", "/95"), or null if it isn't one. */
export function parseSupportLabel(label: string): number[] | null {
  const parts = label.split("/").map(p => p.trim());
  let any = false;
  const vals = parts.map(p => {
    if (p === "") return NaN;
    const v = Number(p);
    if (Number.isFinite(v)) any = true;
    return v;
  });
  // Every part must be a number or blank, and at least one a number.
  if (!any || parts.some((p, i) => p !== "" && !Number.isFinite(vals[i]))) return null;
  return vals;
}

/**
 * Sets tree.supportCount / supportScale from the parsed labels and each node's
 * default support (the last value, as 0–1). A value is a percentage when any
 * node has it above 1 — judged per value, so UFBoot "1" still means 1 %.
 */
export function indexSupports(tree: Tree): void {
  let count = 0;
  for (const nd of tree.nodes) if (nd.supports) count = Math.max(count, nd.supports.length);
  const max = new Array<number>(count).fill(-Infinity);
  for (const nd of tree.nodes) nd.supports?.forEach((v, i) => { if (Number.isFinite(v)) max[i] = Math.max(max[i], v); });
  tree.supportCount = count;
  tree.supportScale = max.map(m => (m > 1 ? 100 : 1));
  for (const nd of tree.nodes) nd.support = supportValue(tree, nd, count - 1);
}

/** Support value i of a node as 0–1, or undefined. */
export function supportValue(tree: Tree, nd: Node, i: number): number | undefined {
  const v = nd.supports?.[i];
  return v !== undefined && Number.isFinite(v) ? v / (tree.supportScale?.[i] ?? 1) : undefined;
}

/**
 * Display names for a tree's support values. IQ-TREE writes them in a fixed
 * order (SH-aLRT, aBayes, UFBoot — only the tests that were run), so the
 * common combinations are recognised from how many there are and their scales.
 */
export function guessSupportNames(count: number, scale: number[]): string[] {
  const key = scale.join(",");
  const known: Record<string, string[]> = {
    "100,1,100": ["SH-aLRT", "aBayes", "UFBoot"],
    "100,100": ["SH-aLRT", "UFBoot"],
    "100,1": ["SH-aLRT", "aBayes"],
    "1,100": ["aBayes", "UFBoot"],
  };
  return known[key] ?? Array.from({ length: count }, (_, i) => `Value ${i + 1}`);
}

// ============================================================
// Leaf-count annotation (used by layout and ladderize)
// ============================================================

export function computeLeafCounts(tree: Tree): void {
  const { nodes, root } = tree;
  const leavesInSubtree = new Uint32Array(nodes.length);
  const order: number[] = [];

  (function post(u: number) {
    for (const v of nodes[u].children) post(v);
    order.push(u);
  })(root);

  for (const u of order) {
    const nd = nodes[u];
    if (nd.isLeaf) {
      leavesInSubtree[u] = 1;
    } else {
      let s = 0;
      for (const v of nd.children) s += leavesInSubtree[v];
      leavesInSubtree[u] = s;
    }
    (nd as any).leaves = leavesInSubtree[u];
  }
}

// ============================================================
// Tree manipulation: ladderize, reroot
// ============================================================

function computeSubtreeStats(t: Tree): Uint32Array {
  const sz = new Uint32Array(t.nodes.length);
  const order: number[] = [];

  (function post(u: number) {
    for (const v of t.nodes[u].children) post(v);
    order.push(u);
  })(t.root);

  for (const u of order) {
    const nd = t.nodes[u];
    if (nd.isLeaf) {
      sz[u] = 1;
    } else {
      let s = 0;
      for (const v of nd.children) s += sz[v];
      sz[u] = s;
    }
  }
  return sz;
}

/** Sort children by subtree size and recompute leaf indices */
export function ladderizeTree(t: Tree, dir: "asc" | "desc"): void {
  const sz = computeSubtreeStats(t);
  const st = [t.root];

  while (st.length) {
    const u = st.pop()!;
    const nd = t.nodes[u];
    nd.children.sort((a, b) =>
      dir === "asc" ? sz[a] - sz[b] : sz[b] - sz[a]
    );
    for (const v of nd.children) st.push(v);
  }

  // Recompute leaf order and L/R intervals after sorting
  const leaves: number[] = [];
  function dfs(u: number) {
    const nd = t.nodes[u];
    if (nd.isLeaf) {
      nd.leafIndex = leaves.length;
      nd.L = nd.leafIndex;
      nd.R = nd.leafIndex + 1;
      leaves.push(u);
    } else {
      nd.L = Infinity as any;
      nd.R = -Infinity as any;
      for (const v of nd.children) {
        dfs(v);
        nd.L = Math.min(nd.L, t.nodes[v].L);
        nd.R = Math.max(nd.R, t.nodes[v].R);
      }
    }
  }
  dfs(t.root);
  t.leaves = leaves;
}

/** Re-root the tree at a given node (mutates the tree in place) */
export function rerootAtNode(
  t: Tree,
  newRoot: number,
  ladderizeDir: "asc" | "desc" | "none"
): void {
  const n = t.nodes.length;

  // Build undirected adjacency
  const adj: Array<Array<{ to: number; len: number }>> = Array.from(
    { length: n },
    () => []
  );
  for (const nd of t.nodes) {
    for (const ch of nd.children) {
      const len = t.nodes[ch].length;
      adj[nd.id].push({ to: ch, len });
      adj[ch].push({ to: nd.id, len });
    }
  }

  // BFS from new root to find parent relationships
  const parent = new Int32Array(n).fill(-1);
  const plen = new Float32Array(n).fill(0);
  const order: number[] = [newRoot];
  parent[newRoot] = -2; // sentinel for "no parent"

  for (let i = 0; i < order.length; i++) {
    const u = order[i];
    for (const e of adj[u]) {
      if (parent[e.to] === -1) {
        parent[e.to] = u;
        plen[e.to] = e.len;
        order.push(e.to);
      }
    }
  }

  // Rebuild children arrays
  for (const nd of t.nodes) {
    nd.parent = null;
    nd.children = [];
  }

  for (let v = 0; v < n; v++) {
    const p = parent[v];
    if (p === -2) {
      t.root = v;
      t.nodes[v].parent = null;
      t.nodes[v].length = 0;
    } else {
      t.nodes[v].parent = p;
      t.nodes[v].length = plen[v];
      t.nodes[p].children.push(v);
    }
  }

  // Recompute depth, cumLen, leafIndex, L, R
  const leaves: number[] = [];
  function dfs(u: number, d: number, c: number) {
    const nd = t.nodes[u];
    nd.depth = d;
    nd.cumLen = c;
    if (nd.isLeaf) {
      nd.leafIndex = leaves.length;
      nd.L = nd.leafIndex;
      nd.R = nd.leafIndex + 1;
      leaves.push(u);
    } else {
      nd.L = Infinity as any;
      nd.R = -Infinity as any;
      for (const v of nd.children) {
        dfs(v, d + 1, c + t.nodes[v].length);
        nd.L = Math.min(nd.L, t.nodes[v].L);
        nd.R = Math.max(nd.R, t.nodes[v].R);
      }
    }
  }
  dfs(t.root, 0, 0);
  t.leaves = leaves;

  if (ladderizeDir !== "none") {
    ladderizeTree(t, ladderizeDir);
  }
  computeLeafCounts(t);
}
