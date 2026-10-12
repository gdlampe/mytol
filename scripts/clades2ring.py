#!/usr/bin/env python3
"""Turn a table of clades (two leaves + colour + name per row) into a mitol ring.

Each row names a clade by two of its leaves (the clade is their last common
ancestor in the tree, like iTOL's "A|B" ranges), a colour and a label, e.g.

    VVB86198.1/60-305   QXH48823.1/1-220   #f04f27   UG9

Columns can be in any order and extra columns are ignored: the first two cells
that are leaves of the tree (or one "A|B" cell) give the clade, the first cell
that is a colour gives the colour, and the last other non-empty cell gives the
label. Every leaf under the clade gets the label; where clades are nested the
smaller one wins.

Rooting matters: IQ-TREE and most programs write trees rooted on an arbitrary
taxon, so a clade can straddle that root and swallow most of the tree. With
--root auto (default) the tree is re-rooted at its midpoint when any clade
would cover more than half the leaves; --root midpoint / asis force either.
The ring itself does not depend on rooting afterwards (each leaf has its label),
but for coloured ranges in mitol use "Re-root at midpoint" there too.

Outputs (in OUTDIR):
  <stem>.tsv         id + one column (--name) per leaf: load it in mitol and the
                     column becomes a categorical ring; "Clades from a column"
                     can also turn it into coloured ranges or collapsed clades.
  <stem>.colors.tsv  colour key (column, value, color) with the table's colours.

Usage:
  python3 scripts/clades2ring.py CLADES.tsv --tree TREE.nwk [-o OUTDIR] [--name "UG clade"] [--root auto|midpoint|asis]
"""

import argparse
import csv
import os
import re
import sys
from collections import Counter

HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
RGB = re.compile(r"^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$", re.I)


def norm_color(s):
    """Hex or rgb()/rgba() colour → lowercase #rrggbb(aa), else None."""
    s = s.strip()
    if HEX.match(s):
        h = s[1:].lower()
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return "#" + h
    m = RGB.match(s)
    if m:
        r, g, b = (max(0, min(255, int(m.group(i)))) for i in (1, 2, 3))
        out = f"#{r:02x}{g:02x}{b:02x}"
        if m.group(4) is not None and float(m.group(4)) < 1:
            out += f"{round(max(0.0, float(m.group(4))) * 255):02x}"
        return out
    return None


def parse_newick(text):
    """Minimal Newick parser → (root, parent, children, names, lengths); node 0 is the root.

    "(" opens a group as the current node's first child, "," starts a sibling,
    ")" returns to the group; a label after ")" names that group.
    """
    parent, children, names, lengths = [-1], [[]], [""], [0.0]
    cur, i, n = 0, 0, len(text)
    while i < n:
        c = text[i]
        if c == "(":
            parent.append(cur); children.append([]); names.append(""); lengths.append(0.0)
            children[cur].append(len(parent) - 1)
            cur = len(parent) - 1
            i += 1
        elif c == ",":
            p = parent[cur]
            parent.append(p); children.append([]); names.append(""); lengths.append(0.0)
            children[p].append(len(parent) - 1)
            cur = len(parent) - 1
            i += 1
        elif c == ")":
            cur = parent[cur]
            i += 1
        elif c == ":":  # branch length
            j = i + 1
            while j < n and text[j] not in ",();[":
                j += 1
            try:
                lengths[cur] = float(text[i + 1:j])
            except ValueError:
                pass
            i = j
        elif c == "[":  # comment
            i = text.index("]", i) + 1
        elif c == ";":
            break
        elif c.isspace():
            i += 1
        elif c == "'":  # quoted label
            j = i + 1
            buf = []
            while j < n:
                if text[j] == "'" and j + 1 < n and text[j + 1] == "'":
                    buf.append("'"); j += 2
                elif text[j] == "'":
                    break
                else:
                    buf.append(text[j]); j += 1
            names[cur] = "".join(buf)
            i = j + 1
        else:
            j = i
            while j < n and text[j] not in ",():;[":
                j += 1
            names[cur] = text[i:j].strip()
            i = j
    return 0, parent, children, names, lengths


class Tree:
    """Tree as an undirected graph that can be (re-)rooted; then LCA and leaves under a node."""

    def __init__(self, path):
        with open(path, encoding="utf-8-sig") as fh:
            text = fh.read()
        root, parent, children, self.names, lengths = parse_newick(text)
        self.adj = [[] for _ in parent]
        for v, p in enumerate(parent):
            if p >= 0:
                self.adj[v].append((p, lengths[v]))
                self.adj[p].append((v, lengths[v]))
        self.leaf = {self.names[v]: v for v in range(len(parent)) if not children[v]}
        self.set_root(root)

    def set_root(self, root):
        n = len(self.adj)
        self.root = root
        self.parent = [-1] * n
        self.depth = [0] * n
        seen = [False] * n
        seen[root] = True
        order = [root]
        for u in order:
            for v, _ in self.adj[u]:
                if not seen[v]:
                    seen[v] = True
                    self.parent[v] = u
                    self.depth[v] = self.depth[u] + 1
                    order.append(v)
        self.leaves_under = [None] * n
        for u in reversed(order):
            kids = [v for v, _ in self.adj[u] if self.parent[v] == u]
            self.leaves_under[u] = [self.names[u]] if not kids else [x for v in kids for x in self.leaves_under[v]]

    def midpoint_root(self):
        """Re-root halfway along the longest leaf-to-leaf path (adds a root node)."""
        def farthest(src):
            dist, prev, stack = {src: 0.0}, {src: None}, [src]
            while stack:
                u = stack.pop()
                for v, l in self.adj[u]:
                    if v not in dist:
                        dist[v], prev[v] = dist[u] + l, u
                        stack.append(v)
            far = max(self.leaf.values(), key=lambda x: dist[x])
            return far, dist, prev
        a, _, _ = farthest(next(iter(self.leaf.values())))
        b, dist, prev = farthest(a)
        path = [b]
        while prev[path[-1]] is not None:
            path.append(prev[path[-1]])
        half = dist[b] / 2
        from_b = [dist[b] - dist[x] for x in path]
        k = next(i for i in range(len(path) - 1) if from_b[i] <= half <= from_b[i + 1])
        u, v = path[k], path[k + 1]
        r = len(self.adj)
        self.adj.append([(u, half - from_b[k]), (v, from_b[k + 1] - half)])
        self.names.append("")
        self.adj[u] = [(w, l) for w, l in self.adj[u] if w != v] + [(r, half - from_b[k])]
        self.adj[v] = [(w, l) for w, l in self.adj[v] if w != u] + [(r, from_b[k + 1] - half)]
        self.set_root(r)

    def lca(self, a, b):
        while self.depth[a] > self.depth[b]:
            a = self.parent[a]
        while self.depth[b] > self.depth[a]:
            b = self.parent[b]
        while a != b:
            a, b = self.parent[a], self.parent[b]
        return a


def read_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        text = fh.read()
    delim = "\t" if "\t" in text.split("\n", 1)[0] or not path.lower().endswith(".csv") else ","
    return [[c.strip() for c in r] for r in csv.reader(text.splitlines(), delimiter=delim)]


def resolve(tree, rows):
    """Clades from table rows: [{line, ids, node, label, color, size}], warnings."""
    clades, warnings = [], []
    for ln, cells in enumerate(rows, 1):
        cells = [c for c in cells if c != ""]
        if not cells:
            continue
        ids = []
        for c in cells:
            if "|" in c and all(p in tree.leaf for p in c.split("|")):
                ids = c.split("|")[:2]
                break
            if c in tree.leaf and c not in ids:
                ids.append(c)
                if len(ids) == 2:
                    break
        color = next((norm_color(c) for c in cells if norm_color(c)), None)
        rest = [c for c in cells if c not in tree.leaf and "|" not in c and not norm_color(c)]
        label = rest[-1] if rest else None
        if not ids or not label:
            warnings.append(f"line {ln}: skipped (needs leaves of the tree and a label): {' | '.join(cells)}")
            continue
        node = tree.lca(tree.leaf[ids[0]], tree.leaf[ids[-1]])
        clades.append({"line": ln, "ids": ids, "node": node, "label": label, "color": color,
                       "size": len(tree.leaves_under[node])})
    return clades, warnings


def write(path, lines):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__.split("\n\n", 1)[1])
    ap.add_argument("table", help="clade table (TSV or CSV)")
    ap.add_argument("--tree", required=True, help="Newick tree the clades refer to")
    ap.add_argument("-o", "--outdir", help="output folder (default: next to the table)")
    ap.add_argument("--name", default="clade", help='ring/column name (default: "clade")')
    ap.add_argument("--root", choices=["auto", "midpoint", "asis"], default="auto",
                    help="auto (default): midpoint-root only if a clade would cover more than half the leaves")
    args = ap.parse_args()
    for path in (args.table, args.tree):
        if not os.path.isfile(path):
            sys.exit(f"error: no such file: {path}")

    tree = Tree(args.tree)
    rows = read_rows(args.table)
    outdir = args.outdir or os.path.dirname(os.path.abspath(args.table))
    os.makedirs(outdir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(args.table))[0]

    if args.root == "midpoint":
        tree.midpoint_root()
    clades, warnings = resolve(tree, rows)
    half = len(tree.leaf) / 2
    if any(c["size"] > half for c in clades):
        big = ", ".join(c["label"] for c in clades if c["size"] > half)
        if args.root == "auto":
            tree.midpoint_root()
            clades, warnings = resolve(tree, rows)
            print(f"note: {big} covered more than half the tree with its original root; re-rooted at the midpoint")
        else:
            warnings.append(f"{big} covers more than half the tree; the root may be in the wrong place (try --root midpoint)")
    if not clades:
        sys.exit("error: no usable rows (each needs two leaves of the tree or an A|B id, and a label)")

    # Larger clades first so nested (smaller) clades overwrite them.
    assign = {}
    for c in sorted(clades, key=lambda c: -c["size"]):
        for leaf in tree.leaves_under[c["node"]]:
            assign[leaf] = c["label"]

    colors = {}
    for label in dict.fromkeys(c["label"] for c in clades):
        cs = Counter(c["color"] for c in clades if c["label"] == label and c["color"])
        if cs:
            colors[label] = cs.most_common(1)[0][0]
            if len(cs) > 1:
                warnings.append(f"{label}: several colours {sorted(cs)}; using {colors[label]}")

    leaf_order = tree.leaves_under[tree.root]
    write(os.path.join(outdir, f"{stem}.tsv"),
          [f"id\t{args.name}"] + [f"{leaf}\t{assign[leaf]}" for leaf in leaf_order if leaf in assign])
    write(os.path.join(outdir, f"{stem}.colors.tsv"),
          ["column\tvalue\tcolor"] + [f"{args.name}\t{label}\t{col}" for label, col in colors.items()])

    print(f"{len(clades)} clades → {len(assign)} of {len(leaf_order)} leaves labelled, {len(colors)} labels")
    for c in clades:
        others = sum(1 for leaf in tree.leaves_under[c["node"]] if assign[leaf] != c["label"])
        note = f" ({others} taken by smaller clades inside)" if others else ""
        print(f"  {c['label']:<8} {c['size']:>5} leaves  {c['color'] or '-'}  {'|'.join(c['ids'])}{note}")
    for w in warnings:
        print("warning:", w, file=sys.stderr)
    print(f"wrote {os.path.join(outdir, stem + '.tsv')} and {stem}.colors.tsv")


if __name__ == "__main__":
    main()
