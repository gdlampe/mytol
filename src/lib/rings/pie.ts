import type { AnnotationRow, TrackConfig } from "../types";
import type { LegendEntry, LegendSection } from "../legend";
import { fmtNum } from "../trackStyle";
import type { BandOut } from "./band";
import type { OptionField, RingDrawContext, RingInfoContext, RingModule } from "./types";
import { opt } from "./types";
import { FIELD_PALETTE, drawFieldLabel, fieldColor, fieldLabelSize } from "./util";

// ============================================================
// Pie chart ring (iTOL DATASET_PIECHART, external pies at position -1):
// one pie per leaf from 2+ numeric columns, one slice per column.
// Like iTOL, the first slice starts at 12 o'clock, slices run clockwise in
// field order and pies keep their screen orientation in circular layouts.
// Optional polar-area style (iTOL POLAR_AREA_DIAGRAM): equal-angle wedges
// whose radius is linear in the value (relative to the leaf's largest).
// Blank, non-numeric and negative cells count as 0.
// ============================================================

type RadiusMode = "fixed" | "scaled" | "column";
type PieStyle = "pie" | "polar";

/** Pies whose fitted radius would be below this (screen px) switch to the dense view. */
const LOD_MIN_R = 1.5;
/** Fraction of the slot pitch a pie spans at barFill 1 (iTOL: 0.45 × leaf pitch radius). */
const PITCH_FRAC = 0.45;
/** Below this radius (screen px) slice borders are skipped. */
const BORDER_MIN_R = 3;

// ------------------------------------------------------------
// Cell parsing (cached: cells repeat and rings redraw every frame)
// ------------------------------------------------------------

const numCache = new Map<string, number>();

/** Finite number from a cell (accepts a trailing %), or NaN (blank / text / ±Infinity). */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (v === null || v === undefined || v === "") return NaN;
  const s = typeof v === "string" ? v : String(v);
  const hit = numCache.get(s);
  if (hit !== undefined) return hit;
  let t = s.trim();
  if (t.endsWith("%")) t = t.slice(0, -1).trim();
  let n = t === "" ? NaN : Number(t);
  if (!Number.isFinite(n)) n = NaN;
  if (numCache.size > 100000) numCache.clear();
  numCache.set(s, n);
  return n;
}

/** Slice weight of a cell: positive numbers only. */
const weight = (v: unknown) => {
  const n = num(v);
  return n > 0 ? n : 0;
};

// ------------------------------------------------------------
// Dataset-wide values (once per rows identity + fields)
// ------------------------------------------------------------

type DataStats = { maxTotal: number; maxSize: number };
const statsCache = new WeakMap<AnnotationRow[], Map<string, DataStats>>();

function dataStats(rows: AnnotationRow[], fields: string[], sizeField: string): DataStats {
  const key = `${fields.join("\x01")}\x02${sizeField}`;
  let m = statsCache.get(rows);
  if (!m) { m = new Map(); statsCache.set(rows, m); }
  const hit = m.get(key);
  if (hit) return hit;
  let maxTotal = 0, maxSize = 0;
  const n = fields.length;
  for (const row of rows) {
    let t = 0;
    for (let i = 0; i < n; i++) t += weight(row[fields[i]]);
    if (t > maxTotal) maxTotal = t;
    if (sizeField) {
      const z = num(row[sizeField]);
      if (z > maxSize) maxSize = z;
    }
  }
  const s = { maxTotal, maxSize };
  if (m.size > 32) m.clear();
  m.set(key, s);
  return s;
}

// ------------------------------------------------------------
// Options
// ------------------------------------------------------------

type PieOpts = {
  fields: string[];
  style: PieStyle;
  mode: RadiusMode;
  sizeField: string;
  maxR: number;
  minR: number;
};

const finite = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function readOpts(ring: TrackConfig): PieOpts {
  const fields = ring.fields ?? [];
  const style: PieStyle = opt<string>(ring, "style", "pie") === "polar" ? "polar" : "pie";
  let mode = opt<string>(ring, "radiusMode", "fixed") as RadiusMode;
  if (mode !== "scaled" && mode !== "column") mode = "fixed";
  const sizeField = mode === "column" ? opt<string>(ring, "sizeField", "") : "";
  if (mode === "column" && !sizeField) mode = "fixed";
  const maxR = Math.max(0.5, Math.min(500, finite(opt(ring, "maxRadius", 8), 8)));
  const minR = mode === "fixed" ? 0 : Math.max(0, Math.min(maxR, finite(opt(ring, "minRadius", 2), 2)));
  return { fields, style, mode, sizeField, maxR, minR };
}

/** Pie radius in design px for a row with this slice total (before fitting to the slot). */
function designRadius(o: PieOpts, ds: DataStats | null, row: AnnotationRow, total: number): number {
  if (o.mode === "scaled" && ds && ds.maxTotal > 0) return Math.max(o.minR, o.maxR * Math.sqrt(total / ds.maxTotal));
  if (o.mode === "column" && ds) {
    const z = num(row[o.sizeField]);
    return ds.maxSize > 0 && z > 0 ? Math.max(o.minR, (o.maxR * z) / ds.maxSize) : o.minR;
  }
  return o.maxR;
}

// ------------------------------------------------------------
// Drawing helpers
// ------------------------------------------------------------

/** Band coordinates of a screen point (exact inverse of out.xy). */
function toBand(out: BandOut, x: number, y: number): [number, number] {
  const g = out.geom;
  if (g.kind === "rect") return [y, x - g.x0];
  return [Math.atan2(y - g.cy, x - g.cx), Math.hypot(x - g.cx, y - g.cy) - g.r0];
}

/** Lines from the pie centre to each slice boundary (iTOL strokes every slice). */
function sliceBorders(out: BandOut, u: number, v: number, r: number, vals: number[], n: number, total: number, color: string, w: number) {
  const [x, y] = out.xy(u, v);
  let a = -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const val = vals[i];
    if (!(val > 0)) continue;
    const [bu, bv] = toBand(out, x + r * Math.cos(a), y + r * Math.sin(a));
    out.line(u, v, bu, bv, color, w);
    a += (val / total) * 2 * Math.PI;
  }
}

/**
 * Polar area diagram: n equal wedges from 12 o'clock clockwise, wedge i of
 * radius r · v_i / max(v). Drawn in screen orientation (local frame counter-rotated).
 */
function polarArea(out: BandOut, u: number, v: number, r: number, vals: number[], n: number, vmax: number,
  colors: string[], stroke: string | null, sw: number) {
  const theta = out.geom.kind === "polar" ? u : 0;
  const c = Math.cos(theta), s = Math.sin(theta);
  const da = (2 * Math.PI) / n;
  for (let i = 0; i < n; i++) {
    const val = vals[i];
    if (!(val > 0)) continue;
    const ri = (r * val) / vmax;
    if (n === 1) { out.shape("circle", u, v, 2 * ri, colors[i], stroke, sw); continue; }
    const a0 = -Math.PI / 2 + i * da;
    const segs = Math.max(2, Math.min(32, Math.ceil((ri * da) / 2)));
    const pts: Array<[number, number]> = [[0, 0]];
    for (let j = 0; j <= segs; j++) {
      const a = a0 + (da * j) / segs;
      const dx = ri * Math.cos(a), dy = ri * Math.sin(a);
      pts.push([dx * c + dy * s, -dx * s + dy * c]);
    }
    out.localPolygon(u, v, pts, colors[i], stroke, sw);
  }
}

// Reused per-slot value buffer (draw is synchronous; BandOut does not keep it).
const scratch: number[] = [];

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const options: OptionField[] = [
  {
    key: "style", label: "Style", type: "select",
    choices: [{ value: "pie", label: "Pie chart" }, { value: "polar", label: "Polar area diagram" }],
    help: "Polar area: equal-angle wedges whose radius is proportional to the value (relative to the leaf's largest value), as in iTOL.",
  },
  {
    key: "radiusMode", label: "Pie size", type: "select",
    choices: [
      { value: "fixed", label: "Fixed" },
      { value: "scaled", label: "Scaled by row total" },
      { value: "column", label: "From a column" },
    ],
    help: "Scaled: pie area proportional to the sum of the leaf's values. From a column: radius proportional to that column's value (iTOL radius field).",
  },
  { key: "sizeField", label: "Size column", type: "column", numeric: true, showIf: o => o.radiusMode === "column" },
  { key: "maxRadius", label: "Maximum radius", type: "number", min: 1, max: 100, step: 0.5, unit: "px",
    help: "Radius of the largest pie. Pies shrink to fit when leaves are dense." },
  { key: "minRadius", label: "Minimum radius", type: "number", min: 0, max: 100, step: 0.5, unit: "px",
    showIf: o => o.radiusMode === "scaled" || o.radiusMode === "column" },
  { key: "fieldColors", label: "Slice colours", type: "fieldColors" },
  { key: "outlineWidth", label: "Border width", type: "number", min: 0, max: 5, step: 0.25, unit: "px", help: "0 = no border." },
  { key: "outlineColor", label: "Border colour", type: "color", showIf: o => Number(o.outlineWidth) > 0 },
  { key: "sliceBorders", label: "Border every slice", type: "bool", showIf: o => Number(o.outlineWidth) > 0 },
  { key: "denseBars", label: "Stacked bars when dense", type: "bool",
    help: "When pies would be too small to read, show each leaf's proportions as a stacked bar instead of a dot of its largest slice." },
  { key: "showLabel", label: "Show ring label", type: "bool" },
];

const pie: RingModule = {
  kind: "pie",
  title: "Pie charts",
  description: "Several numeric columns as one pie chart per leaf (one slice per column), optionally sized by the row total or a column.",
  fields: { count: "many", numeric: true, hint: "Two or more numeric columns (one slice each)" },

  defaults(fields) {
    const fieldColors: Record<string, string> = {};
    fields.forEach((f, i) => { fieldColors[f] = FIELD_PALETTE[i % FIELD_PALETTE.length]; });
    return {
      style: "pie",
      radiusMode: "fixed",
      sizeField: "",
      maxRadius: 8,
      minRadius: 2,
      fieldColors,
      outlineWidth: 0,
      outlineColor: "#000000",
      sliceBorders: true,
      denseBars: true,
      showLabel: false,
    };
  },

  options,

  width(ring) {
    return 2 * readOpts(ring).maxR + 4;
  },

  draw(ring, ctx: RingDrawContext) {
    const o = readOpts(ring);
    const n = o.fields.length;
    const out = ctx.out;
    const vc = ctx.width / 2;
    if (n > 0 && ctx.slots.length > 0) {
      const ds = o.mode === "fixed" ? null : dataStats(ctx.rows, o.fields, o.sizeField);
      const colors = o.fields.map((f, i) => fieldColor(ring, f, i));
      const scale = ctx.scale > 0 ? ctx.scale : 1;
      const ow = Math.max(0, finite(opt(ring, "outlineWidth", 0), 0)) * scale;
      const oc = ow > 0 ? opt(ring, "outlineColor", "#000000") : null;
      const borders = !!oc && opt(ring, "sliceBorders", true);
      const denseBars = opt(ring, "denseBars", true);
      const fill = Number.isFinite(ctx.barFill) ? Math.max(0, ctx.barFill) : 1;
      const inset = (1 - fill) / 2;
      const maxPx = o.maxR * scale;
      const vals = scratch;
      vals.length = n;

      for (const s of ctx.slots) {
        const row = s.row;
        if (!row) continue;
        let total = 0, vmax = 0, best = 0, nz = 0;
        for (let i = 0; i < n; i++) {
          const w = weight(row[o.fields[i]]);
          vals[i] = w;
          total += w;
          if (w > vmax) { vmax = w; best = i; }
          if (w > 0) nz++;
        }
        if (!(total > 0)) continue;
        const rd = designRadius(o, ds, row, total);
        if (!(rd > 0)) continue;

        // Fit: shrink every pie by the same factor so the largest fits the slot.
        const cap = PITCH_FRAC * fill * out.alongPx(s.lo, s.hi, vc);
        const k = maxPx > cap ? cap / maxPx : 1;
        const natural = Math.min(rd * scale, vc);
        const r = natural * k;

        if (cap < LOD_MIN_R) {
          // Too dense for pies: a cell across the pie's depth.
          const span = s.hi - s.lo;
          const u0 = s.lo + span * inset, u1 = s.hi - span * inset;
          if (u1 <= u0) continue;
          if (denseBars) {
            let v0 = vc - natural;
            const dv = (2 * natural) / total;
            for (let i = 0; i < n; i++) {
              if (!(vals[i] > 0)) continue;
              const v1 = v0 + vals[i] * dv;
              out.fillCell(u0, u1, v0, v1, colors[i]);
              v0 = v1;
            }
          } else {
            const h = Math.max(0.5, r);
            out.fillCell(u0, u1, vc - h, vc + h, colors[best]);
          }
          continue;
        }

        const u = (s.lo + s.hi) / 2;
        if (o.style === "polar") {
          polarArea(out, u, vc, r, vals, n, vmax, colors, oc, ow);
        } else {
          out.pie(u, vc, r, vals, colors, oc, ow);
          if (borders && nz > 1 && r >= BORDER_MIN_R) sliceBorders(out, u, vc, r, vals, n, total, oc!, ow);
        }
      }
    }
    if (opt(ring, "showLabel", false) && ring.label) drawFieldLabel(ctx, vc, ring.label, fieldLabelSize(ctx));
  },

  legend(ring, info: RingInfoContext): LegendSection[] {
    const o = readOpts(ring);
    if (!o.fields.length) return [];
    const entries: LegendEntry[] = o.fields.map((f, i) => ({
      id: `track:${ring.key}\x00${f}`,
      label: info.columnLabel(f),
      color: fieldColor(ring, f, i),
      fillAlpha: 1,
      shape: "circle",
    }));
    const notes: string[] = [];
    if (o.mode === "scaled") {
      const ds = dataStats(info.rows, o.fields, o.sizeField);
      notes.push(`pie area ∝ row total (max ${fmtNum(ds.maxTotal)})`);
    } else if (o.mode === "column") {
      const ds = dataStats(info.rows, o.fields, o.sizeField);
      notes.push(`pie radius ∝ ${info.columnLabel(o.sizeField)} (max ${fmtNum(ds.maxSize)})`);
    }
    if (o.style === "polar") notes.push("wedge radius ∝ value");
    return [{
      id: `track:${ring.key}`,
      title: ring.label,
      note: notes.length ? notes.join("; ") : undefined,
      kind: "swatches",
      entries,
      more: 0,
    }];
  },

  tooltip(ring, row, info) {
    const o = readOpts(ring);
    if (!row || !o.fields.length) return [];
    let total = 0, any = false;
    const vals = o.fields.map(f => {
      const x = num(row[f]);
      if (Number.isFinite(x)) any = true;
      if (x > 0) total += x;
      return x;
    });
    if (!any) return [];
    const pct = (x: number) => {
      const p = (100 * x) / total;
      return p > 0 && p < 0.1 ? "<0.1%" : `${+p.toFixed(1)}%`;
    };
    const lines = [`${ring.label}: total ${fmtNum(total)}`];
    o.fields.forEach((f, i) => {
      const name = info.columnLabel(f);
      const x = vals[i];
      const raw = row[f];
      if (!Number.isFinite(x)) {
        lines.push(raw === null || raw === undefined || raw === "" ? `${name}: N/A` : `${name}: ${String(raw)} (ignored)`);
      } else if (x < 0) {
        lines.push(`${name}: ${fmtNum(x)} (ignored)`);
      } else {
        lines.push(`${name}: ${fmtNum(x)} (${total > 0 ? pct(x) : "0%"})`);
      }
    });
    if (o.mode === "column") {
      const z = num(row[o.sizeField]);
      lines.push(`${info.columnLabel(o.sizeField)} (size): ${Number.isFinite(z) ? fmtNum(z) : "N/A"}`);
    }
    return lines;
  },
};

export default pie;
