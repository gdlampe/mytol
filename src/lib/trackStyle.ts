import * as d3 from "d3";
import { clamp } from "./colorUtils";
import type { AnnotationRow, ContinuousStyle, RingBorder, ScaleType, ShadeStyle, TrackConfig } from "./types";

// ============================================================
// Ring (annotation track) styling: value scales, gradients, and one
// "painter" per track that turns an annotation row into a cell colour.
// Every renderer (canvas rect/circular/unrooted and SVG) uses the painters,
// so they all agree.
// ============================================================

export const DEFAULT_BAR_COLOR = "#666666";
export const DEFAULT_SHADE_LOW = "#ffffff";

const sample = (f: (t: number) => string, n = 7): string[] =>
  Array.from({ length: n }, (_, i) => d3.color(f(i / (n - 1)))!.formatHex());

export const GRADIENT_PRESETS: { name: string; stops: string[] }[] = [
  { name: "Viridis", stops: sample(d3.interpolateViridis) },
  { name: "Magma", stops: sample(d3.interpolateMagma) },
  { name: "Plasma", stops: sample(d3.interpolatePlasma) },
  { name: "Cividis", stops: sample(d3.interpolateCividis) },
  { name: "Turbo", stops: sample(d3.interpolateTurbo, 9) },
  { name: "Blues", stops: sample(d3.interpolateBlues) },
  { name: "Reds", stops: sample(d3.interpolateReds) },
  { name: "Greens", stops: sample(d3.interpolateGreens) },
  { name: "Purples", stops: sample(d3.interpolatePurples) },
  { name: "Oranges", stops: sample(d3.interpolateOranges) },
  { name: "Greys", stops: sample(d3.interpolateGreys) },
  { name: "Yellow–Orange–Red", stops: sample(d3.interpolateYlOrRd) },
  { name: "Red–Blue (diverging)", stops: sample(d3.interpolateRdBu) },
  { name: "Spectral (diverging)", stops: sample(d3.interpolateSpectral) },
  { name: "White → Blue", stops: ["#ffffff", "#08519c"] },
  { name: "White → Red", stops: ["#ffffff", "#a50f15"] },
  { name: "White → Black", stops: ["#ffffff", "#000000"] },
];

export function defaultContinuousStyle(): ContinuousStyle {
  return { mode: "bar", barColor: DEFAULT_BAR_COLOR, stops: [...GRADIENT_PRESETS[0].stops], scale: "linear", min: null, max: null };
}

export function contStyle(t: TrackConfig): ContinuousStyle {
  return { ...defaultContinuousStyle(), ...(t.cont ?? {}) };
}

// ------------------------------------------------------------
// Numeric column statistics
// ------------------------------------------------------------

export type NumStats = { min: number; max: number; minPos: number; count: number };

/** Min / max / smallest positive value of every numeric-looking cell, per column. */
export function numericStats(rows: Iterable<AnnotationRow>, keys: string[]): Map<string, NumStats> {
  const acc = new Map<string, NumStats>(keys.map(k => [k, { min: Infinity, max: -Infinity, minPos: Infinity, count: 0 }]));
  for (const row of rows) {
    for (const k of keys) {
      const v = row[k];
      if (v === null || v === undefined || v === "") continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue; // "Infinity", "1e999" etc. count as missing
      const s = acc.get(k)!;
      s.count++;
      if (n < s.min) s.min = n;
      if (n > s.max) s.max = n;
      if (n > 0 && n < s.minPos) s.minPos = n;
    }
  }
  return acc;
}

export type ValueScale = {
  t: (v: number) => number;
  lo: number;
  hi: number;
  log: boolean;
  base: number;
  /** Log scale: positions (0–1) and values of the powers of the base inside [lo, hi]. */
  ticks: Array<{ t: number; value: number }>;
};

export const DEFAULT_LOG_BASE = 10;
export const validLogBase = (b: number | undefined): number =>
  b !== undefined && Number.isFinite(b) && b > 1 ? b : DEFAULT_LOG_BASE;

/** Short name for a log base: log₁₀, log₂, ln, or "log base b". */
export function logBaseName(b: number): string {
  if (b === 10) return "log₁₀";
  if (b === 2) return "log₂";
  if (Math.abs(b - Math.E) < 1e-9) return "ln";
  return `log base ${+b.toPrecision(4)}`;
}

/**
 * Map values to [0,1]. Linear default range is [min(0, data min), data max].
 * Log default range is the data range widened to whole powers of the base
 * (e.g. 3–3364 → 1–10000 for base 10, 2–4096 for base 2). User min/max override.
 */
export function makeValueScale(
  r: { scale: ScaleType; min: number | null; max: number | null; logBase?: number },
  s: NumStats | undefined
): ValueScale {
  const dataMin = s && s.count ? s.min : 0;
  const dataMax = s && s.count ? s.max : 1;
  const minPos = s && isFinite(s.minPos) ? s.minPos : 1;
  if (r.scale === "log") {
    const base = validLogBase(r.logBase);
    const lnB = Math.log(base);
    const logb = (v: number) => Math.log(v) / lnB;
    let lo = r.min !== null && r.min > 0 ? r.min : Math.pow(base, Math.floor(logb(minPos) + 1e-9));
    let hi = r.max !== null && r.max > 0 ? r.max : dataMax > 0 ? Math.pow(base, Math.ceil(logb(dataMax) - 1e-9)) : lo * base;
    // Degenerate range (e.g. every value is 1): widen downward so the data
    // sits at the top of the scale, as it does in linear mode.
    if (!(hi > lo)) {
      if (r.min !== null && r.min > 0) hi = lo * base;
      else lo = hi / base;
    }
    const L = Math.log(lo), span = Math.log(hi) - L;
    // Powers of the base inside the range, thinned to at most 6 ticks.
    const k0 = Math.ceil(logb(lo) - 1e-9), k1 = Math.floor(logb(hi) + 1e-9);
    const step = Math.max(1, Math.ceil((k1 - k0 + 1) / 6));
    const ticks: ValueScale["ticks"] = [];
    for (let k = k0; k <= k1 && k1 - k0 < 1000; k += step) {
      const value = Math.pow(base, k);
      ticks.push({ t: clamp((Math.log(value) - L) / span, 0, 1), value });
    }
    return { t: v => (v > 0 ? clamp((Math.log(v) - L) / span, 0, 1) : 0), lo, hi, log: true, base, ticks };
  }
  let lo = r.min ?? Math.min(0, dataMin);
  let hi = r.max ?? dataMax;
  if (!(hi > lo)) hi = lo + 1;
  return { t: v => clamp((v - lo) / (hi - lo), 0, 1), lo, hi, log: false, base: DEFAULT_LOG_BASE, ticks: [] };
}

// ------------------------------------------------------------
// Gradients (quantised to 256 levels so renderers batch fills by colour)
// ------------------------------------------------------------

const LEVELS = 255;

export function makeGradient(stops: string[]): (t: number) => string {
  const cols = stops.length >= 2 ? stops : stops.length === 1 ? [stops[0], stops[0]] : ["#ffffff", "#000000"];
  const interp = d3.piecewise(d3.interpolateRgb, cols);
  const cache: string[] = new Array(LEVELS + 1);
  return (t: number) => {
    const q = t > 0 ? Math.round(Math.min(t, 1) * LEVELS) : 0; // NaN-safe
    return cache[q] ?? (cache[q] = d3.color(interp(q / LEVELS))!.formatHex());
  };
}

// ------------------------------------------------------------
// Painters
// ------------------------------------------------------------

/**
 * A categorical ring's shading, if it is in effect: its column must still
 * exist with numeric data (it may have been deleted or its file removed —
 * shade.by is kept so restoring the column brings the shading back).
 */
export function activeShade(track: TrackConfig, stats: Map<string, NumStats>): ShadeStyle | null {
  const sh = track.shade;
  return sh && sh.by && (stats.get(sh.by)?.count ?? 0) > 0 ? sh : null;
}

/** frac = bar length as a fraction of the ring height (1 = full cell). */
export type CellPaint = { color: string; frac: number };
export type Painter = (row: AnnotationRow | undefined) => CellPaint | null;

export function makeTrackPainter(track: TrackConfig, colorMap: Map<string, string> | undefined, stats: Map<string, NumStats>): Painter {
  const key = track.key;
  const present = (v: any) => v !== null && v !== undefined && v !== "";

  if (track.type === "categorical") {
    const shade = activeShade(track, stats);
    if (!shade) {
      return row => {
        const v = row?.[key];
        return present(v) ? { color: colorMap?.get(String(v)) ?? "#aaa", frac: 1 } : null;
      };
    }
    // Per-category gradient from its low colour to its category colour.
    const sc = makeValueScale(shade, stats.get(shade.by));
    const grads = new Map<string, (t: number) => string>();
    return row => {
      const v = row?.[key];
      if (!present(v)) return null;
      const cat = String(v);
      let g = grads.get(cat);
      if (!g) {
        g = makeGradient([shade.low[cat] ?? DEFAULT_SHADE_LOW, colorMap?.get(cat) ?? "#aaa"]);
        grads.set(cat, g);
      }
      const n = Number(row?.[shade.by]);
      return { color: g(Number.isFinite(n) ? sc.t(n) : 0), frac: 1 };
    };
  }

  const cs = contStyle(track);
  const sc = makeValueScale(cs, stats.get(key));
  if (cs.mode === "gradient") {
    const g = makeGradient(cs.stops);
    return row => {
      const v = row?.[key];
      if (!present(v)) return null;
      const n = Number(v);
      return Number.isFinite(n) ? { color: g(sc.t(n)), frac: 1 } : null;
    };
  }
  return row => {
    const v = row?.[key];
    if (!present(v)) return null;
    const n = Number(v);
    return Number.isFinite(n) ? { color: cs.barColor, frac: sc.t(n) } : null;
  };
}

export const fmtNum = (n: number) => String(+n.toPrecision(4));

/** Short human-readable description of a scale range, for legends. */
export function scaleLabel(sc: ValueScale): { lo: string; hi: string } {
  return { lo: fmtNum(sc.lo), hi: fmtNum(sc.hi) };
}

/** Legend tick labels for a log scale (powers of the base), or undefined for linear. */
export function scaleTicks(sc: ValueScale): Array<{ t: number; label: string }> | undefined {
  if (!sc.log) return undefined;
  return sc.ticks.map(k => ({ t: k.t, label: fmtNum(k.value) }));
}

// ------------------------------------------------------------
// Copy / paste ring styles
// ------------------------------------------------------------

export type StyleClip = {
  fromLabel: string;
  /** Ring kind ("column" for one-column rings); paste only onto the same kind. */
  kind: string;
  /** Multi-column rings: their options and columns (to remap per-field settings). */
  opts: Record<string, any> | null;
  fields?: string[];
  type: "categorical" | "continuous";
  colors: Array<[string, string]>;
  shade: ShadeStyle | null;
  cont: ContinuousStyle | null;
  border: RingBorder | undefined;
  gap: number | undefined;
};

export function copyStyle(track: TrackConfig, colorMap: Map<string, string> | undefined): StyleClip {
  return {
    fromLabel: track.label,
    kind: track.kind ?? "column",
    opts: track.opts ? JSON.parse(JSON.stringify(track.opts)) : null,
    fields: track.fields ? [...track.fields] : undefined,
    type: track.type,
    colors: colorMap ? [...colorMap] : [],
    shade: track.shade ? { ...track.shade, low: { ...track.shade.low } } : null,
    cont: track.type === "continuous" ? contStyle(track) : null,
    border: track.border ? { ...track.border } : undefined,
    gap: track.gap,
  };
}

/**
 * Categorical → categorical: categories with the same name take the source
 * colour; the rest take the remaining source colours in order (cycling).
 * Shading (if any) comes along, with low colours mapped the same way.
 */
export function pasteCategoryColors(clip: StyleClip, target: Map<string, string>): Map<string, string> {
  const src = new Map(clip.colors);
  const unused = clip.colors.filter(([c]) => !target.has(c)).map(([, col]) => col);
  const pool = unused.length ? unused : clip.colors.map(([, col]) => col);
  const out = new Map<string, string>();
  let i = 0;
  for (const cat of target.keys()) {
    const c = src.get(cat);
    out.set(cat, c ?? (pool.length ? pool[i++ % pool.length] : target.get(cat)!));
  }
  return out;
}
