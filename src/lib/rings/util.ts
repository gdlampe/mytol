import type { TrackConfig } from "../types";
import type { ShapeKind } from "./band";
import type { RingDrawContext } from "./types";

// Shared helpers for ring modules.

/** Default colours for a ring's fields (Tableau 10, then cycling). */
export const FIELD_PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

export const DEFAULT_SHAPES: ShapeKind[] = ["circle", "square", "star", "triangle-right", "diamond", "hexagon", "triangle-left", "octagon", "check", "plus"];

/** Colour per field from opts (falls back to the palette by field position). */
export function fieldColor(ring: TrackConfig, field: string, i: number, key = "fieldColors"): string {
  const m = ring.opts?.[key] as Record<string, string> | undefined;
  return m?.[field] ?? FIELD_PALETTE[i % FIELD_PALETTE.length];
}

const present = (v: unknown) => v !== null && v !== undefined && v !== "";

/** Finite number from a cell, or null (blank, text, NaN, ±Infinity). */
export function cellNumber(v: unknown): number | null {
  if (!present(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Parse caches: cells repeat a lot and rings redraw every frame.
const listCache = new Map<string, number[]>();

/** Numbers in a cell separated by commas, semicolons, pipes or whitespace (cached). */
export function parseNumberList(v: unknown): number[] {
  if (!present(v)) return [];
  const s = String(v);
  const hit = listCache.get(s);
  if (hit) return hit;
  // Strip one pair of surrounding brackets; empty tokens (leading/trailing separators) are not zeros.
  const t = s.trim().replace(/^[[(]\s*|\s*[\])]$/g, "");
  const nums = t.split(/[,;|\s]+/).filter(x => x !== "").map(Number).filter(n => Number.isFinite(n));
  if (listCache.size > 200000) listCache.clear();
  listCache.set(s, nums);
  return nums;
}

/**
 * Binary cell: 1 = present (filled), 0 = absent but shown (outline), null = nothing.
 * Accepts 1/0/-1, true/false, yes/no, y/n, present/absent, +/-.
 */
export function cellBinary(v: unknown): 1 | 0 | null {
  if (!present(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "present" || s === "+") return 1;
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "absent") return 0;
  if (s === "-1" || s === "-" || s === "na" || s === "nan") return null;
  const n = Number(s);
  return Number.isFinite(n) ? (n > 0 ? 1 : n === 0 ? 0 : null) : null;
}

/**
 * Header label for a ring column at depth v (field labels, like iTOL):
 * rectangular — above the first leaf, reading upward; radial — just before
 * the first leaf (in the gap of a partial arc), along the arc.
 */
export function drawFieldLabel(ctx: RingDrawContext, v: number, text: string, size: number, color = "#333") {
  const out = ctx.out;
  if (out.geom.kind === "rect") {
    const u = Math.min(ctx.uStart, ctx.uEnd) - 4;
    out.text(u, v, text, { size, color, orient: "radial", rotate: -90, anchor: "start" });
  } else {
    const r = Math.max(1, out.geom.r0 + v);
    const dir = ctx.uStart >= ctx.uEnd ? 1 : -1; // leaves run from uStart towards uEnd
    out.text(ctx.uStart + (dir * 4) / r, v, text, { size, color, orient: "tangential", anchor: dir > 0 ? "start" : "end" });
  }
}

/** Label font size for field labels (scaled by the user's font scale, clamped). */
export const fieldLabelSize = (ctx: RingDrawContext, base = 10) => Math.max(6, Math.min(16, base * ctx.fontScale));
