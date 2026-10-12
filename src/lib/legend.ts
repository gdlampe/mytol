import { hexToRgb } from "./colorUtils";
import { shapePoints } from "./rings/band";
import type { ShapeKind } from "./rings/band";

// ============================================================
// On-canvas legend
// One layout pass produces drawing primitives (in legend-local px) plus hit
// regions; the same primitives are rendered to the canvas and to SVG export,
// so what you see on screen is what gets exported.
// ============================================================

/** What clicking a swatch edits. */
export type LegendEditTarget =
  | { type: "category"; trackKey: string; category: string }
  | { type: "ranges"; indices: number[] }
  | { type: "support"; slot: "low" | "mid" | "high" };

export type LegendEntry = {
  id: string;
  label: string;
  color: string;
  /** Swatch fill opacity (coloured ranges are translucent in background mode). */
  fillAlpha: number;
  /** Draw the swatch as a small gradient (shaded categories: low → category colour). */
  stops?: GradientStop[];
  /** Draw the swatch as this shape instead of a square. */
  shape?: ShapeKind;
  /** Shape outline only (e.g. "absent" in binary rings). */
  hollow?: boolean;
  edit?: LegendEditTarget;
};

export type GradientStop = { color: string; opacity: number };

/** note: optional small line under the section title (e.g. scale details). */
export type LegendSection =
  | { id: string; title: string; note?: string; kind: "swatches"; entries: LegendEntry[]; more: number }
  | { id: string; title: string; note?: string; kind: "ramp"; min: string; max: string; style: "bar" | "gradient"; color: string; stops?: GradientStop[]; ticks?: Array<{ t: number; label: string }> }
  | { id: string; title: string; note?: string; kind: "gradient"; stops: GradientStop[]; labels: [string, string, string]; edits?: LegendEditTarget[] };

export type LegendModel = { title: string; sections: LegendSection[] };

export type LegendPrim =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill: string; fillOpacity?: number; stroke?: string; strokeOpacity?: number }
  | { t: "text"; x: number; y: number; text: string; size: number; fill: string; bold?: boolean; italic?: boolean; anchor?: "start" | "middle" | "end" }
  | { t: "wedge"; x: number; y: number; w: number; h: number; fill: string }
  | { t: "lgrad"; x: number; y: number; w: number; h: number; stops: GradientStop[] }
  | { t: "shape"; kind: ShapeKind; x: number; y: number; size: number; fill: string; hollow?: boolean };

export type LegendHit = {
  kind: "title" | "section" | "entry" | "swatch";
  /** "title", a section id, or an entry id */
  id: string;
  x: number; y: number; w: number; h: number;
  /** Current text, for inline renaming */
  text?: string;
  edit?: LegendEditTarget;
};

export type LegendLayout = { w: number; h: number; prims: LegendPrim[]; hits: LegendHit[] };

export type LegendStyle = { fontSize: number; columns: number; box: boolean; background: string };

export type MeasureText = (text: string, size: number, bold: boolean) => number;

const TEXT = "#222";
const MUTED = "#777";

export function legendFont(size: number, bold?: boolean, italic?: boolean): string {
  return `${italic ? "italic " : ""}${bold ? "bold " : ""}${size}px sans-serif`;
}

export function layoutLegend(model: LegendModel, style: LegendStyle, measure: MeasureText): LegendLayout {
  const fs = style.fontSize;
  const pad = Math.round(fs * 0.8);
  const rowH = Math.round(fs * 1.5);
  const sw = Math.round(fs * 0.95);
  const gap = Math.round(fs * 0.5);
  const colGap = Math.round(fs * 1.2);
  const sectionGap = Math.round(fs * 0.6);
  const titleFs = Math.round(fs * 1.15);
  const barH = Math.round(fs * 0.9);

  const prims: LegendPrim[] = [];
  const hits: LegendHit[] = [];
  let y = pad;
  let w = 0;

  if (model.title) {
    const tw = measure(model.title, titleFs, true);
    const th = Math.round(titleFs * 1.5);
    prims.push({ t: "text", x: pad, y: y + th / 2, text: model.title, size: titleFs, bold: true, fill: TEXT });
    hits.push({ kind: "title", id: "title", x: pad, y, w: tw, h: th, text: model.title });
    w = Math.max(w, tw);
    y += th;
  }

  model.sections.forEach((s, si) => {
    if (si > 0) y += sectionGap;
    if (s.title) {
      const tw = measure(s.title, fs, true);
      prims.push({ t: "text", x: pad, y: y + rowH / 2, text: s.title, size: fs, bold: true, fill: TEXT });
      hits.push({ kind: "section", id: s.id, x: pad, y, w: tw, h: rowH, text: s.title });
      w = Math.max(w, tw);
      y += rowH;
    }
    if (s.note) {
      const nfs = Math.round(fs * 0.85);
      prims.push({ t: "text", x: pad, y: y + nfs * 0.6, text: s.note, size: nfs, fill: MUTED, italic: true });
      w = Math.max(w, measure(s.note, nfs, false));
      y += Math.round(nfs * 1.4);
    }

    if (s.kind === "swatches") {
      const n = s.entries.length + (s.more > 0 ? 1 : 0);
      // Gradient swatches (shaded categories) are drawn twice as wide.
      const swW = s.entries.some(e => e.stops) ? sw * 2 : sw;
      const perCol = Math.ceil(n / Math.max(1, Math.min(style.columns, n)));
      const cols = Math.ceil(n / perCol); // columns actually filled
      let x = pad;
      for (let c = 0; c < cols; c++) {
        let colW = 0;
        const labelHits: LegendHit[] = [];
        for (let r = 0; r < perCol; r++) {
          const i = c * perCol + r;
          if (i >= n) break;
          const ey = y + r * rowH;
          if (i < s.entries.length) {
            const e = s.entries[i];
            if (e.stops) {
              prims.push({ t: "lgrad", x, y: ey + (rowH - sw) / 2, w: swW, h: sw, stops: e.stops });
            } else if (e.shape) {
              prims.push({ t: "shape", kind: e.shape, x: x + sw / 2, y: ey + rowH / 2, size: sw, fill: e.color, hollow: e.hollow });
            } else {
              prims.push({
                t: "rect", x, y: ey + (rowH - sw) / 2, w: sw, h: sw,
                fill: e.color, fillOpacity: e.fillAlpha,
                stroke: e.fillAlpha < 1 ? e.color : "#000", strokeOpacity: e.fillAlpha < 1 ? 1 : 0.35,
              });
            }
            hits.push({ kind: "swatch", id: e.id, x, y: ey, w: swW, h: rowH, edit: e.edit });
            const tw = measure(e.label, fs, false);
            prims.push({ t: "text", x: x + swW + gap, y: ey + rowH / 2, text: e.label, size: fs, fill: TEXT });
            const hit: LegendHit = { kind: "entry", id: e.id, x: x + swW + gap, y: ey, w: tw, h: rowH, text: e.label, edit: e.edit };
            hits.push(hit);
            labelHits.push(hit);
            colW = Math.max(colW, swW + gap + tw);
          } else {
            const txt = `… ${s.more} more`;
            prims.push({ t: "text", x, y: ey + rowH / 2, text: txt, size: fs, fill: MUTED, italic: true });
            colW = Math.max(colW, measure(txt, fs, false));
          }
        }
        // Label hit areas span the whole column so short labels are easy to target.
        for (const h of labelHits) h.w = Math.max(h.w, colW - swW - gap);
        x += colW + (c < cols - 1 ? colGap : 0);
      }
      w = Math.max(w, x - pad);
      y += perCol * rowH;
    } else if (s.kind === "ramp" && s.ticks) {
      // Log scale: bar on its own row, tick marks + labels (min, powers of the base, max) below.
      const barW = fs * 9;
      const by = y + (rowH - barH) / 2;
      if (s.style === "bar") prims.push({ t: "wedge", x: pad, y: by, w: barW, h: barH, fill: s.color });
      else prims.push({ t: "lgrad", x: pad, y: by, w: barW, h: barH, stops: s.stops ?? [{ color: s.color, opacity: 1 }] });
      y += rowH;
      const lfs = Math.round(fs * 0.85);
      const cands = [
        { t: 0, label: s.min }, { t: 1, label: s.max },
        ...s.ticks.filter(k => k.t > 0.02 && k.t < 0.98),
      ];
      // Endpoints first, then interior ticks that don't collide with placed labels.
      const placed: Array<{ x0: number; x1: number }> = [];
      for (const c of cands) {
        const lw = measure(c.label, lfs, false);
        const cx = pad + c.t * barW;
        const anchor = c.t <= 0.02 ? "start" : c.t >= 0.98 ? "end" : "middle";
        const x0 = anchor === "start" ? cx : anchor === "end" ? cx - lw : cx - lw / 2;
        if (placed.some(p => x0 < p.x1 + gap && x0 + lw > p.x0 - gap)) continue;
        placed.push({ x0, x1: x0 + lw });
        prims.push({ t: "rect", x: cx - 0.5, y: by + barH, w: 1, h: Math.round(fs * 0.3), fill: MUTED });
        prims.push({ t: "text", x: cx, y: y + lfs * 0.6, text: c.label, size: lfs, fill: MUTED, anchor });
      }
      y += Math.round(lfs * 1.3);
      w = Math.max(w, barW);
    } else if (s.kind === "ramp") {
      const barW = fs * 6;
      const minW = measure(s.min, fs, false);
      const by = y + (rowH - barH) / 2;
      prims.push({ t: "text", x: pad, y: y + rowH / 2, text: s.min, size: fs, fill: TEXT });
      const bx = pad + minW + gap;
      if (s.style === "bar") prims.push({ t: "wedge", x: bx, y: by, w: barW, h: barH, fill: s.color });
      else prims.push({ t: "lgrad", x: bx, y: by, w: barW, h: barH, stops: s.stops ?? [{ color: s.color, opacity: 1 }] });
      const mx = bx + barW + gap;
      prims.push({ t: "text", x: mx, y: y + rowH / 2, text: s.max, size: fs, fill: TEXT });
      w = Math.max(w, mx - pad + measure(s.max, fs, false));
      y += rowH;
    } else {
      const barW = fs * 8;
      prims.push({ t: "lgrad", x: pad, y: y + (rowH - barH) / 2, w: barW, h: barH, stops: s.stops });
      const third = barW / 3;
      (s.edits ?? []).forEach((edit, i) => hits.push({ kind: "swatch", id: `${s.id}:${i}`, x: pad + i * third, y, w: third, h: rowH, edit }));
      y += rowH;
      const lfs = Math.round(fs * 0.9);
      const anchors = ["start", "middle", "end"] as const;
      s.labels.forEach((lbl, i) => prims.push({ t: "text", x: pad + (barW / 2) * i, y: y + lfs * 0.6, text: lbl, size: lfs, fill: MUTED, anchor: anchors[i] }));
      y += Math.round(lfs * 1.3);
      w = Math.max(w, barW);
    }
  });

  for (const h of hits) if (h.kind === "title" || h.kind === "section") h.w = Math.max(h.w, w);
  const W = Math.ceil(w + pad * 2);
  const H = Math.ceil(y + pad);
  if (style.box) prims.unshift({ t: "rect", x: 0, y: 0, w: W, h: H, fill: style.background, fillOpacity: 0.92, stroke: "#000", strokeOpacity: 0.25 });
  return { w: W, h: H, prims, hits };
}

function rgba(color: string, opacity: number): string {
  if (opacity >= 1) return color;
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function drawLegend(ctx: CanvasRenderingContext2D, L: LegendLayout, ox: number, oy: number): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  for (const p of L.prims) {
    if (p.t === "rect") {
      ctx.globalAlpha = p.fillOpacity ?? 1;
      ctx.fillStyle = p.fill;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      if (p.stroke) {
        ctx.globalAlpha = p.strokeOpacity ?? 1;
        ctx.strokeStyle = p.stroke;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      }
      ctx.globalAlpha = 1;
    } else if (p.t === "text") {
      ctx.font = legendFont(p.size, p.bold, p.italic);
      ctx.fillStyle = p.fill;
      ctx.textAlign = p.anchor === "middle" ? "center" : p.anchor === "end" ? "right" : "left";
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.t === "shape") {
      const pts = shapePoints(p.kind);
      ctx.beginPath();
      if (pts === "circle") ctx.arc(p.x, p.y, p.size / 2, 0, 2 * Math.PI);
      else pts.forEach(([a, b], i) => (i ? ctx.lineTo(p.x + a * p.size, p.y + b * p.size) : ctx.moveTo(p.x + a * p.size, p.y + b * p.size)));
      ctx.closePath();
      if (p.hollow) { ctx.strokeStyle = p.fill; ctx.lineWidth = 1.5; ctx.stroke(); }
      else { ctx.fillStyle = p.fill; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 0.5; ctx.stroke(); }
    } else if (p.t === "wedge") {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + p.h);
      ctx.lineTo(p.x + p.w, p.y);
      ctx.lineTo(p.x + p.w, p.y + p.h);
      ctx.closePath();
      ctx.fillStyle = p.fill;
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
      p.stops.forEach((s, i) => g.addColorStop(p.stops.length > 1 ? i / (p.stops.length - 1) : 0, rgba(s.color, s.opacity)));
      ctx.fillStyle = g;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    }
  }
  ctx.restore();
}

/** SVG elements for the legend. Colours and opacities are kept as separate attributes (no rgba) for Illustrator. */
export function legendToSvg(L: LegendLayout, ox: number, oy: number): string[] {
  const f = (n: number) => n.toFixed(2);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const out: string[] = [`<g id="legend" transform="translate(${f(ox)},${f(oy)})" font-family="sans-serif">`];
  let gradId = 0;
  for (const p of L.prims) {
    if (p.t === "rect") {
      const fo = p.fillOpacity !== undefined && p.fillOpacity < 1 ? ` fill-opacity="${p.fillOpacity}"` : "";
      const st = p.stroke
        ? ` stroke="${p.stroke}" stroke-width="1"${p.strokeOpacity !== undefined && p.strokeOpacity < 1 ? ` stroke-opacity="${p.strokeOpacity}"` : ""}`
        : "";
      // Stroked rects are inset half a pixel (stroke centred on the edge); plain fills are exact.
      const ins = p.stroke ? 0.5 : 0;
      out.push(`<rect x="${f(p.x + ins)}" y="${f(p.y + ins)}" width="${f(p.w - 2 * ins)}" height="${f(p.h - 2 * ins)}" fill="${p.fill}"${fo}${st}/>`);
    } else if (p.t === "text") {
      const attrs = [
        `x="${f(p.x)}"`, `y="${f(p.y)}"`, `font-size="${p.size}"`, `fill="${p.fill}"`, `dominant-baseline="central"`,
        p.bold ? `font-weight="bold"` : "", p.italic ? `font-style="italic"` : "",
        p.anchor && p.anchor !== "start" ? `text-anchor="${p.anchor}"` : "",
      ].filter(Boolean).join(" ");
      out.push(`<text ${attrs}>${esc(p.text)}</text>`);
    } else if (p.t === "shape") {
      const pts = shapePoints(p.kind);
      const d = pts === "circle"
        ? `M ${f(p.x - p.size / 2)},${f(p.y)} A ${f(p.size / 2)},${f(p.size / 2)} 0 1,0 ${f(p.x + p.size / 2)},${f(p.y)} A ${f(p.size / 2)},${f(p.size / 2)} 0 1,0 ${f(p.x - p.size / 2)},${f(p.y)} Z`
        : `M ${pts.map(([a, b]) => `${f(p.x + a * p.size)},${f(p.y + b * p.size)}`).join(" L ")} Z`;
      out.push(p.hollow
        ? `<path fill="none" stroke="${p.fill}" stroke-width="1.5" d="${d}"/>`
        : `<path fill="${p.fill}" stroke="#000" stroke-opacity="0.35" stroke-width="0.5" d="${d}"/>`);
    } else if (p.t === "wedge") {
      out.push(`<path fill="${p.fill}" d="M ${f(p.x)},${f(p.y + p.h)} L ${f(p.x + p.w)},${f(p.y)} L ${f(p.x + p.w)},${f(p.y + p.h)} Z"/>`);
    } else {
      const id = `legend-grad-${gradId++}`;
      const stops = p.stops.map((s, i) =>
        `<stop offset="${p.stops.length > 1 ? i / (p.stops.length - 1) : 0}" stop-color="${s.color}"${s.opacity < 1 ? ` stop-opacity="${s.opacity}"` : ""}/>`
      ).join("");
      out.push(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>`);
      out.push(`<rect x="${f(p.x + 0.5)}" y="${f(p.y + 0.5)}" width="${f(p.w - 1)}" height="${f(p.h - 1)}" fill="url(#${id})" stroke="#000" stroke-width="1" stroke-opacity="0.25"/>`);
    }
  }
  out.push("</g>");
  return out;
}
