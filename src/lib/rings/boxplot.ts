import type { AnnotationRow, TrackConfig } from "../types";
import { fmtNum, logBaseName, makeValueScale, scaleLabel, scaleTicks, validLogBase } from "../trackStyle";
import type { NumStats, ValueScale } from "../trackStyle";
import type { LegendSection } from "../legend";
import type { BandOut } from "./band";
import { opt } from "./types";
import type { OptionField, RingDrawContext, RingInfoContext, RingModule } from "./types";
import { FIELD_PALETTE, drawFieldLabel, fieldLabelSize, parseNumberList } from "./util";

// ============================================================
// Box plot ring (iTOL DATASET_BOXPLOT), from ONE column.
// Each cell is a list of numbers (comma / semicolon / pipe / space separated):
//   "raw"     — samples; min, Q1, median, Q3, max are computed (linear
//               interpolation quantiles, as R type 7 / numpy). Whiskers run
//               to min–max, or Tukey: the furthest samples within 1.5 × IQR
//               of the box, with the rest drawn as outliers.
//   "summary" — iTOL's own format: min, Q1, median, Q3, max[, extremes…].
// Drawn along v (the value axis), centred on the leaf: whisker line, box
// Q1–Q3, median line, whisker caps, outliers. Like iTOL, boxes are straight
// rectangles (rotated to the leaf angle in circular layouts), not wedges.
// ============================================================

type Mode = "minmax" | "tukey" | "summary";
type Box = { min: number; q1: number; med: number; q3: number; max: number; out: number[]; n: number };

const DEFAULT_FILL = FIELD_PALETTE[0];
const DEFAULT_LINE = "#222222";
const SCALE_COLOR = "#aaaaaa"; // iTOL's default scale line colour
/** Below this box thickness (screen px) draw a compact box: no caps, outliers or outlines. */
const COMPACT_PX = 3;
const CACHE_CAP = 100000;
const EMPTY: number[] = [];

const blank = (v: unknown) => v === null || v === undefined || v === "";
const asc = (a: number, b: number) => a - b;

/** Option value → finite number or null (blank / text). */
function numOpt(v: unknown): number | null {
  if (blank(v)) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Colour option; blank ("" from the editor's Clear, or whitespace) = the default. */
function colorOpt(ring: TrackConfig, key: string, fallback: string): string {
  const v = ring.opts?.[key];
  if (blank(v)) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

function modeOf(ring: TrackConfig): Mode {
  if (opt<string>(ring, "format", "raw") === "summary") return "summary";
  return opt<string>(ring, "whiskers", "minmax") === "tukey" ? "tukey" : "minmax";
}

// ------------------------------------------------------------
// Cell → five-number summary (cached per mode, keyed by the cell string)
// ------------------------------------------------------------

function quantile(s: number[], p: number): number {
  const h = (s.length - 1) * p;
  const i = Math.floor(h);
  const f = h - i;
  return f > 0 && i + 1 < s.length ? s[i] + f * (s[i + 1] - s[i]) : s[i];
}

function computeBox(cell: string, mode: Mode): Box | null {
  const xs = parseNumberList(cell); // cached: never mutate
  if (mode === "summary") {
    if (xs.length < 5) return null;
    const f = xs.slice(0, 5).sort(asc);
    return { min: f[0], q1: f[1], med: f[2], q3: f[3], max: f[4], out: xs.length > 5 ? xs.slice(5) : EMPTY, n: 0 };
  }
  if (!xs.length) return null;
  const s = xs.slice().sort(asc);
  const n = s.length;
  const q1 = quantile(s, 0.25), med = quantile(s, 0.5), q3 = quantile(s, 0.75);
  if (mode === "minmax") return { min: s[0], q1, med, q3, max: s[n - 1], out: EMPTY, n };
  const iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  let a = 0;
  while (a < n && s[a] < lo) a++;
  let b = n - 1;
  while (b >= 0 && s[b] > hi) b--;
  const out = a > 0 || b < n - 1 ? s.slice(0, a).concat(s.slice(b + 1)) : EMPTY;
  return {
    min: a <= b ? Math.min(q1, s[a]) : q1,
    q1, med, q3,
    max: a <= b ? Math.max(q3, s[b]) : q3,
    out, n,
  };
}

const boxCaches: Record<Mode, Map<string, Box | null>> = { minmax: new Map(), tukey: new Map(), summary: new Map() };

function getBox(v: unknown, mode: Mode): Box | null {
  if (blank(v)) return null;
  const key = typeof v === "string" ? v : String(v);
  const cache = boxCaches[mode];
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const b = computeBox(key, mode);
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(key, b);
  return b;
}

// ------------------------------------------------------------
// Dataset-wide value range (once per rows identity)
// ------------------------------------------------------------

const statsCache = new WeakMap<AnnotationRow[], Map<string, NumStats>>();

/** Min / max / smallest positive of every number (incl. outliers / extremes) in valid cells of the column. */
function columnStats(rows: AnnotationRow[], field: string, summary: boolean): NumStats {
  let m = statsCache.get(rows);
  if (!m) { m = new Map(); statsCache.set(rows, m); }
  const key = (summary ? "s\x00" : "r\x00") + field;
  const hit = m.get(key);
  if (hit) return hit;
  const s: NumStats = { min: Infinity, max: -Infinity, minPos: Infinity, count: 0 };
  for (const row of rows) {
    const v = row[field];
    if (blank(v)) continue;
    const xs = parseNumberList(v);
    if (summary ? xs.length < 5 : xs.length === 0) continue;
    for (const x of xs) {
      s.count++;
      if (x < s.min) s.min = x;
      if (x > s.max) s.max = x;
      if (x > 0 && x < s.minPos) s.minPos = x;
    }
  }
  m.set(key, s);
  return s;
}

function scaleFor(ring: TrackConfig, rows: AnnotationRow[]): { sc: ValueScale; stats: NumStats } {
  const field = ring.fields?.[0] ?? "";
  const stats = columnStats(rows, field, modeOf(ring) === "summary");
  const sc = makeValueScale(
    {
      scale: opt<string>(ring, "scale", "linear") === "log" ? "log" : "linear",
      min: numOpt(opt(ring, "min", null)),
      max: numOpt(opt(ring, "max", null)),
      logBase: validLogBase(numOpt(opt(ring, "logBase", 10)) ?? undefined),
    },
    stats
  );
  return { sc, stats };
}

/**
 * Guess the cell format. iTOL summaries have ≥ 5 numbers with the first five
 * sorted and any extras outside [min, max] (and usually out of order). Exactly
 * five sorted numbers read the same either way (type-7 quartiles of 5 values
 * are the 2nd and 4th), and a fully sorted longer list is taken as samples.
 * A few malformed cells don't flip the decision.
 */
function detectFormat(rows: AnnotationRow[], field: string): "raw" | "summary" {
  let seen = 0, rawVotes = 0, sumVotes = 0;
  for (const row of rows) {
    const v = row[field];
    if (blank(v)) continue;
    const xs = parseNumberList(v);
    if (!xs.length) continue;
    seen++;
    let vote = 0; // -1 raw, +1 summary
    if (xs.length < 5) vote = -1;
    else {
      for (let i = 1; i < 5; i++) if (xs[i] < xs[i - 1]) vote = -1;
      if (!vote && xs.length > 5) {
        let sorted = true;
        for (let i = 5; i < xs.length && vote === 0; i++) {
          if (xs[i] >= xs[0] && xs[i] <= xs[4]) vote = -1; // extras inside the range: samples
          else if (xs[i] < xs[i - 1]) sorted = false;
        }
        if (!vote && !sorted) vote = 1;
      }
    }
    if (vote < 0) rawVotes++;
    else if (vote > 0) sumVotes++;
    if (seen >= 5000) break;
  }
  return sumVotes > 0 && rawVotes <= 0.05 * seen ? "summary" : "raw";
}

// ------------------------------------------------------------
// Drawing helpers
// ------------------------------------------------------------

// Local screen frame at band point (u, v): a = px outward, b = px along +u.
// local() writes the band coordinates of (a, b) into LU / LV (no allocation).
let LU = 0, LV = 0;
function local(out: BandOut, u: number, v: number, a: number, b: number): boolean {
  const g = out.geom;
  if (g.kind === "rect") { LU = u + b; LV = v + a; return true; }
  const r = g.r0 + v + a;
  if (r <= 0) return false;
  LU = u + Math.atan2(b, r);
  LV = Math.hypot(r, b) - g.r0;
  return true;
}

/** Straight screen segment between two local-frame points around (u, v). */
function localLine(out: BandOut, u: number, v: number, a0: number, b0: number, a1: number, b1: number, color: string, lw: number) {
  if (!local(out, u, v, a0, b0)) return;
  const u0 = LU, v0 = LV;
  if (!local(out, u, v, a1, b1)) return;
  out.line(u0, v0, LU, LV, color, lw);
}

// Reused box outline (local frame) — mutated per box.
const BOX: Array<[number, number]> = [[0, 0], [0, 0], [0, 0], [0, 0]];

/** Nice round tick values inside [lo, hi] (at most ~maxN). */
function niceTicks(lo: number, hi: number, maxN: number): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const raw = span / Math.max(1, maxN);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  const ticks: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9 && ticks.length < 50; k++) {
    ticks.push(+(k * step).toPrecision(12));
  }
  return ticks;
}

/** Scale lines across the whole leaf set (under the data), with value labels at the header position. */
function drawScale(ctx: RingDrawContext, sc: ValueScale) {
  const W = ctx.width;
  const out = ctx.out;
  const vals = sc.log ? sc.ticks.map(k => k.value) : niceTicks(sc.lo, sc.hi, Math.max(2, Math.min(10, Math.floor(W / (30 * ctx.scale)))));
  if (!vals.length) return;
  const lw = 1 * ctx.scale;
  const vs = vals.map(x => sc.t(x) * W);
  for (const v of vs) out.alongLine(ctx.uStart, ctx.uEnd, v, SCALE_COLOR, lw);
  out.flush();
  const size = Math.min(24, fieldLabelSize(ctx, 9) * ctx.scale);
  if (size < 4) return;
  // Thin the labels so they don't collide (they stack along v).
  let last = -Infinity;
  for (let i = 0; i < vs.length; i++) {
    if (vs[i] - last < size * 1.3) continue;
    drawFieldLabel(ctx, vs[i], fmtNum(vals[i]), size, "#666");
    last = vs[i];
  }
}

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const showOutlierOpts = (o: Record<string, any>) => o.format === "summary" || o.whiskers === "tukey";

const options: OptionField[] = [
  {
    key: "format", label: "Cell format", type: "select",
    choices: [
      { value: "raw", label: "Samples (compute quartiles)" },
      { value: "summary", label: "Summary: min, Q1, median, Q3, max[, extremes…]" },
    ],
    help: "Samples: any list of numbers per cell. Summary: iTOL's box plot format (extra numbers are drawn as outliers).",
  },
  {
    key: "whiskers", label: "Whiskers", type: "select",
    choices: [
      { value: "minmax", label: "Min – max" },
      { value: "tukey", label: "1.5 × IQR (Tukey) + outliers" },
    ],
    showIf: o => (o.format ?? "raw") !== "summary",
  },
  {
    key: "outlierShape", label: "Outlier marker", type: "select",
    choices: [
      { value: "circle", label: "Circle" },
      { value: "cross", label: "Cross (iTOL)" },
    ],
    showIf: showOutlierOpts,
  },
  { key: "color", label: "Box fill", type: "color", help: "Clear for the default." },
  { key: "lineColor", label: "Line colour", type: "color", help: "Box outline, whiskers, median and outliers. Clear for the default." },
  { key: "lineWidth", label: "Line width", type: "number", min: 0.1, max: 10, step: 0.25, unit: "px" },
  { key: "boxFrac", label: "Box thickness", type: "number", min: 0.05, max: 1, step: 0.05, help: "Fraction of the leaf spacing (also scaled by the global bar fill)." },
  { key: "width", label: "Width", type: "number", min: 20, max: 2000, step: 10, unit: "px" },
  {
    key: "scale", label: "Scale", type: "select",
    choices: [{ value: "linear", label: "Linear" }, { value: "log", label: "Logarithmic" }],
  },
  { key: "logBase", label: "Log base", type: "number", min: 1.01, step: 1, showIf: o => o.scale === "log" },
  { key: "min", label: "Minimum", type: "number", auto: true, help: "Blank = automatic (0 or the data minimum; log: a power of the base)." },
  { key: "max", label: "Maximum", type: "number", auto: true, help: "Blank = automatic (largest value, including outliers)." },
  {
    key: "scaleLines", label: "Scale lines", type: "select",
    choices: [{ value: "off", label: "Off" }, { value: "auto", label: "Automatic" }],
  },
];

const boxplot: RingModule = {
  kind: "boxplot",
  title: "Box plot",
  description: "Box-and-whisker plot per leaf from a list of numbers (samples, or min, Q1, median, Q3, max[, extremes]).",
  fields: { count: "one", hint: "A column of number lists, e.g. 3.1, 4.7, 5.0, 2.2 (or min,Q1,median,Q3,max)" },

  defaults(fields: string[], info: RingInfoContext) {
    return {
      format: fields[0] ? detectFormat(info.rows, fields[0]) : "raw",
      whiskers: "minmax",
      outlierShape: "circle",
      color: DEFAULT_FILL,
      lineColor: DEFAULT_LINE,
      lineWidth: 1,
      boxFrac: 0.6,
      width: 120,
      scale: "linear",
      logBase: 10,
      min: null,
      max: null,
      scaleLines: "auto",
    };
  },

  options,

  width(ring) {
    const w = numOpt(opt(ring, "width", 120));
    return w !== null && w > 0 ? w : 120;
  },

  draw(ring, ctx) {
    const field = ring.fields?.[0];
    const W = ctx.width;
    if (!field || !(W > 0) || !ctx.slots.length) return;
    const out = ctx.out;
    const mode = modeOf(ring);
    const { sc } = scaleFor(ring, ctx.rows);

    if (opt<string>(ring, "scaleLines", "auto") === "auto") drawScale(ctx, sc);

    const fill = colorOpt(ring, "color", DEFAULT_FILL);
    const line = colorOpt(ring, "lineColor", DEFAULT_LINE);
    const lw = Math.max(0.1, numOpt(opt(ring, "lineWidth", 1)) ?? 1) * ctx.scale;
    const boxFrac = Math.min(1, Math.max(0.02, numOpt(opt(ring, "boxFrac", 0.6)) ?? 0.6));
    const frac = boxFrac * ctx.barFill;
    if (!(frac > 0)) return;
    const showOut = mode !== "minmax";
    const cross = opt<string>(ring, "outlierShape", "circle") === "cross";
    const mw = Math.max(1, lw); // compact median thickness (px along v)
    const lo = sc.lo, hi = sc.hi;
    // Outlier marker radius cap (px): iTOL's h/4 gets huge on sparse circular trees.
    const rCap = Math.max(1, 3 * ctx.scale);

    for (const s of ctx.slots) {
      const b = getBox(s.row?.[field], mode);
      if (!b) continue;
      // Box + whiskers entirely outside a user-set range: nothing to draw but (in-range) outliers.
      const inRange = b.max >= lo && b.min <= hi;
      const thick = out.alongPx(s.lo, s.hi, 0) * frac;
      if (!inRange && (thick < COMPACT_PX || !showOut || !b.out.length)) continue;
      const u = (s.lo + s.hi) / 2;
      const vMin = sc.t(b.min) * W, vQ1 = sc.t(b.q1) * W, vMed = sc.t(b.med) * W, vQ3 = sc.t(b.q3) * W, vMax = sc.t(b.max) * W;

      if (thick < COMPACT_PX) {
        // Level of detail: cell fills only (box split around a median band, thin whiskers) — no overlaps, so batching order is irrelevant.
        const hu = ((s.hi - s.lo) * frac) / 2;
        const wu = hu * 0.35;
        if (vQ1 > vMin) out.fillCell(u - wu, u + wu, vMin, vQ1, line);
        if (vMax > vQ3) out.fillCell(u - wu, u + wu, vQ3, vMax, line);
        const m0 = Math.max(vQ1, vMed - mw / 2), m1 = Math.min(vQ3, vMed + mw / 2);
        if (m0 > vQ1) out.fillCell(u - hu, u + hu, vQ1, m0, fill);
        if (vQ3 > m1) out.fillCell(u - hu, u + hu, m1, vQ3, fill);
        if (b.med >= lo && b.med <= hi) out.fillCell(u - hu, u + hu, vMed - mw / 2, vMed + mw / 2, line);
        continue;
      }

      const h = thick / 2;
      if (inRange) {
        // Whiskers (centre line) and caps (±h/3, as iTOL); no cap where a whisker is cut by a user-set range.
        if (vQ1 > vMin) out.line(u, vMin, u, vQ1, line, lw);
        if (vMax > vQ3) out.line(u, vQ3, u, vMax, line, lw);
        if (b.min >= lo) localLine(out, u, vMin, 0, -h / 3, 0, h / 3, line, lw);
        if (b.max <= hi) localLine(out, u, vMax, 0, -h / 3, 0, h / 3, line, lw);
        // Box Q1–Q3 (straight rectangle, also in polar); clamped to a user-set range, skipped if fully outside it.
        if (b.q3 >= lo && b.q1 <= hi) {
          const L = vQ3 - vQ1;
          BOX[0][0] = 0; BOX[0][1] = -h;
          BOX[1][0] = L; BOX[1][1] = -h;
          BOX[2][0] = L; BOX[2][1] = h;
          BOX[3][0] = 0; BOX[3][1] = h;
          out.localPolygon(u, vQ1, BOX, fill, line, lw);
        }
        // Median across the whole box.
        if (b.med >= lo && b.med <= hi) localLine(out, u, vMed, 0, -h, 0, h, line, lw);
      }
      // Outliers / extremes (skipped when outside a user-set range).
      if (showOut && b.out.length && h >= 2) {
        const r = Math.min(Math.max(1, h / 4), rCap);
        for (const x of b.out) {
          if (!(x >= lo && x <= hi)) continue;
          const v = sc.t(x) * W;
          if (cross) {
            localLine(out, u, v, -r, -r, r, r, line, lw);
            localLine(out, u, v, -r, r, r, -r, line, lw);
          } else {
            out.shape("circle", u, v, 2 * r, null, line, lw);
          }
        }
      }
    }
    out.flush();
  },

  legend(ring, info): LegendSection[] {
    const field = ring.fields?.[0];
    if (!field) return [];
    const { sc, stats } = scaleFor(ring, info.rows);
    const mode = modeOf(ring);
    const notes: string[] = [];
    notes.push(mode === "summary" ? "min, Q1, median, Q3, max" : mode === "tukey" ? "whiskers 1.5 × IQR, outliers" : "whiskers min – max");
    if (sc.log) notes.push(`${logBaseName(sc.base)} scale`);
    if (!stats.count) notes.push("no numeric data");
    const { lo, hi } = scaleLabel(sc);
    return [{
      id: `track:${ring.key}`,
      title: ring.label,
      note: notes.join("; "),
      kind: "ramp",
      min: lo,
      max: hi,
      style: "bar",
      color: colorOpt(ring, "color", DEFAULT_FILL),
      ticks: scaleTicks(sc),
    }];
  },

  tooltip(ring, row, info) {
    const field = ring.fields?.[0];
    if (!field || !row) return [];
    const raw = row[field];
    if (blank(raw)) return [];
    const name = info.columnLabel(field);
    const mode = modeOf(ring);
    const b = getBox(raw, mode);
    if (!b) return [`${name}: ${String(raw).slice(0, 40)} (${mode === "summary" ? "needs ≥ 5 numbers" : "no numbers"})`];
    const lines = [
      `${name}: median ${fmtNum(b.med)}`,
      `Q1 – Q3: ${fmtNum(b.q1)} – ${fmtNum(b.q3)}`,
      `${mode === "tukey" ? "Whiskers" : "Min – max"}: ${fmtNum(b.min)} – ${fmtNum(b.max)}`,
    ];
    const extra: string[] = [];
    if (b.n) extra.push(`n = ${b.n}`);
    if (b.out.length) {
      const MAX = 6;
      const list = b.out.slice(0, MAX).map(fmtNum).join(", ") + (b.out.length > MAX ? ` … (+${b.out.length - MAX})` : "");
      extra.push(`${mode === "summary" ? "extremes" : "outliers"}: ${list}`);
    }
    if (extra.length) lines.push(extra.join("; "));
    return lines;
  },
};

export default boxplot;
