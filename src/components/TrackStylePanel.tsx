import React, { useState } from "react";
import { Swatch } from "./ColorPicker";
import {
  contStyle,
  DEFAULT_LOG_BASE,
  DEFAULT_SHADE_LOW,
  GRADIENT_PRESETS,
  makeValueScale,
  validLogBase,
  activeShade,
} from "../lib/trackStyle";
import type { NumStats } from "../lib/trackStyle";
import RingOptionsEditor from "./RingOptionsEditor";
import type { RingModule } from "../lib/rings/types";
import type { ScaleType, ShadeStyle, TrackConfig } from "../lib/types";

type EditColor = (title: string, color: string, apply: (c: string) => void) => void;

/** Number field where blank means "automatic"; commits on blur / Enter. */
function AutoNumber({ value, auto, onChange }: { value: number | null; auto: number; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (s: string) => {
    const t = s.trim();
    const n = Number(t);
    onChange(t === "" || !Number.isFinite(n) ? null : n);
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? (value === null ? "" : String(value))}
      placeholder={`auto (${+auto.toPrecision(4)})`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }}
      style={{ width: 92, fontSize: 11 }}
    />
  );
}

/** Log base: quick picks (2, e, 10) plus any number > 1; commits on blur / Enter. */
function LogBaseField({ value, onChange }: { value: number; onChange: (b: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (s: string) => {
    const t = s.trim().toLowerCase();
    const n = t === "e" ? Math.E : Number(t);
    if (Number.isFinite(n) && n > 1) onChange(n);
    setDraft(null);
  };
  const shown = Math.abs(value - Math.E) < 1e-9 ? "e" : String(+value.toPrecision(6));
  return (
    <>
      {([["2", 2], ["e", Math.E], ["10", 10]] as const).map(([lbl, b]) => (
        <button key={lbl} type="button" className={"btn" + (Math.abs(value - b) < 1e-9 ? " active" : "")}
          style={{ padding: "0 6px", fontSize: 11 }} onClick={() => onChange(b)}>{lbl}</button>
      ))}
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? shown}
        title="Any number greater than 1 (or e)"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }}
        style={{ width: 52, fontSize: 11 }}
      />
    </>
  );
}

type RangeFields = { scale: ScaleType; min: number | null; max: number | null; logBase?: number };

function ScaleRow({ range, stats, onChange }: {
  range: RangeFields;
  stats: NumStats | undefined;
  onChange: (patch: Partial<RangeFields>) => void;
}) {
  const auto = makeValueScale({ ...range, min: null, max: null }, stats);
  return (
    <>
      <div className="style-row">
        <span className="note">Scale</span>
        <div className="toggle-pill">
          {(["linear", "log"] as const).map(sc => (
            <button key={sc} type="button" className={range.scale === sc ? "active" : ""} onClick={() => onChange({ scale: sc })}>
              {sc === "linear" ? "Linear" : "Log"}
            </button>
          ))}
        </div>
      </div>
      <div className="style-row">
        <span className="note">Min</span>
        <AutoNumber value={range.min} auto={auto.lo} onChange={(v) => onChange({ min: v })} />
        <span className="note">Max</span>
        <AutoNumber value={range.max} auto={auto.hi} onChange={(v) => onChange({ max: v })} />
      </div>
      {range.scale === "log" && (
        <>
          <div className="style-row">
            <span className="note">Log base</span>
            <LogBaseField value={validLogBase(range.logBase ?? DEFAULT_LOG_BASE)} onChange={(b) => onChange({ logBase: b })} />
          </div>
          <div className="note">
            Automatic min/max round out to whole powers of the base. Values ≤ 0 are drawn at the minimum.
          </div>
        </>
      )}
    </>
  );
}

/** Number field committing on blur / Enter, clamped to [min, max]. */
function NumField({ value, min, max, step = 1, onChange }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (s: string) => {
    const n = Number(s);
    if (s.trim() !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    setDraft(null);
  };
  return (
    <input
      type="number" min={min} max={max} step={step}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }}
      style={{ width: 52, fontSize: 11 }}
    />
  );
}

/** Ring frame: spacing after the ring and an optional outline (both ring types). */
function RingFrame({ track, onPatch, editColor }: { track: TrackConfig; onPatch: (patch: Partial<TrackConfig>) => void; editColor: EditColor }) {
  const border = track.border ?? { show: false, color: "#000000", width: 2 };
  const setBorder = (patch: Partial<typeof border>) => onPatch({ border: { ...border, ...patch } });
  return (
    <>
      <div className="style-row">
        <span className="note">Gap after</span>
        <NumField value={track.gap ?? DEFAULT_GAP} min={0} max={200} onChange={(v) => onPatch({ gap: v })} />
        <span className="note">px</span>
      </div>
      <div className="style-row">
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 58 }}>
          <input type="checkbox" checked={border.show} onChange={(e) => setBorder({ show: e.target.checked })} />
          Border
        </label>
        {border.show && (
          <>
            <Swatch color={border.color} title="Border colour"
              onClick={() => editColor(`${track.label}: border colour`, border.color, c => onPatch({ border: { ...(track.border ?? border), show: true, color: c } }))} />
            <NumField value={border.width} min={0.5} max={50} step={0.5} onChange={(v) => setBorder({ width: v })} />
            <span className="note">px</span>
          </>
        )}
      </div>
    </>
  );
}

/** Default space between rings (matches TRACK_PADDING). */
const DEFAULT_GAP = 2;

const gradientCss = (stops: string[]) =>
  `linear-gradient(to right, ${(stops.length > 1 ? stops : [stops[0] ?? "#fff", stops[0] ?? "#000"]).join(", ")})`;

export default function TrackStylePanel({
  track, colorMap, numericColumns, stats, palettes, selectedPalette, setSelectedPalette, applyPalette,
  onPatch, onEditCategory, editColor, ringModule, columns, categories, categoryColor,
}: {
  /** Set for multi-column rings (heatmap, domains …): their options come from the module schema. */
  ringModule?: RingModule;
  columns?: Array<{ key: string; label: string; numeric: boolean }>;
  categories?: (optKey: string) => string[];
  categoryColor?: (optKey: string, cat: string) => string | undefined;
  track: TrackConfig;
  colorMap: Map<string, string> | undefined;
  /** Columns with numeric values, for "shade by" */
  numericColumns: Array<{ key: string; label: string }>;
  stats: Map<string, NumStats>;
  palettes: { name: string; colors: string[] }[];
  selectedPalette: string;
  setSelectedPalette: (name: string) => void;
  applyPalette: (trackKey: string, paletteName: string) => void;
  onPatch: (patch: Partial<TrackConfig>) => void;
  onEditCategory: (category: string) => void;
  editColor: EditColor;
}) {
  // ---------------- Multi-column ring types ----------------
  if (ringModule && ringModule.kind !== "column") {
    return (
      <div className="style-panel">
        <RingFrame track={track} onPatch={onPatch} editColor={editColor} />
        <div className="note" style={{ fontStyle: "italic" }}>{ringModule.description}</div>
        <RingOptionsEditor
          ring={track}
          module={ringModule}
          columns={columns ?? []}
          categories={categories ?? (() => [])}
          categoryColor={categoryColor}
          onPatch={onPatch}
          editColor={editColor}
        />
      </div>
    );
  }

  // ---------------- Continuous ----------------
  if (track.type === "continuous") {
    const cs = contStyle(track);
    const setCont = (patch: Partial<typeof cs>) => onPatch({ cont: { ...cs, ...patch } });
    return (
      <div className="style-panel">
        <RingFrame track={track} onPatch={onPatch} editColor={editColor} />
        <div className="style-row">
          <span className="note">Display</span>
          <div className="toggle-pill">
            <button type="button" className={cs.mode === "bar" ? "active" : ""} onClick={() => setCont({ mode: "bar" })}>Bar</button>
            <button type="button" className={cs.mode === "gradient" ? "active" : ""} onClick={() => setCont({ mode: "gradient" })}>Colour gradient</button>
          </div>
        </div>
        {cs.mode === "bar" ? (
          <div className="style-row">
            <span className="note">Bar colour</span>
            <Swatch color={cs.barColor} title="Edit bar colour"
              onClick={() => editColor(`${track.label}: bar colour`, cs.barColor, c => onPatch({ cont: { ...contStyle(track), barColor: c } }))} />
          </div>
        ) : (
          <>
            <div className="style-row">
              <span className="note">Preset</span>
              <select
                value=""
                onChange={(e) => {
                  const p = GRADIENT_PRESETS.find(g => g.name === e.target.value);
                  if (p) setCont({ stops: [...p.stops] });
                }}
                style={{ fontSize: 11, flex: 1, minWidth: 0 }}
              >
                <option value="">Choose a gradient…</option>
                {GRADIENT_PRESETS.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
              <button type="button" className="btn" style={{ padding: "1px 6px", fontSize: 11 }} title="Reverse the gradient"
                onClick={() => setCont({ stops: [...cs.stops].reverse() })}>⇄</button>
            </div>
            <div className="gradient-preview" style={{ background: gradientCss(cs.stops) }} />
            <div className="style-row" style={{ flexWrap: "wrap" }}>
              <span className="note">Stops</span>
              {cs.stops.map((c, i) => (
                <Swatch key={i} color={c} title={`Edit colour stop ${i + 1}`}
                  onClick={() => editColor(`${track.label}: gradient stop ${i + 1}`, c, col => {
                    const cur = contStyle(track);
                    onPatch({ cont: { ...cur, stops: cur.stops.map((s, j) => (j === i ? col : s)) } });
                  })} />
              ))}
              <button type="button" className="btn" style={{ padding: "0 6px", fontSize: 11 }} title="Add a colour stop"
                onClick={() => setCont({ stops: [...cs.stops, cs.stops[cs.stops.length - 1] ?? "#000000"] })}>+</button>
              <button type="button" className="btn" style={{ padding: "0 6px", fontSize: 11 }} title="Remove the last colour stop"
                disabled={cs.stops.length <= 2} onClick={() => setCont({ stops: cs.stops.slice(0, -1) })}>−</button>
            </div>
          </>
        )}
        <ScaleRow range={cs} stats={stats.get(track.key)} onChange={(patch) => setCont(patch)} />
      </div>
    );
  }

  // ---------------- Categorical ----------------
  // Shading counts only while its column still has numeric data.
  const shade = activeShade(track, stats);
  const setShade = (patch: Partial<ShadeStyle> | null) => {
    if (patch === null) { onPatch({ shade: null }); return; }
    const base: ShadeStyle = shade ?? { by: "", low: {}, scale: "linear", min: null, max: null };
    onPatch({ shade: { ...base, ...patch } });
  };
  const cats = colorMap ? [...colorMap] : [];

  return (
    <div className="style-panel">
      <RingFrame track={track} onPatch={onPatch} editColor={editColor} />
      <div className="style-row">
        <span className="note">Palette</span>
        <select value={selectedPalette} onChange={(e) => setSelectedPalette(e.target.value)} style={{ fontSize: 11, flex: 1, minWidth: 0 }}>
          {palettes.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <button className="btn" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => applyPalette(track.key, selectedPalette)}>Apply</button>
      </div>

      <div className="style-row">
        <span className="note">Shade by number</span>
        <select
          value={shade?.by ?? ""}
          onChange={(e) => (e.target.value ? setShade({ by: e.target.value }) : setShade(null))}
          style={{ fontSize: 11, flex: 1, minWidth: 0 }}
          title="Colour each category on its own gradient (low colour → category colour) by a numeric column"
        >
          <option value="">— none —</option>
          {numericColumns.filter(c => c.key !== track.key).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      {shade && (
        <>
          <ScaleRow range={shade} stats={stats.get(shade.by)} onChange={(patch) => setShade(patch)} />
          <div className="style-row">
            <span className="note">Low colour for all</span>
            <Swatch color={DEFAULT_SHADE_LOW} title="Set every category's low colour"
              onClick={() => editColor(`${track.label}: low colour (all categories)`, DEFAULT_SHADE_LOW, c => {
                const low: Record<string, string> = {};
                for (const [cat] of cats) low[cat] = c;
                setShade({ low });
              })} />
          </div>
        </>
      )}

      <div className="category-list">
        {cats.map(([category, color]) => (
          <div key={category} className="legend-item">
            {shade && (
              <>
                <Swatch color={shade.low[category] ?? DEFAULT_SHADE_LOW} title="Low end of this category's gradient"
                  onClick={() => editColor(`${category}: low colour`, shade.low[category] ?? DEFAULT_SHADE_LOW, c => {
                    const cur = track.shade ?? shade;
                    onPatch({ shade: { ...cur, low: { ...cur.low, [category]: c } } });
                  })} />
                <span className="gradient-chip" style={{ background: gradientCss([shade.low[category] ?? DEFAULT_SHADE_LOW, color]) }} />
              </>
            )}
            <Swatch color={color} title={shade ? "High end (category colour)" : "Edit colour"} onClick={() => onEditCategory(category)} />
            <span className="legend-label">{category || "(empty)"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
