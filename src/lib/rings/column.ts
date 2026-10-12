import { makeTrackPainter } from "../trackStyle";
import type { RingModule } from "./types";

// The original one-column ring: categorical colour strip (optionally shaded
// by a number), or a numeric bar / gradient. Its options live on the
// TrackConfig itself (type, cont, shade) and its legend is built by the viewer.
const column: RingModule = {
  kind: "column",
  title: "Single column",
  description: "One column as a colour strip (text) or a bar / colour gradient (numbers).",
  fields: { count: "one", hint: "Any column" },
  defaults: () => ({}),
  options: [],
  draw(ring, ctx) {
    const paint = makeTrackPainter(ring, ctx.colorMaps.get(ring.key), ctx.stats);
    const rect = ctx.out.geom.kind === "rect";
    for (const s of ctx.slots) {
      const cell = paint(s.row);
      if (!cell) continue;
      const span = s.hi - s.lo, mid = (s.lo + s.hi) / 2;
      // Rect: never thinner than 1 px (bar fill < 1 would fade dense strips).
      const h = rect ? Math.max(span * ctx.barFill, Math.min(span, 1)) : span * ctx.barFill;
      ctx.out.fillCell(mid - h / 2, mid + h / 2, 0, cell.frac * ctx.width, cell.color);
    }
  },
};

export default column;
