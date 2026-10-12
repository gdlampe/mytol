import { color as d3color, ticks as d3ticks } from "d3";
import type { AnnotationRow, ScaleType, TrackConfig } from "../types";
import { fmtNum, logBaseName, makeValueScale, validLogBase } from "../trackStyle";
import type { NumStats, ValueScale } from "../trackStyle";
import type { LegendSection } from "../legend";
import { opt } from "./types";
import type { OptionField, RingDrawContext, RingInfoContext, RingModule } from "./types";
import { FIELD_PALETTE, drawFieldLabel, fieldColor, fieldLabelSize, parseNumberList } from "./util";

// ============================================================
// Multi-value bar chart (iTOL DATASET_MULTIBAR) from 1+ numeric columns.
//   stacked  — one bar per leaf, segments stacked outward in field order
//              (iTOL default). Full width = largest row total (or max).
//   aligned  — one equal-width sub-column per field, every field on the
//              same value scale (iTOL ALIGN_FIELDS).
//   grouped  — fields as parallel thin bars across the leaf's slot, all
//              starting at the inner edge (iTOL SIDE_STACKED).
// Negative values are drawn as 0 (iTOL draws them leftwards from the
// segment start, which overlaps the previous segment); blank / non-numeric
// cells draw nothing. With a log scale a stacked bar's TOTAL sits on the log
// axis and its segments split it in proportion to their values, so the
// scale lines stay readable (iTOL instead stacks log10 of each value).
// ============================================================

type Mode = "stacked" | "aligned" | "grouped";
type LabelPos = "left" | "center" | "right";

const DEFAULT_WIDTH = 80;

const modeOf = (ring: TrackConfig): Mode => {
  const m = opt<string>(ring, "mode", "stacked");
  return m === "aligned" || m === "grouped" ? m : "stacked";
};

/** Numeric option that may be blank (null / "" / undefined → null = auto). */
function numOpt(ring: TrackConfig, key: string): number | null {
  const v = ring.opts?.[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function posOpt(ring: TrackConfig, key: string, fallback: number): number {
  const n = Number(opt<unknown>(ring, key, fallback));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ------------------------------------------------------------
// Cell parsing (cached: cells repeat a lot and rings redraw every frame)
// ------------------------------------------------------------

const numCache = new Map<string, number>();
const NUM_CACHE_CAP = 100000;

/** Uncached parse: finite number or NaN (blank, whitespace, text, ±Infinity). */
function parseNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (v === null || v === undefined) return NaN;
  const s = typeof v === "string" ? v.trim() : String(v).trim();
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Cached parse for per-frame use. */
function cellNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (v === null || v === undefined || v === "") return NaN;
  const s = typeof v === "string" ? v : String(v);
  let n = numCache.get(s);
  if (n === undefined) {
    n = parseNum(s);
    if (numCache.size >= NUM_CACHE_CAP) numCache.clear();
    numCache.set(s, n);
  }
  return n;
}

/** Value-label text: integers as-is, other numbers to 4 significant digits. */
const fmtVal = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toPrecision(4)));

// ------------------------------------------------------------
// Dataset-wide values (once per rows identity + field list)
// ------------------------------------------------------------

type DataStats = {
  /** Row totals (negatives as 0) over rows with at least one number. */
  sums: NumStats;
  /** Every single value (negatives as 0). */
  values: NumStats;
  /** Number of negative cells (drawn as 0). */
  negatives: number;
  /** Value scales by option signature. */
  scales: Map<string, ValueScale>;
};

const statsCache = new WeakMap<AnnotationRow[], Map<string, DataStats>>();

const emptyStats = (): NumStats => ({ min: Infinity, max: -Infinity, minPos: Infinity, count: 0 });
function addStat(s: NumStats, n: number) {
  s.count++;
  if (n < s.min) s.min = n;
  if (n > s.max) s.max = n;
  if (n > 0 && n < s.minPos) s.minPos = n;
}

function dataStats(rows: AnnotationRow[], fields: string[]): DataStats {
  let byFields = statsCache.get(rows);
  if (!byFields) { byFields = new Map(); statsCache.set(rows, byFields); }
  const key = fields.join("\x00");
  let st = byFields.get(key);
  if (st) return st;
  st = { sums: emptyStats(), values: emptyStats(), negatives: 0, scales: new Map() };
  const nf = fields.length;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let sum = 0, any = false;
    for (let i = 0; i < nf; i++) {
      let n = parseNum(row[fields[i]]);
      if (n !== n) continue; // NaN
      any = true;
      if (n < 0) { st.negatives++; n = 0; }
      addStat(st.values, n);
      sum += n;
    }
    if (any) addStat(st.sums, sum);
  }
  if (byFields.size > 64) byFields.clear();
  byFields.set(key, st);
  return st;
}

function ringScale(ring: TrackConfig, st: DataStats, mode: Mode): ValueScale {
  const scale: ScaleType = opt<string>(ring, "scale", "linear") === "log" ? "log" : "linear";
  const min = numOpt(ring, "min"), max = numOpt(ring, "max");
  const logBase = validLogBase(numOpt(ring, "logBase") ?? undefined);
  const sumMode = mode === "stacked";
  const sig = `${sumMode ? "s" : "v"}|${scale}|${min}|${max}|${logBase}`;
  let sc = st.scales.get(sig);
  if (!sc) {
    sc = makeValueScale({ scale, min, max, logBase }, sumMode ? st.sums : st.values);
    if (st.scales.size > 32) st.scales.clear();
    st.scales.set(sig, sc);
  }
  return sc;
}

// ------------------------------------------------------------
// Small per-frame helpers (module scratch buffers, no per-leaf allocation)
// ------------------------------------------------------------

let scratch = new Float64Array(16);
const scratchFor = (n: number) => (scratch.length >= n ? scratch : (scratch = new Float64Array(Math.max(n, scratch.length * 2))));

const contrastCache = new Map<string, string>();
/** Black or white text for a fill colour (iTOL LABEL_AUTO_COLOR). */
function contrastText(fill: string): string {
  let c = contrastCache.get(fill);
  if (!c) {
    const k = d3color(fill)?.rgb();
    const lum = k ? (0.299 * k.r + 0.587 * k.g + 0.114 * k.b) / 255 : 1;
    c = lum > 0.55 ? "#000000" : "#ffffff";
    if (contrastCache.size > 1000) contrastCache.clear();
    contrastCache.set(fill, c);
  }
  return c;
}

/** Scale-line values: off / auto nice ticks / user list, inside the scale range, baseline excluded. */
function scaleValues(ring: TrackConfig, sc: ValueScale, colPx: number, labelSize: number): number[] {
  const kind = opt<string>(ring, "scaleLines", "auto");
  if (kind === "off") return [];
  let vals: number[];
  if (kind === "custom") {
    const lo = Math.min(sc.lo, sc.hi), hi = Math.max(sc.lo, sc.hi), eps = (hi - lo) * 1e-9;
    vals = parseNumberList(opt<string>(ring, "scaleValues", "")).filter(v => v >= lo - eps && v <= hi + eps && (!sc.log || v > 0));
  } else if (sc.log) {
    vals = sc.ticks.map(k => k.value);
  } else {
    const count = Math.max(1, Math.min(6, Math.floor(colPx / (labelSize * 3.5))));
    vals = d3ticks(sc.lo, sc.hi, count);
  }
  return vals.filter(v => { const t = sc.t(v); return t > 1e-3 && t <= 1 + 1e-9; });
}

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const options: OptionField[] = [
  { key: "width", label: "Width", type: "number", min: 10, max: 2000, step: 5, unit: "px", help: "Length of the longest bar (all columns together when aligned)." },
  {
    key: "mode", label: "Layout", type: "select", choices: [
      { value: "stacked", label: "Stacked" },
      { value: "aligned", label: "Aligned columns (one per field)" },
      { value: "grouped", label: "Side by side (thin bar per field)" },
    ],
  },
  { key: "gap", label: "Column gap", type: "number", min: 0, max: 50, step: 1, unit: "px", showIf: o => o.mode === "aligned" },
  { key: "heightFactor", label: "Bar thickness", type: "number", min: 0.1, max: 2, step: 0.05, help: "Multiplies the global bar fill (iTOL HEIGHT_FACTOR)." },
  { key: "fieldColors", label: "Field colours", type: "fieldColors" },
  { key: "scale", label: "Scale", type: "select", choices: [{ value: "linear", label: "Linear" }, { value: "log", label: "Logarithmic" }] },
  { key: "logBase", label: "Log base", type: "number", min: 1.01, showIf: o => o.scale === "log" },
  { key: "min", label: "Minimum", type: "number", auto: true, help: "Blank = auto (0 for linear, a power of the base for log)." },
  { key: "max", label: "Maximum", type: "number", auto: true, help: "Value at full length. Blank = auto: largest row total (stacked) or largest single value (aligned / side by side). Negative values are drawn as 0." },
  { key: "borderWidth", label: "Border width", type: "number", min: 0, max: 5, step: 0.5, unit: "px" },
  { key: "borderColor", label: "Border colour", type: "color", showIf: o => Number(o.borderWidth) > 0 },
  { key: "showValues", label: "Show values", type: "bool", help: "Each segment's value inside it (when it fits)." },
  {
    key: "labelPosition", label: "Value position", type: "select", showIf: o => !!o.showValues,
    choices: [{ value: "left", label: "Start" }, { value: "center", label: "Centre" }, { value: "right", label: "End" }],
  },
  { key: "labelSize", label: "Value size", type: "number", min: 0.3, max: 3, step: 0.1, showIf: o => !!o.showValues },
  { key: "labelAutoColor", label: "Black / white values by field colour", type: "bool", showIf: o => !!o.showValues },
  { key: "labelColor", label: "Value colour", type: "color", showIf: o => !!o.showValues && !o.labelAutoColor },
  {
    key: "scaleLines", label: "Scale lines", type: "select",
    choices: [{ value: "off", label: "Off" }, { value: "auto", label: "Auto" }, { value: "custom", label: "Custom values" }],
    help: "Dashed lines across all leaves at scale values (iTOL DATASET_SCALE); repeated in every column when aligned.",
  },
  { key: "scaleValues", label: "Scale values", type: "text", placeholder: "e.g. 100, 500, 1000", showIf: o => o.scaleLines === "custom" },
  { key: "scaleColor", label: "Scale line colour", type: "color", showIf: o => o.scaleLines !== "off" },
  { key: "scaleDashed", label: "Dashed scale lines", type: "bool", showIf: o => o.scaleLines !== "off" },
  { key: "scaleLabels", label: "Scale value labels", type: "bool", showIf: o => o.scaleLines !== "off" },
  { key: "showLabels", label: "Field labels", type: "bool", help: "One label per column.", showIf: o => o.mode === "aligned" },
];

const multibar: RingModule = {
  kind: "multibar",
  title: "Multi-value bars",
  description: "Several numeric columns as stacked bars, aligned per-field columns, or side-by-side thin bars (iTOL multi-value bar chart).",
  fields: { count: "many", numeric: true, hint: "One or more numeric columns (one bar segment per column)" },

  defaults(fields) {
    const fieldColors: Record<string, string> = {};
    fields.forEach((f, i) => { fieldColors[f] = FIELD_PALETTE[i % FIELD_PALETTE.length]; });
    return {
      width: DEFAULT_WIDTH, mode: "stacked", gap: 4, heightFactor: 1, fieldColors,
      scale: "linear", logBase: 10, min: null, max: null,
      borderWidth: 0, borderColor: "#000000",
      showValues: false, labelPosition: "right", labelSize: 1, labelAutoColor: true, labelColor: "#000000",
      scaleLines: "auto", scaleValues: "", scaleColor: "#aaaaaa", scaleDashed: true, scaleLabels: true,
      showLabels: true,
    };
  },

  options,

  width(ring) {
    const w = Number(opt<unknown>(ring, "width", DEFAULT_WIDTH));
    return Number.isFinite(w) && w > 0 ? w : DEFAULT_WIDTH;
  },

  draw(ring, ctx) {
    const fields = ring.fields ?? [];
    const N = fields.length;
    const out = ctx.out;
    const W = ctx.width;
    if (!N || !(W > 0)) return;
    const s = ctx.scale;
    const mode = modeOf(ring);
    const st = dataStats(ctx.rows, fields);
    const sc = ringScale(ring, st, mode);
    const colors: string[] = new Array(N);
    for (let i = 0; i < N; i++) colors[i] = fieldColor(ring, fields[i], i);

    // Columns: aligned = N equal columns with a gap; otherwise one column of length W.
    let colLen = W, colStep = 0;
    if (mode === "aligned") {
      let gap = posOpt(ring, "gap", 4) * s;
      colLen = (W - gap * (N - 1)) / N;
      if (colLen < 1) { gap = 0; colLen = W / N; }
      colStep = colLen + gap;
    }
    const fill = Math.max(0.02, Math.min(2, ctx.barFill * posOpt(ring, "heightFactor", 1)));
    const inset = (1 - fill) / 2;
    const slots = ctx.slots;
    const vals = scratchFor(N);

    // Along-extent of the visible leaves (scale lines span them; drawing the
    // whole leaf set would mean dashing a huge off-screen path every frame).
    let uLo = Infinity, uHi = -Infinity;
    for (let k = 0; k < slots.length; k++) {
      if (slots[k].lo < uLo) uLo = slots[k].lo;
      if (slots[k].hi > uHi) uHi = slots[k].hi;
    }
    if (!(uHi > uLo)) return;

    // ---- 1. Scale lines (underneath the bars) ----
    const tickSize = fieldLabelSize(ctx, 8);
    const ticks = scaleValues(ring, sc, colLen, tickSize);
    if (ticks.length) {
      const lc = opt<string>(ring, "scaleColor", "#aaaaaa") || "#aaaaaa"; // "" = cleared → default
      const dash = opt<boolean>(ring, "scaleDashed", true) ? [4 * s, 4 * s] : undefined;
      const lw = Math.max(0.5, s);
      const cols = mode === "aligned" ? N : 1;
      for (let c = 0; c < cols; c++) {
        const v0 = c * colStep;
        for (const t of ticks) out.alongLine(uLo, uHi, v0 + sc.t(t) * colLen, lc, lw, dash);
      }
      out.flush();
    }

    // Values of one row into `vals` (NaN = missing, negatives → 0); returns the row total.
    const readRow = (row: AnnotationRow): number => {
      let sum = 0;
      for (let i = 0; i < N; i++) {
        let n = cellNum(row[fields[i]]);
        if (n < 0) n = 0;
        vals[i] = n;
        if (n > 0) sum += n;
      }
      return sum;
    };

    // Calls seg(i, u0, u1, v0, v1) for every visible segment of one slot.
    const eachSegment = (row: AnnotationRow, lo: number, hi: number, seg: (i: number, u0: number, u1: number, v0: number, v1: number) => void) => {
      const span = hi - lo;
      const u0 = lo + span * inset, u1 = hi - span * inset;
      const sum = readRow(row);
      if (mode === "stacked") {
        if (!(sum > 0)) return;
        const L = sc.t(sum) * W;
        if (!(L > 0)) return;
        let a = 0;
        for (let i = 0; i < N; i++) {
          const x = vals[i];
          if (!(x > 0)) continue;
          const len = (L * x) / sum;
          seg(i, u0, u1, a, a + len);
          a += len;
        }
      } else if (mode === "aligned") {
        for (let i = 0; i < N; i++) {
          const x = vals[i];
          if (x !== x) continue;
          const len = sc.t(x) * colLen;
          if (len > 0) seg(i, u0, u1, i * colStep, i * colStep + len);
        }
      } else {
        const sub = (u1 - u0) / N;
        for (let i = 0; i < N; i++) {
          const x = vals[i];
          if (x !== x) continue;
          const len = sc.t(x) * W;
          if (len > 0) seg(i, u0 + i * sub, u0 + (i + 1) * sub, 0, len);
        }
      }
    };

    // ---- 2. Bars ----
    const fillSeg = (i: number, u0: number, u1: number, v0: number, v1: number) => out.fillCell(u0, u1, v0, v1, colors[i]);
    for (let k = 0; k < slots.length; k++) {
      const sl = slots[k];
      if (sl.row) eachSegment(sl.row, sl.lo, sl.hi, fillSeg);
    }
    out.flush();

    // ---- 3. Segment borders (skipped on slivers, where they would hide the fill) ----
    const bw = posOpt(ring, "borderWidth", 0) * s;
    if (bw > 0) {
      const bc = opt<string>(ring, "borderColor", "#000000") || "#000000";
      const strokeSeg = (_i: number, u0: number, u1: number, v0: number, v1: number) => {
        if (out.alongPx(u0, u1, v0) >= 2) out.strokeCell(u0, u1, v0, v1, bc, bw);
      };
      for (let k = 0; k < slots.length; k++) {
        const sl = slots[k];
        if (sl.row) eachSegment(sl.row, sl.lo, sl.hi, strokeSeg);
      }
      out.flush();
    }

    // ---- 4. Value labels (level of detail: only where the text fits) ----
    if (opt<boolean>(ring, "showValues", false)) {
      const pos = opt<LabelPos>(ring, "labelPosition", "right");
      const factor = Math.max(0.1, Number(opt<unknown>(ring, "labelSize", 1)) || 1);
      const auto = opt<boolean>(ring, "labelAutoColor", true);
      const fixed = opt<string>(ring, "labelColor", "#000000") || "#000000";
      const maxFont = 13 * ctx.fontScale;
      const pad = 4 * s;
      const sub = mode === "grouped" ? N : 1;
      const anchor = pos === "left" ? "start" : pos === "center" ? "middle" : "end";
      const textSeg = (i: number, u0: number, u1: number, v0: number, v1: number) => {
        const vm = (v0 + v1) / 2;
        const size = Math.min(0.75 * out.alongPx(u0, u1, vm), maxFont) * factor;
        if (size < 5) return;
        const txt = fmtVal(cellNum(curRow[fields[i]]));
        const need = txt.length * size * 0.6 + (pos === "center" ? 2 : 2 * pad);
        if (need > v1 - v0) return;
        const v = pos === "left" ? v0 + pad : pos === "center" ? vm : v1 - pad;
        out.text((u0 + u1) / 2, v, txt, { size, color: auto ? contrastText(colors[i]) : fixed, orient: "radial", anchor });
      };
      let curRow: AnnotationRow = {} as AnnotationRow;
      for (let k = 0; k < slots.length; k++) {
        const sl = slots[k];
        if (!sl.row) continue;
        // Cheap reject before reading the row: thickest possible text is at the outer edge.
        const span = (sl.hi - sl.lo) * fill;
        if (Math.min(0.75 * out.alongPx(0, span / sub, W), maxFont) * factor < 5) continue;
        curRow = sl.row;
        eachSegment(sl.row, sl.lo, sl.hi, textSeg);
      }
    }

    // ---- 5. Header labels: field labels (aligned) and scale value labels ----
    const fieldLbl = mode === "aligned" && opt<boolean>(ring, "showLabels", true);
    const flSize = fieldLabelSize(ctx);
    const flStep = fieldLbl ? Math.max(1, Math.ceil((flSize * 1.1) / colStep)) : 0;
    if (fieldLbl) {
      for (let i = 0; i < N; i += flStep) drawFieldLabel(ctx, i * colStep + colLen / 2, ctx.columnLabel(fields[i]), flSize, "#333");
    }
    if (ticks.length && opt<boolean>(ring, "scaleLabels", true) && W >= 12) {
      const cols = mode === "aligned" ? N : 1;
      const clear = (tickSize + flSize) / 2 + 1;
      for (let c = 0; c < cols; c++) {
        const v0 = c * colStep;
        const flV = fieldLbl && c % flStep === 0 ? v0 + colLen / 2 : NaN;
        let last = -Infinity;
        for (const t of ticks) {
          const v = v0 + sc.t(t) * colLen;
          if (v - last < tickSize * 1.2) continue;
          if (Math.abs(v - flV) < clear) continue;
          drawFieldLabel(ctx, v, fmtNum(t), tickSize, "#666666");
          last = v;
        }
      }
    }
  },

  legend(ring, info: RingInfoContext): LegendSection[] {
    const fields = ring.fields ?? [];
    if (!fields.length) return [];
    const mode = modeOf(ring);
    const st = dataStats(info.rows, fields);
    const sc = ringScale(ring, st, mode);
    const modeName = mode === "stacked" ? "Stacked" : mode === "aligned" ? "Aligned" : "Side by side";
    const range = `${sc.log ? `${logBaseName(sc.base)} ` : ""}${fmtNum(sc.lo)}–${fmtNum(sc.hi)}${mode === "stacked" ? " (row total)" : ""}`;
    const note = `${modeName} · ${range}${st.negatives ? " · negatives drawn as 0" : ""}`;
    return [{
      id: `track:${ring.key}`,
      title: ring.label,
      note,
      kind: "swatches",
      entries: fields.map((f, i) => ({
        id: `track:${ring.key}\x00${f}`,
        label: info.columnLabel(f),
        color: fieldColor(ring, f, i),
        fillAlpha: 1,
      })),
      more: 0,
    }];
  },

  tooltip(ring, row, info) {
    const fields = ring.fields ?? [];
    const lines: string[] = [];
    let sum = 0, any = false;
    for (const f of fields) {
      const raw = row?.[f];
      const n = parseNum(raw);
      const shown = raw === null || raw === undefined || String(raw).trim() === "" ? "N/A" : String(raw).trim();
      lines.push(`${info.columnLabel(f)}: ${shown}${n < 0 ? " (drawn as 0)" : ""}`);
      if (n === n) { any = true; if (n > 0) sum += n; }
    }
    if (modeOf(ring) === "stacked" && fields.length > 1 && any) lines.push(`${ring.label} total: ${fmtVal(sum)}`);
    return lines;
  },
};

export default multibar;
