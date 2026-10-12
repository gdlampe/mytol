import type { TrackConfig } from "../types";
import type { RingInfoContext, RingKind, RingModule } from "./types";
import column from "./column";
import heatmap from "./heatmap";
import multibar from "./multibar";
import binary from "./binary";
import shapes from "./shapes";
import pie from "./pie";
import text from "./text";
import domains from "./domains";
import boxplot from "./boxplot";
import linechart from "./linechart";
import alignment from "./alignment";

/** Every ring type, in "Add ring" menu order. */
export const RING_MODULES: RingModule[] = [column, heatmap, multibar, binary, shapes, pie, text, domains, boxplot, linechart, alignment];

const byKind = new Map<RingKind, RingModule>(RING_MODULES.map(m => [m.kind, m]));

export function ringModule(ring: TrackConfig): RingModule {
  return byKind.get(ring.kind ?? "column") ?? column;
}

/** True for the original one-column rings (key = column name). */
export const isColumnRing = (ring: TrackConfig) => !ring.kind || ring.kind === "column";

/** Band thickness in design px. */
export function ringWidth(ring: TrackConfig, info: RingInfoContext): number {
  const m = ringModule(ring);
  const w = m.width ? m.width(ring, info) : ring.height;
  return Number.isFinite(w) && w > 0 ? w : ring.height;
}
