import type { AnnotationRow, TrackConfig } from "../types";
import type { LegendSection } from "../legend";
import { fmtNum, logBaseName, makeGradient, makeValueScale, scaleTicks, validLogBase } from "../trackStyle";
import type { NumStats, ValueScale } from "../trackStyle";
import { opt } from "./types";
import type { OptionField, RingDrawContext, RingInfoContext, RingModule } from "./types";
import { drawFieldLabel, fieldLabelSize } from "./util";

// ============================================================
// Heatmap ring (iTOL DATASET_HEATMAP): one or more numeric columns drawn
// side by side as a grid of cells, coloured on a 2+ stop gradient.
//
// Value → gradient position:
//   normalize "none"   — one value scale shared by every column (linear or
//                        log; blank min/max = data range over all columns;
//                        optional mid value pinned to the gradient centre).
//   normalize "column" — each column on its own range (min–max or z-score).
//   normalize "row"    — each leaf on its own range across its columns.
// z-scores span ±S, S = ceil(largest |z| in the data), like iTOL "scaling".
// Blank / non-numeric cells use the no-value colour (iTOL COLOR_NAN);
// leaves without an annotation row are left empty.
// ============================================================

const DEFAULT_STOPS = ["#2166ac", "#f7f7f7", "#b2182b"];
const DEFAULT_MISSING = "#cccccc";
const MAX_FIELDS_CACHE = 32;

type Normalize = "none" | "column" | "row";
type NormType = "range" | "zscore";

// ------------------------------------------------------------
// Cell parsing (cached: cells repeat and rings redraw every frame)
// ------------------------------------------------------------

const numCache = new Map<string, number>();

/** Finite number in a cell, or NaN (blank, text such as "X"/"NA", ±Infinity). */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (v === null || v === undefined || v === "") return NaN;
  const s = typeof v === "string" ? v : String(v);
  let n = numCache.get(s);
  if (n === undefined) {
    const t = s.trim();
    n = t === "" ? NaN : Number(t); // Number("  ") is 0, so trim first
    if (!Number.isFinite(n)) n = NaN;
    if (numCache.size > 100000) numCache.clear();
    numCache.set(s, n);
  }
  return n;
}

// ------------------------------------------------------------
// Dataset-wide statistics (once per rows identity + field list)
// ------------------------------------------------------------

type FieldStat = NumStats & { mean: number; sd: number; missing: number };

type DataStats = {
  fields: FieldStat[];
  /** Over every cell of every column. */
  all: NumStats;
  /** Rows that exist but have a blank / non-numeric cell in at least one column. */
  missingCells: number;
  /** z-score half-ranges: ceil(max |z|) per column / per leaf (≥ 1). */
  colZ: number;
  rowZ: number;
};

const statsCache = new WeakMap<AnnotationRow[], Map<string, DataStats>>();

function dataStats(rows: AnnotationRow[], fields: string[]): DataStats {
  let byKey = statsCache.get(rows);
  if (!byKey) { byKey = new Map(); statsCache.set(rows, byKey); }
  const key = fields.join("\x00");
  const hit = byKey.get(key);
  if (hit) return hit;

  const n = fields.length;
  const fs: FieldStat[] = fields.map(() => ({ min: Infinity, max: -Infinity, minPos: Infinity, count: 0, mean: 0, sd: 0, missing: 0 }));
  const m2 = new Float64Array(n); // Welford sums of squares
  const all: NumStats = { min: Infinity, max: -Infinity, minPos: Infinity, count: 0 };
  const buf = new Float64Array(n);
  let missingCells = 0;
  let rowZMax = 0;
  for (const row of rows) {
    let k = 0, anyMissing = false;
    for (let i = 0; i < n; i++) {
      const v = num(row[fields[i]]);
      const s = fs[i];
      if (Number.isNaN(v)) { s.missing++; anyMissing = true; continue; }
      buf[k++] = v;
      s.count++;
      const d = v - s.mean;
      s.mean += d / s.count;
      m2[i] += d * (v - s.mean);
      if (v < s.min) s.min = v;
      if (v > s.max) s.max = v;
      if (v > 0 && v < s.minPos) s.minPos = v;
    }
    if (anyMissing) missingCells++;
    if (k >= 2) {
      const z = rowZExtent(buf, k);
      if (z > rowZMax) rowZMax = z;
    }
  }
  let colZMax = 0;
  fs.forEach((s, i) => {
    s.sd = s.count > 1 ? Math.sqrt(m2[i] / (s.count - 1)) : 0;
    if (s.count) {
      all.count += s.count;
      all.min = Math.min(all.min, s.min);
      all.max = Math.max(all.max, s.max);
      all.minPos = Math.min(all.minPos, s.minPos);
    }
    if (s.sd > 0) colZMax = Math.max(colZMax, Math.abs(s.min - s.mean) / s.sd, Math.abs(s.max - s.mean) / s.sd);
  });
  const res: DataStats = {
    fields: fs, all, missingCells,
    colZ: Math.max(1, Math.ceil(colZMax - 1e-9)),
    rowZ: Math.max(1, Math.ceil(rowZMax - 1e-9)),
  };
  if (byKey.size >= MAX_FIELDS_CACHE) byKey.clear();
  byKey.set(key, res);
  return res;
}

/** Largest |z| among the first k values (sample sd; 0 when constant). */
function rowZExtent(buf: Float64Array, k: number): number {
  let sum = 0, lo = Infinity, hi = -Infinity;
  for (let j = 0; j < k; j++) { const v = buf[j]; sum += v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const mean = sum / k;
  let ss = 0;
  for (let j = 0; j < k; j++) ss += (buf[j] - mean) ** 2;
  const sd = Math.sqrt(ss / (k - 1));
  return sd > 0 ? Math.max(mean - lo, hi - mean) / sd : 0;
}

// ------------------------------------------------------------
// Options
// ------------------------------------------------------------

/** Number option or null (unset / blank / not a number). */
function numOpt(ring: TrackConfig, key: string): number | null {
  const v = ring.opts?.[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stopsOf(ring: TrackConfig): string[] {
  const s = ring.opts?.stops;
  const cols = Array.isArray(s) ? s.filter((c): c is string => typeof c === "string" && c !== "") : [];
  return cols.length ? cols : DEFAULT_STOPS;
}

const gradCache = new Map<string, (t: number) => string>();
function gradientOf(stops: string[]): (t: number) => string {
  const key = stops.join("|");
  let g = gradCache.get(key);
  if (!g) {
    g = makeGradient(stops);
    if (gradCache.size > 64) gradCache.clear();
    gradCache.set(key, g);
  }
  return g;
}

type Settings = {
  fields: string[];
  normalize: Normalize;
  normType: NormType;
  log: boolean;
  base: number;
  stops: string[];
};

function settings(ring: TrackConfig): Settings {
  const nz = opt<string>(ring, "normalize", "none");
  const normalize: Normalize = nz === "column" || nz === "row" ? nz : "none";
  const normType: NormType = opt<string>(ring, "normType", "range") === "zscore" ? "zscore" : "range";
  const zscore = normalize !== "none" && normType === "zscore";
  return {
    fields: ring.fields ?? [],
    normalize,
    normType,
    log: !zscore && opt<string>(ring, "scale", "linear") === "log",
    base: validLogBase(numOpt(ring, "logBase") ?? undefined),
    stops: stopsOf(ring),
  };
}

/** Shared scale ("none" mode): user min/max, else the data range over all columns. */
function sharedScale(ring: TrackConfig, st: DataStats, log: boolean, base: number): ValueScale {
  const userMin = numOpt(ring, "min");
  const all = st.all;
  // Linear: default low end is the data minimum (iTOL), not min(0, data min).
  const min = userMin ?? (!log && all.count ? all.min : null);
  return makeValueScale({ scale: log ? "log" : "linear", min, max: numOpt(ring, "max"), logBase: base }, all.count ? all : undefined);
}

/** Gradient position of the user's mid value on the shared scale, or null (no remapping). */
function midPosition(ring: TrackConfig, sc: ValueScale): number | null {
  const mid = numOpt(ring, "mid");
  if (mid === null || (sc.log && mid <= 0)) return null;
  const p = sc.t(mid);
  return p > 1e-6 && p < 1 - 1e-6 ? p : null;
}

// ------------------------------------------------------------
// Drawing helpers
// ------------------------------------------------------------

// Per-field affine map in (log-)value space: t = f(v)·K + B, f = identity or ln.
let K = new Float64Array(16);
let B = new Float64Array(16);
let VALS = new Float64Array(16);
function ensureScratch(n: number) {
  if (K.length < n) {
    const m = Math.max(n, K.length * 2);
    K = new Float64Array(m); B = new Float64Array(m); VALS = new Float64Array(m);
  }
}

/** Set K[i], B[i] so [lo, hi] maps to [0, 1]; a degenerate range maps to the centre. */
function setRange(i: number, lo: number, hi: number) {
  if (hi > lo && Number.isFinite(lo) && Number.isFinite(hi)) { K[i] = 1 / (hi - lo); B[i] = -lo * K[i]; }
  else { K[i] = 0; B[i] = 0.5; }
}

/** z-score map: mean → centre, ±S·sd → ends; constant data → centre. */
function setZ(i: number, mean: number, sd: number, S: number) {
  if (sd > 0) { K[i] = 1 / (2 * S * sd); B[i] = 0.5 - mean * K[i]; }
  else { K[i] = 0; B[i] = 0.5; }
}

/** Row mode: one map for a leaf from its values in VALS[0..n) (its own range, or mean ± S·sd). */
function setRowMap(n: number, log: boolean, zscore: boolean, S: number) {
  let lo = Infinity, hi = -Infinity, sum = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const v = VALS[i];
    if (Number.isNaN(v)) continue;
    if (zscore) { sum += v; k++; if (v < lo) lo = v; if (v > hi) hi = v; }
    else if (log) { if (v > 0) { const l = Math.log(v); if (l < lo) lo = l; if (l > hi) hi = l; } }
    else { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (zscore) {
    const mean = k ? sum / k : 0;
    let ss = 0;
    for (let i = 0; i < n; i++) if (!Number.isNaN(VALS[i])) ss += (VALS[i] - mean) ** 2;
    setZ(0, mean, k > 1 ? Math.sqrt(ss / (k - 1)) : 0, S);
  } else setRange(0, lo, hi);
  for (let i = 1; i < n; i++) { K[i] = K[0]; B[i] = B[0]; }
}

/** Gradient position (0–1) of value v in field i; pm = mid-value position to pin to the centre. */
function position(v: number, i: number, log: boolean, pm: number | null): number {
  let t = log ? (v > 0 ? Math.log(v) * K[i] + B[i] : 0) : v * K[i] + B[i];
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (pm !== null) t = t <= pm ? (0.5 * t) / pm : 0.5 + (0.5 * (t - pm)) / (1 - pm);
  return t;
}

const textColorCache = new Map<string, string>();
/** Black or white text for a cell colour (iTOL VALUE_AUTO_COLOR luminance). */
function autoTextColor(fill: string): string {
  let c = textColorCache.get(fill);
  if (c) return c;
  let h = fill.startsWith("#") ? fill.slice(1) : "";
  if (h.length === 3) h = h.replace(/./g, x => x + x);
  if (/^[0-9a-f]{6}$/i.test(h)) {
    const ch = (o: number) => Math.pow(parseInt(h.slice(o, o + 2), 16) / 255, 2.2);
    const L = Math.pow(0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4), 0.678);
    c = L < 0.5 ? "#ffffff" : "#000000";
  } else c = "#000000";
  if (textColorCache.size > 1024) textColorCache.clear();
  textColorCache.set(fill, c);
  return c;
}

function formatValue(n: number, decimals: number | null): string {
  if (decimals !== null) return n.toFixed(Math.max(0, Math.min(10, Math.round(decimals))));
  return Number.isInteger(n) ? String(n) : String(+n.toPrecision(3));
}

/** Grid-line and value-text level of detail: minimum along-size of a cell in screen px. */
const GRID_MIN_PX = 3;
const VALUE_MIN_FONT = 5;

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const zscoreOn = (o: Record<string, any>) => (o.normalize === "column" || o.normalize === "row") && o.normType === "zscore";

const options: OptionField[] = [
  { key: "cellWidth", label: "Cell width", type: "number", min: 1, max: 300, step: 1, unit: "px", help: "Width of each column's cells." },
  { key: "stops", label: "Colours", type: "gradient", help: "Low → high. The middle of the gradient marks the mid value." },
  {
    key: "normalize", label: "Colour range", type: "select",
    choices: [
      { value: "none", label: "Shared by all columns" },
      { value: "column", label: "Each column separately" },
      { value: "row", label: "Each leaf separately" },
    ],
    help: "Normalise the values per column or per leaf before colouring.",
  },
  {
    key: "normType", label: "Normalisation", type: "select",
    choices: [{ value: "range", label: "Min → max" }, { value: "zscore", label: "z-score" }],
    help: "Min → max spans the whole gradient; z-score centres on the mean (± whole standard deviations).",
    showIf: o => o.normalize === "column" || o.normalize === "row",
  },
  {
    key: "scale", label: "Scale", type: "select",
    choices: [{ value: "linear", label: "Linear" }, { value: "log", label: "Logarithmic" }],
    showIf: o => !zscoreOn(o),
  },
  { key: "logBase", label: "Log base", type: "number", min: 1.1, step: 1, showIf: o => o.scale === "log" && !zscoreOn(o) },
  { key: "min", label: "Minimum", type: "number", auto: true, help: "Value at the low end. Blank = smallest value in any column.", showIf: o => !o.normalize || o.normalize === "none" },
  { key: "mid", label: "Mid value", type: "number", auto: true, help: "Value at the centre of the gradient (e.g. 0 for a diverging gradient). Blank = halfway.", showIf: o => !o.normalize || o.normalize === "none" },
  { key: "max", label: "Maximum", type: "number", auto: true, help: "Value at the high end. Blank = largest value in any column.", showIf: o => !o.normalize || o.normalize === "none" },
  { key: "missingColor", label: "No-value colour", type: "color", help: "Blank or non-numeric cells. Clear to leave them empty." },
  { key: "showGrid", label: "Cell borders", type: "bool" },
  { key: "gridColor", label: "Border colour", type: "color", showIf: o => !!o.showGrid },
  { key: "gridWidth", label: "Border width", type: "number", min: 0.1, max: 10, step: 0.1, unit: "px", showIf: o => !!o.showGrid },
  { key: "showLabels", label: "Column labels", type: "bool" },
  { key: "labelSize", label: "Label size", type: "number", min: 0.2, max: 5, step: 0.1, unit: "×", showIf: o => o.showLabels !== false },
  { key: "showValues", label: "Show values", type: "bool", help: "Print each value in its cell when there is room." },
  { key: "valueDecimals", label: "Decimals", type: "number", auto: true, min: 0, max: 10, step: 1, help: "Blank = up to 3 significant digits.", showIf: o => !!o.showValues },
  { key: "valueColor", label: "Value colour", type: "color", help: "Clear for automatic black / white.", showIf: o => !!o.showValues },
];

const heatmap: RingModule = {
  kind: "heatmap",
  title: "Heatmap",
  description: "Several numeric columns as a grid of cells coloured on a gradient (one cell per column per leaf).",
  fields: { count: "many", numeric: true, hint: "Numeric columns, one heatmap column each" },

  defaults(fields, info) {
    const st = dataStats(info.rows, fields);
    // Data on both sides of 0: centre the diverging gradient on 0.
    const mid = st.all.count && st.all.min < 0 && st.all.max > 0 ? 0 : null;
    return {
      cellWidth: 14,
      stops: [...DEFAULT_STOPS],
      normalize: "none",
      normType: "range",
      scale: "linear",
      logBase: 10,
      min: null,
      mid,
      max: null,
      missingColor: DEFAULT_MISSING,
      showGrid: false,
      gridColor: "#ffffff",
      gridWidth: 0.5,
      showLabels: true,
      labelSize: 1,
      showValues: false,
      valueDecimals: null,
      valueColor: "",
    };
  },

  options,

  width(ring) {
    const cw = numOpt(ring, "cellWidth") ?? 14;
    return Math.max(1, ring.fields?.length ?? 0) * Math.max(0.5, cw);
  },

  draw(ring, ctx: RingDrawContext) {
    const s = settings(ring);
    const fields = s.fields;
    const n = fields.length;
    if (!n || ctx.width <= 0) return;
    const out = ctx.out;
    const st = dataStats(ctx.rows, fields);
    const grad = gradientOf(s.stops);
    const missing = opt<string>(ring, "missingColor", DEFAULT_MISSING);
    const cw = ctx.width / n;
    const log = s.log;
    ensureScratch(n);

    // Per-field maps (row mode fills them per leaf below).
    let pm: number | null = null;
    if (s.normalize === "none") {
      const sc = sharedScale(ring, st, log, s.base);
      for (let i = 0; i < n; i++) {
        if (sc.log) setRange(i, Math.log(sc.lo), Math.log(sc.hi));
        else setRange(i, sc.lo, sc.hi);
      }
      pm = midPosition(ring, sc);
    } else if (s.normalize === "column") {
      for (let i = 0; i < n; i++) {
        const f = st.fields[i];
        if (s.normType === "zscore") setZ(i, f.mean, f.sd, st.colZ);
        else if (log) setRange(i, Math.log(f.minPos), Math.log(f.max));
        else setRange(i, f.min, f.max);
      }
    }
    const rowMode = s.normalize === "row";
    const zscore = s.normalize !== "none" && s.normType === "zscore";

    const inset = (1 - ctx.barFill) / 2;
    const grid = opt<boolean>(ring, "showGrid", false);
    const gridColor = opt<string>(ring, "gridColor", "#ffffff") || "#ffffff";
    const gridW = Math.max(0, numOpt(ring, "gridWidth") ?? 0.5) * ctx.scale;
    let columnLines = false;

    for (const slot of ctx.slots) {
      const row = slot.row;
      if (!row) continue;
      const w = slot.hi - slot.lo;
      const u0 = slot.lo + w * inset, u1 = slot.hi - w * inset;
      for (let i = 0; i < n; i++) VALS[i] = num(row[fields[i]]);

      if (rowMode) setRowMap(n, log, zscore, st.rowZ);

      const gridHere = grid && gridW > 0 && out.alongPx(u0, u1, 0) >= GRID_MIN_PX;
      if (grid && !gridHere) columnLines = true;
      for (let i = 0; i < n; i++) {
        const v = VALS[i];
        let color: string;
        if (Number.isNaN(v)) {
          if (!missing) continue;
          color = missing;
        } else color = grad(position(v, i, log, pm));
        out.fillCell(u0, u1, i * cw, (i + 1) * cw, color);
        if (gridHere) out.strokeCell(u0, u1, i * cw, (i + 1) * cw, gridColor, gridW);
      }
    }
    // Cells too thin for per-cell borders: keep the columns apart instead.
    if (columnLines) for (let i = 0; i <= n; i++) out.alongLine(ctx.uStart, ctx.uEnd, i * cw, gridColor, gridW);
    out.flush();

    // Values inside the cells (only where they fit).
    if (opt<boolean>(ring, "showValues", false)) {
      const decimals = numOpt(ring, "valueDecimals");
      const fixedColor = opt<string>(ring, "valueColor", "");
      const maxFont = 11 * ctx.fontScale * ctx.scale;
      for (const slot of ctx.slots) {
        const row = slot.row;
        if (!row) continue;
        const w = slot.hi - slot.lo;
        const u0 = slot.lo + w * inset, u1 = slot.hi - w * inset;
        if (out.alongPx(u0, u1, 0) * 0.7 < VALUE_MIN_FONT) continue;
        const um = (u0 + u1) / 2;
        for (let i = 0; i < n; i++) VALS[i] = num(row[fields[i]]);
        if (rowMode && !fixedColor) setRowMap(n, log, zscore, st.rowZ);
        for (let i = 0; i < n; i++) {
          const v = VALS[i];
          if (Number.isNaN(v)) continue;
          const vm = (i + 0.5) * cw;
          const txt = formatValue(v, decimals);
          let size = Math.min(out.alongPx(u0, u1, vm) * 0.7, maxFont);
          size = Math.min(size, (cw * 0.9) / (txt.length * 0.6));
          if (size < VALUE_MIN_FONT) continue;
          let color = fixedColor;
          if (!color) color = autoTextColor(grad(position(v, i, log, pm)));
          out.text(um, vm, txt, { size, color, anchor: "middle", orient: "radial" });
        }
      }
    }

    // Column labels above the first leaf (iTOL field labels).
    if (opt<boolean>(ring, "showLabels", true)) {
      const factor = numOpt(ring, "labelSize") ?? 1;
      const size = Math.min(fieldLabelSize(ctx) * Math.max(0.1, factor) * ctx.scale, cw * 0.95);
      if (size >= 4) for (let i = 0; i < n; i++) drawFieldLabel(ctx, (i + 0.5) * cw, ctx.columnLabel(fields[i]), size);
    }
    out.flush();
  },

  legend(ring, info: RingInfoContext): LegendSection[] {
    const s = settings(ring);
    if (!s.fields.length) return [];
    const st = dataStats(info.rows, s.fields);
    const id = `track:${ring.key}`;
    const stops = s.stops.map(color => ({ color, opacity: 1 }));
    const sections: LegendSection[] = [];
    let labels: [string, string, string];
    let note: string | undefined;
    let ticks: Array<{ t: number; label: string }> | undefined;
    let remapped = false;
    const logNote = s.log ? `${logBaseName(s.base)} scale` : "";
    const join = (...xs: string[]) => xs.filter(Boolean).join(", ") || undefined;

    if (s.normalize === "none") {
      const sc = sharedScale(ring, st, s.log, s.base);
      const pm = midPosition(ring, sc);
      remapped = pm !== null;
      const midVal = pm !== null ? numOpt(ring, "mid")! : sc.log ? Math.sqrt(sc.lo * sc.hi) : (sc.lo + sc.hi) / 2;
      labels = [fmtNum(sc.lo), fmtNum(midVal), fmtNum(sc.hi)];
      note = join(logNote);
      ticks = remapped ? undefined : scaleTicks(sc);
    } else {
      const who = s.normalize === "column" ? "column" : "leaf";
      if (s.normType === "zscore") {
        const S = s.normalize === "column" ? st.colZ : st.rowZ;
        labels = [`−${fmtNum(S)}`, "0", fmtNum(S)];
        note = `z-score per ${who} (SD units)`;
      } else {
        labels = ["min", "mid", "max"];
        note = join(`scaled per ${who}`, logNote);
      }
    }

    if (stops.length >= 3 || remapped) {
      sections.push({ id, title: ring.label, note, kind: "gradient", stops: stops.length >= 2 ? stops : [stops[0], stops[0]], labels });
    } else {
      sections.push({
        id, title: ring.label, note, kind: "ramp", min: labels[0], max: labels[2], style: "gradient",
        color: s.stops[s.stops.length - 1], stops, ticks,
      });
    }

    const missing = opt<string>(ring, "missingColor", DEFAULT_MISSING);
    if (missing && st.missingCells > 0) {
      sections.push({
        id: `${id}:missing`, title: "", kind: "swatches", more: 0,
        entries: [{ id: `${id}\x00No value`, label: "No value", color: missing, fillAlpha: 1 }],
      });
    }
    return sections;
  },

  tooltip(ring, row, info) {
    const s = settings(ring);
    const lines: string[] = [];
    const zscore = s.normalize !== "none" && s.normType === "zscore";
    let st: DataStats | undefined;
    let rowMean = 0, rowSd = 0;
    if (zscore && row) {
      st = dataStats(info.rows, s.fields);
      if (s.normalize === "row") {
        let sum = 0, k = 0;
        for (const f of s.fields) { const v = num(row[f]); if (!Number.isNaN(v)) { sum += v; k++; } }
        rowMean = k ? sum / k : 0;
        let ss = 0;
        for (const f of s.fields) { const v = num(row[f]); if (!Number.isNaN(v)) ss += (v - rowMean) ** 2; }
        rowSd = k > 1 ? Math.sqrt(ss / (k - 1)) : 0;
      }
    }
    s.fields.forEach((f, i) => {
      const raw = row?.[f];
      const text = raw === null || raw === undefined || String(raw).trim() === "" ? "N/A" : String(raw);
      let extra = "";
      if (st && row) {
        const v = num(raw);
        const mean = s.normalize === "row" ? rowMean : st.fields[i].mean;
        const sd = s.normalize === "row" ? rowSd : st.fields[i].sd;
        if (!Number.isNaN(v)) extra = ` (z = ${sd > 0 ? fmtNum(+((v - mean) / sd).toFixed(2)) : "0"})`;
      }
      lines.push(`${info.columnLabel(f)}: ${text}${extra}`);
    });
    return lines;
  },
};

export default heatmap;
