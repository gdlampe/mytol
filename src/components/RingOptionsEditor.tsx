import React, { useState } from "react";
import { Swatch } from "./ColorPicker";
import { GRADIENT_PRESETS } from "../lib/trackStyle";
import { FIELD_PALETTE, DEFAULT_SHAPES } from "../lib/rings/util";
import { SHAPE_CHOICES } from "../lib/rings/types";
import type { OptionField, RingModule } from "../lib/rings/types";
import type { TrackConfig } from "../lib/types";

type EditColor = (title: string, color: string, apply: (c: string) => void) => void;

const gradientCss = (stops: string[]) =>
  `linear-gradient(to right, ${(stops.length > 1 ? stops : [stops[0] ?? "#fff", stops[0] ?? "#000"]).join(", ")})`;

/** Number input that commits on blur/Enter; blank = null when `auto`. */
function NumberOpt({ value, f, onChange }: { value: number | null | undefined; f: Extract<OptionField, { type: "number" }>; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (s: string) => {
    const t = s.trim();
    if (t === "" && f.auto) onChange(null);
    else {
      const n = Number(t);
      if (t !== "" && Number.isFinite(n)) onChange(Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n)));
    }
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? (value === null || value === undefined ? "" : String(value))}
      placeholder={f.auto ? "auto" : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }}
      style={{ width: 70, fontSize: 11 }}
    />
  );
}

/**
 * Renders a ring module's option schema. Values are read from ring.opts and
 * written back with onPatch({ opts }).
 */
export default function RingOptionsEditor({ ring, module, columns, categories, categoryColor, onPatch, editColor }: {
  ring: TrackConfig;
  module: RingModule;
  /** Annotation columns ({ key, label, numeric }) for "column" options. */
  columns: Array<{ key: string; label: string; numeric: boolean }>;
  /** Distinct values for "categoryColors" options (e.g. domain names), by option key. */
  categories: (optKey: string) => string[];
  /** Colour actually drawn for a category (falls back to the stored option or grey). */
  categoryColor?: (optKey: string, cat: string) => string | undefined;
  onPatch: (patch: Partial<TrackConfig>) => void;
  editColor: EditColor;
}) {
  const opts = ring.opts ?? {};
  const set = (key: string, value: unknown) => onPatch({ opts: { ...(ring.opts ?? {}), [key]: value } });
  const fields = ring.fields ?? [];

  const row = (f: OptionField, control: React.ReactNode) => (
    <div key={f.key} className="style-row" title={f.help}>
      <span className="note">{f.label}</span>
      {control}
    </div>
  );

  return (
    <>
      {module.options.filter(f => !f.showIf || f.showIf(opts)).map(f => {
        const v = opts[f.key];
        switch (f.type) {
          case "number":
            return row(f, <><NumberOpt value={v} f={f} onChange={(n) => set(f.key, n)} />{f.unit && <span className="note">{f.unit}</span>}</>);
          case "bool":
            return (
              <label key={f.key} className="note style-row" style={{ gap: 6 }} title={f.help}>
                <input type="checkbox" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} />
                {f.label}
              </label>
            );
          case "color":
            return row(f, v
              ? <><Swatch color={v} title={f.label} onClick={() => editColor(`${ring.label}: ${f.label}`, v, c => set(f.key, c))} />
                  <button type="button" className="btn" style={{ padding: "0 5px", fontSize: 11 }} title="Clear" onClick={() => set(f.key, "")}>×</button></>
              : <button type="button" className="btn" style={{ padding: "0 6px", fontSize: 11 }} onClick={() => editColor(`${ring.label}: ${f.label}`, "#888888", c => set(f.key, c))}>Set…</button>);
          case "select":
            return row(f, (
              <select value={v ?? ""} onChange={(e) => set(f.key, e.target.value)} style={{ fontSize: 11, flex: 1, minWidth: 0 }}>
                {f.choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            ));
          case "text":
            return row(f, <input type="text" value={v ?? ""} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} style={{ fontSize: 11, flex: 1, minWidth: 0 }} />);
          case "column":
            return row(f, (
              <select value={v ?? ""} onChange={(e) => set(f.key, e.target.value || null)} style={{ fontSize: 11, flex: 1, minWidth: 0 }}>
                {f.optional !== false && <option value="">— none —</option>}
                {columns.filter(c => !f.numeric || c.numeric).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            ));
          case "gradient": {
            const stops: string[] = Array.isArray(v) && v.length ? v : GRADIENT_PRESETS[0].stops;
            return (
              <div key={f.key} className="style-panel" style={{ gap: 4 }}>
                <div className="style-row">
                  <span className="note">{f.label}</span>
                  <select value="" onChange={(e) => { const p = GRADIENT_PRESETS.find(g => g.name === e.target.value); if (p) set(f.key, [...p.stops]); }} style={{ fontSize: 11, flex: 1, minWidth: 0 }}>
                    <option value="">Preset…</option>
                    {GRADIENT_PRESETS.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                  </select>
                  <button type="button" className="btn" style={{ padding: "1px 6px", fontSize: 11 }} title="Reverse" onClick={() => set(f.key, [...stops].reverse())}>⇄</button>
                </div>
                <div className="gradient-preview" style={{ background: gradientCss(stops) }} />
                <div className="style-row" style={{ flexWrap: "wrap" }}>
                  {stops.map((c, i) => (
                    <Swatch key={i} color={c} title={`Stop ${i + 1}`}
                      onClick={() => editColor(`${ring.label}: stop ${i + 1}`, c, col => set(f.key, stops.map((s, j) => (j === i ? col : s))))} />
                  ))}
                  <button type="button" className="btn" style={{ padding: "0 6px", fontSize: 11 }} onClick={() => set(f.key, [...stops, stops[stops.length - 1]])}>+</button>
                  <button type="button" className="btn" style={{ padding: "0 6px", fontSize: 11 }} disabled={stops.length <= 2} onClick={() => set(f.key, stops.slice(0, -1))}>−</button>
                </div>
              </div>
            );
          }
          case "fieldColors": {
            const m: Record<string, string> = v ?? {};
            return (
              <div key={f.key} className="style-panel" style={{ gap: 2 }}>
                <span className="note">{f.label}</span>
                {fields.map((fk, i) => {
                  const c = m[fk] ?? FIELD_PALETTE[i % FIELD_PALETTE.length];
                  const label = columns.find(x => x.key === fk)?.label ?? fk;
                  return (
                    <div key={fk} className="legend-item">
                      <Swatch color={c} title={`${label} colour`} onClick={() => editColor(`${label}`, c, col => set(f.key, { ...(ring.opts?.[f.key] ?? {}), [fk]: col }))} />
                      <span className="legend-label">{label}</span>
                    </div>
                  );
                })}
              </div>
            );
          }
          case "fieldShapes": {
            const m: Record<string, string> = v ?? {};
            return (
              <div key={f.key} className="style-panel" style={{ gap: 2 }}>
                <span className="note">{f.label}</span>
                {fields.map((fk, i) => {
                  const label = columns.find(x => x.key === fk)?.label ?? fk;
                  return (
                    <div key={fk} className="style-row">
                      <span className="legend-label" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
                      <select value={m[fk] ?? DEFAULT_SHAPES[i % DEFAULT_SHAPES.length]} onChange={(e) => set(f.key, { ...(ring.opts?.[f.key] ?? {}), [fk]: e.target.value })} style={{ fontSize: 11 }}>
                        {SHAPE_CHOICES.map(sc => <option key={sc.value} value={sc.value}>{sc.label}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            );
          }
          case "categoryColors": {
            const m: Record<string, string> = v ?? {};
            const cats = categories(f.key);
            return (
              <div key={f.key} className="style-panel" style={{ gap: 2 }}>
                <span className="note">{f.label}{cats.length > 60 ? ` (first 60 of ${cats.length})` : ""}</span>
                <div className="category-list">
                  {cats.slice(0, 60).map(cat => {
                    const cur = categoryColor?.(f.key, cat) ?? m[cat] ?? "#cccccc";
                    return (
                    <div key={cat} className="legend-item">
                      <Swatch color={cur} title={cat} onClick={() => editColor(cat, cur, col => set(f.key, { ...(ring.opts?.[f.key] ?? {}), [cat]: col }))} />
                      <span className="legend-label">{cat}</span>
                    </div>
                    );
                  })}
                </div>
              </div>
            );
          }
        }
      })}
    </>
  );
}
