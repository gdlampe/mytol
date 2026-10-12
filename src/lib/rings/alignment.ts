import type { AnnotationRow, TrackConfig } from "../types";
import type { GradientStop, LegendEntry, LegendSection } from "../legend";
import type { BandOut } from "./band";
import { opt } from "./types";
import type { OptionField, RingModule } from "./types";
import { fieldLabelSize } from "./util";

// ============================================================
// Multiple sequence alignment ring (iTOL DATASET_ALIGNMENT).
// One column holds each leaf's aligned sequence (letters, gaps "-" "." "~";
// whitespace is ignored, so FASTA-style blocks of 10 work). Alignment columns
// run across the ring (v), one cellWidth each; leaves run along it (u).
// Residues are coloured by a standard scheme, consecutive same-colour residues
// are merged into one cell (runs cached per sequence + options, per chunk of
// columns, size-bounded), only the visible columns are drawn (long alignments
// make very wide rings) and letters are drawn only when a cell is large
// enough on screen. Extras from iTOL: position
// ruler, consensus row, conservation graph, dot highlighting against the
// consensus or a reference leaf, inverse gaps.
// ============================================================

// ------------------------------------------------------------
// Colour schemes (Clustal X / Zappo / Taylor / hydrophobicity / propensities
// are the Jalview palettes as used by iTOL; nucleotide + purine/pyrimidine are
// Jalview's nucleotide palettes)
// ------------------------------------------------------------

type SchemeLegend =
  | { kind: "groups"; groups: Array<{ label: string; color: string }> }
  | { kind: "ramp"; note: string; min: string; max: string; lo: string; hi: string };

type Scheme = { label: string; colors: Record<string, string>; legend: SchemeLegend | null };

const AA_NAMES: Record<string, string> = {
  A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", Q: "Gln", E: "Glu", G: "Gly", H: "His", I: "Ile",
  L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val",
};

/** Scheme from residue groups: [legend label, letters, colour]. */
function grouped(label: string, groups: Array<[string, string, string]>): Scheme {
  const colors: Record<string, string> = {};
  for (const [, letters, c] of groups) for (const ch of letters) colors[ch] = c;
  return { label, colors, legend: { kind: "groups", groups: groups.map(([l, letters, color]) => ({ label: `${l} (${letters.split("").join(" ")})`, color })) } };
}

/** Scheme from "A=#rrggbb R=#rrggbb …". */
function perResidue(label: string, spec: string, legend: SchemeLegend | "letters"): Scheme {
  const colors: Record<string, string> = {};
  for (const tok of spec.trim().split(/\s+/)) {
    const [k, c] = tok.split("=");
    colors[k] = c;
  }
  const lg: SchemeLegend = legend === "letters"
    ? { kind: "groups", groups: Object.keys(colors).map(k => ({ label: AA_NAMES[k] ? `${k} ${AA_NAMES[k]}` : k, color: colors[k] })) }
    : legend;
  return { label, colors, legend: lg };
}

const SCHEMES: Record<string, Scheme> = {
  clustal: grouped("Clustal X colours", [
    ["Hydrophobic", "AILMFWV", "#80a0f0"],
    ["Positive", "KR", "#f01505"],
    ["Polar", "NQST", "#00ff00"],
    ["Negative", "DE", "#c048c0"],
    ["Cysteine", "C", "#f08080"],
    ["Glycine", "G", "#f09048"],
    ["Aromatic", "HY", "#15a4a4"],
    ["Proline", "P", "#ffff00"],
  ]),
  zappo: grouped("Zappo colours", [
    ["Aliphatic / hydrophobic", "AILMV", "#ffafaf"],
    ["Aromatic", "FWY", "#ffc800"],
    ["Positive", "HKR", "#6464ff"],
    ["Negative", "DE", "#ff0000"],
    ["Hydrophilic", "NQST", "#00ff00"],
    ["Conformational", "GP", "#ff00ff"],
    ["Cysteine", "C", "#ffff00"],
  ]),
  taylor: perResidue("Taylor colours",
    "A=#ccff00 R=#0000ff N=#cc00ff D=#ff0000 C=#ffff00 Q=#ff00cc E=#ff0066 G=#ff9900 H=#0066ff I=#66ff00 " +
    "L=#33ff00 K=#6600ff M=#00ff00 F=#00ff66 P=#ffcc00 S=#ff3300 T=#ff6600 W=#00ccff Y=#00ffcc V=#99ff00", "letters"),
  hydrophobicity: perResidue("Hydrophobicity",
    "A=#ad0052 R=#0000ff N=#0c00f3 D=#0c00f3 C=#c2003d Q=#0c00f3 E=#0c00f3 G=#6a0095 H=#1500ea I=#ff0000 " +
    "L=#ea0015 K=#0000ff M=#b0004f F=#cb0034 P=#4600b9 S=#5e00a1 T=#61009e W=#5b00a4 Y=#4f00b0 V=#f60009 " +
    "B=#0c00f3 X=#680097 Z=#0c00f3",
    { kind: "ramp", note: "Kyte–Doolittle hydrophobicity", min: "hydrophilic", max: "hydrophobic", lo: "#0000ff", hi: "#ff0000" }),
  helix: perResidue("Helix propensity",
    "A=#e718e7 R=#6f906f N=#1be41b D=#778877 C=#23dc23 Q=#926d92 E=#ff00ff G=#00ff00 H=#758a75 I=#8a758a " +
    "L=#ae51ae K=#a05fa0 M=#ef10ef F=#986798 P=#00ff00 S=#36c936 T=#47b847 W=#8a758a Y=#21de21 V=#857a85 " +
    "B=#49b649 X=#758a75 Z=#c936c9",
    { kind: "ramp", note: "Helix propensity", min: "low", max: "high", lo: "#00ff00", hi: "#ff00ff" }),
  strand: perResidue("Strand propensity",
    "A=#5858a7 R=#6b6b94 N=#64649b D=#2121de C=#9d9d62 Q=#8c8c73 E=#0000ff G=#4949b6 H=#60609f I=#ecec13 " +
    "L=#b2b24d K=#4747b8 M=#82827d F=#c2c23d P=#2323dc S=#4949b6 T=#9d9d62 W=#c0c03f Y=#d3d32c V=#ffff00 " +
    "B=#4343bc X=#797986 Z=#4747b8",
    { kind: "ramp", note: "Strand propensity", min: "low", max: "high", lo: "#0000ff", hi: "#ffff00" }),
  turn: perResidue("Turn propensity",
    "A=#2cd3d3 R=#708f8f N=#ff0000 D=#e81717 C=#a85757 Q=#3fc0c0 E=#778888 G=#ff0000 H=#708f8f I=#00ffff " +
    "L=#1ce3e3 K=#7e8181 M=#1ee1e1 F=#1ee1e1 P=#f60909 S=#e11e1e T=#738c8c W=#738c8c Y=#9d6262 V=#07f8f8 " +
    "B=#f30c0c X=#7c8383 Z=#5ba4a4",
    { kind: "ramp", note: "Turn propensity", min: "low", max: "high", lo: "#00ffff", hi: "#ff0000" }),
  buried: perResidue("Buried index",
    "A=#00a35c R=#00fc03 N=#00eb14 D=#00eb14 C=#0000ff Q=#00f10e E=#00f10e G=#009d62 H=#00d52a I=#0054ab " +
    "L=#007b84 K=#00ff00 M=#009768 F=#008778 P=#00e01f S=#00d52a T=#00db24 W=#00a857 Y=#00e619 V=#005fa0 " +
    "B=#00eb14 X=#00b649 Z=#00f10e",
    { kind: "ramp", note: "Buried index", min: "exposed", max: "buried", lo: "#00ff00", hi: "#0000ff" }),
  nucleotide: grouped("Nucleotide colours", [
    ["Adenine", "A", "#64f73f"],
    ["Cytosine", "C", "#ffb340"],
    ["Guanine", "G", "#eb413c"],
    ["Thymine / uracil", "TU", "#3c88ee"],
  ]),
  purine: grouped("Purine / pyrimidine", [
    ["Purine", "AGR", "#ff83fa"],
    ["Pyrimidine", "CTUY", "#40e0d0"],
  ]),
  mono: { label: "Single colour", colors: {}, legend: null },
};

const SCHEME_CHOICES: Array<{ value: string; label: string }> = [
  { value: "clustal", label: "Clustal X (protein)" },
  { value: "zappo", label: "Zappo (protein)" },
  { value: "taylor", label: "Taylor (protein)" },
  { value: "hydrophobicity", label: "Hydrophobicity (protein)" },
  { value: "helix", label: "Helix propensity" },
  { value: "strand", label: "Strand propensity" },
  { value: "turn", label: "Turn propensity" },
  { value: "buried", label: "Buried index" },
  { value: "nucleotide", label: "Nucleotide (A C G T/U)" },
  { value: "purine", label: "Purine / pyrimidine" },
  { value: "mono", label: "Mono (one colour)" },
];

const DEFAULT_MONO = "#bdbdbd";
const INVERSE_GAP_FILL = "#222222";
const INVERSE_GAP_BAR = "#ffffff";
/** Conservation bar colours (iTOL COLOR_GRAPH): > 95 %, > 30 %, otherwise. */
const CONS_COLORS = ["#aaffaa", "#ff8c00", "#ff0000"];
const CONS_PLAIN = "#aaaaaa";
const CONS_STROKE = "#444444";
const RULER_COLOR = "#333333";
const MAX_COLS = 100000;
/** Residue cells drawn per frame at most (more → adjacent columns are merged). */
const CELL_BUDGET = 60000;
/** Residue letters drawn per draw() at most (each is a text call); more visible → no letters. */
const LETTER_BUDGET = 25000;
/** Run cache limit in 4-byte words (cached Int32 runs + per-sequence overhead), ≈ 64 MB. */
const RUN_CACHE_WORDS = 16_000_000;
/** Approximate bookkeeping per cached sequence, in words. */
const ENTRY_WORDS = 32;
/** Drawn cells (bins) per run chunk: runs are computed per chunk, only where visible. */
const CHUNK_BINS = 256;
/** Char ops spent on a consensus at most; larger datasets are sampled with a stride. */
const CONSENSUS_BUDGET = 2e7;

// ------------------------------------------------------------
// Cell parsing
// ------------------------------------------------------------

const MISSING = new Set(["na", "n/a", "nan", "null", "none", "?"]);
const WS = /\s/;
const DIGIT = /\d/;
const normCache = new Map<string, string>();

const isGap = (code: number) => code === 45 /* - */ || code === 46 /* . */ || code === 126; /* ~ */

/** The aligned sequence in a cell (whitespace removed), or null when missing. */
function normSeq(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : String(v);
  if (!s.length) return null;
  if (s.length <= 4 && MISSING.has(s.trim().toLowerCase())) return null;
  if (DIGIT.test(s)) return null; // numbers are not sequences (bad value)
  if (!WS.test(s)) return s;
  let t = normCache.get(s);
  if (t === undefined) {
    t = s.replace(/\s+/g, "");
    if (normCache.size > 5000) normCache.clear();
    normCache.set(s, t);
  }
  return t || null;
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------
// Dataset-wide values (cached per rows identity)
// ------------------------------------------------------------

const lenCache = new WeakMap<AnnotationRow[], Map<string, number>>();

/** Longest sequence in the column over all rows. */
function alignmentLength(rows: AnnotationRow[], field: string): number {
  let m = lenCache.get(rows);
  if (!m) { m = new Map(); lenCache.set(rows, m); }
  const hit = m.get(field);
  if (hit !== undefined) return hit;
  let L = 0;
  for (const r of rows) {
    const v = r[field];
    if (v === null || v === undefined) continue;
    const s = typeof v === "string" ? v : String(v);
    if (s.length <= L) continue; // whitespace removal only shortens
    const t = normSeq(s);
    if (t && t.length > L) L = t.length;
  }
  m.set(field, L);
  return L;
}

type Win = { s0: number; n: number; start: number; end: number; len: number };

/** Displayed window: 1-based start/end (blank = whole alignment), clamped to the alignment length. */
function windowOf(ring: TrackConfig, rows: AnnotationRow[]): Win {
  const field = ring.fields?.[0];
  const len = field ? alignmentLength(rows, field) : 0;
  const st = toNum(opt<unknown>(ring, "start", null));
  const start = st !== null && st >= 1 ? Math.floor(st) : 1;
  const en = toNum(opt<unknown>(ring, "end", null));
  let end = en !== null && en >= 1 ? Math.floor(en) : len;
  if (len > 0) end = Math.min(end, len);
  const n = Math.max(0, Math.min(MAX_COLS, end - start + 1));
  return { s0: start - 1, n, start, end: start + n - 1, len };
}

const cellWidthOf = (ring: TrackConfig) => {
  const w = toNum(opt<unknown>(ring, "cellWidth", 4));
  return w !== null && w > 0 ? w : 4;
};

let nextId = 1;

type Consensus = {
  id: number;
  /** Uppercase consensus residue per window column (char code), 0 = below threshold. */
  ref: Uint8Array;
  /** Consensus string (uppercase ≥ threshold, lowercase ≥ half, "-" otherwise), iTOL style. */
  chars: string;
  /** Top residue count / number of sequences, per column (iTOL conservation). */
  cons: Float32Array;
  /** Sequences counted. */
  N: number;
  /** Row stride used (1 = every row). */
  stride: number;
  runs: Map<string, Int32Array>;
};

const consCache = new WeakMap<AnnotationRow[], Map<string, Consensus>>();

/** Per-column consensus over the whole column (iTOL algorithm; letters counted case-insensitively, X/B/Z/J ignored). */
function consensusOf(rows: AnnotationRow[], field: string, s0: number, n: number, thr: number, ignoreGaps: boolean): Consensus {
  let m = consCache.get(rows);
  if (!m) { m = new Map(); consCache.set(rows, m); }
  const key = `${field}\x00${s0}\x00${n}\x00${thr}\x00${ignoreGaps ? 1 : 0}`;
  const hit = m.get(key);
  if (hit) return hit;
  const counts = new Int32Array(n * 26);
  const nonGap = new Int32Array(n);
  const stride = Math.max(1, Math.ceil((rows.length * n) / CONSENSUS_BUDGET));
  let N = 0;
  for (let i = 0; i < rows.length; i += stride) {
    const seq = normSeq(rows[i][field]);
    if (!seq) continue;
    N++;
    const lim = Math.min(n, seq.length - s0);
    for (let c = 0; c < lim; c++) {
      const k = (seq.charCodeAt(s0 + c) | 32) - 97;
      if (k < 0 || k >= 26 || k === 23 /* x */ || k === 1 /* b */ || k === 25 /* z */ || k === 9 /* j */) continue;
      counts[c * 26 + k]++;
      nonGap[c]++;
    }
  }
  const ref = new Uint8Array(n);
  const cons = new Float32Array(n);
  const chars: string[] = new Array(n);
  for (let c = 0; c < n; c++) {
    let best = -1, top = 0;
    for (let k = 0; k < 26; k++) { const x = counts[c * 26 + k]; if (x > top) { top = x; best = k; } }
    const denom = ignoreGaps ? nonGap[c] : N;
    const frac = denom > 0 ? top / denom : 0;
    cons[c] = N > 0 ? top / N : 0;
    if (best >= 0 && frac * 100 >= thr) { ref[c] = 65 + best; chars[c] = String.fromCharCode(65 + best); }
    else if (best >= 0 && top >= denom / 2) chars[c] = String.fromCharCode(97 + best);
    else chars[c] = "-";
  }
  const out: Consensus = { id: nextId++, ref, chars: chars.join(""), cons, N, stride, runs: new Map() };
  if (m.size > 16) m.clear();
  m.set(key, out);
  return out;
}

type RefSeq = { id: number; ref: Uint8Array; name: string } | null;
const refCache = new WeakMap<AnnotationRow[], Map<string, RefSeq>>();

/** Reference leaf's sequence (uppercase codes per window column, 0 = gap / none). */
function referenceOf(rows: AnnotationRow[], field: string, name: string, s0: number, n: number): RefSeq {
  let m = refCache.get(rows);
  if (!m) { m = new Map(); refCache.set(rows, m); }
  const key = `${field}\x00${name}\x00${s0}\x00${n}`;
  const hit = m.get(key);
  if (hit !== undefined) return hit;
  let res: RefSeq = null;
  const row = rows.find(r => r.id === name);
  const seq = row ? normSeq(row[field]) : null;
  if (seq) {
    const ref = new Uint8Array(n);
    const lim = Math.min(n, seq.length - s0);
    for (let c = 0; c < lim; c++) {
      let code = seq.charCodeAt(s0 + c);
      if (code >= 97 && code <= 122) code -= 32;
      ref[c] = code >= 65 && code <= 90 ? code : 0;
    }
    res = { id: nextId++, ref, name };
  }
  if (m.size > 16) m.clear();
  m.set(key, res);
  return res;
}

// ------------------------------------------------------------
// Paint: char → palette index lookup for one option set
// ------------------------------------------------------------

type Paint = {
  key: string;
  lut: Int16Array; // char code 0..127 → palette index, -1 = no fill
  other: number;   // index for codes ≥ 128
  gap: number;     // index for gap cells, -1 = blank
  colors: string[];
  text: string[];  // letter colour per palette index (by luminance)
};

/** Black or white text for a background colour (hex; anything else counts as light). */
function textOn(color: string): string {
  let h = color.trim();
  if (h[0] !== "#") return "#000000";
  h = h.slice(1);
  if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return "#000000";
  const ch = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  return L > 0.25 ? "#000000" : "#ffffff";
}

const paintCache = new Map<string, Paint>();

function getPaint(scheme: string, mono: string, gapColor: string, inverse: boolean): Paint {
  const key = `${scheme}|${mono}|${gapColor}|${inverse ? 1 : 0}`;
  const hit = paintCache.get(key);
  if (hit) return hit;
  const colors: string[] = [];
  const index = (c: string) => { let i = colors.indexOf(c); if (i < 0) { i = colors.length; colors.push(c); } return i; };
  const lut = new Int16Array(128).fill(-1);
  let other = -1;
  if (scheme === "mono") {
    const i = index(mono || DEFAULT_MONO);
    for (let c = 33; c < 127; c++) if (!isGap(c)) lut[c] = i;
    other = i;
  } else {
    const sc = SCHEMES[scheme] ?? SCHEMES.clustal;
    for (const [ch, col] of Object.entries(sc.colors)) {
      const i = index(col);
      lut[ch.charCodeAt(0)] = i;
      lut[ch.toLowerCase().charCodeAt(0)] = i;
    }
  }
  const gap = inverse ? index(INVERSE_GAP_FILL) : gapColor ? index(gapColor) : -1;
  const p: Paint = { key, lut, other, gap, colors, text: colors.map(textOn) };
  if (paintCache.size > 64) paintCache.clear();
  paintCache.set(key, p);
  return p;
}

// ------------------------------------------------------------
// Colour runs: [c0, c1, paletteIndex] triples (window-relative columns)
// ------------------------------------------------------------

type Highlight = { id: number; ref: Uint8Array; diff: boolean; colored: boolean };

const EMPTY_RUNS = new Int32Array(0);
let scratch = new Int32Array(3 * 512);

/** Is a residue (non-gap code) highlighted against the reference / consensus? */
const highlighted = (code: number, c: number, hl: Highlight) => {
  const up = code >= 97 && code <= 122 ? code - 32 : code;
  const r = hl.ref[c];
  const match = r !== 0 && up === r;
  return match !== hl.diff;
};

/** Palette index of one cell (-1 = no fill). */
function cellIndex(code: number, c: number, p: Paint, hl: Highlight | null): number {
  if (isGap(code)) return p.gap;
  const i = code < 128 ? p.lut[code] : p.other;
  if (i >= 0 && hl && !hl.colored && !highlighted(code, c, hl)) return -1;
  return i;
}

let binCounts = new Int32Array(64);

/**
 * Colour runs of one sequence over window columns [c0, c1) (c0 a multiple of
 * bin). bin > 1 (cells narrower than a pixel): each group of `bin` columns
 * takes its most common colour (blank when blanks are the majority), so a
 * frame draws about one cell per pixel.
 */
function computeRuns(seq: string, p: Paint, s0: number, n: number, hl: Highlight | null, bin = 1, c0 = 0, c1 = n): Int32Array {
  const m = Math.min(n, c1, seq.length - s0);
  if (m <= c0) return EMPTY_RUNS;
  let k = 0;
  let cur = -1, from = c0;
  const push = (a: number, b: number, idx: number) => {
    if (k + 3 > scratch.length) { const g = new Int32Array(scratch.length * 2); g.set(scratch); scratch = g; }
    scratch[k++] = a; scratch[k++] = b; scratch[k++] = idx;
  };
  if (bin <= 1) {
    for (let c = c0; c < m; c++) {
      const idx = cellIndex(seq.charCodeAt(s0 + c), c, p, hl);
      if (idx !== cur) {
        if (cur >= 0) push(from, c, cur);
        cur = idx;
        from = c;
      }
    }
  } else {
    const P = p.colors.length;
    if (binCounts.length < P) binCounts = new Int32Array(P * 2);
    for (let b0 = c0; b0 < m; b0 += bin) {
      const b1 = Math.min(m, b0 + bin);
      binCounts.fill(0, 0, P);
      let best = -1, bestN = 0, filled = 0;
      for (let c = b0; c < b1; c++) {
        const i = cellIndex(seq.charCodeAt(s0 + c), c, p, hl);
        if (i < 0) continue;
        filled++;
        const x = ++binCounts[i];
        if (x > bestN) { bestN = x; best = i; }
      }
      const idx = filled * 2 >= b1 - b0 ? best : -1;
      if (idx !== cur) {
        if (cur >= 0) push(from, b0, cur);
        cur = idx;
        from = b0;
      }
    }
  }
  if (cur >= 0) push(from, m, cur);
  return k ? scratch.slice(0, k) : EMPTY_RUNS;
}

/** Columns merged per drawn cell: 1, or a power of two so a cell is ≳ 0.75 px. */
const binFor = (cw: number) => (cw >= 0.75 || !(cw > 0) ? 1 : Math.pow(2, Math.ceil(Math.log2(0.75 / cw))));

/** First run (Int32 offset) of a sorted run list that ends after column c. */
function firstRun(runs: Int32Array, c: number): number {
  let lo = 0, hi = runs.length / 3;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid * 3 + 1] > c) hi = mid; else lo = mid + 1;
  }
  return lo * 3;
}

// Run cache: per option set, per raw cell value, the runs of each chunk of
// CHUNK_BINS cells that has been visible. Bounded by total size (words), least
// recently used option sets / sequences dropped first.

type Entry = {
  seq: string;
  /** Runs per chunk of `span` columns (filled in when a chunk is first visible). */
  chunks: Array<Int32Array | undefined> | null;
  /** Cache size charged for this entry (words). */
  words: number;
};
const MISSING_ENTRY: Entry = { seq: "", chunks: null, words: ENTRY_WORDS };

type RunSet = {
  key: string;
  /** Raw cell value → entry, least recently used first. */
  entries: Map<string, Entry>;
  words: number;
  p: Paint;
  s0: number;
  n: number;
  hl: Highlight | null;
  bin: number;
  /** Columns per chunk (CHUNK_BINS × bin, so bins never straddle chunks). */
  span: number;
};

/** Option set key → cached runs, least recently used first. */
const runSets = new Map<string, RunSet>();
let runWords = 0;

function dropSet(set: RunSet) {
  if (runSets.get(set.key) === set) runSets.delete(set.key);
  runWords -= set.words;
}

/** Evict down to RUN_CACHE_WORDS: other option sets first, then the oldest sequences of `keep` (never its newest). */
function trimRuns(keep: RunSet) {
  for (const set of runSets.values()) {
    if (runWords <= RUN_CACHE_WORDS) return;
    if (set !== keep) dropSet(set);
  }
  for (const [k, e] of keep.entries) {
    if (runWords <= RUN_CACHE_WORDS || keep.entries.size <= 1) return;
    keep.entries.delete(k);
    keep.words -= e.words;
    runWords -= e.words;
  }
}

function charge(set: RunSet, e: Entry | null, words: number) {
  if (e) e.words += words;
  set.words += words;
  runWords += words;
  if (runWords > RUN_CACHE_WORDS) trimRuns(set);
}

/** Run cache for one option set (a few option sets are kept, oldest dropped). */
function runsFor(key: string, p: Paint, s0: number, n: number, hl: Highlight | null, bin: number): RunSet {
  let set = runSets.get(key);
  if (set) {
    // refresh recency
    runSets.delete(key);
    runSets.set(key, set);
    set.p = p;
    set.hl = hl;
    return set;
  }
  set = { key, entries: new Map(), words: 0, p, s0, n, hl, bin, span: CHUNK_BINS * Math.max(1, bin) };
  runSets.set(key, set);
  if (runSets.size > 8) dropSet(runSets.values().next().value as RunSet);
  return set;
}

function entryOf(set: RunSet, raw: unknown): Entry {
  if (raw === null || raw === undefined || raw === "") return MISSING_ENTRY;
  const key = typeof raw === "string" ? raw : String(raw);
  const m = set.entries;
  let e = m.get(key);
  if (e) {
    // refresh recency
    m.delete(key);
    m.set(key, e);
    return e;
  }
  const seq = normSeq(key);
  // a whitespace-stripped copy is charged too (≈ 1 byte per char)
  e = seq ? { seq, chunks: null, words: 0 } : MISSING_ENTRY;
  m.set(key, e);
  charge(set, seq ? e : null, ENTRY_WORDS + (seq && seq !== key ? Math.ceil(seq.length / 4) : 0));
  return e;
}

/** Runs of chunk ci of a sequence (computed on first use). */
function chunkRuns(set: RunSet, e: Entry, ci: number, nChunks: number): Int32Array {
  let ch = e.chunks;
  if (!ch) {
    ch = e.chunks = new Array<Int32Array | undefined>(nChunks);
    charge(set, e, 2 * nChunks);
  }
  let r = ch[ci];
  if (!r) {
    const a = ci * set.span;
    r = computeRuns(e.seq, set.p, set.s0, set.n, set.hl, set.bin, a, a + set.span);
    ch[ci] = r;
    charge(set, e, r.length + 2);
  }
  return r;
}

let vis = new Int32Array(3 * 1024);

/** Runs of a sequence that overlap columns [cA, cB), copied into `vis`; returns their Int32 length. */
function visibleRuns(set: RunSet, e: Entry, cA: number, cB: number): number {
  if (!e.seq) return 0;
  const m = Math.min(set.n, e.seq.length - set.s0);
  const hiC = Math.min(cB, m);
  if (hiC <= cA) return 0;
  const span = set.span;
  const nChunks = Math.ceil(m / span);
  let k = 0;
  for (let ci = Math.floor(cA / span), last = Math.floor((hiC - 1) / span); ci <= last; ci++) {
    const runs = chunkRuns(set, e, ci, nChunks);
    for (let j = firstRun(runs, cA); j < runs.length && runs[j] < cB; j += 3) {
      if (k + 3 > vis.length) { const g = new Int32Array(vis.length * 2); g.set(vis); vis = g; }
      vis[k++] = runs[j];
      vis[k++] = runs[j + 1];
      vis[k++] = runs[j + 2];
    }
  }
  return k;
}

// ------------------------------------------------------------
// Option reading
// ------------------------------------------------------------

type Opts = {
  field: string;
  scheme: string;
  mono: string;
  gapColor: string;
  inverse: boolean;
  letters: boolean;
  ruler: boolean;
  label: boolean;
  highlight: "none" | "consensus" | "reference";
  reference: string;
  markRef: boolean;
  diff: boolean;
  colored: boolean;
  showConsensus: boolean;
  showConservation: boolean;
  colorGraph: boolean;
  threshold: number;
  ignoreGaps: boolean;
};

function readOpts(ring: TrackConfig): Opts {
  const h = opt<string>(ring, "highlight", "none");
  const thr = toNum(opt<unknown>(ring, "threshold", 50));
  return {
    field: ring.fields?.[0] ?? "",
    scheme: SCHEMES[opt<string>(ring, "scheme", "clustal")] ? opt<string>(ring, "scheme", "clustal") : "clustal",
    mono: opt<string>(ring, "monoColor", DEFAULT_MONO) || DEFAULT_MONO,
    gapColor: opt<string>(ring, "gapColor", ""),
    inverse: !!opt(ring, "inverseGaps", false),
    letters: !!opt(ring, "showLetters", true),
    ruler: !!opt(ring, "showRuler", true),
    label: !!opt(ring, "showLabel", false),
    highlight: h === "consensus" || h === "reference" ? h : "none",
    reference: String(opt<unknown>(ring, "reference", "")).trim(),
    markRef: !!opt(ring, "markReference", false),
    diff: !!opt(ring, "highlightDiff", false),
    colored: !!opt(ring, "coloredDots", false),
    showConsensus: !!opt(ring, "showConsensus", false),
    showConservation: !!opt(ring, "showConservation", false),
    colorGraph: !!opt(ring, "colorGraph", false),
    threshold: thr === null ? 50 : Math.max(0, Math.min(100, thr)),
    ignoreGaps: !!opt(ring, "ignoreGaps", false),
  };
}

function highlightOf(o: Opts, rows: AnnotationRow[], w: Win): Highlight | null {
  if (o.highlight === "consensus") {
    const c = consensusOf(rows, o.field, w.s0, w.n, o.threshold, o.ignoreGaps);
    return { id: c.id, ref: c.ref, diff: o.diff, colored: o.colored };
  }
  if (o.highlight === "reference" && o.reference) {
    const r = referenceOf(rows, o.field, o.reference, w.s0, w.n);
    return r ? { id: r.id, ref: r.ref, diff: o.diff, colored: o.colored } : null;
  }
  return null;
}

// ------------------------------------------------------------
// Drawing helpers
// ------------------------------------------------------------

/** Band-u offset for `px` screen px at depth v (rect: px; polar: radians). */
const uPerPx = (out: BandOut, v: number) => (out.geom.kind === "rect" ? 1 : 1 / Math.max(1, out.geom.r0 + v));

const NICE = [1, 2, 5];
/** Smallest 1/2/5×10^k step whose spacing is at least minPx. */
function niceStep(cw: number, minPx: number): number {
  for (let e = 1; e < 1e9; e *= 10) for (const b of NICE) if (b * e * cw >= minPx) return b * e;
  return 1e9;
}

/** Letter of one cell and its colours (null = nothing to print). */
function letterOf(code: number, c: number, p: Paint, hl: Highlight | null, inverse: boolean): { ch: string; color: string } | null {
  if (isGap(code)) {
    if (inverse) return null;
    return { ch: String.fromCharCode(code), color: p.gap >= 0 ? p.text[p.gap] : "#999999" };
  }
  const idx = code < 128 ? p.lut[code] : p.other;
  const dotted = hl !== null && !highlighted(code, c, hl);
  const shownIdx = dotted && !hl!.colored ? -1 : idx;
  return { ch: dotted ? "." : String.fromCharCode(code), color: shownIdx >= 0 ? p.text[shownIdx] : "#222222" };
}

// ------------------------------------------------------------
// Module
// ------------------------------------------------------------

const consOptShown = (o: Record<string, any>) => o.highlight === "consensus" || !!o.showConsensus || !!o.showConservation;

const options: OptionField[] = [
  { key: "scheme", label: "Colour scheme", type: "select", choices: SCHEME_CHOICES },
  { key: "monoColor", label: "Residue colour", type: "color", showIf: o => o.scheme === "mono" },
  { key: "start", label: "First column", type: "number", min: 1, step: 1, auto: true, help: "1-based; blank = 1." },
  { key: "end", label: "Last column", type: "number", min: 1, step: 1, auto: true, help: "Inclusive; blank = the whole alignment (longest sequence)." },
  { key: "cellWidth", label: "Cell width", type: "number", min: 0.2, max: 40, step: 0.5, unit: "px", help: "Width of one alignment column (ring width = columns × cell width)." },
  { key: "gapColor", label: "Gap colour", type: "color", help: "Empty = gaps are left blank." },
  { key: "inverseGaps", label: "Inverse gaps (dark cell, white bar)", type: "bool" },
  { key: "showLetters", label: "Residue letters", type: "bool", help: "Drawn when a cell is at least 7 px wide and the row at least 9 px tall." },
  { key: "showRuler", label: "Position ruler", type: "bool", help: "Column numbers before the first leaf." },
  { key: "showLabel", label: "Ring label", type: "bool" },
  {
    key: "highlight", label: "Dot highlighting", type: "select",
    choices: [{ value: "none", label: "Off" }, { value: "consensus", label: "Against consensus" }, { value: "reference", label: "Against reference leaf" }],
    help: "Residues that do not match are shown as dots (and without colour unless 'coloured dots' is on).",
  },
  { key: "reference", label: "Reference leaf", type: "text", placeholder: "leaf name", showIf: o => o.highlight === "reference" },
  { key: "markReference", label: "Box around reference", type: "bool", showIf: o => o.highlight === "reference" },
  { key: "highlightDiff", label: "Highlight differences instead", type: "bool", showIf: o => o.highlight === "consensus" || o.highlight === "reference" },
  { key: "coloredDots", label: "Coloured dots", type: "bool", help: "Keep the residue colour behind dotted cells.", showIf: o => o.highlight === "consensus" || o.highlight === "reference" },
  { key: "showConsensus", label: "Consensus row", type: "bool", help: "Consensus sequence after the last leaf." },
  { key: "showConservation", label: "Conservation graph", type: "bool", help: "Bar per column: top residue count / sequences." },
  { key: "colorGraph", label: "Colour conservation bars", type: "bool", help: "Green > 95 %, orange > 30 %, red otherwise.", showIf: o => !!o.showConservation },
  { key: "threshold", label: "Consensus threshold", type: "number", min: 0, max: 100, step: 5, unit: "%", showIf: consOptShown },
  { key: "ignoreGaps", label: "Ignore gaps in consensus", type: "bool", showIf: consOptShown },
];

/** Nucleotide if ≥ 90 % of the letters in a sample are A/C/G/T/U/N. */
function guessScheme(rows: AnnotationRow[], field: string): string {
  let nuc = 0, all = 0, seen = 0;
  const step = Math.max(1, Math.floor(rows.length / 300));
  for (let i = 0; i < rows.length && seen < 300; i += step) {
    const seq = normSeq(rows[i]?.[field]);
    if (!seq) continue;
    seen++;
    const lim = Math.min(seq.length, 2000);
    for (let j = 0; j < lim; j++) {
      const k = seq.charCodeAt(j) | 32;
      if (k < 97 || k > 122) continue;
      all++;
      if (k === 97 || k === 99 || k === 103 || k === 116 || k === 117 || k === 110) nuc++;
    }
  }
  return all > 0 && nuc / all >= 0.9 ? "nucleotide" : "clustal";
}

const alignment: RingModule = {
  kind: "alignment",
  title: "Sequence alignment",
  description: "Aligned sequence per leaf (one column; letters with gaps '-' or '.'), coloured by residue.",
  fields: { count: "one", hint: "Column with aligned sequences (all the same length)" },

  defaults(fields, info) {
    return {
      scheme: fields[0] ? guessScheme(info.rows, fields[0]) : "clustal",
      monoColor: DEFAULT_MONO,
      start: null,
      end: null,
      cellWidth: 4,
      gapColor: "",
      inverseGaps: false,
      showLetters: true,
      showRuler: true,
      showLabel: false,
      highlight: "none",
      reference: "",
      markReference: false,
      highlightDiff: false,
      coloredDots: false,
      showConsensus: false,
      showConservation: false,
      colorGraph: false,
      threshold: 50,
      ignoreGaps: false,
    };
  },

  options,

  width(ring, info) {
    return windowOf(ring, info.rows).n * cellWidthOf(ring);
  },

  draw(ring, ctx) {
    const o = readOpts(ring);
    if (!o.field) return;
    const out = ctx.out;
    const s = ctx.scale;
    const w = windowOf(ring, ctx.rows);
    if (w.n <= 0 || !(ctx.width > 0)) return;
    const n = w.n;
    const cw = ctx.width / n; // screen px per alignment column
    const p = getPaint(o.scheme, o.mono, o.gapColor, o.inverse);
    const hl = highlightOf(o, ctx.rows, w);
    // Visible columns [cA, cB) (wide rings: only the part across v that can be on screen).
    const vLo = ctx.vMin > -Infinity ? ctx.vMin : -Infinity; // NaN / missing → unbounded
    const vHi = ctx.vMax < Infinity ? ctx.vMax : Infinity;
    const colFrom = (v: number) => Math.max(0, Math.floor(v / cw) - 1);
    const colTo = (v: number) => Math.min(n, Math.ceil(v / cw) + 1);
    const cA = colFrom(vLo), cB = colTo(vHi);
    const nVis = Math.max(0, cB - cA);
    // Merge columns so a frame draws at most ~CELL_BUDGET cells (overview zoom
    // of large trees); detail returns as zooming in reduces the visible slots / columns.
    const budgetCols = CELL_BUDGET / Math.max(1, ctx.slots.length);
    const bin = Math.max(binFor(cw), nVis > budgetCols ? Math.pow(2, Math.ceil(Math.log2(nVis / Math.max(1, budgetCols)))) : 1);
    // Coloured dots keep every colour, so their runs equal the plain ones.
    const hlRuns = hl && !hl.colored ? hl : null;
    const cache = runsFor(`${o.field}|${p.key}|${w.s0}|${n}|${bin}|${hlRuns ? `${hlRuns.id}|${hlRuns.diff ? 1 : 0}` : "-"}`, p, w.s0, n, hlRuns, bin);
    const inset = (1 - ctx.barFill) / 2;
    const polar = out.geom.kind === "polar";
    const span = Math.abs(ctx.uEnd - ctx.uStart);
    const gapU = polar ? 2 * Math.PI - span : Infinity; // free arc for header / footer

    // ---- residue cells: merged colour runs (visible columns only) ----
    let anyGapRun = false;
    for (const sl of ctx.slots) {
      const len = visibleRuns(cache, entryOf(cache, sl.row?.[o.field]), cA, cB);
      if (!len) continue;
      const d = sl.hi - sl.lo;
      const u0 = sl.lo + d * inset, u1 = sl.hi - d * inset;
      for (let k = 0; k < len; k += 3) {
        out.fillCell(u0, u1, vis[k] * cw, vis[k + 1] * cw, p.colors[vis[k + 2]]);
        if (vis[k + 2] === p.gap) anyGapRun = true;
      }
    }

    // ---- footer geometry (consensus row + conservation graph after the last leaf) ----
    const needCons = o.showConsensus || o.showConservation;
    let rowPx = 10 * s;
    if (ctx.slots.length) {
      const sl = ctx.slots[ctx.slots.length - 1];
      rowPx = Math.min(16 * s, Math.max(6 * s, out.alongPx(sl.lo, sl.hi, 0)));
    }
    const vMid = ctx.width / 2;
    const uMid = uPerPx(out, vMid);
    const fontSize = fieldLabelSize(ctx, 9) * s;
    const tick = 4 * s;
    const headerPx = o.ruler ? 3 * s + tick + 2 * s + fontSize * 3 : 0;
    const footerPx = (o.showConsensus ? 3 * s + rowPx : 0) + (o.showConservation ? 3 * s + 4 * rowPx : 0);
    const showHeader = o.ruler && headerPx * uMid <= gapU;
    const showFooter = needCons && (headerPx * (showHeader ? 1 : 0) + footerPx) * uMid <= gapU;
    // Direction away from the leaves at each end of the leaf set.
    const headDir = polar ? (ctx.uStart >= ctx.uEnd ? 1 : -1) : -1;
    const uHead = polar ? ctx.uStart : Math.min(ctx.uStart, ctx.uEnd);
    const footDir = -headDir;
    const uFoot = polar ? ctx.uEnd : Math.max(ctx.uStart, ctx.uEnd);

    let cons: Consensus | null = null;
    let consRow: [number, number] | null = null;
    if (showFooter) {
      cons = consensusOf(ctx.rows, o.field, w.s0, n, o.threshold, o.ignoreGaps);
      let off = 3 * s;
      if (o.showConsensus) {
        const a = uFoot + footDir * off * uMid, b = uFoot + footDir * (off + rowPx) * uMid;
        consRow = [Math.min(a, b), Math.max(a, b)];
        const rk = `${p.key}|${bin}`;
        let runs = cons.runs.get(rk);
        if (!runs) {
          runs = computeRuns(cons.chars, p, 0, n, null, bin);
          if (cons.runs.size >= 8) cons.runs.clear();
          cons.runs.set(rk, runs);
        }
        for (let k = firstRun(runs, cA); k < runs.length && runs[k] < cB; k += 3) out.fillCell(consRow[0], consRow[1], runs[k] * cw, runs[k + 1] * cw, p.colors[runs[k + 2]]);
        out.strokeCell(consRow[0], consRow[1], 0, ctx.width, "#888888", 0.5 * s);
        off += rowPx + 3 * s;
      }
      if (o.showConservation) {
        const gh = 4 * rowPx;
        const base = uFoot + footDir * (off + gh) * uMid; // baseline (far side); bars grow toward the leaves
        const pad = cw >= 4 ? 1 * s : 0;
        const stroke = cw >= 4;
        for (let c = Math.floor(cA / bin) * bin, cEnd = Math.min(n, cB); c < cEnd; c += bin) {
          // mean conservation over the bin (one bar per column when bin = 1)
          const c1 = Math.min(n, c + bin);
          let f = 0;
          for (let j = c; j < c1; j++) f += cons.cons[j];
          f /= c1 - c;
          if (!(f > 0)) continue;
          const top = base - footDir * f * gh * uMid;
          const col = o.colorGraph ? (f > 0.95 ? CONS_COLORS[0] : f > 0.3 ? CONS_COLORS[1] : CONS_COLORS[2]) : CONS_PLAIN;
          const a = Math.min(base, top), b = Math.max(base, top);
          out.fillCell(a, b, c * cw + pad, c1 * cw - pad, col);
          if (stroke) out.strokeCell(a, b, c * cw + pad, c1 * cw - pad, CONS_STROKE, 0.5 * s);
        }
        out.line(base, 0, base, ctx.width, "#666666", 0.75 * s);
      }
    }

    // ---- inverse gaps: white bar through each gap run ----
    if (o.inverse && anyGapRun) {
      out.flush();
      const barPx = 3 * s;
      for (const sl of ctx.slots) {
        if (out.alongPx(sl.lo, sl.hi, 0) < barPx + 2) continue;
        const len = visibleRuns(cache, entryOf(cache, sl.row?.[o.field]), cA, cB);
        if (!len) continue;
        const mid = (sl.lo + sl.hi) / 2;
        for (let k = 0; k < len; k += 3) {
          if (vis[k + 2] !== p.gap) continue;
          const v0 = vis[k] * cw + 2 * s, v1 = vis[k + 1] * cw - 2 * s;
          if (v1 <= v0) continue;
          const h = (barPx / 2) * uPerPx(out, (v0 + v1) / 2);
          out.fillCell(mid - h, mid + h, v0, v1, INVERSE_GAP_BAR);
        }
      }
    }

    // ---- reference box ----
    if (o.highlight === "reference" && o.markRef && o.reference) {
      for (const sl of ctx.slots) {
        if (sl.name !== o.reference && sl.row?.id !== o.reference) continue;
        out.strokeCell(sl.lo, sl.hi, 0, ctx.width, "#ff0000", 1.5 * s);
      }
    }

    // ---- ruler (before the first leaf) ----
    let headerExtent = 0;
    if (showHeader) {
      const g = 3 * s;
      const uR = uHead + headDir * g * uMid;
      out.line(uR, 0, uR, ctx.width, RULER_COLOR, 1 * s);
      const digits = String(w.end).length;
      const minPx = polar ? Math.max(fontSize * 1.5, 24 * s) : Math.max(digits * fontSize * 0.62 + 8 * s, 36 * s);
      const step = niceStep(cw, minPx);
      // Widest label = the largest tick position.
      const lastTick = Math.floor(w.end / step) * step;
      const maxW = lastTick >= w.start ? String(lastTick).length * fontSize * 0.62 : 0;
      // Ticks are culled to the visible columns, widened by a label's extent.
      const margin = maxW + fontSize + tick;
      const posLo = w.start + colFrom(vLo - margin), posHi = w.start + colTo(vHi + margin) - 1;
      const minor = step >= 5 && step % 5 === 0 ? step / 5 : step >= 2 ? step / 2 : 0;
      if (minor && minor * cw >= 3) {
        const first = Math.ceil(posLo / minor) * minor;
        for (let pos = first; pos <= posHi; pos += minor) {
          if (pos % step === 0) continue;
          const v = (pos - w.start + 0.5) * cw;
          out.line(uR, v, uR + headDir * tick * 0.5 * uPerPx(out, v), v, RULER_COLOR, 0.75 * s);
        }
      }
      out.flush();
      const labelSkip = o.label && !polar ? fontSize * 1.4 : -Infinity;
      const ticks: number[] = [];
      for (let pos = Math.ceil(posLo / step) * step; pos <= posHi; pos += step) {
        const v = (pos - w.start + 0.5) * cw;
        out.line(uR, v, uR + headDir * tick * uPerPx(out, v), v, RULER_COLOR, 1 * s);
        ticks.push(pos);
      }
      out.flush();
      if (fontSize >= 4) {
        for (const pos of ticks) {
          const v = (pos - w.start + 0.5) * cw;
          const txt = String(pos);
          const tw = txt.length * fontSize * 0.62;
          if (polar) {
            out.text(uR + headDir * (tick + 2 * s) * uPerPx(out, v), v, txt, { size: fontSize, color: RULER_COLOR, orient: "tangential", anchor: headDir > 0 ? "start" : "end" });
          } else {
            if (v - tw / 2 < labelSkip) continue;
            out.text(uR - (tick + 2 * s + fontSize * 0.6), v, txt, { size: fontSize, color: RULER_COLOR, orient: "radial", anchor: "middle" });
          }
        }
        headerExtent = g + tick + 2 * s + (polar ? maxW : fontSize * 1.2);
      }
    }

    // ---- ring label ----
    if (o.label && ring.label) {
      const size = fieldLabelSize(ctx) * s;
      if (polar) {
        const off = headerExtent + 4 * s;
        if ((off + ring.label.length * size * 0.6) * uMid <= gapU) {
          out.text(uHead + headDir * off * uMid, vMid, ring.label, { size, color: "#333333", orient: "tangential", anchor: headDir > 0 ? "start" : "end" });
        }
      } else {
        out.text(uHead - (o.ruler ? 5 * s : 4 * s), size * 0.6, ring.label, { size, color: "#333333", orient: "radial", rotate: -90, anchor: "start" });
      }
    }

    // ---- residue letters (level of detail) ----
    if (!o.letters || cw < 7) return;
    out.flush();
    // Count the visible letters first (visible columns only); more than the
    // budget → no letters for the whole ring rather than for the first slots only.
    // Row size grows linearly with v (constant in rect): first column where it reaches 9 px.
    const firstLetterCol = (a: number, b: number) => (a >= 9 ? 0 : Math.max(0, Math.floor((9 - a) / ((b - a) / ctx.width) / cw)));
    const cEnd = Math.min(n, cB);
    const letterRows: Array<{ seq: string; mid: number; a: number; slope: number; c0: number; c1: number }> = [];
    let count = 0;
    for (const sl of ctx.slots) {
      const e = entryOf(cache, sl.row?.[o.field]);
      if (!e.seq) continue;
      const c1 = Math.min(cEnd, e.seq.length - w.s0);
      if (c1 <= cA) continue;
      const a = out.alongPx(sl.lo, sl.hi, 0), b = out.alongPx(sl.lo, sl.hi, ctx.width);
      if (Math.max(a, b) < 9) continue;
      const c0 = Math.max(cA, firstLetterCol(a, b));
      if (c1 <= c0) continue;
      count += c1 - c0;
      if (count > LETTER_BUDGET) return;
      letterRows.push({ seq: e.seq, mid: (sl.lo + sl.hi) / 2, a, slope: (b - a) / ctx.width, c0, c1 });
    }
    let consC0 = cEnd;
    if (cons && consRow) {
      const a = out.alongPx(consRow[0], consRow[1], 0), b = out.alongPx(consRow[0], consRow[1], ctx.width);
      if (Math.max(a, b) >= 9) consC0 = Math.max(cA, firstLetterCol(a, b));
      count += Math.max(0, cEnd - consC0);
      if (count > LETTER_BUDGET) return;
    }
    const letterSize = (slotPx: number) => Math.min(slotPx * 0.8, cw * 1.05);
    for (const r of letterRows) {
      for (let c = r.c0; c < r.c1; c++) {
        const v = (c + 0.5) * cw;
        const slotPx = r.a + r.slope * v;
        if (slotPx < 9) continue;
        const L = letterOf(r.seq.charCodeAt(w.s0 + c), c, p, hl, o.inverse);
        if (!L) continue;
        out.text(r.mid, v, L.ch, { size: letterSize(slotPx), color: L.color, orient: "radial", anchor: "middle" });
      }
    }
    // consensus letters
    if (cons && consRow) {
      const mid = (consRow[0] + consRow[1]) / 2;
      for (let c = consC0; c < cEnd; c++) {
        const v = (c + 0.5) * cw;
        const rpx = out.alongPx(consRow[0], consRow[1], v);
        if (rpx < 9) continue;
        const code = cons.chars.charCodeAt(c);
        const idx = cellIndex(code, c, p, null);
        out.text(mid, v, cons.chars[c], { size: letterSize(rpx), color: idx >= 0 ? p.text[idx] : "#222222", orient: "radial", anchor: "middle" });
      }
    }
  },

  legend(ring, _info) {
    const o = readOpts(ring);
    const sid = `track:${ring.key}`;
    const eid = (name: string) => `${sid}\x00${name}`;
    const sections: LegendSection[] = [];
    if (o.scheme === "mono") return sections;
    const sc = SCHEMES[o.scheme];
    if (!sc?.legend) return sections;
    const gapEntry: LegendEntry | null = o.inverse
      ? { id: eid("Gap"), label: "Gap", color: INVERSE_GAP_FILL, fillAlpha: 1 }
      : o.gapColor ? { id: eid("Gap"), label: "Gap", color: o.gapColor, fillAlpha: 1 } : null;
    if (sc.legend.kind === "groups") {
      const entries: LegendEntry[] = sc.legend.groups.map(g => ({ id: eid(g.label), label: g.label, color: g.color, fillAlpha: 1 }));
      if (gapEntry) entries.push(gapEntry);
      sections.push({ id: sid, title: ring.label, note: sc.label, kind: "swatches", entries, more: 0 });
    } else {
      const lg = sc.legend;
      const stops: GradientStop[] = [{ color: lg.lo, opacity: 1 }, { color: lg.hi, opacity: 1 }];
      sections.push({ id: sid, title: ring.label, note: lg.note, kind: "ramp", min: lg.min, max: lg.max, style: "gradient", color: lg.hi, stops });
      if (gapEntry) sections.push({ id: `${sid}:gaps`, title: "", kind: "swatches", entries: [gapEntry], more: 0 });
    }
    if (o.showConservation && o.colorGraph) {
      const csid = `${sid}:conservation`;
      sections.push({
        id: csid, title: "Conservation", kind: "swatches", more: 0,
        entries: [
          { id: `${sid}\x00cons>95`, label: "> 95 %", color: CONS_COLORS[0], fillAlpha: 1 },
          { id: `${sid}\x00cons>30`, label: "30–95 %", color: CONS_COLORS[1], fillAlpha: 1 },
          { id: `${sid}\x00cons<=30`, label: "≤ 30 %", color: CONS_COLORS[2], fillAlpha: 1 },
        ],
      });
    }
    return sections;
  },

  tooltip(ring, row, info) {
    const field = ring.fields?.[0];
    const name = ring.label || (field ? info.columnLabel(field) : "Alignment");
    const seq = field ? normSeq(row?.[field]) : null;
    if (!seq) return [`${name}: N/A`];
    let res = "";
    let count = 0;
    for (let i = 0; i < seq.length; i++) {
      if (isGap(seq.charCodeAt(i))) continue;
      count++;
      if (res.length < 40) res += seq[i];
    }
    return [
      `${name}: ${count} residues (aligned length ${seq.length})`,
      count ? `${res}${count > 40 ? "…" : ""}` : "(gaps only)",
    ];
  },
};

export default alignment;
