// ============================================================
// Coloured-range outlines in screen pixels, shared by the canvas and the SVG
// export so the exported shape is exactly the one on screen: one closed
// polygon per range, optionally grown past its edge and with rounded corners.
// ============================================================

export type Pt = [number, number];

/** Signed area (> 0 = counter-clockwise in a y-up frame). */
function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Points along a circular arc from angle a0 to a1 (radians, either direction), excluding a0. */
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 16)));
  const out: Pt[] = [];
  for (let k = 1; k <= steps; k++) {
    const a = a0 + ((a1 - a0) * k) / steps;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/**
 * Round each corner of a closed polygon with a circular fillet of radius r
 * (smaller where the neighbouring edges are short). Works for convex and
 * concave corners; nearly straight corners are left alone.
 */
export function roundCorners(poly: Pt[], r: number): Pt[] {
  const n = poly.length;
  if (r <= 0 || n < 3) return poly;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i], a = poly[(i + n - 1) % n], b = poly[(i + 1) % n];
    const ux = a[0] - p[0], uy = a[1] - p[1], vx = b[0] - p[0], vy = b[1] - p[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-9 || lv < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
    const theta = Math.acos(cos); // interior angle between the two edges
    if (theta > Math.PI - 0.02) { out.push(p); continue; }
    const tanHalf = Math.tan(theta / 2);
    const d = Math.min(r / tanHalf, lu / 2, lv / 2); // distance from the corner to the tangent points
    const rr = d * tanHalf;
    const t1: Pt = [p[0] + (ux / lu) * d, p[1] + (uy / lu) * d];
    const t2: Pt = [p[0] + (vx / lv) * d, p[1] + (vy / lv) * d];
    // Fillet centre on the bisector, rr away from both edges.
    const bx = ux / lu + vx / lv, by = uy / lu + vy / lv, bl = Math.hypot(bx, by) || 1;
    const dc = rr / Math.sin(theta / 2);
    const c: Pt = [p[0] + (bx / bl) * dc, p[1] + (by / bl) * dc];
    let s0 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
    let s1 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    // Take the short way round (the fillet arc is always < 180°).
    while (s1 - s0 > Math.PI) s1 -= 2 * Math.PI;
    while (s0 - s1 > Math.PI) s1 += 2 * Math.PI;
    out.push(t1, ...arcPoints(c[0], c[1], rr, s0, s1));
  }
  return out.length >= 3 ? out : poly;
}

/** A convex polygon grown outward by `pad` (edges pushed out, corners rounded). */
export function growConvex(poly: Pt[], pad: number): Pt[] {
  const n = poly.length;
  if (pad <= 0 || n < 3) return poly;
  const sgn = signedArea(poly) > 0 ? 1 : -1; // outward normal side
  const normal = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [(sgn * dy) / l, (-sgn * dx) / l];
  };
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i], prev = poly[(i + n - 1) % n], next = poly[(i + 1) % n];
    const nIn = normal(prev, p), nOut = normal(p, next);
    let a0 = Math.atan2(nIn[1], nIn[0]);
    let a1 = Math.atan2(nOut[1], nOut[0]);
    // Convex corner: the normal turns the same way as the polygon (short way).
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
    out.push([p[0] + pad * nIn[0], p[1] + pad * nIn[1]], ...arcPoints(p[0], p[1], pad, a0, a1));
  }
  return out;
}

/** Rectangle range (rectangular layout), grown right / up / down by `pad`. */
export function rectRangeShape(x1: number, y1: number, x2: number, y2: number, pad: number, round: number): Pt[] {
  const poly: Pt[] = [[x1, y1 - pad], [x2 + pad, y1 - pad], [x2 + pad, y2 + pad], [x1, y2 + pad]];
  return roundCorners(poly, round);
}

/**
 * Annular-sector range (circular layout) between radii r0 < r1 and angles a0, a1
 * (radians; either order). The outer edge and both sides are pushed out by `pad`.
 */
export function sectorRangeShape(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, pad: number, round: number): Pt[] {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const R1 = r1 + pad;
  const dA = R1 > 0 ? pad / R1 : 0;
  const b0 = lo - dA, b1 = hi + dA;
  const at = (r: number, a: number): Pt => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const poly: Pt[] = [at(R1, b0), ...arcPoints(cx, cy, R1, b0, b1)];
  if (r0 > 0.5) poly.push(at(r0, b1), ...arcPoints(cx, cy, r0, b1, b0));
  else poly.push([cx, cy]);
  return roundCorners(poly, round);
}

/** Convex-hull range (unrooted layout): rounded, then grown by `pad`. */
export function hullRangeShape(hull: Pt[], pad: number, round: number): Pt[] {
  return growConvex(roundCorners(hull, round), pad);
}

/**
 * Points whose hull is an unrooted range: the clade's node, every visible leaf,
 * and a ring round each collapsed clade (the circle drawn for it). Hidden
 * parts (skip = 2) are left out, so the shape follows what is on screen.
 */
export function unrootedRangePoints(
  nodeId: number,
  nodes: ReadonlyArray<{ children: number[]; isLeaf: boolean }>,
  skip: ArrayLike<number>,
  pos: (id: number) => Pt,
  collapsedRadius: (id: number) => number
): Pt[] {
  const pts: Pt[] = [pos(nodeId)];
  const stack = [nodeId];
  while (stack.length) {
    const u = stack.pop()!;
    if (skip[u] === 2) continue;
    if (skip[u] === 1 || nodes[u].isLeaf) {
      const [x, y] = pos(u);
      pts.push([x, y]);
      if (skip[u] === 1) {
        const r = collapsedRadius(u);
        for (let k = 0; k < 8; k++) pts.push([x + r * Math.cos((k * Math.PI) / 4), y + r * Math.sin((k * Math.PI) / 4)]);
      }
      continue;
    }
    for (const c of nodes[u].children) stack.push(c);
  }
  return pts;
}

/** SVG path data for a closed polygon. */
export function polygonPathData(poly: Pt[], f: (n: number) => string): string {
  if (!poly.length) return "";
  return `M ${poly.map(([x, y]) => `${f(x)},${f(y)}`).join(" L ")} Z`;
}

/** Fill a screen-space polygon on a canvas whose transform may be anything. */
export function fillScreenPolygon(ctx: CanvasRenderingContext2D, poly: Pt[], color: string, alpha: number) {
  if (poly.length < 3) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
