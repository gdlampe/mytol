// ============================================================
// Core tree types
// ============================================================

export type Node = {
  id: number;
  name?: string;
  parent: number | null;
  children: number[];
  length: number;
  /** Support (0–1) of the tree's default value: the last one in the label. */
  support?: number;
  /** Every number in the node label, as written (IQ-TREE "92.7/0.995/93" → [92.7, 0.995, 93]); NaN = blank part. */
  supports?: number[];
  isLeaf: boolean;
  depth: number;
  cumLen: number;
  leafIndex: number;
  /** Index of leftmost leaf in subtree */
  L: number;
  /** Index one past the rightmost leaf in subtree */
  R: number;
  propCat?: string;
};

export type Tree = {
  nodes: Node[];
  root: number;
  leaves: number[];
  nameToNode: Map<string, number>;
  /** Most support values on any node label (IQ-TREE writes one per test, e.g. SH-aLRT/aBayes/UFBoot). */
  supportCount?: number;
  /** Per value: 100 if written as a percentage (any value > 1), else 1. Divide by it for 0–1. */
  supportScale?: number[];
};

// ============================================================
// Annotation types
// ============================================================

export type AnnotationRow = {
  id: string;
  [key: string]: any;
};

export type ScaleType = "linear" | "log";

/** How a continuous ring maps values to colour/length. min/max null = automatic (from data). */
export type ContinuousStyle = {
  mode: "bar" | "gradient";
  barColor: string;
  /** Gradient colours, low → high */
  stops: string[];
  scale: ScaleType;
  /** Log base (log scale only; default 10). Auto min/max snap to powers of it. */
  logBase?: number;
  min: number | null;
  max: number | null;
};

/**
 * Categorical ring shaded by a numeric column: each category is drawn on a
 * gradient from its own low colour (default white) to its category colour.
 */
export type ShadeStyle = {
  by: string;
  low: Record<string, string>;
  scale: ScaleType;
  logBase?: number;
  min: number | null;
  max: number | null;
};

export type RingBorder = { show: boolean; color: string; width: number };

export type TrackConfig = {
  key: string;
  label: string;
  type: "categorical" | "continuous";
  height: number;
  maxVal?: number;
  visible: boolean;
  /** Continuous styling (defaults applied when absent) */
  cont?: ContinuousStyle;
  /** Categorical: optional shading by a numeric column */
  shade?: ShadeStyle | null;
  /** The user picked the type by hand (don't auto-switch it when data changes). */
  userType?: boolean;
  /** Space after this ring, px (default TRACK_PADDING). */
  gap?: number;
  /** Outline drawn around this ring. */
  border?: RingBorder;
};

// ============================================================
// UI state types
// ============================================================

export type ColoredRange = { nodeId: number; color: string; label?: string };

export type PolarCoord = { x: number; y: number; angle: number; r: number };

export type EditingColorInfo = {
  trackKey: string;
  category: string;
};
