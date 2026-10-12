// ============================================================
// Ring ("band") drawing.
//
// Every annotation ring is drawn in band coordinates:
//   u — position ALONG the leaves: screen y (px) in the rectangular layout,
//       an angle (radians) in the circular/unrooted layouts.
//   v — depth ACROSS the ring in screen px, 0 = the ring's inner edge.
// A BandOut maps those to the screen for one layout and one backend
// (canvas or SVG), so each ring type is written once and works everywhere.
// Fills and strokes are batched by colour; call flush() between layers
// when draw order matters.
// ============================================================

export type BandGeom =
  /** u = screen y; v → x = x0 + v */
  | { kind: "rect"; x0: number }
  /** u = angle (rad); v → radius r0 + v around (cx, cy) */
  | { kind: "polar"; cx: number; cy: number; r0: number };

export type ShapeKind =
  | "square" | "circle" | "star" | "triangle-right" | "triangle-left" | "check"
  | "diamond" | "hexagon" | "octagon" | "triangle-up" | "triangle-down" | "plus" | "cross";

/** iTOL domain shapes (protein domains). */
export type DomainShape =
  | "RE" | "HH" | "HV" | "EL" | "DI" | "TR" | "TL" | "PL" | "PR" | "PU" | "PD" | "OC" | "GP";

export type TextOpts = {
  size: number;
  color: string;
  /** Anchor along the text direction. */
  anchor?: "start" | "middle" | "end";
  /** "radial": text runs outward (+v), like leaf labels. "tangential": text runs along u. */
  orient?: "radial" | "tangential";
  bold?: boolean;
  italic?: boolean;
  /** Extra rotation in degrees (applied after orientation). */
  rotate?: number;
};

export interface BandOut {
  readonly geom: BandGeom;
  /** Screen point for band coordinates. */
  xy(u: number, v: number): [number, number];
  /** Outward unit vector at u (rect: +x; polar: radial). */
  outward(u: number): [number, number];
  /** Screen length of the along-span [u0, u1] at depth v. */
  alongPx(u0: number, u1: number, v: number): number;

  fillCell(u0: number, u1: number, v0: number, v1: number, fill: string): void;
  strokeCell(u0: number, u1: number, v0: number, v1: number, stroke: string, width: number): void;
  /** Straight screen segment between two band points. */
  line(u0: number, v0: number, u1: number, v1: number, stroke: string, width: number, dash?: number[]): void;
  /** Line along u at depth v (vertical in rect, an arc in polar). */
  alongLine(u0: number, u1: number, v: number, stroke: string, width: number, dash?: number[]): void;
  /** Open polyline through band points (straight screen segments). */
  polyline(pts: Array<[number, number]>, stroke: string, width: number, dash?: number[]): void;
  /** Filled/stroked polygon through band points. */
  polygon(pts: Array<[number, number]>, fill: string | null, stroke?: string | null, width?: number): void;
  /**
   * Polygon in a local screen frame anchored at band point (u, v): a = px
   * outward (+v direction), b = px perpendicular. Exact in polar (radial lines are straight).
   */
  localPolygon(u: number, v: number, pts: Array<[number, number]>, fill: string | null, stroke?: string | null, width?: number): void;
  /** Symbol of `size` px centred at (u, v), pointing outward. */
  shape(kind: ShapeKind, u: number, v: number, size: number, fill: string | null, stroke?: string | null, width?: number): void;
  /** Domain glyph spanning depth [v0, v1] with half-thickness h px, centred on u. */
  domain(kind: DomainShape, u: number, v0: number, v1: number, h: number, fill: string, stroke?: string | null, width?: number): void;
  /** Pie centred at (u, v); values are relative weights. */
  pie(u: number, v: number, radius: number, values: number[], colors: string[], stroke?: string | null, width?: number): void;
  text(u: number, v: number, s: string, o: TextOpts): void;
  /** Draw everything batched so far (fills, then strokes). */
  flush(): void;
}

// ------------------------------------------------------------
// Geometry shared by both backends
// ------------------------------------------------------------

function makeMapping(g: BandGeom) {
  if (g.kind === "rect") {
    return {
      xy: (u: number, v: number): [number, number] => [g.x0 + v, u],
      outward: (_u: number): [number, number] => [1, 0],
      alongPx: (u0: number, u1: number, _v: number) => Math.abs(u1 - u0),
      orientAngle: (_u: number) => 0,
    };
  }
  return {
    xy: (u: number, v: number): [number, number] => [g.cx + (g.r0 + v) * Math.cos(u), g.cy + (g.r0 + v) * Math.sin(u)],
    outward: (u: number): [number, number] => [Math.cos(u), Math.sin(u)],
    alongPx: (u0: number, u1: number, v: number) => Math.abs(u1 - u0) * Math.max(0, g.r0 + v),
    orientAngle: (u: number) => u,
  };
}

/** Unit-size outlines (centred at 0,0; +a = outward; size 1 = full height). Exported for the legend. */
export function shapePoints(kind: ShapeKind): Array<[number, number]> | "circle" {
  const regular = (n: number, rot = 0, r = 0.5): Array<[number, number]> =>
    Array.from({ length: n }, (_, i) => {
      const t = rot + (i * 2 * Math.PI) / n;
      return [r * Math.cos(t), r * Math.sin(t)];
    });
  switch (kind) {
    case "circle": return "circle";
    case "square": return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    case "diamond": return [[-0.5, 0], [0, -0.5], [0.5, 0], [0, 0.5]];
    case "triangle-right": return [[-0.5, -0.5], [0.5, 0], [-0.5, 0.5]];
    case "triangle-left": return [[0.5, -0.5], [-0.5, 0], [0.5, 0.5]];
    case "triangle-up": return [[-0.5, 0.5], [0, -0.5], [0.5, 0.5]];
    case "triangle-down": return [[-0.5, -0.5], [0, 0.5], [0.5, -0.5]];
    case "hexagon": return regular(6, 0);
    case "octagon": return regular(8, Math.PI / 8);
    case "star": {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.5 : 0.21;
        const t = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([r * Math.cos(t), r * Math.sin(t)]);
      }
      return pts;
    }
    case "check": return [[-0.5, 0.05], [-0.3, -0.15], [-0.1, 0.1], [0.35, -0.45], [0.5, -0.25], [-0.1, 0.45]];
    case "plus": {
      const w = 0.17;
      return [[-w, -0.5], [w, -0.5], [w, -w], [0.5, -w], [0.5, w], [w, w], [w, 0.5], [-w, 0.5], [-w, w], [-0.5, w], [-0.5, -w], [-w, -w]];
    }
    case "cross": {
      const s = Math.SQRT1_2;
      return (shapePoints("plus") as Array<[number, number]>).map(([a, b]) => [a * s - b * s, a * s + b * s] as [number, number]);
    }
  }
}

/**
 * Domain glyph outline in the local frame: a from 0 (start) to L (end),
 * b in [-h, h]. GP (gap) returns null: callers draw nothing over the backbone.
 */
function domainPoints(kind: DomainShape, L: number, h: number): Array<[number, number]> | null {
  const tip = Math.min(L / 2, h);
  switch (kind) {
    case "GP": return null;
    case "RE": return [[0, -h], [L, -h], [L, h], [0, h]];
    case "HH": return [[0, 0], [tip, -h], [L - tip, -h], [L, 0], [L - tip, h], [tip, h]];
    case "HV": { const e = h * 0.45; return [[0, -h + e], [L / 2, -h], [L, -h + e], [L, h - e], [L / 2, h], [0, h - e]]; }
    case "EL": return Array.from({ length: 28 }, (_, i) => {
      const t = (i / 28) * 2 * Math.PI;
      return [L / 2 + (L / 2) * Math.cos(t), h * Math.sin(t)] as [number, number];
    });
    case "DI": return [[0, 0], [L / 2, -h], [L, 0], [L / 2, h]];
    case "TR": return [[0, -h], [L, 0], [0, h]];
    case "TL": return [[L, -h], [0, 0], [L, h]];
    case "PR": return [[0, -h], [L - tip, -h], [L, 0], [L - tip, h], [0, h]];
    case "PL": return [[L, -h], [tip, -h], [0, 0], [tip, h], [L, h]];
    case "PU": return [[0, h], [0, -h * 0.4], [L / 2, -h], [L, -h * 0.4], [L, h]];
    case "PD": return [[0, -h], [L, -h], [L, h * 0.4], [L / 2, h], [0, h * 0.4]];
    case "OC": { const c = Math.min(h * 0.45, L / 3); return [[0, -h + c], [c, -h], [L - c, -h], [L, -h + c], [L, h - c], [L - c, h], [c, h], [0, h - c]]; }
  }
}

/** Rotate local (a, b) by θ and translate to (x, y). */
function toScreen(x: number, y: number, theta: number, pts: Array<[number, number]>): Array<[number, number]> {
  const c = Math.cos(theta), s = Math.sin(theta);
  return pts.map(([a, b]) => [x + a * c - b * s, y + a * s + b * c]);
}

/** Readable text rotation: flip text that would read upside down. */
function readable(theta: number, anchor: "start" | "middle" | "end"): { theta: number; anchor: "start" | "middle" | "end" } {
  const c = Math.cos(theta);
  if (c >= -1e-9) return { theta, anchor };
  return { theta: theta + Math.PI, anchor: anchor === "start" ? "end" : anchor === "end" ? "start" : "middle" };
}

const fontOf = (o: TextOpts) => `${o.italic ? "italic " : ""}${o.bold ? "bold " : ""}${o.size}px sans-serif`;

/**
 * Is an arc of angle da at radius r flat enough to draw as a straight chord?
 * (Sagitta r·(1 − cos(da/2)) ≈ r·da²/8 under 0.25 px.) Rasterising thousands
 * of tiny arcs is far slower than quads, and invisible at that size.
 */
const chordOk = (r: number, da: number) => r * da * da < 2;

// ------------------------------------------------------------
// Canvas backend
// ------------------------------------------------------------

/**
 * Path recorder with the Path2D methods we use. Chrome's Path2D gets
 * super-linearly slow as a path grows (100k cells took ~17 s), so commands are
 * recorded into a flat array and replayed on the context in chunks at flush.
 */
class PathRec {
  ops: number[] = [];
  subpaths = 0;
  moveTo(x: number, y: number) { this.ops.push(0, x, y); this.subpaths++; }
  lineTo(x: number, y: number) { this.ops.push(1, x, y); }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false) { this.ops.push(2, cx, cy, r, a0, a1, ccw ? 1 : 0); }
  closePath() { this.ops.push(3); }
  rect(x: number, y: number, w: number, h: number) { this.ops.push(4, x, y, w, h); this.subpaths++; }
  /** Replay onto ctx, filling or stroking every CHUNK subpaths. */
  replay(ctx: CanvasRenderingContext2D, paint: () => void) {
    const o = this.ops, CHUNK = 1500;
    let n = 0;
    ctx.beginPath();
    for (let i = 0; i < o.length;) {
      const op = o[i];
      if ((op === 0 || op === 4) && n >= CHUNK) { paint(); ctx.beginPath(); n = 0; }
      switch (op) {
        case 0: ctx.moveTo(o[i + 1], o[i + 2]); n++; i += 3; break;
        case 1: ctx.lineTo(o[i + 1], o[i + 2]); i += 3; break;
        case 2: ctx.arc(o[i + 1], o[i + 2], o[i + 3], o[i + 4], o[i + 5], o[i + 6] === 1); i += 7; break;
        case 3: ctx.closePath(); i += 1; break;
        default: ctx.rect(o[i + 1], o[i + 2], o[i + 3], o[i + 4]); n++; i += 5; break;
      }
    }
    if (n > 0) paint();
  }
}

export function canvasBand(ctx: CanvasRenderingContext2D, geom: BandGeom): BandOut {
  const m = makeMapping(geom);
  const fills = new Map<string, PathRec>();
  const strokes = new Map<string, { path: PathRec; color: string; width: number; dash?: number[] }>();
  const fillPath = (c: string) => { let p = fills.get(c); if (!p) { p = new PathRec(); fills.set(c, p); } return p; };
  const strokePath = (c: string, w: number, dash?: number[]) => {
    const k = `${c}|${w}|${dash ? dash.join(",") : ""}`;
    let e = strokes.get(k);
    if (!e) { e = { path: new PathRec(), color: c, width: w, dash }; strokes.set(k, e); }
    return e.path;
  };
  const cellPath = (p: PathRec, u0: number, u1: number, v0: number, v1: number) => {
    if (geom.kind === "rect") {
      p.rect(geom.x0 + Math.min(v0, v1), Math.min(u0, u1), Math.abs(v1 - v0), Math.abs(u1 - u0));
    } else {
      const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
      const ri = Math.max(0, geom.r0 + Math.min(v0, v1)), ro = Math.max(0, geom.r0 + Math.max(v0, v1));
      const cl = Math.cos(lo), sl = Math.sin(lo), ch = Math.cos(hi), sh = Math.sin(hi);
      p.moveTo(geom.cx + ro * cl, geom.cy + ro * sl);
      if (chordOk(ro, hi - lo)) {
        p.lineTo(geom.cx + ro * ch, geom.cy + ro * sh);
        p.lineTo(geom.cx + ri * ch, geom.cy + ri * sh);
        p.lineTo(geom.cx + ri * cl, geom.cy + ri * sl);
      } else {
        p.arc(geom.cx, geom.cy, ro, lo, hi, false);
        p.arc(geom.cx, geom.cy, ri, hi, lo, true);
      }
      p.closePath();
    }
  };
  const addPoly = (p: PathRec, pts: Array<[number, number]>, close: boolean) => {
    if (!pts.length) return;
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    if (close) p.closePath();
  };

  const out: BandOut = {
    geom,
    xy: m.xy,
    outward: m.outward,
    alongPx: m.alongPx,
    fillCell(u0, u1, v0, v1, fill) { cellPath(fillPath(fill), u0, u1, v0, v1); },
    strokeCell(u0, u1, v0, v1, stroke, width) { cellPath(strokePath(stroke, width), u0, u1, v0, v1); },
    line(u0, v0, u1, v1, stroke, width, dash) {
      const p = strokePath(stroke, width, dash);
      const a = m.xy(u0, v0), b = m.xy(u1, v1);
      p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]);
    },
    alongLine(u0, u1, v, stroke, width, dash) {
      const p = strokePath(stroke, width, dash);
      if (geom.kind === "rect") { p.moveTo(geom.x0 + v, u0); p.lineTo(geom.x0 + v, u1); }
      else {
        const r = Math.max(0, geom.r0 + v);
        p.moveTo(geom.cx + r * Math.cos(u0), geom.cy + r * Math.sin(u0));
        p.arc(geom.cx, geom.cy, r, u0, u1, u1 < u0);
      }
    },
    polyline(pts, stroke, width, dash) { addPoly(strokePath(stroke, width, dash), pts.map(([u, v]) => m.xy(u, v)), false); },
    polygon(pts, fill, stroke, width = 1) {
      const sp = pts.map(([u, v]) => m.xy(u, v));
      if (fill) addPoly(fillPath(fill), sp, true);
      if (stroke) addPoly(strokePath(stroke, width), sp, true);
    },
    localPolygon(u, v, pts, fill, stroke, width = 1) {
      const [x, y] = m.xy(u, v);
      const sp = toScreen(x, y, m.orientAngle(u), pts);
      if (fill) addPoly(fillPath(fill), sp, true);
      if (stroke) addPoly(strokePath(stroke, width), sp, true);
    },
    shape(kind, u, v, size, fill, stroke, width = 1) {
      const [x, y] = m.xy(u, v);
      const pts = shapePoints(kind);
      if (pts === "circle") {
        const r = size / 2;
        if (fill) { const p = fillPath(fill); p.moveTo(x + r, y); p.arc(x, y, r, 0, 2 * Math.PI); }
        if (stroke) { const p = strokePath(stroke, width); p.moveTo(x + r, y); p.arc(x, y, r, 0, 2 * Math.PI); }
        return;
      }
      const sp = toScreen(x, y, m.orientAngle(u), pts.map(([a, b]) => [a * size, b * size]));
      if (fill) addPoly(fillPath(fill), sp, true);
      if (stroke) addPoly(strokePath(stroke, width), sp, true);
    },
    domain(kind, u, v0, v1, h, fill, stroke, width = 1) {
      const pts = domainPoints(kind, Math.max(0, v1 - v0), h);
      if (!pts) return;
      out.localPolygon(u, v0, pts, fill, stroke, width);
    },
    pie(u, v, radius, values, colors, stroke, width = 1) {
      const total = values.reduce((s, x) => s + (x > 0 ? x : 0), 0);
      if (!(total > 0) || radius <= 0) return;
      const [x, y] = m.xy(u, v);
      let a = -Math.PI / 2;
      values.forEach((val, i) => {
        if (!(val > 0)) return;
        const da = (val / total) * 2 * Math.PI;
        const p = fillPath(colors[i % colors.length]);
        p.moveTo(x, y);
        p.arc(x, y, radius, a, a + da);
        p.closePath();
        a += da;
      });
      if (stroke) { const p = strokePath(stroke, width); p.moveTo(x + radius, y); p.arc(x, y, radius, 0, 2 * Math.PI); }
    },
    text(u, v, s, o) {
      out.flush(); // keep layering: shapes drawn so far go underneath text
      const [x, y] = m.xy(u, v);
      let theta = m.orientAngle(u) + (o.orient === "tangential" ? Math.PI / 2 : 0) + ((o.rotate ?? 0) * Math.PI) / 180;
      const r = readable(theta, o.anchor ?? "start");
      theta = r.theta;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(theta);
      ctx.font = fontOf(o);
      ctx.fillStyle = o.color;
      ctx.textBaseline = "middle";
      ctx.textAlign = r.anchor === "middle" ? "center" : r.anchor === "end" ? "right" : "left";
      ctx.fillText(s, 0, 0);
      ctx.restore();
    },
    flush() {
      for (const [color, p] of fills) { ctx.fillStyle = color; p.replay(ctx, () => ctx.fill()); }
      fills.clear();
      for (const e of strokes.values()) {
        if (!(e.width > 0)) continue;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.width;
        ctx.setLineDash(e.dash ?? []);
        e.path.replay(ctx, () => ctx.stroke());
      }
      ctx.setLineDash([]);
      strokes.clear();
    },
  };
  return out;
}

// ------------------------------------------------------------
// SVG backend (appends elements to `lines`)
// ------------------------------------------------------------

export function svgBand(lines: string[], geom: BandGeom, f: (n: number) => string = n => n.toFixed(2)): BandOut {
  const m = makeMapping(geom);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fills = new Map<string, string[]>();
  const strokes = new Map<string, { d: string[]; color: string; width: number; dash?: number[] }>();
  const fillD = (c: string) => { let a = fills.get(c); if (!a) { a = []; fills.set(c, a); } return a; };
  const strokeD = (c: string, w: number, dash?: number[]) => {
    const k = `${c}|${w}|${dash ? dash.join(",") : ""}`;
    let e = strokes.get(k);
    if (!e) { e = { d: [], color: c, width: w, dash }; strokes.set(k, e); }
    return e.d;
  };
  const P = ([x, y]: [number, number]) => `${f(x)},${f(y)}`;
  const polyD = (pts: Array<[number, number]>, close: boolean) =>
    pts.length ? `M ${pts.map(P).join(" L ")}${close ? " Z" : ""}` : "";
  // Arc from u0 to u1 at radius r (split into ≤ π pieces so flags are unambiguous).
  const arcD = (r: number, u0: number, u1: number, first: boolean) => {
    if (geom.kind !== "polar") return "";
    const n = Math.max(1, Math.ceil(Math.abs(u1 - u0) / Math.PI));
    let d = first ? `M ${P([geom.cx + r * Math.cos(u0), geom.cy + r * Math.sin(u0)])}` : `L ${P([geom.cx + r * Math.cos(u0), geom.cy + r * Math.sin(u0)])}`;
    for (let i = 1; i <= n; i++) {
      const a = u0 + ((u1 - u0) * i) / n;
      d += ` A ${f(r)},${f(r)} 0 0,${u1 > u0 ? 1 : 0} ${P([geom.cx + r * Math.cos(a), geom.cy + r * Math.sin(a)])}`;
    }
    return d;
  };
  const cellD = (u0: number, u1: number, v0: number, v1: number) => {
    if (geom.kind === "rect") {
      const x = geom.x0 + Math.min(v0, v1), y = Math.min(u0, u1), w = Math.abs(v1 - v0), h = Math.abs(u1 - u0);
      return `M ${f(x)},${f(y)} h ${f(w)} v ${f(h)} h ${f(-w)} Z`;
    }
    const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
    const ri = Math.max(0, geom.r0 + Math.min(v0, v1)), ro = Math.max(0, geom.r0 + Math.max(v0, v1));
    if (chordOk(ro, hi - lo)) {
      const Q = (r: number, a: number) => P([geom.cx + r * Math.cos(a), geom.cy + r * Math.sin(a)]);
      return `M ${Q(ro, lo)} L ${Q(ro, hi)} L ${Q(ri, hi)} L ${Q(ri, lo)} Z`;
    }
    return `${arcD(ro, lo, hi, true)} ${arcD(ri, hi, lo, false)} Z`;
  };

  const out: BandOut = {
    geom,
    xy: m.xy,
    outward: m.outward,
    alongPx: m.alongPx,
    fillCell(u0, u1, v0, v1, fill) { fillD(fill).push(cellD(u0, u1, v0, v1)); },
    strokeCell(u0, u1, v0, v1, stroke, width) { strokeD(stroke, width).push(cellD(u0, u1, v0, v1)); },
    line(u0, v0, u1, v1, stroke, width, dash) { strokeD(stroke, width, dash).push(`M ${P(m.xy(u0, v0))} L ${P(m.xy(u1, v1))}`); },
    alongLine(u0, u1, v, stroke, width, dash) {
      if (geom.kind === "rect") strokeD(stroke, width, dash).push(`M ${P([geom.x0 + v, u0])} L ${P([geom.x0 + v, u1])}`);
      else strokeD(stroke, width, dash).push(arcD(Math.max(0, geom.r0 + v), u0, u1, true));
    },
    polyline(pts, stroke, width, dash) { strokeD(stroke, width, dash).push(polyD(pts.map(([u, v]) => m.xy(u, v)), false)); },
    polygon(pts, fill, stroke, width = 1) {
      const d = polyD(pts.map(([u, v]) => m.xy(u, v)), true);
      if (fill) fillD(fill).push(d);
      if (stroke) strokeD(stroke, width).push(d);
    },
    localPolygon(u, v, pts, fill, stroke, width = 1) {
      const [x, y] = m.xy(u, v);
      const d = polyD(toScreen(x, y, m.orientAngle(u), pts), true);
      if (fill) fillD(fill).push(d);
      if (stroke) strokeD(stroke, width).push(d);
    },
    shape(kind, u, v, size, fill, stroke, width = 1) {
      const [x, y] = m.xy(u, v);
      const pts = shapePoints(kind);
      let d: string;
      if (pts === "circle") {
        const r = size / 2;
        d = `M ${f(x - r)},${f(y)} A ${f(r)},${f(r)} 0 1,1 ${f(x + r)},${f(y)} A ${f(r)},${f(r)} 0 1,1 ${f(x - r)},${f(y)} Z`;
      } else {
        d = polyD(toScreen(x, y, m.orientAngle(u), pts.map(([a, b]) => [a * size, b * size])), true);
      }
      if (fill) fillD(fill).push(d);
      if (stroke) strokeD(stroke, width).push(d);
    },
    domain(kind, u, v0, v1, h, fill, stroke, width = 1) {
      const pts = domainPoints(kind, Math.max(0, v1 - v0), h);
      if (!pts) return;
      out.localPolygon(u, v0, pts, fill, stroke, width);
    },
    pie(u, v, radius, values, colors, stroke, width = 1) {
      const total = values.reduce((s, x) => s + (x > 0 ? x : 0), 0);
      if (!(total > 0) || radius <= 0) return;
      const [x, y] = m.xy(u, v);
      const circle = `M ${f(x - radius)},${f(y)} A ${f(radius)},${f(radius)} 0 1,1 ${f(x + radius)},${f(y)} A ${f(radius)},${f(radius)} 0 1,1 ${f(x - radius)},${f(y)} Z`;
      const pt = (a: number) => P([x + radius * Math.cos(a), y + radius * Math.sin(a)]);
      let a = -Math.PI / 2;
      values.forEach((val, i) => {
        if (!(val > 0)) return;
        const da = (val / total) * 2 * Math.PI;
        const c = colors[i % colors.length];
        if (da >= 2 * Math.PI - 1e-6) {
          fillD(c).push(circle);
        } else {
          // Split into ≤ π/2 arcs: endpoints never coincide after rounding.
          const k = Math.max(1, Math.ceil(da / (Math.PI / 2)));
          let d = `M ${f(x)},${f(y)} L ${pt(a)}`;
          for (let j = 1; j <= k; j++) d += ` A ${f(radius)},${f(radius)} 0 0,1 ${pt(a + (da * j) / k)}`;
          fillD(c).push(`${d} Z`);
        }
        a += da;
      });
      if (stroke) strokeD(stroke, width).push(circle);
    },
    text(u, v, s, o) {
      out.flush();
      const [x, y] = m.xy(u, v);
      let theta = m.orientAngle(u) + (o.orient === "tangential" ? Math.PI / 2 : 0) + ((o.rotate ?? 0) * Math.PI) / 180;
      const r = readable(theta, o.anchor ?? "start");
      theta = r.theta;
      const attrs = [
        `transform="translate(${f(x)},${f(y)}) rotate(${f((theta * 180) / Math.PI)})"`,
        `font-family="sans-serif"`, `font-size="${f(o.size)}"`, `fill="${o.color}"`, `dominant-baseline="central"`,
        r.anchor !== "start" ? `text-anchor="${r.anchor}"` : "",
        o.bold ? `font-weight="bold"` : "", o.italic ? `font-style="italic"` : "",
      ].filter(Boolean).join(" ");
      lines.push(`<text ${attrs}>${esc(s)}</text>`);
    },
    flush() {
      for (const [color, ds] of fills) if (ds.length) lines.push(`<path fill="${color}" d="${ds.join(" ")}"/>`);
      fills.clear();
      for (const e of strokes.values()) {
        if (!e.d.length || !(e.width > 0)) continue;
        const dash = e.dash && e.dash.length ? ` stroke-dasharray="${e.dash.join(",")}"` : "";
        lines.push(`<path fill="none" stroke="${e.color}" stroke-width="${f(e.width)}"${dash} d="${e.d.join(" ")}"/>`);
      }
      strokes.clear();
    },
  };
  return out;
}
