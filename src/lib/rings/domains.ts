import type { AnnotationRow, TrackConfig } from "../types";
import type { LegendEntry, LegendSection } from "../legend";
import type { DomainShape, ShapeKind } from "./band";
import type { RingDrawContext, RingModule } from "./types";
import { opt } from "./types";
import { FIELD_PALETTE, cellNumber, drawFieldLabel, fieldLabelSize, parseNumberList } from "./util";
import { hashString } from "../colorUtils";
import { fmtNum } from "../trackStyle";

// ============================================================
// Protein domains ring (iTOL DATASET_DOMAINS).
// One column; per leaf the cell lists the protein's domains:
//   compact  name:start-end[:SHAPE][:#rrggbb]        e.g. "SH2:100-150;SH3:400-500:EL"
//   iTOL     SHAPE|start|end|#color|label             e.g. "RE|100|150|#ff0000|SH2,EL|400|500|#0000ff|SH3"
//   length   len=NNN (or a bare number, as in an iTOL data line)
// Items are separated by ";" (then names may contain "," and "(", as in
// long domain tables), or by "," / ";" in iTOL SHAPE|… cells and in cells
// without ";". The protein length comes from the length column, else len=,
// else the last domain end.
// Each protein is a straight schematic from the ring's inner edge outward
// (straight radial bars in circular layouts, like iTOL): a backbone, then
// the domain glyphs, then (optionally) the domain labels inside them.
// ============================================================

const SHAPE_CODES: DomainShape[] = ["RE", "HH", "HV", "EL", "DI", "TR", "TL", "PL", "PR", "PU", "PD", "OC", "GP"];
const SHAPE_SET = new Set<string>(SHAPE_CODES);

const SHAPE_LABELS: Record<DomainShape, string> = {
  RE: "Rectangle", HH: "Horizontal hexagon", HV: "Vertical hexagon", EL: "Ellipse", DI: "Diamond",
  TR: "Triangle →", TL: "Triangle ←", PL: "Pentagon ←", PR: "Pentagon →", PU: "Pentagon ↑", PD: "Pentagon ↓",
  OC: "Octagon", GP: "Gap (thin bar)",
};

/** Legend swatch for a domain shape (square swatch when undefined). */
const LEGEND_SHAPE: Partial<Record<DomainShape, ShapeKind>> = {
  EL: "circle", DI: "diamond", TR: "triangle-right", TL: "triangle-left", HH: "hexagon", HV: "hexagon",
  OC: "octagon", PU: "triangle-up", PD: "triangle-down", PL: "triangle-left", PR: "triangle-right",
};

/** Share of a glyph's length a label may use (iTOL clips labels to the shape; we only show labels that fit). */
const LABEL_ROOM: Record<DomainShape, number> = {
  RE: 1, HH: 0.8, HV: 0.9, EL: 0.75, DI: 0.5, TR: 0.5, TL: 0.5, PL: 0.8, PR: 0.8, PU: 0.85, PD: 0.85, OC: 0.85, GP: 0,
};

/** Default domain colours (Tableau 20 without its greys, which would vanish on the grey backbone). */
const DOMAIN_PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#499894",
  "#d37295", "#b6992d", "#a0cbe8", "#ffbe7d", "#8cd17d", "#f1ce63", "#86bcb6", "#ff9d9a", "#d4a6c8", "#d7b5a6",
];

const DEF = {
  width: 200,
  scaleMode: "proportional",
  height: 20,
  heightFactor: 1,
  defaultShape: "RE" as DomainShape,
  backboneColor: "#aaaaaa",
  backboneHeight: 2,
  borderWidth: 0,
  borderColor: "#000000",
  showLabels: true,
  labelSize: 1,
  labelsOnTop: false,
  labelRotation: 0,
  labelAutoColor: true,
  labelColor: "#000000",
  scaleLines: "",
};

/** Legend entry cap (the rest are counted in "more"). */
const LEGEND_MAX = 40;
/** Below this full glyph height (screen px) domains are drawn as plain strokes. */
const MIN_GLYPH_PX = 1.5;
/** Smallest label font (screen px); smaller labels are skipped. */
const MIN_LABEL_PX = 5;
/** Average glyph width of sans-serif text as a fraction of the font size (no text measuring in ring modules). */
const CHAR_W = 0.58;

// ------------------------------------------------------------
// Option helpers
// ------------------------------------------------------------

function numOpt(ring: TrackConfig, key: string, fallback: number, lo: number, hi: number): number {
  const v = opt<unknown>(ring, key, fallback);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function colorOpt(ring: TrackConfig, key: string, fallback: string): string {
  const v = opt<unknown>(ring, key, fallback);
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

const boolOpt = (ring: TrackConfig, key: string, fallback: boolean) => {
  const v = opt<unknown>(ring, key, fallback);
  return typeof v === "boolean" ? v : v === "true" || v === 1 ? true : v === "false" || v === 0 ? false : fallback;
};

function shapeOpt(ring: TrackConfig): DomainShape {
  const v = String(opt<unknown>(ring, "defaultShape", DEF.defaultShape)).toUpperCase();
  return SHAPE_SET.has(v) ? (v as DomainShape) : DEF.defaultShape;
}

const lengthColumnOf = (ring: TrackConfig): string => {
  const v = opt<unknown>(ring, "lengthColumn", "");
  return typeof v === "string" ? v : "";
};

const isEach = (ring: TrackConfig) => opt<string>(ring, "scaleMode", DEF.scaleMode) === "each";

/** Stroke widths snap to 0.25 px so canvas/SVG batches (keyed by width) stay few. */
const snapWidth = (w: number) => Math.max(0.25, Math.round(w * 4) / 4);

// ------------------------------------------------------------
// Colours
// ------------------------------------------------------------

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", lime: "#00ff00", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", magenta: "#ff00ff", fuchsia: "#ff00ff", cyan: "#00ffff",
  aqua: "#00ffff", pink: "#ffc0cb", brown: "#a52a2a", gray: "#808080", grey: "#808080", navy: "#000080",
  teal: "#008080", olive: "#808000", maroon: "#800000", silver: "#c0c0c0", gold: "#ffd700", violet: "#ee82ee",
  indigo: "#4b0082", darkgreen: "#006400", darkblue: "#00008b", darkred: "#8b0000", lightblue: "#add8e6",
  lightgreen: "#90ee90", salmon: "#fa8072", coral: "#ff7f50", tomato: "#ff6347", khaki: "#f0e68c", turquoise: "#40e0d0",
};

/** A colour we can hand to canvas / SVG unchanged, or null (blank / not a colour). */
function normColor(raw: string | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim();
  if (!c) return null;
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase();
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c.toLowerCase();
  m = /^(rgba?|hsla?)\(\s*[-\d.%\s,/]+\)$/i.exec(c);
  if (m) return c.replace(/\s+/g, "");
  return NAMED[c.toLowerCase()] ?? null;
}

const autoColorCache = new Map<string, string>();

/** Stable palette colour for a domain name. */
function autoColor(name: string): string {
  if (!name) return FIELD_PALETTE[0];
  let c = autoColorCache.get(name);
  if (!c) {
    c = DOMAIN_PALETTE[hashString(name) % DOMAIN_PALETTE.length];
    if (autoColorCache.size > 20000) autoColorCache.clear();
    autoColorCache.set(name, c);
  }
  return c;
}

const textColorCache = new Map<string, string>();

/**
 * Label colour on a domain fill (iTOL LABEL_AUTO_COLOR):
 * L = (0.2126 R^2.2 + 0.7152 G^2.2 + 0.0722 B^2.2)^0.678 → white below 0.5, else black.
 * Colours that are not hex / rgb() get `fallback`.
 */
function autoTextColor(fill: string, fallback: string): string {
  const hit = textColorCache.get(fill);
  if (hit) return hit === "?" ? fallback : hit;
  let rgb: [number, number, number] | null = null;
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(fill);
  if (h) rgb = [parseInt(h[1], 16), parseInt(h[2], 16), parseInt(h[3], 16)];
  else {
    const m = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(fill);
    if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  let res = "?";
  if (rgb) {
    const lin = (x: number) => Math.pow(Math.min(255, Math.max(0, x)) / 255, 2.2);
    const L = Math.pow(0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]), 0.678);
    res = L < 0.5 ? "#ffffff" : "#000000";
  }
  if (textColorCache.size > 5000) textColorCache.clear();
  textColorCache.set(fill, res);
  return res === "?" ? fallback : res;
}

// ------------------------------------------------------------
// Cell parsing (cached by cell string)
// ------------------------------------------------------------

type Domain = {
  /** Colour / legend key: the compact name or the iTOL label ("" = unnamed). */
  name: string;
  start: number;
  end: number;
  /** null = the ring's default shape. */
  shape: DomainShape | null;
  /** Colour given in the cell, or null. */
  color: string | null;
  /** Palette colour from the name (fallback). */
  auto: string;
};

type Parsed = {
  domains: Domain[];
  /** Length given in the cell (len=… or a bare number), or null. */
  len: number | null;
  /** Largest domain end (0 without domains). */
  maxEnd: number;
  /** Items that could not be read. */
  bad: number;
};

const LEN_RE = /^(?:len|length|size|aa)\s*[=:]\s*(\d+(?:\.\d+)?)$/i;
const NUM_RE = /^\d+(?:\.\d+)?$/;
const RANGE_RE = /^(-?\d+(?:\.\d+)?)\s*(?:-|–|—|\.\.)\s*(\d+(?:\.\d+)?)$/;

function makeDomain(name: string, a: number, b: number, shape: DomainShape | null, color: string | null): Domain {
  // Reversed ranges are swapped (iTOL would skip them); negative positions clamp to 0.
  const start = Math.max(0, Math.min(a, b));
  const end = Math.max(0, Math.max(a, b));
  return { name, start, end, shape, color, auto: autoColor(name) };
}

/** "SHAPE|start|end|#color|label" (shape may be missing or unknown). */
function parseItol(t: string): Domain | null {
  const p = t.split("|").map(s => s.trim());
  let i = 0;
  let shape: DomainShape | null = null;
  let label0 = "";
  if (!NUM_RE.test(p[0])) {
    const up = p[0].toUpperCase();
    if (SHAPE_SET.has(up)) shape = up as DomainShape;
    else label0 = p[0]; // "SH2|100|150|#f00" — a name where the shape should be
    i = 1;
  }
  const a = Number(p[i]), b = Number(p[i + 1]);
  if (p[i] === undefined || p[i + 1] === undefined || p[i] === "" || p[i + 1] === "" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const color = normColor(p[i + 2]);
  const label = p[i + 3] || label0;
  return makeDomain(label, a, b, shape, color);
}

/** "name:start-end[:SHAPE][:#color]" — the name may itself contain ':'. */
function parseCompact(t: string): Domain | null {
  const segs = t.split(":").map(s => s.trim());
  let k = -1;
  let m: RegExpExecArray | null = null;
  for (let j = segs.length - 1; j >= 0; j--) {
    m = RANGE_RE.exec(segs[j]);
    if (m) { k = j; break; }
  }
  if (k < 0 || !m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let shape: DomainShape | null = null;
  let color: string | null = null;
  for (let j = k + 1; j < segs.length; j++) {
    const up = segs[j].toUpperCase();
    if (SHAPE_SET.has(up)) shape = up as DomainShape;
    else color = normColor(segs[j]) ?? color;
  }
  return makeDomain(segs.slice(0, k).join(":"), a, b, shape, color);
}

/** Split on ';' / ',' outside parentheses (so "rgb(1, 2, 3)" stays whole). */
function splitAll(s: string): string[] {
  if (!s.includes("(")) return s.split(/[;,]/);
  const items: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 40) depth++; // (
    else if (c === 41) depth = Math.max(0, depth - 1); // )
    else if ((c === 59 || c === 44) && depth === 0) { items.push(s.slice(from, i)); from = i + 1; } // ; ,
  }
  items.push(s.slice(from));
  return items;
}

/** A "name:start-end…" item (not iTOL, not a length). */
const isCompactItem = (t: string) => {
  const x = t.trim();
  return x !== "" && !x.includes("|") && !LEN_RE.test(x) && parseCompact(x) !== null;
};

/** Blank, a length or a "name:start-end…" item. */
const isReadableItem = (t: string) => {
  const x = t.trim();
  return x === "" || LEN_RE.test(x) || NUM_RE.test(x) || isCompactItem(x);
};

/**
 * Cell → items.
 *  - iTOL "SHAPE|…" items: ';' and ',' both separate (outside parentheses).
 *  - Cells with ';' (e.g. joined from a long domain table): split only on ';',
 *    so names keep their ',' and '(' ("Zinc finger, C2H2 (zf):5-25"). A piece
 *    is still split on ',' when every part is itself a name:start-end item
 *    ("SH2:1-5,SH3:9-20;len=300"); a name without ':' can never make that true.
 *  - Otherwise ',' separates, unless that leaves unreadable parts and the
 *    whole cell is one name:start-end item (a single domain whose name has commas).
 */
function splitItems(s: string): string[] {
  if (s.includes("|")) return splitAll(s);
  if (s.includes(";")) {
    const items: string[] = [];
    for (const piece of s.split(";")) {
      if (piece.includes(",")) {
        const parts = splitAll(piece);
        if (parts.length > 1 && parts.every(t => !t.trim() || isCompactItem(t))) { items.push(...parts); continue; }
      }
      items.push(piece);
    }
    return items;
  }
  const parts = splitAll(s);
  if (parts.length > 1 && !parts.every(isReadableItem) && isCompactItem(s)) return [s];
  return parts;
}

function parseUncached(s: string): Parsed | null {
  const domains: Domain[] = [];
  let len: number | null = null;
  let maxEnd = 0;
  let bad = 0;
  for (const raw of splitItems(s)) {
    const t = raw.trim();
    if (!t) continue;
    const lm = LEN_RE.exec(t);
    if (lm) { const n = Number(lm[1]); if (n > 0) len = n; else bad++; continue; }
    if (NUM_RE.test(t)) { const n = Number(t); if (n > 0 && len === null) len = n; else if (!(n > 0)) bad++; continue; }
    const d = t.includes("|") ? parseItol(t) : parseCompact(t);
    if (!d) { bad++; continue; }
    domains.push(d);
    if (d.end > maxEnd) maxEnd = d.end;
  }
  if (!domains.length && len === null && !bad) return null;
  return { domains, len, maxEnd, bad };
}

const parseCache = new Map<string, Parsed | null>();

function parseCell(v: unknown): Parsed | null {
  if (v === null || v === undefined || v === "") return null;
  const s = typeof v === "string" ? v : String(v);
  const hit = parseCache.get(s);
  if (hit !== undefined) return hit;
  const p = parseUncached(s);
  if (parseCache.size >= 100000) parseCache.clear();
  parseCache.set(s, p);
  return p;
}

/** Protein length: length column, else len= in the cell, else the last domain end (0 = nothing to draw). */
function proteinLength(row: AnnotationRow | undefined, p: Parsed | null, lenCol: string): number {
  if (lenCol && row) {
    const n = cellNumber(row[lenCol]);
    if (n !== null && n > 0) return n;
  }
  if (!p) return 0;
  return p.len ?? p.maxEnd;
}

// ------------------------------------------------------------
// Dataset-wide values (once per rows identity)
// ------------------------------------------------------------

type NameStat = { name: string; count: number; color: string | null; shape: DomainShape | null; auto: string };

/** Everything dataset-wide for one domains column (one scan per rows identity). */
type DataInfo = {
  /** Distinct named domains, most frequent first (legend, default colours). */
  names: NameStat[];
  /** Name → first colour written in a cell for it (colours items of that name that give none). */
  cellColor: Map<string, string>;
  /** Longest protein per length column ("" = lengths from the cells). */
  maxLen: Map<string, number>;
};

const infoCache = new WeakMap<AnnotationRow[], Map<string, DataInfo>>();

function dataInfo(rows: AnnotationRow[], field: string): DataInfo {
  let m = infoCache.get(rows);
  if (!m) { m = new Map(); infoCache.set(rows, m); }
  const hit = m.get(field);
  if (hit) return hit;
  const acc = new Map<string, NameStat>();
  let max = 0;
  for (const row of rows) {
    const p = parseCell(row[field]);
    if (!p) continue;
    const L = p.len ?? p.maxEnd;
    if (L > max) max = L;
    for (const d of p.domains) {
      if (!d.name) continue;
      let st = acc.get(d.name);
      if (!st) { st = { name: d.name, count: 0, color: d.color, shape: d.shape, auto: d.auto }; acc.set(d.name, st); }
      st.count++;
      if (!st.color && d.color) st.color = d.color;
      if (!st.shape && d.shape) st.shape = d.shape;
    }
  }
  const names = [...acc.values()].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const cellColor = new Map<string, string>();
  for (const st of names) if (st.color) cellColor.set(st.name, st.color);
  const info: DataInfo = { names, cellColor, maxLen: new Map([["", max]]) };
  m.set(field, info);
  return info;
}

/** Longest protein over every row (proportional scale). */
function datasetMaxLen(rows: AnnotationRow[], field: string, lenCol: string): number {
  const di = dataInfo(rows, field);
  const hit = di.maxLen.get(lenCol);
  if (hit !== undefined) return hit;
  let max = 0;
  for (const row of rows) {
    const L = proteinLength(row, parseCell(row[field]), lenCol);
    if (L > max) max = L;
  }
  di.maxLen.set(lenCol, max);
  return max;
}

/** Colour stored for a domain name in the option map, or null ("" = cleared → default). */
function optColorOf(colors: Record<string, unknown>, name: string): string | null {
  const c = colors[name];
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

/**
 * The option colour for `name` when it overrides cell colours, else null.
 * New rings store each name's cell colour as its option colour; once the user
 * picks a different one, it wins over the colours written in the cells.
 * Names no cell colours keep their option colour (as before).
 */
function overrideColor(name: string, colors: Record<string, unknown>, di: DataInfo): string | null {
  const o = optColorOf(colors, name);
  if (!o) return null;
  const cell = di.cellColor.get(name);
  return cell !== undefined && (normColor(o) ?? o.toLowerCase()) === cell ? null : o;
}

/**
 * Colour of a domain name (legend, editor swatches, items without a colour of
 * their own): user override, else a colour a cell gives the name, else the palette.
 */
function nameColor(name: string, auto: string, colors: Record<string, unknown>, di: DataInfo): string {
  return overrideColor(name, colors, di) ?? di.cellColor.get(name) ?? auto;
}

const LENGTH_NAME_RE = /^(?:prot(?:ein)?|seq(?:uence)?|aa)?[\s_.-]?(?:len|length|aa[\s_.-]?len(?:gth)?)$/i;

/** At least 80 % of the first 200 non-blank values of column k are positive numbers (false when k is absent). */
function mostlyPositive(rows: AnnotationRow[], k: string): boolean {
  let num = 0, seen = 0;
  for (let i = 0; i < rows.length && seen < 200; i++) {
    const v = rows[i]?.[k];
    if (v === null || v === undefined || v === "") continue;
    seen++;
    const n = cellNumber(v);
    if (n !== null && n > 0) num++;
  }
  return seen > 0 && num / seen >= 0.8;
}

/**
 * A numeric column that looks like a protein length, or "": first the
 * "<stem> length" column a long domain table writes next to "<stem> domains",
 * then names like "length", "protein_length", "seq_len" ….
 */
function guessLengthColumn(rows: AnnotationRow[], field: string): string {
  const paired = field.replace(/ domains$/, " length");
  if (paired !== field && mostlyPositive(rows, paired)) return paired;
  const first = rows.find(r => r && Object.keys(r).length > 1);
  if (!first) return "";
  for (const k of Object.keys(first)) {
    if (k === "id" || k === field || !LENGTH_NAME_RE.test(k)) continue;
    if (mostlyPositive(rows, k)) return k;
  }
  return "";
}

/** Round scale-line step (1, 2, 5 × 10^k) giving about five lines over [0, max]. */
function autoScaleValues(max: number): number[] {
  if (!(max > 0)) return [];
  const raw = max / 5;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  const step = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p;
  const vals: number[] = [];
  for (let v = step; v <= max * (1 + 1e-9) && vals.length < 50; v += step) vals.push(+v.toPrecision(12));
  return vals;
}

function scaleValues(ring: TrackConfig, maxLen: number): number[] {
  const raw = opt<unknown>(ring, "scaleLines", DEF.scaleLines);
  const s = typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? raw.join(",") : "";
  if (!s) return [];
  if (/^auto$/i.test(s)) return autoScaleValues(maxLen);
  return parseNumberList(s).filter(v => v > 0 && v <= maxLen * (1 + 1e-9));
}

// ------------------------------------------------------------
// Drawing
// ------------------------------------------------------------

/** Reused backbone outline (band consumes points synchronously). */
const bbPts: Array<[number, number]> = [[0, 0], [0, 0], [0, 0], [0, 0]];
const gapPts: Array<[number, number]> = [[0, 0], [0, 0], [0, 0], [0, 0]];

function setRect(pts: Array<[number, number]>, a0: number, a1: number, b: number) {
  pts[0][0] = a0; pts[0][1] = -b;
  pts[1][0] = a1; pts[1][1] = -b;
  pts[2][0] = a1; pts[2][1] = b;
  pts[3][0] = a0; pts[3][1] = b;
}

function drawScaleLines(ring: TrackConfig, ctx: RingDrawContext, maxLen: number) {
  const vals = scaleValues(ring, maxLen);
  if (!vals.length) return;
  // Along-extent of the visible leaves: dashing the whole leaf set would mean
  // a huge, mostly off-screen path every frame when zoomed in.
  let uLo = Infinity, uHi = -Infinity;
  for (const sl of ctx.slots) {
    if (sl.lo < uLo) uLo = sl.lo;
    if (sl.hi > uHi) uHi = sl.hi;
  }
  if (!(uHi > uLo)) return;
  const out = ctx.out, s = ctx.scale;
  const lw = snapWidth(1 * s);
  const dash = [4 * s, 3 * s];
  for (const val of vals) {
    const v = (val / maxLen) * ctx.width;
    if (v < ctx.vMin - lw || v > ctx.vMax + lw) continue;
    out.alongLine(uLo, uHi, v, "#c4c4c4", lw, dash);
  }
  out.flush();
  // Labels (iTOL: above the first leaf / before the start angle), thinned so they never overlap.
  const size = fieldLabelSize(ctx, 9);
  let last = -Infinity;
  for (const val of vals) {
    const v = (val / maxLen) * ctx.width;
    if (v - last < size * 1.3) continue;
    last = v; // thinning ignores visibility, so panning never changes which labels are shown
    if (v < ctx.vMin - size || v > ctx.vMax + size) continue;
    drawFieldLabel(ctx, v, fmtNum(val), size, "#888888");
  }
}

function draw(ring: TrackConfig, ctx: RingDrawContext) {
  const field = ring.fields?.[0];
  if (!field || !ctx.slots.length) return;
  const out = ctx.out;
  const sc = ctx.scale;
  const lenCol = lengthColumnOf(ring);
  const each = isEach(ring);
  const maxLen = each ? 0 : datasetMaxLen(ctx.rows, field, lenCol);
  if (!each && !(maxLen > 0)) return;
  const pxPerUnit = each ? 0 : ctx.width / maxLen;

  const hCap = (numOpt(ring, "height", DEF.height, 0.5, 500) / 2) * sc;
  const hFactor = numOpt(ring, "heightFactor", DEF.heightFactor, 0.05, 10);
  const fill = Math.max(0, ctx.barFill) * 0.45; // iTOL: half-height 0.45 × leaf spacing
  const bbColor = colorOpt(ring, "backboneColor", DEF.backboneColor);
  const bbHalf = (numOpt(ring, "backboneHeight", DEF.backboneHeight, 0, 200) / 2) * sc;
  const bw = numOpt(ring, "borderWidth", DEF.borderWidth, 0, 50) * sc;
  const border = bw > 0 ? colorOpt(ring, "borderColor", DEF.borderColor) : null;
  const borderW = border ? snapWidth(bw) : 0;
  const defShape = shapeOpt(ring);
  const colors = (opt<unknown>(ring, "domainColors", null) ?? {}) as Record<string, unknown>;
  const di = dataInfo(ctx.rows, field);
  // Per-name user override (null = none), resolved once per draw.
  const overrides = new Map<string, string | null>();
  const colorOf = (d: Domain) => {
    let o = overrides.get(d.name);
    if (o === undefined) { o = overrideColor(d.name, colors, di); overrides.set(d.name, o); }
    return o ?? d.color ?? di.cellColor.get(d.name) ?? d.auto;
  };
  // Visible depth range (screen px), padded for strokes / caps: glyphs outside it are skipped.
  const pad = 2 + 2 * borderW;
  const vLo = ctx.vMin - pad, vHi = ctx.vMax + pad;

  if (!each) drawScaleLines(ring, ctx, maxLen);

  // Per-slot geometry, shared by the passes (set by prep()).
  let P: Parsed | null = null;
  let Lpx = 0, ppu = 0, h = 0, uMid = 0, protLen = 0;
  const prep = (lo: number, hi: number, row: AnnotationRow | undefined): boolean => {
    P = row ? parseCell(row[field]) : null;
    protLen = proteinLength(row, P, lenCol);
    if (!(protLen > 0)) return false;
    ppu = each ? ctx.width / protLen : pxPerUnit;
    Lpx = protLen * ppu;
    h = Math.min(hCap, out.alongPx(lo, hi, 0) * fill) * hFactor;
    if (!(h > 0.05)) return false;
    uMid = (lo + hi) / 2;
    return true;
  };

  // 1. Backbones (clipped to the visible depth range: same pixels, small paths when zoomed in).
  if (bbHalf > 0 && vHi > 0) {
    for (const s of ctx.slots) {
      if (!prep(s.lo, s.hi, s.row)) continue;
      const a0 = Math.max(0, vLo), a1 = Math.min(Lpx, vHi);
      if (!(a1 > a0)) continue;
      const b = Math.min(bbHalf, h);
      if (b * 2 < MIN_GLYPH_PX) out.line(uMid, a0, uMid, a1, bbColor, snapWidth(b * 2));
      else { setRect(bbPts, a0, a1, b); out.localPolygon(uMid, 0, bbPts, bbColor); }
    }
    out.flush();
  }

  // 2. Domains (batched by colour; borders stroke after all fills).
  let labelRoom = false;
  for (const s of ctx.slots) {
    if (!prep(s.lo, s.hi, s.row)) continue;
    const p = P as Parsed | null;
    if (!p || !p.domains.length) continue;
    const thin = h * 2 < MIN_GLYPH_PX;
    if (!thin) labelRoom = true;
    for (const d of p.domains) {
      if (d.start >= protLen) continue;
      const v0 = d.start * ppu;
      const v1 = Math.max(Math.min(d.end, protLen) * ppu, v0 + 1);
      if (v1 < vLo || v0 > vHi) continue;
      const shape = d.shape ?? defShape;
      const col = colorOf(d);
      if (thin) {
        out.line(uMid, v0, uMid, v1, col, snapWidth(shape === "GP" ? (h * 2) / 5 : h * 2));
      } else if (shape === "GP") {
        // iTOL: a bar of 40 % of the domain height in the domain colour (band.domain draws nothing for GP).
        setRect(gapPts, 0, v1 - v0, h / 5);
        out.localPolygon(uMid, v0, gapPts, col, border, borderW);
      } else {
        out.domain(shape, uMid, v0, v1, h, col, border, borderW);
      }
    }
  }
  out.flush();

  // 3. Labels, centred on each domain (only where the glyph is big enough to read).
  if (!labelRoom || !boolOpt(ring, "showLabels", DEF.showLabels)) return;
  const sizeF = numOpt(ring, "labelSize", DEF.labelSize, 0.1, 10);
  const onTop = boolOpt(ring, "labelsOnTop", DEF.labelsOnTop);
  const rot = numOpt(ring, "labelRotation", DEF.labelRotation, -360, 360);
  const rad = (rot * Math.PI) / 180;
  const cr = Math.abs(Math.cos(rad)), sr = Math.abs(Math.sin(rad));
  const auto = boolOpt(ring, "labelAutoColor", DEF.labelAutoColor);
  const fixed = colorOpt(ring, "labelColor", DEF.labelColor);
  for (const s of ctx.slots) {
    if (!prep(s.lo, s.hi, s.row)) continue;
    const p = P as Parsed | null;
    if (!p || !p.domains.length) continue;
    const size = 0.75 * h * sizeF; // iTOL: 0.75 × half-height × LABEL_SIZE_FACTOR
    if (size < MIN_LABEL_PX) continue;
    for (const d of p.domains) {
      if (!d.name || d.start >= protLen) continue;
      const shape = d.shape ?? defShape;
      if (shape === "GP") continue;
      const v0 = d.start * ppu;
      const v1 = Math.max(Math.min(d.end, protLen) * ppu, v0 + 1);
      // Conservative reach of the label along v (≤ 1 em per character, any rotation).
      const reach = (d.name.length + 2) * size;
      const vm = (v0 + v1) / 2;
      if (vm + reach < ctx.vMin || vm - reach > ctx.vMax) continue;
      if (!onTop) {
        const tw = d.name.length * CHAR_W * size;
        const along = tw * cr + size * sr, across = tw * sr + size * cr;
        if (along > (v1 - v0) * LABEL_ROOM[shape] - 2 || across > h * 2 * 0.95) continue;
      }
      const col = auto ? autoTextColor(colorOf(d), fixed) : fixed;
      out.text(uMid, vm, d.name, { size, color: col, anchor: "middle", orient: "radial", rotate: rot || undefined });
    }
  }
}

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const ringTitle = (ring: TrackConfig, columnLabel: (k: string) => string) =>
  ring.label || (ring.fields?.[0] ? columnLabel(ring.fields[0]) : "Domains");

const proportionalOnly = (o: Record<string, any>) => (o.scaleMode ?? DEF.scaleMode) !== "each";
const labelsOn = (o: Record<string, any>) => (o.showLabels ?? DEF.showLabels) !== false;

const domains: RingModule = {
  kind: "domains",
  // Domain names for the colour editor (most frequent first).
  categories(ring, optKey, info) {
    const field = ring.fields?.[0];
    return optKey === "domainColors" && field ? dataInfo(info.rows, field).names.map(n => n.name) : [];
  },
  // Colour actually drawn for a domain name (editor swatches): same precedence as draw / legend.
  categoryColor(ring, optKey, cat, info) {
    const field = ring.fields?.[0];
    const colors = (opt<unknown>(ring, optKey, null) ?? {}) as Record<string, unknown>;
    if (optKey !== "domainColors" || !field) return optColorOf(colors, cat) ?? autoColor(cat);
    return nameColor(cat, autoColor(cat), colors, dataInfo(info.rows, field));
  },
  title: "Protein domains",
  description:
    "Domain architecture per leaf: a backbone of the protein's length with shaped, coloured domains. " +
    "Cells: \"name:start-end[:SHAPE][:#color]\" items separated by ';' (e.g. SH2:100-150;SH3:400-500:EL), " +
    "or iTOL items SHAPE|start|end|#color|label; optional len=NNN or a length column.",
  fields: { count: "one", hint: "Domain list, e.g. SH2:100-150;SH3:400-500:EL;len=600" },

  defaults(fields, info) {
    const field = fields[0];
    const domainColors: Record<string, string> = {};
    if (field) {
      // The most frequent names get distinct palette colours (a colour written
      // in a cell is kept), so they show up in the colour editor.
      let i = 0;
      for (const st of dataInfo(info.rows, field).names.slice(0, LEGEND_MAX)) {
        domainColors[st.name] = st.color ?? DOMAIN_PALETTE[i++ % DOMAIN_PALETTE.length];
      }
    }
    return {
      lengthColumn: field ? guessLengthColumn(info.rows, field) : "",
      scaleMode: DEF.scaleMode,
      width: DEF.width,
      height: DEF.height,
      heightFactor: DEF.heightFactor,
      defaultShape: DEF.defaultShape,
      domainColors,
      backboneColor: DEF.backboneColor,
      backboneHeight: DEF.backboneHeight,
      borderWidth: DEF.borderWidth,
      borderColor: DEF.borderColor,
      showLabels: DEF.showLabels,
      labelSize: DEF.labelSize,
      labelsOnTop: DEF.labelsOnTop,
      labelRotation: DEF.labelRotation,
      labelAutoColor: DEF.labelAutoColor,
      labelColor: DEF.labelColor,
      scaleLines: DEF.scaleLines,
    };
  },

  options: [
    { key: "lengthColumn", label: "Protein length column", type: "column", numeric: true, optional: true,
      help: "Numeric column with each protein's length. Without it: len=NNN in the cell, else the last domain end." },
    { key: "scaleMode", label: "Length scale", type: "select", choices: [
      { value: "proportional", label: "Proportional (longest protein = full width)" },
      { value: "each", label: "Each protein fills the width" },
    ] },
    { key: "width", label: "Width", type: "number", min: 20, max: 3000, step: 10, unit: "px",
      help: "Ring width: the length of the longest protein (iTOL WIDTH)." },
    { key: "height", label: "Max domain height", type: "number", min: 1, max: 200, step: 1, unit: "px",
      help: "Domains are at most this tall, and at most 90 % of the leaf spacing (× annotation bar fill)." },
    { key: "heightFactor", label: "Height factor", type: "number", min: 0.1, max: 3, step: 0.05,
      help: "Multiplies the domain height (iTOL HEIGHT_FACTOR); above 1 neighbours may overlap." },
    { key: "defaultShape", label: "Default shape", type: "select",
      choices: SHAPE_CODES.map(c => ({ value: c, label: `${SHAPE_LABELS[c]} (${c})` })),
      help: "Shape of domains whose cell gives none." },
    { key: "domainColors", label: "Domain colours", type: "categoryColors",
      help: "Colour per domain name. Names whose cells give colours keep them until you pick a different colour here." },
    { key: "backboneColor", label: "Backbone colour", type: "color" },
    { key: "backboneHeight", label: "Backbone height", type: "number", min: 0, max: 50, step: 0.5, unit: "px",
      help: "0 = no backbone." },
    { key: "borderWidth", label: "Domain border width", type: "number", min: 0, max: 10, step: 0.25, unit: "px" },
    { key: "borderColor", label: "Domain border colour", type: "color", showIf: o => Number(o.borderWidth ?? 0) > 0 },
    { key: "showLabels", label: "Domain labels", type: "bool" },
    { key: "labelSize", label: "Label size factor", type: "number", min: 0.2, max: 4, step: 0.05, showIf: labelsOn },
    { key: "labelsOnTop", label: "Show labels that don't fit", type: "bool", showIf: labelsOn,
      help: "Off: a label is shown only when it fits inside its domain." },
    { key: "labelRotation", label: "Label rotation", type: "number", min: -180, max: 180, step: 5, unit: "°", showIf: labelsOn },
    { key: "labelAutoColor", label: "Automatic label colour", type: "bool", showIf: labelsOn,
      help: "White or black text depending on the domain colour." },
    { key: "labelColor", label: "Label colour", type: "color", showIf: o => labelsOn(o) && o.labelAutoColor === false },
    { key: "scaleLines", label: "Scale lines", type: "text", placeholder: "auto, or e.g. 100, 500, 1000", showIf: proportionalOnly,
      help: "Dashed lines at these protein positions ('auto' picks round values)." },
  ],

  width(ring) {
    return numOpt(ring, "width", DEF.width, 1, 100000);
  },

  draw,

  legend(ring, info): LegendSection[] {
    const field = ring.fields?.[0];
    if (!field) return [];
    const di = dataInfo(info.rows, field);
    const names = di.names;
    if (!names.length) return [];
    const colors = (opt<unknown>(ring, "domainColors", null) ?? {}) as Record<string, unknown>;
    const defShape = shapeOpt(ring);
    const sid = `track:${ring.key}`;
    const entries: LegendEntry[] = names.slice(0, LEGEND_MAX).map(st => ({
      id: `${sid}\x00${st.name}`,
      label: st.name,
      color: nameColor(st.name, st.auto, colors, di),
      fillAlpha: 1,
      shape: LEGEND_SHAPE[st.shape ?? defShape],
    }));
    let note: string | undefined;
    if (!isEach(ring)) {
      const maxLen = datasetMaxLen(info.rows, field, lengthColumnOf(ring));
      if (maxLen > 0) note = `longest protein: ${fmtNum(maxLen)}`;
    }
    return [{ id: sid, title: ringTitle(ring, info.columnLabel), note, kind: "swatches", entries, more: Math.max(0, names.length - LEGEND_MAX) }];
  },

  tooltip(ring, row, info) {
    const field = ring.fields?.[0];
    const title = ringTitle(ring, info.columnLabel);
    if (!field) return [];
    const p = row ? parseCell(row[field]) : null;
    const lenCol = lengthColumnOf(ring);
    const L = proteinLength(row, p, lenCol);
    if (!p && !(L > 0)) return [`${title}: N/A`];
    const n = p ? p.domains.length : 0;
    const lines = [`${title}: ${n} domain${n === 1 ? "" : "s"}${L > 0 ? `, length ${fmtNum(L)}` : ""}${p && p.bad ? ` (${p.bad} unreadable item${p.bad === 1 ? "" : "s"})` : ""}`];
    if (p) {
      const MAX = 12;
      for (const d of p.domains.slice(0, MAX)) {
        const out = d.end > L ? " (beyond length)" : "";
        lines.push(`  ${d.name || "(unnamed)"}: ${fmtNum(d.start)}–${fmtNum(d.end)}${d.shape ? ` ${d.shape}` : ""}${out}`);
      }
      if (n > MAX) lines.push(`  … ${n - MAX} more`);
    }
    return lines;
  },
};

export default domains;
