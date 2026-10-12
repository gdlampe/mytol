import React, { useRef, useState } from "react";

/** Index the dragged item should land at when dropped before/after `target`. */
export function moveIndex(from: number, target: number, after: boolean): number {
  let to = target + (after ? 1 : 0);
  if (from < to) to -= 1;
  return to;
}

/** Return a copy of `arr` with the item at `from` moved to `to`. */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= arr.length) return arr;
  const next = [...arr];
  const [m] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, m);
  return next;
}

// One drag at a time across every DragList; the owner token stops a row in
// one list (e.g. a nested entry list) from accepting drops from another.
let activeDrag: { owner: object; index: number } | null = null;

/**
 * Vertical list reorderable by dragging a ⠿ handle (HTML5 drag-and-drop), with
 * ArrowUp/ArrowDown on the focused handle as a keyboard fallback.
 * onMove(from, to) receives final indices (see moveIndex).
 */
export default function DragList<T>({ items, getKey, onMove, renderItem }: {
  items: T[];
  getKey: (item: T) => string;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, handle: React.ReactNode, index: number) => React.ReactNode;
}) {
  const owner = useRef({}).current;
  const [target, setTarget] = useState<{ index: number; after: boolean } | null>(null);
  const ours = () => activeDrag !== null && activeDrag.owner === owner;
  const half = (e: React.DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };

  return (
    <div
      className="drag-list"
      onDragLeave={(e) => {
        if (!ours()) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) setTarget(null);
      }}
    >
      {items.map((item, i) => {
        const handle = (
          <span
            className="drag-handle"
            draggable
            role="button"
            tabIndex={0}
            title="Drag to reorder (or focus and use ↑/↓)"
            onDragStart={(e) => {
              e.stopPropagation();
              activeDrag = { owner, index: i };
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("application/x-mytol-item", getKey(item));
              const row = e.currentTarget.closest(".drag-row");
              if (row) e.dataTransfer.setDragImage(row, 12, 12);
            }}
            onDragEnd={() => { activeDrag = null; setTarget(null); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); onMove(i, i - 1); }
              else if (e.key === "ArrowDown" && i < items.length - 1) { e.preventDefault(); onMove(i, i + 1); }
            }}
          >⠿</span>
        );
        return (
          <div
            key={getKey(item)}
            className={"drag-row" + (target?.index === i ? (target.after ? " drop-after" : " drop-before") : "")}
            onDragOver={(e) => {
              if (!ours()) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              const after = half(e);
              setTarget(prev => (prev?.index === i && prev.after === after ? prev : { index: i, after }));
            }}
            onDrop={(e) => {
              if (!ours()) return;
              e.preventDefault();
              e.stopPropagation();
              const from = activeDrag!.index;
              activeDrag = null;
              setTarget(null);
              const to = moveIndex(from, i, half(e));
              if (to !== from) onMove(from, to);
            }}
          >
            {renderItem(item, handle, i)}
          </div>
        );
      })}
    </div>
  );
}
