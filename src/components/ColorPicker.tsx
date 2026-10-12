import React, { useRef } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

/** "#abc" / "#aabbcc" / anything else → "#rrggbb" (for <input type="color">). */
export function toHex6(c: string): string {
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : "#000000";
}

/**
 * Colour picker with a hex field and a screen eyedropper. Uses the browser
 * EyeDropper API where available (Chrome/Edge: pick from anywhere on screen);
 * otherwise opens the system colour panel, which has its own eyedropper on macOS.
 */
export function ColorPickerPanel({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const nativeRef = useRef<HTMLInputElement | null>(null);
  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

  const pickFromScreen = async () => {
    if (hasEyeDropper) {
      // Hide the dialog and its dimmed backdrop while sampling, so the picked
      // colour is the real on-screen colour (wait two frames for the repaint).
      document.body.classList.add("eyedropping");
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        const result = await new (window as any).EyeDropper().open();
        if (result?.sRGBHex) onChange(toHex6(result.sRGBHex));
      } catch {
        /* user cancelled */
      } finally {
        document.body.classList.remove("eyedropping");
      }
    } else {
      nativeRef.current?.click();
    }
  };

  return (
    <div className="color-picker-panel">
      <HexColorPicker color={toHex6(color)} onChange={onChange} />
      <div className="color-picker-row">
        <span className="note">#</span>
        <HexColorInput
          color={toHex6(color)}
          // Only full 6-digit codes apply while typing (a 3-digit prefix like
          // "123" would otherwise expand to #112233); a 3-digit code applies on blur.
          onChange={(c) => { if (/^#[0-9a-f]{6}$/i.test(c)) onChange(c.toLowerCase()); }}
          onBlur={(e) => {
            const v = e.currentTarget.value.replace(/^#/, "");
            if (/^[0-9a-f]{3}$/i.test(v)) onChange(toHex6(`#${v}`));
          }}
          className="color-hex-input"
        />
        <button
          type="button"
          className="btn"
          onClick={pickFromScreen}
          title={hasEyeDropper ? "Pick a colour from anywhere on screen" : "Open the system colour picker (use its eyedropper to pick from screen)"}
        >
          ⌖ Pick from screen
        </button>
        <input
          ref={nativeRef}
          type="color"
          value={toHex6(color)}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
          aria-hidden
          style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
        />
      </div>
    </div>
  );
}

/** Small clickable colour square. */
export function Swatch({ color, onClick, title, size = 16 }: { color: string; onClick?: () => void; title?: string; size?: number }) {
  return (
    <span
      className="legend-swatch"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={(e) => { if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      style={{ display: "inline-block", width: size, height: size, background: color, flexShrink: 0 }}
    />
  );
}
