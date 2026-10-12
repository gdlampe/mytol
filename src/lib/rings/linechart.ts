import { color as d3color } from "d3";
import type { AnnotationRow, TrackConfig } from "../types";
import type { LegendEntry, LegendSection } from "../legend";
import { fmtNum, logBaseName, makeValueScale, validLogBase } from "../trackStyle";
import type { BandOut } from "./band";
import { opt } from "./types";
import type { RingModule } from "./types";
import { FIELD_PALETTE, drawFieldLabel } from "./util";

// ============================================================
// Line chart ring (iTOL DATASET_LINECHART): a small x/y chart per leaf.
//
// Cell formats (one column):
//   "y1,y2,y3,…"         x = 0, 1, 2 … (blank / NA entries leave a gap)
//   "x:y x:y …", "x|y …"  explicit pairs (sorted by x; bad pairs skipped)
// x runs across the ring (v: 0 → width), y along the leaf slot (u), with
// larger y towards smaller u ("up" in the rectangular layout; the same
// direction in polar). Like iTOL, every chart shares one x range and (by
// default) one y range, auto from all rows unless set; optional per-leaf y.
// iTOL extras kept: dots, Y-threshold colours (LINE_COLORS), horizontal /
// vertical guide lines (AXIS_X / AXIS_Y), height factor, title (field label).
// ============================================================

/** Slots thinner than this (screen px) are skipped entirely. */
const MIN_SLOT_PX = 1;
/** Slots thinner than this (screen px) draw a min / max envelope cell instead of the line. */
const ENVELOPE_PX = 2;
/** Dots and guide lines need at least this much slot (screen px). */
const DETAIL_PX = 6;
/** Chart height as a fraction of the slot at height factor 1 (10% padding each side). */
const CHART_FRAC = 0.8;

// ------------------------------------------------------------
// Cell parsing (cached by cell string)
// ------------------------------------------------------------

type Series = {
  /** Sorted by x. ys NaN = gap (missing value). */
  xs: Float64Array;
  ys: Float64Array;
  len: number;
  /** Points with a finite y. */
  n: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Smallest positive y (log scales). */
  minPosY: number;
};

const EMPTY: Series = {
  xs: new Float64Array(0), ys: new Float64Array(0), len: 0, n: 0,
  minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minPosY: Infinity,
};

const seriesCache = new Map<string, Series>();
let cachedPoints = 0;
const CACHE_ENTRIES = 100_000;
const CACHE_POINTS = 4_000_000;

/** Finite number from a token, else NaN ("" is NaN, not 0). */
function num(t: string): number {
  if (t === "") return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const present = (v: unknown) => v !== null && v !== undefined && v !== "";

function parseSeries(v: unknown): Series | null {
  if (!present(v)) return null;
  const raw = String(v);
  const hit = seriesCache.get(raw);
  if (hit) return hit;
  const s = parseUncached(raw);
  if (seriesCache.size >= CACHE_ENTRIES || cachedPoints > CACHE_POINTS) {
    seriesCache.clear();
    cachedPoints = 0;
  }
  seriesCache.set(raw, s);
  cachedPoints += s.len + 8;
  return s;
}

const onePipe = (t: string) => { const k = t.indexOf("|"); return k > 0 && k === t.lastIndexOf("|"); };

function parseUncached(raw: string): Series {
  let str = raw.trim();
  if (/^[[(]/.test(str) && /[\])]$/.test(str)) str = str.slice(1, -1).trim();
  if (!str) return EMPTY;
  let xs: number[] = [];
  let ys: number[] = [];
  const norm = str.replace(/\s*([:|])\s*/g, "$1");
  const toks = norm.split(/[,;\s]+/).filter(t => t !== "");
  const pairs = toks.some(t => t.includes(":")) || (toks.length >= 2 && toks.every(onePipe));
  if (pairs) {
    let sorted = true;
    for (const t of toks) {
      const k = t.search(/[:|]/);
      if (k <= 0) continue;
      const rest = t.slice(k + 1);
      if (/[:|]/.test(rest)) continue;
      const x = num(t.slice(0, k));
      if (Number.isNaN(x)) continue;
      if (xs.length && x < xs[xs.length - 1]) sorted = false;
      xs.push(x);
      ys.push(num(rest));
    }
    if (!sorted) {
      const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
      xs = idx.map(i => xs[i]);
      ys = idx.map(i => ys[i]);
    }
  } else {
    const parts = str.split(/\s*[,;|]\s*|\s+/);
    for (let i = 0; i < parts.length; i++) { xs.push(i); ys.push(num(parts[i])); }
  }
  // Drop leading / trailing gaps (x stays explicit, so nothing shifts).
  let a = 0, b = ys.length;
  while (a < b && Number.isNaN(ys[a])) a++;
  while (b > a && Number.isNaN(ys[b - 1])) b--;
  if (a >= b) return EMPTY;
  const s: Series = {
    xs: Float64Array.from(xs.slice(a, b)), ys: Float64Array.from(ys.slice(a, b)), len: b - a, n: 0,
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minPosY: Infinity,
  };
  for (let i = 0; i < s.len; i++) {
    const y = s.ys[i];
    if (Number.isNaN(y)) continue;
    const x = s.xs[i];
    s.n++;
    if (x < s.minX) s.minX = x;
    if (x > s.maxX) s.maxX = x;
    if (y < s.minY) s.minY = y;
    if (y > s.maxY) s.maxY = y;
    if (y > 0 && y < s.minPosY) s.minPosY = y;
  }
  return s;
}

// ------------------------------------------------------------
// Dataset-wide ranges (once per rows identity and column)
// ------------------------------------------------------------

type GStats = { minX: number; maxX: number; minY: number; maxY: number; minPosY: number; n: number; rows: number };

const statsCache = new WeakMap<AnnotationRow[], Map<string, GStats>>();

function globalStats(rows: AnnotationRow[], field: string): GStats {
  let m = statsCache.get(rows);
  if (!m) { m = new Map(); statsCache.set(rows, m); }
  let g = m.get(field);
  if (g) return g;
  g = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minPosY: Infinity, n: 0, rows: 0 };
  for (const row of rows) {
    const s = parseSeries(row[field]);
    if (!s || !s.n) continue;
    g.rows++;
    g.n += s.n;
    if (s.minX < g.minX) g.minX = s.minX;
    if (s.maxX > g.maxX) g.maxX = s.maxX;
    if (s.minY < g.minY) g.minY = s.minY;
    if (s.maxY > g.maxY) g.maxY = s.maxY;
    if (s.minPosY < g.minPosY) g.minPosY = s.minPosY;
  }
  m.set(field, g);
  return g;
}

// ------------------------------------------------------------
// Options
// ------------------------------------------------------------

type Guide = { val: number; width: number | null; color: string | null };
type Band = { val: number; color: string };

/** Split option lists on whitespace / ";" / "," (commas inside rgb(…) kept). */
function tokens(s: string): string[] {
  return s
    .replace(/\(([^)]*)\)/g, m => m.replace(/\s+/g, ""))
    .split(/[\s;]+|,(?![^(]*\))/)
    .filter(t => t !== "");
}

const guideCache = new Map<string, Guide[]>();
/** iTOL AXIS_X / AXIS_Y syntax: "v v …" or "v|width|colour …". */
function parseGuides(v: unknown): Guide[] {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return [];
  let g = guideCache.get(s);
  if (g) return g;
  g = [];
  for (const t of tokens(s)) {
    const p = t.split("|");
    const val = num(p[0]);
    if (Number.isNaN(val)) continue;
    const w = p[1] !== undefined ? num(p[1]) : NaN;
    g.push({ val, width: Number.isNaN(w) || w < 0 ? null : w, color: p[2] ? p[2] : null });
  }
  if (guideCache.size > 64) guideCache.clear();
  guideCache.set(s, g);
  return g;
}

const bandCache = new Map<string, Band[]>();
/** iTOL LINE_COLORS: "y|colour …" — a point takes the colour of the lowest threshold it is below. */
function parseBands(v: unknown): Band[] {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return [];
  let b = bandCache.get(s);
  if (b) return b;
  b = [];
  for (const t of tokens(s)) {
    const k = t.search(/[|:]/);
    if (k <= 0) continue;
    const val = num(t.slice(0, k));
    const color = t.slice(k + 1).trim();
    if (!Number.isNaN(val) && color) b.push({ val, color });
  }
  b.sort((p, q) => p.val - q.val);
  b = b.slice(0, 64);
  if (bandCache.size > 64) bandCache.clear();
  bandCache.set(s, b);
  return b;
}

const alphaCache = new Map<string, string>();
/** CSS colour at an opacity (rgba string; band batches fills by colour string). */
function withAlpha(c: string, a: number): string {
  if (!(a < 1)) return c;
  const key = `${c}|${a}`;
  let r = alphaCache.get(key);
  if (r) return r;
  const col = d3color(c);
  r = col ? col.copy({ opacity: Math.max(0, a) }).formatRgb() : c;
  if (alphaCache.size > 256) alphaCache.clear();
  alphaCache.set(key, r);
  return r;
}

function numOpt(ring: TrackConfig, key: string, fallback: number, lo: number, hi: number): number {
  const v = opt<unknown>(ring, key, fallback);
  const n = typeof v === "number" ? v : Number(v);
  return v !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** Number or null (auto). */
function autoOpt(ring: TrackConfig, key: string): number | null {
  const v = ring.opts?.[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Colour option; "" (cleared in the editor) → fallback. */
function colorOpt(ring: TrackConfig, key: string, fallback: string): string {
  const v = opt<unknown>(ring, key, "");
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

const DEFAULT_COLOR = FIELD_PALETTE[0];

type Opts = {
  color: string;
  lineWidth: number;
  showLine: boolean;
  showDots: boolean;
  dotSize: number;
  dotColor: string;
  fill: boolean;
  fillColor: string;
  heightFactor: number;
  perLeaf: boolean;
  log: boolean;
  logBase: number;
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
  zeroLine: boolean;
  zeroColor: string;
  hLines: Guide[];
  vLines: Guide[];
  gridColor: string;
  gridWidth: number;
  bands: Band[];
  showLabels: boolean;
  labelSize: number;
};

function readOpts(ring: TrackConfig): Opts {
  const color = colorOpt(ring, "color", DEFAULT_COLOR);
  return {
    color,
    lineWidth: numOpt(ring, "lineWidth", 1, 0, 20),
    showLine: opt<unknown>(ring, "showLine", true) !== false,
    showDots: opt<unknown>(ring, "showDots", true) !== false,
    dotSize: numOpt(ring, "dotSize", 1.5, 0, 50),
    dotColor: colorOpt(ring, "dotColor", color),
    fill: opt<unknown>(ring, "fill", false) === true,
    fillColor: withAlpha(colorOpt(ring, "fillColor", color), numOpt(ring, "fillOpacity", 0.3, 0, 1)),
    heightFactor: numOpt(ring, "heightFactor", 1, 0.05, 2.5),
    perLeaf: opt<unknown>(ring, "yScope", "shared") === "leaf",
    log: opt<unknown>(ring, "yScale", "linear") === "log",
    logBase: validLogBase(autoOpt(ring, "logBase") ?? undefined),
    xMin: autoOpt(ring, "xMin"),
    xMax: autoOpt(ring, "xMax"),
    yMin: autoOpt(ring, "yMin"),
    yMax: autoOpt(ring, "yMax"),
    zeroLine: opt<unknown>(ring, "zeroLine", false) === true,
    zeroColor: colorOpt(ring, "zeroColor", "#888888"),
    hLines: parseGuides(opt<unknown>(ring, "hLines", "")),
    vLines: parseGuides(opt<unknown>(ring, "vLines", "")),
    gridColor: colorOpt(ring, "gridColor", "#aaaaaa"),
    gridWidth: numOpt(ring, "gridWidth", 0.5, 0, 20),
    bands: parseBands(opt<unknown>(ring, "colorBands", "")),
    showLabels: opt<unknown>(ring, "showLabels", true) !== false,
    labelSize: numOpt(ring, "labelSize", 10, 1, 100),
  };
}

// ------------------------------------------------------------
// Scales
// ------------------------------------------------------------

/** Value range plus its transformed form (L, span) for t = (f(y) − L) / span. */
type Range = { lo: number; hi: number; L: number; span: number };

function xRange(o: Opts, g: GStats): Range {
  let lo = g.n ? g.minX : 0, hi = g.n ? g.maxX : 1;
  // Like iTOL, vertical guide lines extend the automatic x range.
  for (const v of o.vLines) { if (v.val < lo) lo = v.val; if (v.val > hi) hi = v.val; }
  if (o.xMin !== null) lo = o.xMin;
  if (o.xMax !== null) hi = o.xMax;
  if (!(hi > lo)) { const c = Number.isFinite(lo) ? lo : 0; lo = c - 0.5; hi = c + 0.5; }
  return { lo, hi, L: lo, span: hi - lo };
}

/**
 * Y range into r. shared: auto range over all rows (extended by guide
 * lines, like iTOL; log auto range snaps to powers of the base). Per leaf:
 * the leaf's own min / max. User min / max always win.
 */
function yRange(o: Opts, dLo: number, dHi: number, dMinPos: number, shared: boolean, r: Range): Range {
  if (o.log) {
    const base = o.logBase;
    let lo: number, hi: number;
    if (shared) {
      let minPos = dMinPos, max = dHi;
      for (const h of o.hLines) if (h.val > 0) { if (h.val < minPos) minPos = h.val; if (h.val > max) max = h.val; }
      const sc = makeValueScale(
        { scale: "log", min: o.yMin, max: o.yMax, logBase: base },
        { min: dLo, max, minPos, count: Number.isFinite(max) ? 1 : 0 }
      );
      lo = sc.lo; hi = sc.hi;
    } else {
      lo = o.yMin !== null && o.yMin > 0 ? o.yMin : dMinPos;
      hi = o.yMax !== null && o.yMax > 0 ? o.yMax : dHi;
      if (!(lo > 0 && Number.isFinite(lo))) lo = hi > 0 && Number.isFinite(hi) ? hi : 1;
      if (!(hi > lo)) { const k = Math.sqrt(base); hi = lo * k; lo = lo / k; }
    }
    r.lo = lo; r.hi = hi; r.L = Math.log(lo); r.span = Math.log(hi) - r.L;
    return r;
  }
  let lo = Number.isFinite(dLo) ? dLo : 0, hi = Number.isFinite(dHi) ? dHi : 1;
  if (shared) for (const h of o.hLines) { if (h.val < lo) lo = h.val; if (h.val > hi) hi = h.val; }
  if (o.zeroLine) { if (lo > 0) lo = 0; if (hi < 0) hi = 0; }
  if (o.yMin !== null) lo = o.yMin;
  if (o.yMax !== null) hi = o.yMax;
  if (!(hi > lo)) { const c = Number.isFinite(lo) ? lo : 0; lo = c - 0.5; hi = c + 0.5; }
  r.lo = lo; r.hi = hi; r.L = lo; r.span = hi - lo;
  return r;
}

/** Position 0–1 of y in r (log: values ≤ 0 sit at the bottom). */
function tOf(y: number, r: Range, log: boolean): number {
  const t = log ? (y > 0 ? (Math.log(y) - r.L) / r.span : 0) : (y - r.L) / r.span;
  return t > 0 ? (t < 1 ? t : 1) : 0;
}

// ------------------------------------------------------------
// Per-frame scratch (reused across frames: no per-leaf allocation)
// ------------------------------------------------------------

const F_BREAK = 1; // first point of a run
const F_DOT = 2;   // dot allowed (slot big enough, series not decimated)
const F_MARK = 4;  // isolated point drawn as a small marker
const NO_BAND = 255;

let GU = new Float64Array(4096);
let GV = new Float64Array(4096);
let GC = new Uint8Array(4096);
let GF = new Uint8Array(4096);
let GN = 0;

function ensure(n: number) {
  if (n <= GU.length) return;
  let cap = GU.length;
  while (cap < n) cap *= 2;
  const u = new Float64Array(cap); u.set(GU.subarray(0, GN)); GU = u;
  const v = new Float64Array(cap); v.set(GV.subarray(0, GN)); GV = v;
  const c = new Uint8Array(cap); c.set(GC.subarray(0, GN)); GC = c;
  const f = new Uint8Array(cap); f.set(GF.subarray(0, GN)); GF = f;
}

// Point tuples for polyline / polygon. Both band backends map the points
// immediately, so one pooled array is reused for every call.
const POOL: Array<[number, number]> = [];
const BUF: Array<[number, number]> = [];
function bufPush(u: number, v: number) {
  const i = BUF.length;
  let p = POOL[i];
  if (!p) { p = [0, 0]; POOL[i] = p; }
  p[0] = u; p[1] = v;
  BUF.push(p);
}

function bandOf(y: number, bands: Band[]): number {
  for (let b = 0; b < bands.length; b++) if (y < bands[b].val) return b;
  return NO_BAND;
}

const YR: Range = { lo: 0, hi: 1, L: 0, span: 1 };

// State of the leaf being appended (module-level so the hot loop allocates nothing).
const A = {
  xs: EMPTY.xs, ys: EMPTY.ys, x0: 0, v0: 0, kx: 0, uBot: 0, uSpan: 0,
  log: false, bands: [] as Band[], dot: 0, brk: F_BREAK,
  bActive: false, bCol: 0, bMin: 0, bMax: 0,
};

function emit(i: number) {
  const y = A.ys[i];
  GU[GN] = A.uBot - A.uSpan * tOf(y, YR, A.log);
  GV[GN] = A.v0 + (A.xs[i] - A.x0) * A.kx;
  GC[GN] = A.bands.length ? bandOf(y, A.bands) : NO_BAND;
  GF[GN] = A.brk | A.dot;
  A.brk = 0;
  GN++;
}

function flushBucket() {
  if (!A.bActive) return;
  A.bActive = false;
  const lo = A.bMin, hi = A.bMax;
  if (lo === hi) emit(lo);
  else if (lo < hi) { emit(lo); emit(hi); }
  else { emit(hi); emit(lo); }
}

/**
 * Append one leaf's mapped points (u, v) to the scratch buffers. Points
 * outside the x range and missing values break the line. Series with more
 * than two points per px across the chart keep only each px column's
 * min and max (in order).
 */
function appendSeries(
  s: Series, xr: Range, v0: number, kx: number, decimate: boolean,
  uBot: number, uSpan: number, log: boolean, bands: Band[], dotFlag: number
) {
  ensure(GN + s.len + 2);
  const xs = s.xs, ys = s.ys;
  A.xs = xs; A.ys = ys; A.x0 = xr.lo; A.v0 = v0; A.kx = kx; A.uBot = uBot; A.uSpan = uSpan;
  A.log = log; A.bands = bands; A.dot = dotFlag; A.brk = F_BREAK; A.bActive = false;
  const eps = xr.span * 1e-9;
  const xLo = xr.lo - eps, xHi = xr.hi + eps;
  for (let i = 0; i < s.len; i++) {
    const x = xs[i], y = ys[i];
    if (x < xLo || x > xHi || Number.isNaN(y)) {
      flushBucket();
      A.brk = F_BREAK;
      continue;
    }
    if (!decimate) { emit(i); continue; }
    const col = Math.floor(v0 + (x - xr.lo) * kx);
    if (!A.bActive || col !== A.bCol) {
      flushBucket();
      A.bActive = true; A.bCol = col; A.bMin = i; A.bMax = i;
    } else {
      if (y < ys[A.bMin]) A.bMin = i;
      if (y > ys[A.bMax]) A.bMax = i;
    }
  }
  flushBucket();
}

// Min / max envelopes of very thin slots: [u0, u1, v0, v1, colour index] per cell.
let ENV = new Float64Array(5 * 1024);
let EN = 0;

function pushEnv(u0: number, u1: number, v0: number, v1: number, c: number) {
  if (5 * (EN + 1) > ENV.length) {
    const e = new Float64Array(ENV.length * 2);
    e.set(ENV.subarray(0, 5 * EN));
    ENV = e;
  }
  const p = 5 * EN++;
  ENV[p] = u0; ENV[p + 1] = u1; ENV[p + 2] = v0; ENV[p + 3] = v1; ENV[p + 4] = c;
}

const EXT = { minX: 0, maxX: 0, minY: 0, maxY: 0, n: 0 };

/** x / y extent of the points of s inside the x range, into EXT. */
function extentIn(s: Series, xr: Range) {
  const eps = xr.span * 1e-9;
  const xLo = xr.lo - eps, xHi = xr.hi + eps;
  if (s.minX >= xLo && s.maxX <= xHi) {
    EXT.minX = s.minX; EXT.maxX = s.maxX; EXT.minY = s.minY; EXT.maxY = s.maxY; EXT.n = s.n;
    return;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
  const xs = s.xs, ys = s.ys;
  for (let i = 0; i < s.len; i++) {
    const x = xs[i], y = ys[i];
    if (x < xLo || x > xHi || Number.isNaN(y)) continue;
    n++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  EXT.minX = minX; EXT.maxX = maxX; EXT.minY = minY; EXT.maxY = maxY; EXT.n = n;
}

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const linechart: RingModule = {
  kind: "linechart",
  title: "Line chart",
  description: "A small line chart per leaf from one column: \"y1,y2,y3…\" (x = position) or \"x:y x:y…\" / \"x|y …\" pairs.",
  fields: { count: "one", hint: "A column of number lists (y1,y2,…) or x:y pairs" },

  defaults: () => ({
    color: DEFAULT_COLOR,
    lineWidth: 1,
    showLine: true,
    showDots: true,
    dotSize: 1.5,
    dotColor: "",
    fill: false,
    fillColor: "",
    fillOpacity: 0.3,
    width: 120,
    heightFactor: 1,
    yScope: "shared",
    yScale: "linear",
    logBase: 10,
    xMin: null,
    xMax: null,
    yMin: null,
    yMax: null,
    zeroLine: false,
    zeroColor: "#888888",
    hLines: "",
    vLines: "",
    gridColor: "#aaaaaa",
    gridWidth: 0.5,
    colorBands: "",
    showLabels: true,
    labelSize: 10,
    showLegend: true,
  }),

  options: [
    { key: "color", label: "Line colour", type: "color", help: "Line colour (iTOL DEFAULT_LINE_COLOR)." },
    { key: "showLine", label: "Draw line", type: "bool", help: "Connect the points (iTOL SHOW_LINE)." },
    { key: "lineWidth", label: "Line width", type: "number", min: 0, max: 20, step: 0.25, unit: "px", showIf: o => o.showLine !== false },
    { key: "showDots", label: "Show points", type: "bool", help: "A dot at each point (iTOL SHOW_DOTS). Hidden on dense series and thin slots." },
    { key: "dotSize", label: "Point radius", type: "number", min: 0, max: 50, step: 0.25, unit: "px", showIf: o => o.showDots !== false, help: "iTOL DOT_SIZE." },
    { key: "dotColor", label: "Point colour", type: "color", showIf: o => o.showDots !== false, help: "Clear to use the line colour (iTOL DEFAULT_DOT_COLOR)." },
    { key: "fill", label: "Fill under line", type: "bool", help: "Shade the area between the line and zero (or the chart bottom)." },
    { key: "fillColor", label: "Fill colour", type: "color", showIf: o => o.fill === true, help: "Clear to use the line colour." },
    { key: "fillOpacity", label: "Fill opacity", type: "number", min: 0, max: 1, step: 0.05, showIf: o => o.fill === true },
    {
      key: "colorBands", label: "Colour by Y", type: "text", placeholder: "e.g. 0|#d62728 10|#2ca02c",
      help: "Y thresholds 'y|colour …' (iTOL LINE_COLORS): a point below a threshold takes the colour of the lowest such threshold; the line leaving it and its dot use that colour.",
    },
    { key: "width", label: "Chart width", type: "number", min: 10, max: 5000, step: 10, unit: "px", help: "Width of the ring (iTOL WIDTH)." },
    {
      key: "heightFactor", label: "Height factor", type: "number", min: 0.05, max: 2.5, step: 0.05, unit: "×",
      help: "Chart height relative to the leaf slot: 1 = 80% (10% padding each side); also scaled by the global bar fill (iTOL HEIGHT_FACTOR).",
    },
    {
      key: "yScope", label: "Y range", type: "select",
      choices: [{ value: "shared", label: "Shared by all leaves" }, { value: "leaf", label: "Per leaf" }],
      help: "Shared: every chart uses the same y axis (iTOL). Per leaf: each chart spans its own min–max.",
    },
    { key: "yScale", label: "Y scale", type: "select", choices: [{ value: "linear", label: "Linear" }, { value: "log", label: "Logarithmic" }] },
    { key: "logBase", label: "Log base", type: "number", min: 1.01, max: 1000, step: 1, showIf: o => o.yScale === "log" },
    { key: "xMin", label: "X min", type: "number", auto: true, help: "Blank = smallest x over all leaves." },
    { key: "xMax", label: "X max", type: "number", auto: true, help: "Blank = largest x over all leaves." },
    { key: "yMin", label: "Y min", type: "number", auto: true, help: "Blank = automatic (all leaves, or per leaf)." },
    { key: "yMax", label: "Y max", type: "number", auto: true, help: "Blank = automatic (all leaves, or per leaf)." },
    { key: "zeroLine", label: "Zero line", type: "bool", help: "Horizontal line at y = 0 (the automatic y range is widened to include 0)." },
    { key: "zeroColor", label: "Zero line colour", type: "color", showIf: o => o.zeroLine === true },
    {
      key: "hLines", label: "Lines at Y", type: "text", placeholder: "e.g. 5 10|1|#ff0000",
      help: "Horizontal guide lines at these y values: 'y' or 'y|width|colour' (iTOL AXIS_X). They extend the automatic y range.",
    },
    {
      key: "vLines", label: "Lines at X", type: "text", placeholder: "e.g. 0 50|1|#999999",
      help: "Vertical guide lines at these x values: 'x' or 'x|width|colour' (iTOL AXIS_Y). They extend the automatic x range.",
    },
    { key: "gridColor", label: "Guide colour", type: "color", showIf: o => !!(o.hLines || o.vLines) },
    { key: "gridWidth", label: "Guide width", type: "number", min: 0, max: 20, step: 0.25, unit: "px", showIf: o => !!(o.hLines || o.vLines || o.zeroLine) },
    { key: "showLabels", label: "Column label", type: "bool", help: "Column name above the first leaf (iTOL SHOW_TITLE)." },
    { key: "labelSize", label: "Label size", type: "number", min: 4, max: 40, step: 1, unit: "px", showIf: o => o.showLabels !== false },
    { key: "showLegend", label: "Legend", type: "bool" },
  ],

  width(ring) {
    return numOpt(ring, "width", 120, 1, 5000);
  },

  draw(ring, ctx) {
    const field = ring.fields?.[0];
    if (!field || !ctx.slots.length) return;
    const out: BandOut = ctx.out;
    const o = readOpts(ring);
    const g = globalStats(ctx.rows, field);
    const xr = xRange(o, g);
    if (!o.perLeaf) yRange(o, g.minY, g.maxY, g.minPosY, true, YR);

    const W = ctx.width, k = ctx.scale;
    const lw = o.lineWidth * k;
    const dotR = o.dotSize * k;
    const padV = Math.min(W / 4, Math.max(o.showDots ? dotR : 0, lw / 2) + 0.5);
    const vSpan = Math.max(0, W - 2 * padV);
    const kx = vSpan / xr.span;
    const frac = Math.min(2.5, Math.max(0.02, CHART_FRAC * ctx.barFill * o.heightFactor));
    const midV = W / 2;
    const bands = o.bands;
    const gridW = o.gridWidth * k;
    const detailGuides = o.zeroLine || o.hLines.length > 0 || o.vLines.length > 0;
    const envLine = o.showLine && lw > 0;

    // Pass 1: map every visible chart into the scratch buffers; area fills
    // and guide lines go straight to the band (fills under strokes).
    GN = 0;
    EN = 0;
    for (const s of ctx.slots) {
      const ser = parseSeries(s.row?.[field]);
      if (!ser || !ser.n) continue;
      const slotPx = out.alongPx(s.lo, s.hi, midV);
      if (slotPx < MIN_SLOT_PX) continue;
      if (slotPx < ENVELOPE_PX && !o.fill && !envLine) continue;
      if (o.perLeaf) yRange(o, ser.minY, ser.maxY, ser.minPosY, false, YR);
      const half = (s.hi - s.lo) * frac * 0.5;
      const uBot = (s.lo + s.hi) * 0.5 + half, uSpan = 2 * half;

      if (slotPx < ENVELOPE_PX) {
        // Too thin for a line: one cell over the chart's x extent and y
        // min–max (split by colour band), plus its fill down to the baseline.
        extentIn(ser, xr);
        if (!EXT.n) continue;
        const va = padV + (EXT.minX - xr.lo) * kx, vb = padV + (EXT.maxX - xr.lo) * kx;
        if (o.fill && EXT.n >= 2 && vb > va) {
          const ub = uBot - uSpan * (o.log ? 0 : tOf(0, YR, false));
          const uTop = uBot - uSpan * tOf(EXT.maxY, YR, o.log), uLow = uBot - uSpan * tOf(EXT.minY, YR, o.log);
          out.fillCell(Math.min(uTop, ub), Math.max(uLow, ub), va, vb, o.fillColor);
        }
        if (envLine) {
          const h = lw / 2, du = (h * (s.hi - s.lo)) / slotPx;
          const nb = bands.length;
          const cLo = nb ? Math.min(bandOf(EXT.minY, bands), nb) : 0;
          const cHi = nb ? Math.min(bandOf(EXT.maxY, bands), nb) : 0;
          for (let c = cLo; c <= cHi; c++) {
            const ya = c > cLo ? bands[c - 1].val : EXT.minY;
            const yb = c < cHi ? bands[c].val : EXT.maxY;
            const u0 = uBot - uSpan * tOf(yb, YR, o.log) - (c === cHi ? du : 0);
            const u1 = uBot - uSpan * tOf(ya, YR, o.log) + (c === cLo ? du : 0);
            if (u1 > u0) pushEnv(u0, u1, va - h, vb + h, c < nb ? c : NO_BAND);
          }
        }
        continue;
      }

      const detail = slotPx >= DETAIL_PX;
      const decimate = ser.len > 2 * vSpan;
      const start = GN;
      appendSeries(ser, xr, padV, kx, decimate, uBot, uSpan, o.log, bands, o.showDots && detail && !decimate ? F_DOT : 0);

      if (o.fill && GN - start >= 2) {
        const tb = o.log ? 0 : tOf(0, YR, false);
        const ub = uBot - uSpan * tb;
        let i = start;
        while (i < GN) {
          let j = i + 1;
          while (j < GN && !(GF[j] & F_BREAK)) j++;
          if (j - i >= 2) {
            BUF.length = 0;
            for (let q = i; q < j; q++) bufPush(GU[q], GV[q]);
            bufPush(ub, GV[j - 1]);
            bufPush(ub, GV[i]);
            out.polygon(BUF, o.fillColor, null);
          }
          i = j;
        }
      }

      if (detail && detailGuides) {
        if (o.zeroLine && !o.log && YR.lo <= 0 && YR.hi >= 0) {
          const u = uBot - uSpan * tOf(0, YR, false);
          out.line(u, 0, u, W, o.zeroColor, gridW);
        }
        for (const h of o.hLines) {
          if (h.val < YR.lo || h.val > YR.hi || (o.log && !(h.val > 0))) continue;
          const u = uBot - uSpan * tOf(h.val, YR, o.log);
          out.line(u, 0, u, W, h.color ?? o.gridColor, h.width !== null ? h.width * k : gridW);
        }
        for (const vl of o.vLines) {
          if (vl.val < xr.lo || vl.val > xr.hi) continue;
          const v = padV + (vl.val - xr.lo) * kx;
          out.alongLine(uBot - uSpan, uBot, v, vl.color ?? o.gridColor, vl.width !== null ? vl.width * k : gridW);
        }
      }
    }
    out.flush();
    if (!GN && !EN) { drawTitle(); return; }

    // Pass 2: lines, split into runs of one colour (the segment leaving a
    // point takes that point's colour, as in iTOL), and thin-slot envelopes.
    const bandColor = (c: number, fallback: string) => (c === NO_BAND ? fallback : bands[c].color);
    for (let e = 0; e < EN; e++) {
      const p = 5 * e;
      out.fillCell(ENV[p], ENV[p + 1], ENV[p + 2], ENV[p + 3], bandColor(ENV[p + 4], o.color));
    }
    let i = 0;
    while (i < GN) {
      let j = i + 1;
      while (j < GN && !(GF[j] & F_BREAK)) j++;
      if (j - i === 1) {
        if (o.showLine && !(GF[i] & F_DOT)) GF[i] |= F_MARK;
      } else if (o.showLine && lw > 0) {
        let a = i;
        while (a < j - 1) {
          const c = GC[a];
          let b = a + 1;
          while (b < j - 1 && GC[b] === c) b++;
          BUF.length = 0;
          for (let q = a; q <= b; q++) bufPush(GU[q], GV[q]);
          out.polyline(BUF, bandColor(c, o.color), lw);
          a = b;
        }
      }
      i = j;
    }
    out.flush();

    // Pass 3: dots (and markers for isolated points) above the lines.
    const dotD = 2 * dotR;
    const markD = Math.max(2 * lw, 2 * k);
    for (let q = 0; q < GN; q++) {
      const f = GF[q];
      if (o.showDots && f & F_DOT) {
        if (dotD > 0) out.shape("circle", GU[q], GV[q], dotD, bandColor(GC[q], o.dotColor));
      } else if (f & F_MARK) {
        out.shape("circle", GU[q], GV[q], markD, bandColor(GC[q], o.color));
      }
    }
    out.flush();
    drawTitle();

    function drawTitle() {
      if (!o.showLabels) return;
      const size = Math.min(64, Math.max(1, o.labelSize * ctx.fontScale)) * ctx.scale;
      if (size < 4) return;
      drawFieldLabel(ctx, midV, ctx.columnLabel(field!), size);
    }
  },

  legend(ring, info) {
    const field = ring.fields?.[0];
    if (!field || opt<unknown>(ring, "showLegend", true) === false) return [];
    const o = readOpts(ring);
    const g = globalStats(info.rows, field);
    const sid = `track:${ring.key}`;
    const label = info.columnLabel(field);
    const shape = o.showDots && !o.showLine ? "circle" as const : undefined;
    const entries: LegendEntry[] = [];
    if (o.bands.length) {
      o.bands.forEach((b, i) => entries.push({
        id: `${sid}\x00band:${i}`,
        label: i === 0 ? `< ${fmtNum(b.val)}` : `${fmtNum(o.bands[i - 1].val)} – ${fmtNum(b.val)}`,
        color: b.color, fillAlpha: 1, shape,
      }));
      entries.push({
        id: `${sid}\x00band:rest`, label: `≥ ${fmtNum(o.bands[o.bands.length - 1].val)}`,
        color: o.color, fillAlpha: 1, shape,
      });
    } else {
      entries.push({ id: `${sid}\x00${field}`, label, color: o.color, fillAlpha: 1, shape });
    }
    let note: string | undefined;
    if (g.n) {
      const xr = xRange(o, g);
      const yr = o.perLeaf ? null : yRange(o, g.minY, g.maxY, g.minPosY, true, { lo: 0, hi: 1, L: 0, span: 1 });
      const ys = yr ? `y ${fmtNum(yr.lo)} – ${fmtNum(yr.hi)}` : "y per leaf";
      note = `x ${fmtNum(xr.lo)} – ${fmtNum(xr.hi)}, ${ys}${o.log ? ` (${logBaseName(o.logBase)})` : ""}`;
    }
    const section: LegendSection = { id: sid, title: ring.label || label, note, kind: "swatches", entries, more: 0 };
    return [section];
  },

  tooltip(ring, row, info) {
    const field = ring.fields?.[0];
    if (!field) return [];
    const v = row?.[field];
    if (!present(v)) return [];
    const label = info.columnLabel(field);
    const s = parseSeries(v);
    if (!s || !s.n) return [`${label}: no numeric values`];
    const gaps = s.len - s.n;
    const y = s.minY === s.maxY ? `y = ${fmtNum(s.minY)}` : `y ${fmtNum(s.minY)} – ${fmtNum(s.maxY)}`;
    return [`${label}: ${s.n} point${s.n === 1 ? "" : "s"}${gaps ? ` (${gaps} missing)` : ""}, ${y}`];
  },
};

export default linechart;
