import type { AnnotationRow, TrackConfig } from "../types";
import type { TextOpts } from "./band";
import { drawFieldLabel, fieldLabelSize } from "./util";
import type { RingInfoContext, RingModule } from "./types";

// ============================================================
// Text ring (iTOL DATASET_TEXT, external labels): one column printed as a
// label per leaf. Radial text runs outward like leaf labels; tangential text
// runs along the ring (iTOL ALIGN_TO_TREE). Text can be coloured by the
// column's category colours, rounded (numeric cells), cut to a maximum
// length and / or to the room it has, and shrunk to the leaf spacing.
// Text widths are estimated from Helvetica/Arial glyph advances (no measuring
// context is needed, so fitting works the same on canvas and in SVG export).
// ============================================================

const DEFAULT_COLOR = "#222222"; // same as leaf labels
const DEFAULT_SIZE = 11;
const DEFAULT_WIDTH = 100;
const DEFAULT_PAD = 3;
/** Draw text only when the slot is at least this fraction of the font size. */
const LOD_FRAC = 0.8;
/** "Shrink to the leaf spacing": font = this × slot size, hidden below MIN_FIT_PX. */
const FIT_FRAC = 0.85;
const MIN_FIT_PX = 5;
/** Width estimate margins: other sans-serif fonts run a little wider; bold ≈ 8 % wider. */
const SAFETY = 1.05;
const BOLD = 1.08;

type Orient = "radial" | "tangential";
type Anchor = "start" | "middle" | "end";

// ------------------------------------------------------------
// Options
// ------------------------------------------------------------

function num(ring: TrackConfig, key: string, fallback: number): number {
  const v = ring.opts?.[key];
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Optional integer option ≥ min (null / blank = off). */
function optInt(ring: TrackConfig, key: string, min: number): number | null {
  const v = ring.opts?.[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min ? n : null;
}

type TextSettings = {
  color: string;
  useColorMap: boolean;
  size: number;
  autoSize: boolean;
  bold: boolean;
  italic: boolean;
  orient: Orient;
  anchor: Anchor;
  rotate: number;
  pad: number;
  maxChars: number | null;
  fit: boolean;
  decimals: number | null;
  title: boolean;
};

function settings(ring: TrackConfig): TextSettings {
  const o = ring.opts ?? {};
  return {
    color: typeof o.color === "string" && o.color.trim() ? o.color.trim() : DEFAULT_COLOR,
    useColorMap: !!o.useColorMap,
    size: Math.max(1, num(ring, "size", DEFAULT_SIZE)),
    autoSize: !!o.autoSize,
    bold: !!o.bold,
    italic: !!o.italic,
    orient: o.orient === "tangential" ? "tangential" : "radial",
    anchor: o.anchor === "middle" || o.anchor === "end" ? o.anchor : "start",
    rotate: num(ring, "rotate", 0),
    pad: Math.max(0, num(ring, "pad", DEFAULT_PAD)),
    maxChars: optInt(ring, "maxChars", 1),
    fit: o.fit === undefined || o.fit === null ? true : !!o.fit,
    decimals: optInt(ring, "decimals", 0),
    title: !!o.title,
  };
}

// ------------------------------------------------------------
// Text width estimate (em)
// ------------------------------------------------------------

// Helvetica / Arial advance widths for ASCII 32–126, in 1/1000 em.
const ASCII_W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0-9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P-Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // p-z { | } ~
].map(w => w / 1000);
const ELLIPSIS_EM = 1;

function charEm(c: number): number {
  if (c >= 32 && c < 127) return ASCII_W[c - 32];
  if (c >= 0xdc00 && c <= 0xdfff) return 0; // low surrogate: counted with its high half
  if (c >= 0x2e80 || (c >= 0xd800 && c <= 0xdbff)) return 1; // CJK, symbols, emoji
  return 0.6;
}

function textEm(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) w += charEm(s.charCodeAt(i));
  return w;
}

// ------------------------------------------------------------
// Cell → display text (cached: cells repeat and rings redraw every frame)
// ------------------------------------------------------------

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Anything but single inner plain spaces: other whitespace, control characters, runs, leading / trailing. */
const MESSY = /[^\S ]|[\x00-\x1f\x7f]|  |^ | $/;
const CACHE_CAP = 100000;

/** Clean whitespace / control characters and round numeric cells. */
function format(raw: string, decimals: number | null): string {
  let s = MESSY.test(raw) ? raw.replace(/[\x00-\x1f\x7f\s]+/g, " ").trim() : raw;
  if (decimals !== null && NUMERIC.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = n.toFixed(Math.min(20, decimals));
  }
  return s;
}

/**
 * Longest prefix (≤ maxChars − 1 characters, ≤ roomEm wide with the "…")
 * followed by "…"; "" when nothing useful fits. Callers check first that `s`
 * doesn't fit as it is.
 */
function cut(s: string, maxChars: number, roomEm: number): string {
  const budget = roomEm - ELLIPSIS_EM;
  const maxN = Math.min(s.length, maxChars - 1);
  let em = 0, n = 0;
  while (n < maxN) {
    const w = charEm(s.charCodeAt(n));
    if (em + w > budget) break;
    em += w;
    n++;
  }
  if (n > 0) {
    const c = s.charCodeAt(n - 1);
    if (c >= 0xd800 && c <= 0xdbff) n--; // don't split a surrogate pair
  }
  const head = s.slice(0, n).replace(/[\s.,;:]+$/, "");
  return head ? head + "…" : "";
}

type Cell = { t: string; em: number };

// Formatted cells per rounding setting (cell string → text + width) …
const formatCaches = new Map<number, Map<string, Cell>>();
// … and cut text per (room, max chars), used only for text that is too long.
const cutCaches = new Map<number, Map<string, string>>();

function cacheFor<T>(caches: Map<number, Map<string, T>>, key: number): Map<string, T> {
  let m = caches.get(key);
  if (!m) {
    if (caches.size >= 64) caches.clear();
    m = new Map();
    caches.set(key, m);
  }
  return m;
}

function remember<T>(m: Map<string, T>, k: string, v: T) {
  if (m.size >= CACHE_CAP) m.clear();
  m.set(k, v);
}

function cellOf(fmt: Map<string, Cell>, raw: string, decimals: number | null): Cell {
  let c = fmt.get(raw);
  if (!c) {
    const t = format(raw, decimals);
    c = { t, em: textEm(t) };
    remember(fmt, raw, c);
  }
  return c;
}

const cellString = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : typeof v === "string" ? v : String(v);

/**
 * Cut-cache key: room quantised UP to 1/ROOM_Q em (−1 = unlimited) and the
 * character limit. Whether a label is cut is decided on the exact room; the
 * quantised room only keys the cache and is the room the cut gets (so a cut
 * depends on its key alone, at most 1/ROOM_Q em over the exact room).
 */
const MAXC = 999999;
const ROOM_Q = 16;
const roomQ = (roomEm: number) => (Number.isFinite(roomEm) ? Math.max(0, Math.ceil(roomEm * ROOM_Q)) : -1);

// ------------------------------------------------------------
// Dataset-wide: widest label (for the automatic ring width)
// ------------------------------------------------------------

const widestCache = new WeakMap<AnnotationRow[], Map<string, number>>();

/** Estimated width (em, regular weight) of the widest label of a column. */
function widestLabel(rows: AnnotationRow[], field: string, decimals: number | null, maxChars: number | null): number {
  let per = widestCache.get(rows);
  if (!per) { per = new Map(); widestCache.set(rows, per); }
  const key = `${field}\x00${decimals ?? ""}\x00${maxChars ?? ""}`;
  const hit = per.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  for (const row of rows) {
    const raw = cellString(row?.[field]);
    if (raw === null) continue;
    if (decimals === null) {
      // Cleaning never widens an unrounded cell (and a cut adds at most the "…"),
      // so the raw text bounds the label: skip cells that can't win (no glyph is > 1.02 em).
      const extra = maxChars !== null ? ELLIPSIS_EM : 0;
      if (raw.length * 1.02 + extra <= best || textEm(raw) + extra <= best) continue;
    }
    const t = format(raw, decimals);
    let em = textEm(t);
    if (maxChars !== null && t.length > maxChars) em = textEm(cut(t, maxChars, Infinity));
    if (em > best) best = em;
  }
  if (per.size > 32) per.clear();
  per.set(key, best);
  return best;
}

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const text: RingModule = {
  kind: "text",
  title: "Text labels",
  description: "One column printed as a text label per leaf (iTOL text dataset, external labels).",
  fields: { count: "one", hint: "Any column (its cell text is printed)" },

  defaults: () => ({
    color: DEFAULT_COLOR,
    useColorMap: false,
    size: DEFAULT_SIZE,
    autoSize: false,
    bold: false,
    italic: false,
    orient: "radial",
    anchor: "start",
    rotate: 0,
    width: DEFAULT_WIDTH,
    pad: DEFAULT_PAD,
    maxChars: null,
    fit: true,
    decimals: null,
    title: false,
  }),

  options: [
    { key: "color", type: "color", label: "Colour" },
    {
      key: "useColorMap", type: "bool", label: "Use the column's category colours",
      help: "Colour each label with its value's colour from the column's colour map (values without one use the colour above).",
    },
    { key: "size", type: "number", label: "Font size", min: 1, max: 200, step: 1, unit: "px" },
    {
      key: "autoSize", type: "bool", label: "Shrink to the leaf spacing",
      help: "Like iTOL and the leaf labels: the font shrinks when leaves are closer than the font size (it never grows past it).",
    },
    { key: "bold", type: "bool", label: "Bold" },
    { key: "italic", type: "bool", label: "Italic" },
    {
      key: "orient", type: "select", label: "Orientation",
      choices: [
        { value: "radial", label: "Radial (like leaf labels)" },
        { value: "tangential", label: "Tangential (along the ring)" },
      ],
    },
    {
      key: "anchor", type: "select", label: "Align",
      help: "Radial: where the text sits across the ring. Tangential: the text starts, is centred or ends on the leaf.",
      choices: [
        { value: "start", label: "Start" },
        { value: "middle", label: "Centre" },
        { value: "end", label: "End" },
      ],
    },
    { key: "rotate", type: "number", label: "Rotation", min: -360, max: 360, step: 5, unit: "°", help: "Extra rotation of every label (upside-down text is flipped to stay readable)." },
    { key: "width", type: "number", label: "Ring width", min: 2, max: 3000, step: 5, unit: "px", auto: true, help: "Blank = fit the widest label (estimated)." },
    { key: "pad", type: "number", label: "Padding", min: 0, max: 200, step: 1, unit: "px", help: "Space between the text and the ring edges." },
    { key: "maxChars", type: "number", label: "Max characters", min: 1, max: 100000, step: 1, auto: true, help: "Longer text is cut and ends with …  Blank = no limit." },
    {
      key: "fit", type: "bool", label: "Cut text that doesn't fit",
      help: "Shorten labels (ending with …) to the ring width (radial) or to the leaf's slot (tangential), from an estimate of the text width.",
    },
    { key: "decimals", type: "number", label: "Decimal places", min: 0, max: 20, step: 1, auto: true, help: "Round numeric cells. Blank = as in the file." },
    { key: "title", type: "bool", label: "Show title", help: "The ring's name as a header above the column (iTOL SHOW_LABELS)." },
  ],

  width(ring, info) {
    const w = ring.opts?.width;
    if (w !== null && w !== "") {
      const n = Number(w ?? DEFAULT_WIDTH);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_WIDTH;
    }
    // Automatic (blank): fit the widest label, like iTOL's column width, at the
    // size draw() uses (font size × leaf-label font scale; padding isn't scaled).
    const st = settings(ring);
    const fs = Number.isFinite(info.fontScale) && info.fontScale > 0 ? info.fontScale : 1;
    const size = st.size * fs;
    if (st.orient === "tangential") return Math.ceil(size * 1.3 + 2 * st.pad);
    const field = ring.fields?.[0];
    const em = field ? widestLabel(info.rows, field, st.decimals, st.maxChars) : 0;
    if (em === 0) return Math.ceil(size + 2 * st.pad);
    const wf = SAFETY * (st.bold ? BOLD : 1);
    return Math.min(3000, Math.ceil(em * wf * size + 2 * st.pad + 1));
  },

  draw(ring, ctx) {
    const field = ring.fields?.[0];
    if (!field) return;
    const st = settings(ring);
    const out = ctx.out;
    const k = ctx.scale;
    const W = ctx.width;
    const pad = Math.min(st.pad * k, W / 2);
    const basePx = st.size * ctx.fontScale * k;
    const tangential = st.orient === "tangential";
    const wf = SAFETY * (st.bold ? BOLD : 1); // estimated em → px factor (× font px)

    // Anchor depth across the band, and the depth at which the leaf spacing is
    // measured (radial text may reach the inner edge, the narrowest point in polar).
    const v = tangential ? W / 2 : st.anchor === "start" ? pad : st.anchor === "end" ? W - pad : W / 2;
    const vMeasure = tangential ? W / 2 : pad;
    const room = Math.max(0, W - 2 * pad); // radial: room across the band, px

    if (st.title) {
      const label = ring.label || ctx.columnLabel(field);
      if (label) drawFieldLabel(ctx, W / 2, label, fieldLabelSize(ctx) * k);
    }
    if (!ctx.slots.length || basePx < 0.5) return;

    const cmap = st.useColorMap ? ctx.colorMaps.get(field) : undefined;
    const fmt = cacheFor(formatCaches, st.decimals ?? -1);
    const maxChars = st.maxChars ?? Infinity;
    const mc = Math.min(maxChars, MAXC);
    // Room in em for a font size and slot (Infinity when not fitting).
    const roomEmFor = (px: number, along: number) =>
      st.fit ? (tangential ? along : room) / (px * wf) : Infinity;
    // Radial text at a fixed size has the same room in every slot.
    const fixed = !tangential && !st.autoSize;
    const fixedRoomEm = fixed ? roomEmFor(basePx, 0) : 0;
    const fixedQ = fixed ? roomQ(fixedRoomEm) : 0;
    if (fixed && fixedQ === 0) return;

    // One reusable options object (text() reads it synchronously).
    const to: TextOpts = {
      size: basePx, color: st.color, anchor: st.anchor, orient: st.orient,
      bold: st.bold, italic: st.italic, rotate: st.rotate,
    };
    const lodPx = LOD_FRAC * basePx;
    let lastKey = NaN;
    let cuts: Map<string, string> | null = null;

    for (const s of ctx.slots) {
      const raw = cellString(s.row?.[field]);
      if (raw === null) continue;
      const along = out.alongPx(s.lo, s.hi, vMeasure);
      let px = basePx;
      if (st.autoSize) {
        px = Math.min(basePx, along * FIT_FRAC);
        if (px < MIN_FIT_PX) continue;
      } else if (along < lodPx) continue;
      const roomEm = fixed ? fixedRoomEm : roomEmFor(px, along);
      const q = fixed ? fixedQ : roomQ(roomEm);
      if (q === 0) continue;

      const cell = cellOf(fmt, raw, st.decimals);
      let t = cell.t;
      if (t.length > maxChars || cell.em > roomEm) {
        const key = q * 1e6 + mc;
        if (key !== lastKey) { cuts = cacheFor(cutCaches, key); lastKey = key; }
        let c = cuts!.get(t);
        if (c === undefined) { c = cut(t, maxChars, q >= 0 ? q / ROOM_Q : Infinity); remember(cuts!, t, c); }
        t = c;
      }
      if (!t) continue;

      to.size = px;
      to.color = cmap ? cmap.get(raw) ?? st.color : st.color;
      out.text((s.lo + s.hi) / 2, v, t, to);
    }
  },

  legend: () => [],

  tooltip(ring, row, info: RingInfoContext) {
    const field = ring.fields?.[0];
    if (!field) return [];
    const raw = cellString(row?.[field]);
    return [`${info.columnLabel(field)}: ${raw === null ? "N/A" : format(raw, null)}`];
  },
};

export default text;
