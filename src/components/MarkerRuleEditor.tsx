import React, { useState } from "react";
import { Swatch } from "./ColorPicker";
import { SHAPE_CHOICES } from "../lib/rings/types";
import type { ShapeKind } from "../lib/rings/band";
import type { MarkerRule } from "../lib/decorations";

type EditColor = (title: string, color: string, apply: (c: string) => void) => void;

const OPS: Array<{ value: MarkerRule["op"]; label: string; numeric?: boolean; categorical?: boolean }> = [
  { value: "any", label: "has a value" },
  { value: "is", label: "is", categorical: true },
  { value: "not", label: "is not", categorical: true },
  { value: "gte", label: "≥", numeric: true },
  { value: "lte", label: "≤", numeric: true },
  { value: "between", label: "between", numeric: true },
];

/** Number box that commits on blur / Enter (blank = not set). */
function NumBox({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (t: string) => { const n = Number(t); onChange(t.trim() === "" || !Number.isFinite(n) ? null : n); setDraft(null); };
  return (
    <input type="text" inputMode="decimal" value={draft ?? (value ?? "")} style={{ width: 60, fontSize: 11 }}
      onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }} />
  );
}

/**
 * One leaf-marker rule: which leaves (column + condition), and the symbol
 * (shape or one shape per value, colour or the column's colours, size, fill).
 */
export default function MarkerRuleEditor({ rule, index, count, columns, categories, shownValues, shapeOf, colorOf, matches, onChange, onRemove, onMove, editColor }: {
  rule: MarkerRule;
  index: number;
  count: number;
  columns: Array<{ key: string; label: string; numeric: boolean }>;
  /** All values of the rule's column (for is / is not). */
  categories: string[];
  /** Values carried by the matching leaves (per-value shapes). */
  shownValues: string[];
  shapeOf: (value: string) => ShapeKind;
  colorOf: (value: string) => string;
  matches: number;
  onChange: (patch: Partial<MarkerRule>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  editColor: EditColor;
}) {
  const col = columns.find(c => c.key === rule.column);
  const numeric = !!col?.numeric && categories.length === 0;
  const ops = OPS.filter(o => (numeric ? !o.categorical : !o.numeric));
  const small = { padding: "0 5px", fontSize: 11 } as const;
  return (
    <div className="marker-rule">
      <div className="style-row">
        <input type="checkbox" checked={rule.visible} title="Show these markers" onChange={(e) => onChange({ visible: e.target.checked })} />
        <select value={rule.column ?? ""} onChange={(e) => onChange({ column: e.target.value || null, op: "any", values: [], shapes: {} })}
          style={{ fontSize: 11, flex: 1, minWidth: 0 }}>
          <option value="">Every leaf</option>
          {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {rule.column && (
          <select value={rule.op} onChange={(e) => onChange({ op: e.target.value as MarkerRule["op"] })} style={{ fontSize: 11 }}>
            {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        <button type="button" className="btn" style={small} disabled={index === 0} title="Move closer to the tip" onClick={() => onMove(-1)}>▲</button>
        <button type="button" className="btn" style={small} disabled={index === count - 1} title="Move further out" onClick={() => onMove(1)}>▼</button>
        <button type="button" className="btn" style={small} title="Remove this rule" onClick={onRemove}>×</button>
      </div>

      {rule.column && (rule.op === "is" || rule.op === "not") && (
        <div className="ann-value-list" style={{ maxHeight: 110 }}>
          {categories.map(v => (
            <label key={v} className="ann-value-item">
              <input type="checkbox" checked={rule.values.includes(v)}
                onChange={(e) => onChange({ values: e.target.checked ? [...rule.values, v] : rule.values.filter(x => x !== v) })} />
              <span className="ann-value-swatch" style={{ background: colorOf(v) }} />
              <span className="ann-value-name">{v}</span>
            </label>
          ))}
        </div>
      )}
      {rule.column && (rule.op === "gte" || rule.op === "lte" || rule.op === "between") && (
        <div className="style-row">
          <NumBox value={rule.a} onChange={(a) => onChange({ a })} />
          {rule.op === "between" && <><span className="note">and</span><NumBox value={rule.b} onChange={(b) => onChange({ b })} /></>}
        </div>
      )}

      <div className="style-row">
        <select value={rule.shape} disabled={rule.shapeByValue} onChange={(e) => onChange({ shape: e.target.value as ShapeKind })} style={{ fontSize: 11 }}>
          {SHAPE_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        {rule.column && (
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 3 }} title="A different shape for each value (set below, or from a colour key's shape column)">
            <input type="checkbox" checked={rule.shapeByValue} onChange={(e) => onChange({ shapeByValue: e.target.checked })} /> per value
          </label>
        )}
        {rule.color
          ? <Swatch color={rule.color} title="Marker colour" onClick={() => editColor("Marker colour", rule.color!, (c) => onChange({ color: c }))} />
          : null}
        {rule.column && (
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 3 }} title="Use the column's colours (category colours or its gradient)">
            <input type="checkbox" checked={rule.color === null}
              onChange={(e) => onChange({ color: e.target.checked ? null : "#333333" })} /> column colours
          </label>
        )}
        {!rule.column && !rule.color && (
          <Swatch color="#333333" title="Marker colour" onClick={() => editColor("Marker colour", "#333333", (c) => onChange({ color: c }))} />
        )}
      </div>
      <div className="style-row">
        <span className="note">size</span>
        <input type="range" min={3} max={30} step={1} value={rule.size} onChange={(e) => onChange({ size: Number(e.target.value) })} style={{ flex: 1, minWidth: 0 }} />
        <span className="note" style={{ minWidth: 30 }}>{rule.size} px</span>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <input type="checkbox" checked={rule.filled} onChange={(e) => onChange({ filled: e.target.checked })} /> filled
        </label>
      </div>

      {rule.shapeByValue && shownValues.length > 0 && (
        <div className="ann-value-list" style={{ maxHeight: 130 }}>
          {shownValues.slice(0, 80).map(v => (
            <div key={v} className="style-row" style={{ flexWrap: "nowrap" }}>
              <span className="ann-value-swatch" style={{ background: colorOf(v) }} />
              <span className="ann-value-name" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
              <select value={shapeOf(v)} onChange={(e) => onChange({ shapes: { ...rule.shapes, [v]: e.target.value as ShapeKind } })} style={{ fontSize: 11 }}>
                {SHAPE_CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      <div className="style-row">
        <input type="text" value={rule.label} placeholder={rule.column ? `Legend title (${col?.label ?? rule.column})` : "Legend title"}
          onChange={(e) => onChange({ label: e.target.value })} style={{ fontSize: 11, flex: 1, minWidth: 0 }} />
        <span className="note">{matches.toLocaleString()} leaves</span>
      </div>
    </div>
  );
}
