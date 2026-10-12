import type { AnnotationRow, TrackConfig } from "../types";
import { fmtNum, logBaseName, makeValueScale, validLogBase } from "../trackStyle";
import type { NumStats, ValueScale } from "../trackStyle";
import { hexToRgb } from "../colorUtils";
import type { LegendEntry, LegendSection } from "../legend";
import type { ShapeKind } from "./band";
import { SHAPE_CHOICES, opt } from "./types";
import type { RingDrawContext, RingInfoContext, RingModule } from "./types";
import { FIELD_PALETTE, cellNumber, drawFieldLabel, fieldColor, fieldLabelSize } from "./util";

// ============================================================
// External shapes (iTOL DATASET_EXTERNALSHAPE): one column per numeric field,
// one shape per leaf and field, sized by the value — a dot / bubble matrix.
// As in iTOL the shape's diameter is linear in the value (largest value =
// full size, values ≤ 0 draw nothing); "area" and "log" sizing are extras.
// Light grid lines (on by default, 0.5 px #bbbbbb), optional value text and
// field labels.
// ============================================================

type SizeBy = "diameter" | "area" | "log";

const DEFAULT_SPACING = 16;
const DEFAULT_GRID_COLOR = "#bbbbbb";
const DEFAULT_GRID_WIDTH = 0.5;
/** Smallest shape drawn (screen px); below FAST_PX shapes are drawn as plain cells. */
const MIN_PX = 0.5;
const FAST_PX = 2.5;
/** Log sizing: the smallest value still gets this fraction of the full size. */
const LOG_FLOOR = 0.1;

/** Finite number option, clamped; anything else → fallback. */
function num(ring: TrackConfig, key: string, fallback: number, lo: number, hi: number): number {
  const v = Number(opt<unknown>(ring, key, fallback));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/** Optional number option (null / blank / non-finite = automatic). */
function autoNum(ring: TrackConfig, key: string): number | null {
  const raw = ring.opts?.[key];
  if (raw === null || raw === undefined || raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** Boolean option (anything but false / "false" / 0 counts as the stored truthiness). */
function flag(ring: TrackConfig, key: string, fallback: boolean): boolean {
  const v = opt<unknown>(ring, key, fallback);
  return v === "false" || v === "0" ? false : !!v;
}

const fieldsOf = (ring: TrackConfig) => ring.fields ?? [];
const spacingOf = (ring: TrackConfig) => num(ring, "spacing", DEFAULT_SPACING, 2, 400);
const maxSizeOf = (ring: TrackConfig) => {
  const sp = spacingOf(ring);
  const m = autoNum(ring, "maxSize");
  return m !== null && m > 0 ? Math.min(m, 400) : Math.max(1, sp - 2);
};
const sizeByOf = (ring: TrackConfig): SizeBy => {
  const s = opt<string>(ring, "sizeBy", "diameter");
  return s === "area" || s === "log" ? s : "diameter";
};
const shapeOf = (ring: TrackConfig): ShapeKind => {
  const s = opt<string>(ring, "shape", "circle");
  return SHAPE_CHOICES.some(c => c.value === s) ? (s as ShapeKind) : "circle";
};
/** Field colour; a cleared ("") entry falls back to the palette colour. */
const colorOf = (ring: TrackConfig, field: string, k: number) =>
  fieldColor(ring, field, k) || FIELD_PALETTE[k % FIELD_PALETTE.length];

// ------------------------------------------------------------
// Dataset-wide values (cached per rows identity)
// ------------------------------------------------------------

/** Per-column numeric stats, computed once per rows array. */
const statsCache = new WeakMap<AnnotationRow[], Map<string, NumStats>>();

function fieldStats(rows: AnnotationRow[], field: string): NumStats {
  let m = statsCache.get(rows);
  if (!m) { m = new Map(); statsCache.set(rows, m); }
  let s = m.get(field);
  if (!s) {
    s = { min: Infinity, max: -Infinity, minPos: Infinity, count: 0 };
    for (let i = 0; i < rows.length; i++) {
      const n = cellNumber(rows[i][field]);
      if (n === null) continue;
      s.count++;
      if (n < s.min) s.min = n;
      if (n > s.max) s.max = n;
      if (n > 0 && n < s.minPos) s.minPos = n;
    }
    m.set(field, s);
  }
  return s;
}

/** Maps a value of field k to a size fraction (0 = draw nothing, 1 = full size). */
type Sizer = {
  frac: (v: number, k: number) => number;
  /** Legend note describing the scale. */
  note: string;
};

const sizerCache = new WeakMap<AnnotationRow[], Map<string, Sizer>>();

function sizerFor(ring: TrackConfig, rows: AnnotationRow[]): Sizer {
  const fields = fieldsOf(ring);
  const sizeBy = sizeByOf(ring);
  const perField = flag(ring, "perField", false);
  const userMax = autoNum(ring, "max");
  const base = validLogBase(autoNum(ring, "logBase") ?? undefined);
  const key = `${sizeBy}|${perField ? 1 : 0}|${userMax}|${sizeBy === "log" ? base : ""}|${fields.join("\x00")}`;
  let m = sizerCache.get(rows);
  if (!m) { m = new Map(); sizerCache.set(rows, m); }
  const hit = m.get(key);
  if (hit) return hit;

  const stats = fields.map(f => fieldStats(rows, f));
  const merged: NumStats = { min: Infinity, max: -Infinity, minPos: Infinity, count: 0 };
  for (const s of stats) {
    merged.count += s.count;
    merged.min = Math.min(merged.min, s.min);
    merged.max = Math.max(merged.max, s.max);
    merged.minPos = Math.min(merged.minPos, s.minPos);
  }
  const statOf = (k: number) => (perField ? stats[k] : merged);
  let sizer: Sizer;

  if (sizeBy === "log") {
    const scales: ValueScale[] = fields.map((_, k) =>
      makeValueScale({ scale: "log", min: null, max: userMax !== null && userMax > 0 ? userMax : null, logBase: base }, statOf(k)));
    const sc0 = scales[0];
    sizer = {
      frac: (v, k) => (v > 0 && statOf(k).count ? LOG_FLOOR + (1 - LOG_FLOOR) * scales[k].t(v) : 0),
      note: `Size ∝ ${logBaseName(base)} value` + (perField || !sc0 ? ", per field" : ` (${fmtNum(sc0.lo)} – ${fmtNum(sc0.hi)})`),
    };
  } else {
    // Full size: user max, else the largest value (per field or overall).
    const full = fields.map((_, k) => (userMax !== null && userMax > 0 ? userMax : statOf(k).max));
    const area = sizeBy === "area";
    sizer = {
      frac: (v, k) => {
        const f = full[k];
        if (!(v > 0) || !(f > 0)) return 0;
        const t = v >= f ? 1 : v / f;
        return area ? Math.sqrt(t) : t;
      },
      note: `${area ? "Area" : "Size"} ∝ value; full size = ` +
        (userMax !== null && userMax > 0 ? fmtNum(userMax) : perField ? "each field's maximum" : merged.max > 0 ? fmtNum(merged.max) : "–"),
    };
  }
  if (m.size > 64) m.clear();
  m.set(key, sizer);
  return sizer;
}

// ------------------------------------------------------------
// Value text colour
// ------------------------------------------------------------

const lumCache = new Map<string, string>();

/** Black or white, whichever reads better on `color` (hex). */
function contrastText(color: string): string {
  let c = lumCache.get(color);
  if (c) return c;
  let hex = color.trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(hex);
  const [r, g, b] = /^#[0-9a-f]{6}/i.test(hex) ? hexToRgb(hex.slice(0, 7)) : m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  c = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000000" : "#ffffff";
  if (lumCache.size > 1000) lumCache.clear();
  lumCache.set(color, c);
  return c;
}

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const shapes: RingModule = {
  kind: "shapes",
  title: "Shapes sized by value",
  description:
    "Several numeric columns, one column of shapes each; a shape's size is proportional to the value (largest value = full size, values ≤ 0 are not drawn), like iTOL external shapes.",
  fields: { count: "many", numeric: true, hint: "Numeric columns (one shape column per field)" },

  defaults(fields: string[], _info: RingInfoContext) {
    const fieldColors: Record<string, string> = {};
    fields.forEach((f, i) => { fieldColors[f] = FIELD_PALETTE[i % FIELD_PALETTE.length]; });
    return {
      shape: "circle",
      fieldColors,
      filled: true,
      spacing: DEFAULT_SPACING,
      maxSize: null,
      sizeBy: "diameter",
      logBase: 10,
      perField: false,
      max: null,
      hGrid: true,
      vGrid: true,
      gridColor: DEFAULT_GRID_COLOR,
      gridWidth: DEFAULT_GRID_WIDTH,
      fieldLabels: true,
      showValues: false,
      valueColor: "#000000",
      valueAuto: false,
    };
  },

  options: [
    { key: "shape", label: "Shape", type: "select", choices: SHAPE_CHOICES },
    { key: "fieldColors", label: "Field colours", type: "fieldColors" },
    { key: "filled", label: "Filled shapes", type: "bool", help: "Off: outlines only (iTOL COLOR_FILL 0)." },
    { key: "spacing", label: "Column spacing", type: "number", min: 2, max: 400, step: 1, unit: "px", help: "Width of each field's column; the ring is fields × spacing wide." },
    { key: "maxSize", label: "Maximum shape size", type: "number", min: 1, max: 400, step: 1, unit: "px", auto: true, help: "Size of the largest value (auto: spacing − 2). Shapes also shrink to the leaf spacing × annotation bar fill and never exceed the column width." },
    {
      key: "sizeBy", label: "Size by", type: "select",
      choices: [
        { value: "diameter", label: "Value ∝ diameter (iTOL)" },
        { value: "area", label: "Value ∝ area" },
        { value: "log", label: "Log of value" },
      ],
    },
    { key: "logBase", label: "Log base", type: "number", min: 1.01, step: 1, showIf: o => o.sizeBy === "log" },
    { key: "perField", label: "Scale each field separately", type: "bool", help: "Off: one scale for all fields (largest value overall = full size), as in iTOL." },
    { key: "max", label: "Value at full size", type: "number", auto: true, help: "Auto: the largest value. Larger values are drawn at full size." },
    { key: "hGrid", label: "Horizontal grid lines", type: "bool" },
    { key: "vGrid", label: "Vertical grid lines", type: "bool" },
    { key: "gridColor", label: "Grid colour", type: "color", showIf: o => o.hGrid !== false || o.vGrid !== false },
    { key: "gridWidth", label: "Grid line width", type: "number", min: 0.1, max: 10, step: 0.1, unit: "px", showIf: o => o.hGrid !== false || o.vGrid !== false },
    { key: "fieldLabels", label: "Field labels", type: "bool" },
    { key: "showValues", label: "Show values", type: "bool", help: "Value text centred on each shape (when there is room)." },
    { key: "valueColor", label: "Value colour", type: "color", showIf: o => !!o.showValues },
    { key: "valueAuto", label: "Auto black / white values", type: "bool", help: "Pick black or white text from the field colour (filled shapes).", showIf: o => !!o.showValues },
  ],

  width(ring) {
    return Math.max(1, fieldsOf(ring).length) * spacingOf(ring);
  },

  draw(ring, ctx: RingDrawContext) {
    const fields = fieldsOf(ring);
    const n = fields.length;
    if (!n) return;
    const out = ctx.out;
    const slots = ctx.slots;
    const colW = ctx.width / n;
    const sizer = sizerFor(ring, ctx.rows);
    const shape = shapeOf(ring);
    const filled = flag(ring, "filled", true);
    const lineW = Math.max(0.5, ctx.scale);
    const colors = fields.map((f, k) => colorOf(ring, f, k));
    const vOf = (k: number) => (k + 0.5) * colW;
    // Columns overlapping the visible depth range (everything drawn for
    // column k stays inside [k, k + 1] × colW; 2 px slack for strokes).
    const kLo = Math.max(0, Math.ceil(((ctx.vMin ?? -Infinity) - 2) / colW) - 1);
    const kHi = Math.min(n - 1, Math.floor(((ctx.vMax ?? Infinity) + 2) / colW));

    // One size cap for every shape (so equal values look equal everywhere):
    // the maximum size, shrunk to the mean slot extent at the innermost
    // column × the bar fill (like iTOL, where shapes follow the row height).
    let slotPx = 0;
    for (let i = 0; i < slots.length; i++) slotPx += out.alongPx(slots[i].lo, slots[i].hi, vOf(0));
    slotPx = slots.length ? slotPx / slots.length : 0;
    const maxPx = maxSizeOf(ring) * ctx.scale;
    const fill = Math.max(0.05, ctx.barFill);
    const slotCap = Math.min(maxPx, slotPx * fill);
    // Never wider than the column (maxSize may exceed the spacing).
    const maxDepth = colW * 0.95;
    const cap = Math.min(slotCap, maxDepth);
    // Leaves too close for shapes: each value becomes a cell spanning its slot
    // (× bar fill) whose depth is the size the shape would have at full zoom.
    const dense = slotCap < FAST_PX;
    const inset = (1 - fill) / 2;

    // ---- Grid (underneath the shapes) ----
    const hGrid = flag(ring, "hGrid", true);
    const vGrid = flag(ring, "vGrid", true);
    if (hGrid || vGrid) {
      const gc = opt<string>(ring, "gridColor", DEFAULT_GRID_COLOR) || DEFAULT_GRID_COLOR;
      const gw = Math.max(0.25, num(ring, "gridWidth", DEFAULT_GRID_WIDTH, 0, 50) * ctx.scale);
      if (vGrid && colW >= 3) for (let k = kLo; k <= kHi; k++) out.alongLine(ctx.uStart, ctx.uEnd, vOf(k), gc, gw);
      if (hGrid && slotPx >= 3) {
        const v0 = vOf(0), v1 = vOf(n - 1);
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          const row = s.row;
          if (!row) continue;
          let any = false;
          for (let k = 0; k < n && !any; k++) any = cellNumber(row[fields[k]]) !== null;
          if (!any) continue;
          const u = (s.lo + s.hi) / 2;
          if (n > 1) out.line(u, v0, u, v1, gc, gw);
          else out.line(u, v0 - colW / 2, u, v0 + colW / 2, gc, gw);
        }
      }
      out.flush();
    }

    // ---- Shapes ----
    {
      // Screen px per u unit at each column centre (u extents of tiny cells).
      const pxPerU = dense ? null : fields.map((_, k) => Math.max(1e-9, out.alongPx(0, 1, vOf(k))));
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const row = s.row;
        if (!row) continue;
        const u = (s.lo + s.hi) / 2;
        const w = s.hi - s.lo;
        for (let k = kLo; k <= kHi; k++) {
          const val = cellNumber(row[fields[k]]);
          if (val === null) continue;
          const v = vOf(k);
          if (!pxPerU) {
            const depth = Math.min(sizer.frac(val, k) * maxPx, maxDepth);
            if (depth >= MIN_PX) out.fillCell(s.lo + w * inset, s.hi - w * inset, v - depth / 2, v + depth / 2, colors[k]);
            continue;
          }
          const size = sizer.frac(val, k) * cap;
          if (size < MIN_PX) continue;
          if (size < FAST_PX) {
            // Too small to tell shapes apart: a plain cell is cheaper and crisper.
            const du = size / 2 / pxPerU[k];
            out.fillCell(u - du, u + du, v - size / 2, v + size / 2, colors[k]);
          } else if (filled) {
            out.shape(shape, u, v, size, colors[k]);
          } else {
            out.shape(shape, u, v, size, null, colors[k], lineW);
          }
        }
      }
      out.flush();
    }

    // ---- Value text ----
    if (flag(ring, "showValues", false) && slotPx >= 6) {
      const auto = flag(ring, "valueAuto", false);
      const vc = opt<string>(ring, "valueColor", "#000000") || "#000000";
      const base = Math.min(colW * 0.45, slotPx * 0.6, 10 * ctx.scale * ctx.fontScale);
      if (base >= 5) {
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          const row = s.row;
          if (!row) continue;
          const u = (s.lo + s.hi) / 2;
          for (let k = kLo; k <= kHi; k++) {
            const val = cellNumber(row[fields[k]]);
            if (val === null) continue;
            const txt = fmtNum(val);
            const size = Math.min(base, (colW * 0.95) / (0.6 * txt.length));
            if (size < 5) continue;
            const shapePx = sizer.frac(val, k) * cap;
            const color = auto && filled && shapePx >= size * 1.6 ? contrastText(colors[k]) : vc;
            out.text(u, vOf(k), txt, { size, color, anchor: "middle", orient: "radial" });
          }
        }
      }
    }

    // ---- Field labels ----
    if (flag(ring, "fieldLabels", true)) {
      // Labels are stacked across the columns: never taller than a column.
      const fs = Math.min(fieldLabelSize(ctx), colW * 0.9);
      if (fs >= 5) for (let k = kLo; k <= kHi; k++) drawFieldLabel(ctx, vOf(k), ctx.columnLabel(fields[k]), fs);
    }
  },

  legend(ring, info): LegendSection[] {
    const fields = fieldsOf(ring);
    if (!fields.length) return [];
    const shape = shapeOf(ring);
    const hollow = !flag(ring, "filled", true);
    const MAX_ENTRIES = 60;
    const entries: LegendEntry[] = fields.slice(0, MAX_ENTRIES).map((f, k) => ({
      id: `track:${ring.key}\x00${f}`,
      label: info.columnLabel(f),
      color: colorOf(ring, f, k),
      fillAlpha: 1,
      shape,
      hollow,
    }));
    return [{
      id: `track:${ring.key}`,
      title: ring.label,
      note: sizerFor(ring, info.rows).note,
      kind: "swatches",
      entries,
      more: Math.max(0, fields.length - MAX_ENTRIES),
    }];
  },

  tooltip(ring, row, info) {
    if (!row) return [];
    const fields = fieldsOf(ring);
    const lines: string[] = [];
    const MAX_LINES = 20;
    let shown = 0, rest = 0;
    for (const f of fields) {
      const raw = row[f];
      if (raw === null || raw === undefined || raw === "") continue;
      if (shown >= MAX_LINES) { rest++; continue; }
      const v = cellNumber(raw);
      lines.push(`${info.columnLabel(f)}: ${v !== null ? fmtNum(v) : String(raw)}`);
      shown++;
    }
    if (rest) lines.push(`… ${rest} more`);
    return lines;
  },
};

export default shapes;
