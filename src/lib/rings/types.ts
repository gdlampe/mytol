import type { AnnotationRow, TrackConfig } from "../types";
import type { NumStats } from "../trackStyle";
import type { LegendSection } from "../legend";
import type { BandOut, ShapeKind } from "./band";

// ============================================================
// Ring modules: one per ring type (colour strip, heatmap, domains …).
// A ring is a TrackConfig; `kind` picks the module (undefined = "column",
// the original one-column ring), `fields` are the annotation columns it
// reads and `opts` holds its type-specific options.
// ============================================================

export type RingKind =
  | "column"     // one column: colour strip / bar / gradient / shaded strip
  | "multibar"   // several numeric columns as stacked or side-by-side bars
  | "heatmap"    // several numeric columns as a grid of coloured cells
  | "binary"     // several columns as filled / empty / absent shapes
  | "shapes"     // several numeric columns as shapes sized by value
  | "pie"        // several numeric columns as a pie per leaf
  | "text"       // one column printed as text
  | "domains"    // protein domain architecture per leaf
  | "boxplot"    // per-leaf distribution from a list of numbers
  | "linechart"  // per-leaf series from a list of numbers / x:y pairs
  | "alignment"; // aligned sequence per leaf

/** One leaf's slot along the ring. lo < hi, in band u units (px in rect, radians in polar). */
export type Slot = {
  leafId: number;
  name: string;
  row: AnnotationRow | undefined;
  lo: number;
  hi: number;
};

export type RingDrawContext = {
  out: BandOut;
  /** Visible, level-of-detail-sampled leaf slots, in leaf order. */
  slots: Slot[];
  /** Band thickness in screen px. */
  width: number;
  /** Screen px per design px (≠ 1 when rings zoom with the tree): scale sizes and line widths by this. */
  scale: number;
  /** Global "annotation bar fill" (fraction of a slot a cell covers, 0–2). */
  barFill: number;
  /** Along-extent of the whole leaf set (first leaf's outer edge → last leaf's), for backbones / headers. */
  uStart: number;
  uEnd: number;
  /**
   * Visible depth range of this ring in screen px (v), i.e. the part of
   * [0, width] that can be on screen. Skip work outside it (wide rings such
   * as long alignments). May extend beyond [0, width].
   */
  vMin: number;
  vMax: number;
  /** Leaf-label font scale (user option). */
  fontScale: number;
  stats: Map<string, NumStats>;
  colorMaps: Map<string, Map<string, string>>;
  /** Display name of a column (ring label of its column, or the key). */
  columnLabel: (key: string) => string;
  /**
   * Every annotation row (all leaves, not just visible ones). Same array
   * identity until the annotations change, so it can key a per-ring cache of
   * dataset-wide values (longest protein, value ranges …).
   */
  rows: AnnotationRow[];
};

/** Values that a ring's legend / tooltip / width may need. */
export type RingInfoContext = {
  stats: Map<string, NumStats>;
  colorMaps: Map<string, Map<string, string>>;
  columnLabel: (key: string) => string;
  rows: AnnotationRow[];
  /** Leaf-label font scale (user option), for widths that depend on text size. */
  fontScale: number;
};

/** Declarative option editor schema (rendered by a generic panel). */
export type OptionField = { key: string; label: string; help?: string; showIf?: (opts: Record<string, any>) => boolean } & (
  | { type: "number"; min?: number; max?: number; step?: number; unit?: string; auto?: boolean }
  | { type: "color" }
  | { type: "bool" }
  | { type: "select"; choices: Array<{ value: string; label: string }> }
  | { type: "text"; placeholder?: string }
  /** Gradient stop list (array of colours). */
  | { type: "gradient" }
  /** One colour per field: opts[key] is Record<field, colour>. */
  | { type: "fieldColors" }
  /** One shape per field: opts[key] is Record<field, ShapeKind>. */
  | { type: "fieldShapes" }
  /** Pick one annotation column. */
  | { type: "column"; numeric?: boolean; optional?: boolean }
  /** Category → colour map (opts[key] is Record<category, colour>), e.g. domain colours. */
  | { type: "categoryColors" }
);

export interface RingModule {
  kind: RingKind;
  /** Name shown in the "Add ring" menu. */
  title: string;
  /** One-line description of what it draws and the column format it expects. */
  description: string;
  /** Column requirements for creating the ring. */
  fields: { count: "one" | "many"; numeric?: boolean; hint: string };
  /** Options for a new ring over these columns. */
  defaults(fields: string[], info: RingInfoContext): Record<string, any>;
  /** Option editor schema. */
  options: OptionField[];
  /** Band thickness in design px (before zoom scaling). Defaults to track.height. */
  width?(ring: TrackConfig, info: RingInfoContext): number;
  draw(ring: TrackConfig, ctx: RingDrawContext): void;
  /** Legend sections for this ring (in order). */
  legend?(ring: TrackConfig, info: RingInfoContext): LegendSection[];
  /** Extra hover-tooltip lines for one leaf's row. */
  tooltip?(ring: TrackConfig, row: AnnotationRow | undefined, info: RingInfoContext): string[];
  /** Values listed by a "categoryColors" option editor (e.g. distinct domain names). */
  categories?(ring: TrackConfig, optKey: string, info: RingInfoContext): string[];
  /** The colour actually drawn for a category of a "categoryColors" option (editor swatches). */
  categoryColor?(ring: TrackConfig, optKey: string, cat: string, info: RingInfoContext): string;
}

/** Shapes offered in option editors. */
export const SHAPE_CHOICES: Array<{ value: ShapeKind; label: string }> = [
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "star", label: "Star" },
  { value: "triangle-right", label: "Triangle →" },
  { value: "triangle-left", label: "Triangle ←" },
  { value: "triangle-up", label: "Triangle ↑" },
  { value: "triangle-down", label: "Triangle ↓" },
  { value: "diamond", label: "Diamond" },
  { value: "hexagon", label: "Hexagon" },
  { value: "octagon", label: "Octagon" },
  { value: "check", label: "Check mark" },
  { value: "plus", label: "Plus" },
  { value: "cross", label: "Cross" },
];

/** Read a ring option with a default. */
export function opt<T>(ring: TrackConfig, key: string, fallback: T): T {
  const v = ring.opts?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}
