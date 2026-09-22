import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { Swatch } from "./common";

const HEX_RE = /^#[0-9A-F]{6}$/;

export function normaliseHex(input: string): string | null {
  const v = input.trim().toUpperCase();
  if (HEX_RE.test(v)) return v;
  if (/^[0-9A-F]{6}$/.test(v)) return `#${v}`;
  if (/^#?[0-9A-F]{3}$/.test(v)) {
    const s = v.replace("#", "");
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  return null;
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbTupleToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

export function hexToHsv(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexToRgbTuple(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max > 0 ? d / max : 0, max];
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbTupleToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export interface ColourPickerProps {
  /** Current colour as #RRGGBB. */
  value: string;
  /** Live mode: called on every change. Commit mode: called once on Apply. */
  onChange: (hex: string) => void;
  /** Show Apply/Cancel and only report the colour on Apply (for expensive operations). */
  commit?: boolean;
  disabled?: boolean;
  title?: string;
  /** Trigger content; defaults to a swatch plus the hex code. */
  children?: ReactNode;
  size?: number;
  className?: string;
}

export function ColourPicker({ value, onChange, commit = false, disabled, title, children, size = 18, className }: ColourPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  const [style, setStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);

  const setColour = useCallback(
    (hex: string, nextHsv?: [number, number, number]) => {
      setDraft(hex);
      setHexText(hex);
      setHsv(nextHsv ?? hexToHsv(hex));
      if (!commit) onChange(hex);
    },
    [commit, onChange],
  );

  const openPicker = () => {
    if (disabled) return;
    setDraft(value);
    setHexText(value);
    setHsv(hexToHsv(value));
    setOpen(true);
  };

  const close = useCallback(() => setOpen(false), []);

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const rect = trigger.getBoundingClientRect();
    const width = popover.offsetWidth || 260;
    const height = popover.offsetHeight || 320;
    const margin = 8;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width);
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 4);
    setStyle({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePlacement();
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", updatePlacement, true);
    window.addEventListener("resize", updatePlacement);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", updatePlacement, true);
      window.removeEventListener("resize", updatePlacement);
    };
  }, [open, close, updatePlacement]);

  // Saturation/value square drag.
  const svFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const next: [number, number, number] = [hsv[0], s, v];
    setColour(hsvToHex(next[0], next[1], next[2]), next);
  };
  const onSvPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    svFromPointer(event);
  };
  const onSvPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons & 1) svFromPointer(event);
  };

  const onHue = (h: number) => {
    const next: [number, number, number] = [h, hsv[1], hsv[2]];
    setColour(hsvToHex(next[0], next[1], next[2]), next);
  };

  const commitHexText = () => {
    const hex = normaliseHex(hexText);
    if (hex) setColour(hex);
    else setHexText(draft);
  };

  const [r, g, b] = hexToRgbTuple(draft);
  const setChannel = (index: number, raw: string) => {
    const n = Math.max(0, Math.min(255, Math.round(Number(raw))));
    if (!Number.isFinite(n)) return;
    const rgb: [number, number, number] = [r, g, b];
    rgb[index] = n;
    setColour(rgbTupleToHex(rgb[0], rgb[1], rgb[2]));
  };

  const apply = () => {
    onChange(draft);
    close();
  };

  const hueColour = hsvToHex(hsv[0], 1, 1);
  const marker: CSSProperties = { left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`colour-picker-trigger${className ? ` ${className}` : ""}${open ? " open" : ""}`}
        disabled={disabled}
        title={title ?? t("picker.editColour")}
        onClick={openPicker}
      >
        {children ?? (
          <>
            <Swatch hex={value} size={size} />
            <code>{value}</code>
          </>
        )}
      </button>
      {open && (
        <div ref={popoverRef} className="colour-picker-popover" style={style} role="dialog">
          <div
            ref={svRef}
            className="cp-sv"
            style={{ backgroundColor: hueColour }}
            onPointerDown={onSvPointerDown}
            onPointerMove={onSvPointerMove}
          >
            <span className="cp-sv-marker" style={{ ...marker, background: draft }} />
          </div>
          <input
            type="range"
            className="cp-hue"
            min={0}
            max={360}
            step={1}
            value={Math.round(hsv[0])}
            onChange={(e) => onHue(Number(e.target.value))}
            aria-label="hue"
          />
          <div className="cp-row">
            <span className="cp-preview" title={t("picker.before")}>
              <Swatch hex={value} size={22} />
            </span>
            <span className="cp-preview" title={t("picker.after")}>
              <Swatch hex={draft} size={22} />
            </span>
            <label className="cp-hex">
              <span>{t("picker.hex")}</span>
              <input
                type="text"
                value={hexText}
                spellCheck={false}
                onChange={(e) => setHexText(e.target.value.toUpperCase())}
                onBlur={commitHexText}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const hex = normaliseHex(hexText);
                    if (hex) {
                      setColour(hex);
                      if (commit) {
                        onChange(hex);
                        close();
                      }
                    }
                  }
                }}
              />
            </label>
          </div>
          <div className="cp-row cp-rgb">
            {(["R", "G", "B"] as const).map((label, i) => (
              <label key={label}>
                <span>{label}</span>
                <input type="number" min={0} max={255} value={[r, g, b][i]} onChange={(e) => setChannel(i, e.target.value)} />
              </label>
            ))}
            <label className="cp-system" title={t("picker.system")}>
              <input type="color" value={draft} onChange={(e) => setColour(e.target.value.toUpperCase())} />
              <span>{t("picker.system")}</span>
            </label>
          </div>
          {commit && (
            <div className="cp-row cp-actions">
              <button type="button" className="btn small" onClick={close}>
                {t("picker.cancel")}
              </button>
              <button type="button" className="btn primary small" disabled={draft === value} onClick={apply}>
                {t("picker.apply")}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
