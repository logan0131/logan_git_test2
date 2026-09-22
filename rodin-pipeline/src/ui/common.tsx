import type { ReactNode } from "react";
import type { RGB } from "@core/types";
import { rgbToHex } from "@core/colour";

export function Section({
  step,
  title,
  badge,
  children,
  open = true,
}: {
  step: number;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        <span className="section-step">{step}</span>
        <span className="section-title">{title}</span>
        {badge && <span className="section-badge">{badge}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="row" title={hint}>
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  width = 90,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  width?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      style={{ width }}
      onChange={(e) => {
        const next = Number(e.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

export function Swatch({ rgb, hex, title, size = 18 }: { rgb?: RGB; hex?: string; title?: string; size?: number }) {
  const colour = hex ?? (rgb ? rgbToHex(rgb) : "#808080");
  return <span className="swatch" style={{ background: colour, width: size, height: size }} title={title ?? colour} />;
}

export function pct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}
