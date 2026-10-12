import type { AnnotationRow, TrackConfig } from "../types";
import type { LegendEntry, LegendSection } from "../legend";
import type { ShapeKind } from "./band";
import type { RingModule } from "./types";
import { opt, SHAPE_CHOICES } from "./types";
import { DEFAULT_SHAPES, FIELD_PALETTE, cellBinary, drawFieldLabel, fieldColor } from "./util";

// ============================================================
// Binary ring (iTOL DATASET_BINARY): a presence / absence matrix.
// One symbol column per field; per leaf and field the cell gives
//   1 / true / yes / present → filled symbol in the field colour,
//   0 / false / no / absent  → outline only (filled with "absent fill"),
//   -1 / blank / NA / other  → nothing.
// Grid lines (iTOL HORIZONTAL_GRID / VERTICAL_GRID) are drawn underneath:
// one along each column centre and one across each row that has data.
// ============================================================

/** Below this along-extent (screen px) a leaf's slot gets no symbol. */
const MIN_SLOT_PX = 1.5;
/** Below this along-extent the per-row horizontal grid line is skipped (it would merge into a block). */
const MIN_HGRID_PX = 3;
/** Fraction of the slot (and of the column pitch) a symbol may cover (iTOL: 0.9 of the row height). */
const FIT = 0.9;

const VALID_SHAPES = new Set<string>(SHAPE_CHOICES.map(c => c.value));

function fieldShape(ring: TrackConfig, field: string, i: number): ShapeKind {
  const s = (ring.opts?.fieldShapes as Record<string, string> | undefined)?.[field];
  return s && VALID_SHAPES.has(s) ? (s as ShapeKind) : DEFAULT_SHAPES[i % DEFAULT_SHAPES.length];
}

/** Finite number option, clamped; anything else → fallback. */
function numOpt(ring: TrackConfig, key: string, fallback: number, lo: number, hi: number): number {
  const v = opt<unknown>(ring, key, fallback);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** Colour option; "" (cleared in the editor) → `cleared`. */
function colorOpt<T extends string | null>(ring: TrackConfig, key: string, fallback: string, cleared: T): string | T {
  const v = opt<unknown>(ring, key, fallback);
  return typeof v === "string" && v.trim() ? v : cleared;
}

// Cell parse cache: binary columns hold few distinct strings, rings redraw every frame.
const binCache = new Map<string, 1 | 0 | null>();

function bin(v: unknown): 1 | 0 | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? (v > 0 ? 1 : v === 0 ? 0 : null) : null;
  if (typeof v !== "string") return cellBinary(v);
  const hit = binCache.get(v);
  if (hit !== undefined) return hit;
  const b = cellBinary(v);
  if (binCache.size > 10000) binCache.clear();
  binCache.set(v, b);
  return b;
}

/** Stroke widths snap to 0.25 px so canvas/SVG batches (keyed by width) stay few. */
const snapWidth = (w: number) => Math.max(0.25, Math.round(w * 4) / 4);

// Dataset-wide: does any row hold a present / absent value in these fields?
// Computed once per rows identity (and field list).
type States = { present: boolean; absent: boolean };
const statesCache = new WeakMap<AnnotationRow[], Map<string, States>>();

function dataStates(rows: AnnotationRow[], fields: string[]): States {
  let byFields = statesCache.get(rows);
  if (!byFields) { byFields = new Map(); statesCache.set(rows, byFields); }
  const key = fields.join("\x00");
  const hit = byFields.get(key);
  if (hit) return hit;
  const st: States = { present: false, absent: false };
  outer: for (const row of rows) {
    for (const f of fields) {
      const b = bin(row[f]);
      if (b === 1) st.present = true;
      else if (b === 0) st.absent = true;
      if (st.present && st.absent) break outer;
    }
  }
  if (byFields.size > 64) byFields.clear();
  byFields.set(key, st);
  return st;
}

const binary: RingModule = {
  kind: "binary",
  title: "Binary (presence / absence)",
  description:
    "One symbol column per field: 1 / yes / true / present = filled symbol, 0 / no / false / absent = outline, -1 / blank / NA = nothing.",
  fields: { count: "many", hint: "Columns of 1 / 0 / -1 (or yes / no, true / false, present / absent)" },

  defaults(fields) {
    const fieldShapes: Record<string, ShapeKind> = {};
    const fieldColors: Record<string, string> = {};
    fields.forEach((f, i) => {
      fieldShapes[f] = DEFAULT_SHAPES[i % DEFAULT_SHAPES.length];
      fieldColors[f] = FIELD_PALETTE[i % FIELD_PALETTE.length];
    });
    return {
      fieldShapes,
      fieldColors,
      size: 10,
      spacing: 14,
      lineWidth: 1,
      absentFill: "#ffffff",
      hGrid: true,
      vGrid: true,
      gridColor: "#bbbbbb",
      gridWidth: 0.5,
      showLabels: true,
      labelSize: 10,
    };
  },

  options: [
    { key: "fieldShapes", label: "Shapes", type: "fieldShapes" },
    { key: "fieldColors", label: "Colours", type: "fieldColors" },
    {
      key: "size", label: "Symbol size", type: "number", min: 1, max: 200, step: 1, unit: "px",
      help: "Largest symbol size. Symbols shrink to fit dense leaves and the column width (iTOL HEIGHT_FACTOR).",
    },
    {
      key: "spacing", label: "Column width", type: "number", min: 2, max: 200, step: 1, unit: "px",
      help: "Width of each field column; the ring is fields × this wide (iTOL SYMBOL_SPACING).",
    },
    { key: "lineWidth", label: "Outline width", type: "number", min: 0.25, max: 10, step: 0.25, unit: "px" },
    {
      key: "absentFill", label: "Absent fill", type: "color",
      help: "Fill of outline-only (absent) symbols; iTOL uses white. Clear it to leave them hollow.",
    },
    { key: "hGrid", label: "Horizontal grid", type: "bool", help: "A line through each row's symbols (iTOL HORIZONTAL_GRID)." },
    { key: "vGrid", label: "Vertical grid", type: "bool", help: "A line along each field column (iTOL VERTICAL_GRID)." },
    { key: "gridColor", label: "Grid colour", type: "color", showIf: o => o.hGrid !== false || o.vGrid !== false },
    {
      key: "gridWidth", label: "Grid width", type: "number", min: 0, max: 10, step: 0.25, unit: "px",
      showIf: o => o.hGrid !== false || o.vGrid !== false,
    },
    { key: "showLabels", label: "Field labels", type: "bool", help: "Column names above the first leaf (iTOL SHOW_LABELS)." },
    { key: "labelSize", label: "Label size", type: "number", min: 4, max: 40, step: 1, unit: "px", showIf: o => o.showLabels !== false },
  ],

  width(ring) {
    const n = Math.max(1, ring.fields?.length ?? 0);
    return n * numOpt(ring, "spacing", 14, 1, 1000);
  },

  draw(ring, ctx) {
    const fields = ring.fields ?? [];
    const nF = fields.length;
    if (!nF || !(ctx.width > 0)) return;
    const out = ctx.out;
    const sc = ctx.scale;
    const pitch = ctx.width / nF; // screen px per field column
    const vFirst = pitch / 2;
    const vLast = pitch * (nF - 0.5);

    const symMax = Math.min(numOpt(ring, "size", 10, 0.1, 1000) * sc, pitch * FIT);
    const lw = numOpt(ring, "lineWidth", 1, 0, 50) * sc;
    const absentFill = colorOpt(ring, "absentFill", "#ffffff", null);
    const hGrid = opt<boolean>(ring, "hGrid", true) !== false;
    const vGrid = opt<boolean>(ring, "vGrid", true) !== false;
    const gridColor = colorOpt(ring, "gridColor", "#bbbbbb", "#bbbbbb");
    const gridW = numOpt(ring, "gridWidth", 0.5, 0, 50) * sc;
    const fit = Math.min(FIT, Math.max(0.05, ctx.barFill));

    // Per-field attributes (a handful of entries).
    const colors: string[] = new Array(nF);
    const shapes: ShapeKind[] = new Array(nF);
    for (let i = 0; i < nF; i++) {
      colors[i] = fieldColor(ring, fields[i], i);
      shapes[i] = fieldShape(ring, fields[i], i);
    }

    // Layer 1: grid lines, underneath the symbols.
    if (gridW > 0 && (vGrid || hGrid) && ctx.slots.length) {
      if (vGrid) {
        for (let i = 0; i < nF; i++) out.alongLine(ctx.uStart, ctx.uEnd, (i + 0.5) * pitch, gridColor, gridW);
      }
      if (hGrid && nF > 1) {
        for (const s of ctx.slots) {
          const row = s.row;
          if (!row || out.alongPx(s.lo, s.hi, vFirst) < MIN_HGRID_PX) continue;
          let any = false;
          for (let i = 0; i < nF; i++) if (bin(row[fields[i]]) !== null) { any = true; break; }
          if (!any) continue;
          const uc = (s.lo + s.hi) / 2;
          out.line(uc, vFirst, uc, vLast, gridColor, gridW);
        }
      }
      out.flush();
    }

    // Layer 2: symbols (fills, then outlines on flush).
    if (symMax > 0) {
      for (const s of ctx.slots) {
        const row = s.row;
        if (!row) continue;
        const slotPx = out.alongPx(s.lo, s.hi, vFirst);
        if (slotPx < MIN_SLOT_PX) continue;
        const sym = Math.min(symMax, slotPx * fit);
        const sw = snapWidth(Math.min(lw, sym * 0.2));
        const uc = (s.lo + s.hi) / 2;
        for (let i = 0; i < nF; i++) {
          const b = bin(row[fields[i]]);
          if (b === null) continue;
          const v = (i + 0.5) * pitch;
          if (b === 1) out.shape(shapes[i], uc, v, sym, colors[i], lw > 0 ? colors[i] : null, sw);
          else out.shape(shapes[i], uc, v, sym, absentFill, colors[i], sw);
        }
      }
    }

    // Layer 3: field labels above the first leaf (skipped when columns are too thin to hold text).
    if (opt<boolean>(ring, "showLabels", true) !== false) {
      // The user's size, scaled by the label font scale; only the column width caps it.
      const size = Math.min(numOpt(ring, "labelSize", 10, 1, 100) * ctx.fontScale, pitch * FIT);
      if (size >= 4) {
        out.flush();
        for (let i = 0; i < nF; i++) drawFieldLabel(ctx, (i + 0.5) * pitch, ctx.columnLabel(fields[i]), size);
      }
    }
  },

  legend(ring, info) {
    const fields = ring.fields ?? [];
    if (!fields.length) return [];
    const sid = `track:${ring.key}`;
    const entries: LegendEntry[] = fields.map((f, i) => ({
      id: `${sid}\x00${f}`,
      label: info.columnLabel(f),
      color: fieldColor(ring, f, i),
      fillAlpha: 1,
      shape: fieldShape(ring, f, i),
    }));
    const sections: LegendSection[] = [{ id: sid, title: ring.label, kind: "swatches", entries, more: 0 }];
    // Explain filled vs outline only when the data actually has absent values.
    const st = dataStates(info.rows, fields);
    if (st.absent) {
      const shape = fieldShape(ring, fields[0], 0);
      const grey = "#666666";
      const states: LegendEntry[] = [];
      if (st.present) states.push({ id: `${sid}\x00:present`, label: "Present", color: grey, fillAlpha: 1, shape });
      states.push({ id: `${sid}\x00:absent`, label: "Absent", color: grey, fillAlpha: 1, shape, hollow: true });
      sections.push({ id: `${sid}:states`, title: `${ring.label}: presence`, kind: "swatches", entries: states, more: 0 });
    }
    return sections;
  },

  tooltip(ring, row, info) {
    const fields = ring.fields ?? [];
    const MAX = 20;
    const lines: string[] = [];
    for (let i = 0; i < fields.length && i < MAX; i++) {
      const b = bin(row?.[fields[i]]);
      lines.push(`${info.columnLabel(fields[i])}: ${b === 1 ? "present" : b === 0 ? "absent" : "N/A"}`);
    }
    if (fields.length > MAX) lines.push(`… ${fields.length - MAX} more fields`);
    return lines;
  },
};

export default binary;
