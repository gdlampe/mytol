import * as d3 from "d3";
import type { AnnotationRow } from "./types";

// ============================================================
// Annotation file parsing (CSV / TSV, chosen by extension).
//
// Three layouts are recognised:
//  1. Wide table (the usual): an 'id' or 'name' column + one column per
//     annotation, one row per leaf. A row id "A|B" refers to the clade of A
//     and B (their last common ancestor) — used by node decorations.
//  2. Long domain table (e.g. InterProScan / hmmscan output): repeated ids
//     with start + end columns, one row per domain. Converted to one row per
//     leaf with a "<file> domains" column ("name:start-end[:#colour]" items
//     joined by ";") and, if present, a "<file> length" column.
//  3. Connections: no id column but source + target columns (also from/to,
//     node1/node2, leaf1/leaf2), one row per connection between leaves/clades.
//  4. Colour key: column + value + color columns (no id column). Colours for
//     the categories of a column; for a numeric column, value "(color)" sets
//     the bar / field colour and "(low)" "(mid)" "(high)" a gradient.
// ============================================================

export type Connection = {
  source: string;
  target: string;
  /** Line width in px (from a width column). */
  width?: number;
  /** Relative weight (from a weight column); drawn scaled to the file's range. */
  weight?: number;
  color?: string;
  dashed?: boolean;
  label?: string;
};

export type ColorKeyEntry = { column: string; value: string; color: string };

export type ParsedAnnotationFile =
  | { kind: "table"; rows: AnnotationRow[]; columns: string[]; note?: string }
  | { kind: "connections"; connections: Connection[] }
  | { kind: "colors"; entries: ColorKeyEntry[]; skipped: number };

/** Hex (#rgb, #rrggbb, #rrggbbaa) or rgb()/rgba() → lowercase hex, else null. */
export function normalizeColor(s: string): string | null {
  const t = s.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t);
  if (m) {
    const h = m[1].toLowerCase();
    return "#" + (h.length === 3 ? [...h].map(c => c + c).join("") : h);
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  if (!m) return null;
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const a = m[4] !== undefined ? Number(m[4]) : 1;
  return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}${a < 1 ? hex(a * 255) : ""}`;
}

const lc = (s: string) => s.trim().toLowerCase();
const findCol = (cols: string[], names: string[]) => cols.find(c => names.includes(lc(c)));

/**
 * Colours for one ring (its Style panel → Load colours…). Accepts a colour key
 * (column / value / color header), a value / color header, or plain rows such
 * as "UG9<tab>#f04f27": the colour is the cell that parses as one, the value
 * the last other non-empty cell (so iTOL strip rows "id colour label" give the
 * label). Rows without a colour are skipped. column is "" when not given.
 */
export function parseColorList(text: string): { entries: ColorKeyEntry[]; skipped: number } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(l => l.trim() !== "" && !l.startsWith("#!"));
  const sep = (l: string) => (l.includes("\t") ? l.split("\t") : l.includes(",") && !/rgba?\(/i.test(l) ? l.split(",") : l.trim().split(/\s+/)).map(c => c.trim());
  const entries: ColorKeyEntry[] = [];
  let skipped = 0;
  if (!lines.length) return { entries, skipped };
  const head = sep(lines[0]).map(c => c.toLowerCase());
  const ci = head.findIndex(h => h === "color" || h === "colour");
  const vi = head.indexOf("value");
  const ki = head.indexOf("column");
  if (ci >= 0 && vi >= 0) {
    for (const l of lines.slice(1)) {
      const cells = sep(l);
      const color = normalizeColor(cells[ci] ?? "");
      if (color) entries.push({ column: ki >= 0 ? cells[ki] ?? "" : "", value: cells[vi] ?? "", color });
      else skipped++;
    }
    return { entries, skipped };
  }
  for (const l of lines) {
    const cells = sep(l).filter(c => c !== "");
    const ci2 = cells.findIndex(c => normalizeColor(c));
    const rest = cells.filter((_, i) => i !== ci2);
    if (ci2 < 0 || !rest.length) { skipped++; continue; }
    entries.push({ column: "", value: rest[rest.length - 1], color: normalizeColor(cells[ci2])! });
  }
  return { entries, skipped };
}

export async function parseAnnotationFile(file: File): Promise<ParsedAnnotationFile> {
  const text = await file.text();
  return parseAnnotationText(text, file.name);
}

export function parseAnnotationText(text: string, fileName: string): ParsedAnnotationFile {
  const isTsv = /\.(tsv|tab|txt)$/i.test(fileName) || (!/\.csv$/i.test(fileName) && text.split("\n", 1)[0].includes("\t"));
  const parsed = isTsv ? d3.tsvParse(text) : d3.csvParse(text);
  const cols = parsed.columns;

  // Colour key: column / value / color, and no id column.
  const keyCol = findCol(cols, ["column"]), valCol = findCol(cols, ["value"]), colorCol = findCol(cols, ["color", "colour"]);
  if (keyCol && valCol && colorCol && !findCol(cols, ["id", "name"])) {
    const entries: ColorKeyEntry[] = [];
    let skipped = 0;
    for (const r of parsed) {
      const column = (r[keyCol] ?? "").trim(), value = (r[valCol] ?? "").trim();
      const color = normalizeColor(r[colorCol] ?? "");
      if (column && color) entries.push({ column, value, color });
      else if (column || value) skipped++;
    }
    return { kind: "colors", entries, skipped };
  }

  // Connections: explicit source + target columns win, even if the file also has an id/name column.
  const src = findCol(cols, ["source", "node1", "leaf1", "id1"]) ?? findCol(cols, ["from"]);
  const tgt = findCol(cols, ["target", "node2", "leaf2", "id2"]) ?? findCol(cols, ["to"]);
  const idCol = findCol(cols, ["id", "name"]);
  if (src && tgt && (!idCol || findCol(cols, ["source", "target", "node1", "node2", "leaf1", "leaf2"]))) {
    return { kind: "connections", connections: parseConnections(parsed, src, tgt) };
  }
  if (!idCol) {
    if (src && tgt) return { kind: "connections", connections: parseConnections(parsed, src, tgt) };
    throw new Error(
      `Annotation file needs an 'id' or 'name' column, or 'source' and 'target' columns for connections (found: ${cols.join(", ")})`
    );
  }

  // Long domain table: repeated ids + numeric start/end, and nothing else but
  // domain-describing columns (or an explicit domain-name column). Otherwise
  // it is an ordinary wide table that happens to have start/end columns.
  const startCol = findCol(cols, ["start", "begin", "env_from", "ali_from", "start_location", "domain_start"]);
  const endCol = findCol(cols, ["end", "stop", "env_to", "ali_to", "stop_location", "domain_end"]);
  if (startCol && endCol && looksLikeDomainTable(parsed, cols, idCol, startCol, endCol)) {
    return longDomainTable(parsed, cols, idCol, startCol, endCol, fileName);
  }

  const rows = parsed.map((r) => {
    const row: AnnotationRow = { id: (r[idCol] ?? "").toString() };
    for (const col of cols) if (col !== idCol) row[col] = r[col];
    return row;
  });
  return { kind: "table", rows, columns: cols.filter((c) => c !== idCol) };
}

const DOMAIN_NAME_COLS = ["domain", "domain_name", "domain name", "signature", "signature_description", "hmm", "hmm_name", "target", "target_name", "pfam", "family", "label", "description", "accession", "signature_accession"];
const DOMAIN_EXTRA_COLS = ["color", "colour", "shape", "length", "len", "protein_length", "seq_len", "sequence_length", "qlen", "size",
  "evalue", "e-value", "e_value", "score", "bitscore", "bit_score", "ievalue", "cevalue", "status", "date", "analysis", "md5", "interpro", "interpro_accession", "interpro_description", "go", "pathways", "acc", "query", "qstart", "qend"];

function looksLikeDomainTable(parsed: d3.DSVRowArray<string>, cols: string[], idCol: string, startCol: string, endCol: string): boolean {
  // (a) a domain-name column, or only domain-describing columns besides id/start/end
  const hasName = !!findCol(cols, DOMAIN_NAME_COLS);
  const known = new Set([lc(idCol), lc(startCol), lc(endCol), ...DOMAIN_NAME_COLS, ...DOMAIN_EXTRA_COLS]);
  const onlyDomainCols = cols.every(c => known.has(lc(c)));
  if (!hasName && !onlyDomainCols) return false;
  // (b) mostly numeric coordinates, and (c) a meaningful share of repeated (non-empty) ids
  let rows = 0, numeric = 0, repeated = 0;
  const seen = new Set<string>();
  for (const r of parsed) {
    const id = (r[idCol] ?? "").toString().trim();
    if (!id) continue;
    rows++;
    if (Number.isFinite(Number(r[startCol])) && Number.isFinite(Number(r[endCol])) && String(r[startCol]).trim() !== "") numeric++;
    if (seen.has(id)) repeated++; else seen.add(id);
  }
  return rows > 0 && numeric >= 0.9 * rows && repeated >= Math.max(1, 0.1 * rows);
}

function longDomainTable(
  parsed: d3.DSVRowArray<string>, cols: string[], idCol: string, startCol: string, endCol: string, fileName: string
): ParsedAnnotationFile {
  const nameCol = findCol(cols, DOMAIN_NAME_COLS);
  const colorCol = findCol(cols, ["color", "colour"]);
  const shapeCol = findCol(cols, ["shape"]);
  const lenCol = findCol(cols, ["length", "len", "protein_length", "seq_len", "sequence_length", "qlen", "size"]);
  const stem = fileName.replace(/\.[^.]+$/, "");
  const domCol = `${stem} domains`;
  const lengthCol = `${stem} length`;

  const items = new Map<string, string[]>();
  const lengths = new Map<string, number>();
  for (const r of parsed) {
    const id = (r[idCol] ?? "").toString();
    const s = Number(r[startCol]), e = Number(r[endCol]);
    if (!id || !Number.isFinite(s) || !Number.isFinite(e)) continue;
    // Separators of the domain cell format can't appear in names.
    const name = (nameCol ? (r[nameCol] ?? "") : "domain").toString().replace(/[;:|,()]/g, " ").replace(/\s+/g, " ").trim() || "domain";
    let item = `${name}:${Math.min(s, e)}-${Math.max(s, e)}`;
    const shape = shapeCol ? (r[shapeCol] ?? "").toString().trim().toUpperCase() : "";
    if (/^(RE|HH|HV|EL|DI|TR|TL|PL|PR|PU|PD|OC|GP)$/.test(shape)) item += `:${shape}`;
    const color = colorCol ? (r[colorCol] ?? "").toString().trim() : "";
    if (/^#[0-9a-f]{3,8}$/i.test(color)) item += `:${color}`;
    if (!items.has(id)) items.set(id, []);
    items.get(id)!.push(item);
    const len = lenCol ? Number(r[lenCol]) : NaN;
    lengths.set(id, Math.max(lengths.get(id) ?? 0, Number.isFinite(len) ? len : 0, Math.max(s, e)));
  }
  const rows: AnnotationRow[] = [];
  for (const [id, list] of items) {
    const row: AnnotationRow = { id, [domCol]: list.join(";") };
    if (lenCol) row[lengthCol] = String(lengths.get(id) ?? "");
    rows.push(row);
  }
  let converted = 0;
  for (const list of items.values()) converted += list.length;
  return {
    kind: "table",
    rows,
    columns: lenCol ? [domCol, lengthCol] : [domCol],
    note: `Read as a domain table: ${converted} domains for ${rows.length} leaves`,
  };
}

function parseConnections(parsed: d3.DSVRowArray<string>, src: string, tgt: string): Connection[] {
  const cols = parsed.columns;
  const widthCol = findCol(cols, ["width", "line_width"]);
  const weightCol = findCol(cols, ["weight", "value", "score"]);
  const colorCol = findCol(cols, ["color", "colour"]);
  const styleCol = findCol(cols, ["style", "dashed", "line_style"]);
  const labelCol = findCol(cols, ["label", "name", "type", "id"]);
  const out: Connection[] = [];
  for (const r of parsed) {
    const source = (r[src] ?? "").toString().trim(), target = (r[tgt] ?? "").toString().trim();
    if (!source || !target) continue;
    const w = widthCol ? Number(r[widthCol]) : NaN;
    const wt = weightCol ? Number(r[weightCol]) : NaN;
    const style = styleCol ? lc(r[styleCol] ?? "") : "";
    out.push({
      source, target,
      width: Number.isFinite(w) && w > 0 ? w : undefined,
      weight: Number.isFinite(wt) ? wt : undefined,
      color: colorCol ? (r[colorCol] ?? "").toString().trim() || undefined : undefined,
      dashed: style === "dashed" || style === "1" || style === "true" || style === "yes",
      label: labelCol ? (r[labelCol] ?? "").toString() || undefined : undefined,
    });
  }
  return out;
}

/** Backwards-compatible wrapper: wide tables only. */
export async function parseAnnotations(file: File): Promise<{ rows: AnnotationRow[]; columns: string[] }> {
  const p = await parseAnnotationFile(file);
  if (p.kind !== "table") throw new Error(`${file.name} is a ${p.kind === "colors" ? "colour key" : "connections"} file, not an annotation table`);
  return { rows: p.rows, columns: p.columns };
}
