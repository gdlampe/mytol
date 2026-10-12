import React, { useState } from "react";
import { RING_MODULES } from "../lib/rings";
import type { RingKind } from "../lib/rings/types";

/** "Add ring" form: pick a ring type, its column(s) and a name. */
export default function AddRingForm({ columns, onAdd }: {
  columns: Array<{ key: string; label: string; numeric: boolean }>;
  onAdd: (kind: RingKind, fields: string[], label: string) => void;
}) {
  const kinds = RING_MODULES.filter(m => m.kind !== "column");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RingKind | "">("");
  const [picked, setPicked] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const m = kinds.find(k => k.kind === kind);
  const choices = m ? columns.filter(c => !m.fields.numeric || c.numeric) : [];

  if (!open) {
    return (
      <button type="button" className="btn" style={{ marginTop: 6, width: "100%" }} disabled={kinds.length === 0}
        onClick={() => setOpen(true)} title="Heatmaps, multi-value bars, binary shapes, pies, text, domains, box plots, line charts, alignments">
        + Add ring…
      </button>
    );
  }
  const toggle = (k: string) => setPicked(prev => (m?.fields.count === "one" ? [k] : prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]));
  return (
    <div className="add-ring-form">
      <div className="style-row">
        <span className="note">Type</span>
        <select value={kind} onChange={(e) => { setKind(e.target.value as RingKind); setPicked([]); }} style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
          <option value="">Choose…</option>
          {kinds.map(k => <option key={k.kind} value={k.kind}>{k.title}</option>)}
        </select>
      </div>
      {m && (<>
        <div className="note" style={{ margin: "4px 0" }}>{m.description}</div>
        <div className="note" style={{ fontWeight: 600 }}>
          {m.fields.count === "one" ? "Column" : "Columns"} <span style={{ fontWeight: 400 }}>— {m.fields.hint}</span>
        </div>
        <div className="ann-value-list" style={{ maxHeight: 140 }}>
          {choices.length === 0 && <div className="note" style={{ padding: 4 }}>No suitable columns loaded.</div>}
          {choices.map(c => (
            <label key={c.key} className="ann-value-item">
              <input type={m.fields.count === "one" ? "radio" : "checkbox"} name="add-ring-col" checked={picked.includes(c.key)} onChange={() => toggle(c.key)} />
              <span className="ann-value-name">{c.label}</span>
              {c.numeric && <span className="note">#</span>}
            </label>
          ))}
        </div>
        <div className="style-row" style={{ marginTop: 4 }}>
          <span className="note">Name</span>
          <input type="text" value={label} placeholder={m.title} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1, minWidth: 0, fontSize: 12 }} />
        </div>
      </>)}
      <div className="style-row" style={{ marginTop: 6 }}>
        <button type="button" className="btn active" disabled={!m || picked.length === 0}
          onClick={() => { if (m) { onAdd(m.kind, picked, label); setOpen(false); setKind(""); setPicked([]); setLabel(""); } }}>Add ring</button>
        <button type="button" className="btn" onClick={() => { setOpen(false); setKind(""); setPicked([]); setLabel(""); }}>Cancel</button>
      </div>
    </div>
  );
}
