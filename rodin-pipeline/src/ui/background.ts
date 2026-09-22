import type { CSSProperties } from "react";

/** Preview background: optional checkerboard (like an image editor's transparency grid) and a brightness. */
export interface ViewBackground {
  checker: boolean;
  /** 0 (dark) .. 1 (light). */
  brightness: number;
}

export const DEFAULT_BACKGROUND: ViewBackground = { checker: true, brightness: 0.25 };

export function backgroundColours(bg: ViewBackground): { base: string; alt: string } {
  const b = Math.max(0, Math.min(1, bg.brightness));
  const base = Math.round(22 + b * 225);
  const alt = Math.round(base + (b < 0.5 ? 20 : -20));
  const hex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return { base: `#${hex(base)}${hex(base)}${hex(base)}`, alt: `#${hex(alt)}${hex(alt)}${hex(alt)}` };
}

/** CSS for an element that sits behind a transparent canvas. */
export function backgroundStyle(bg: ViewBackground, size = 18): CSSProperties {
  const { base, alt } = backgroundColours(bg);
  if (!bg.checker) return { backgroundColor: base, backgroundImage: "none" };
  const half = size / 2;
  return {
    backgroundColor: base,
    backgroundImage: `linear-gradient(45deg, ${alt} 25%, transparent 25%, transparent 75%, ${alt} 75%), linear-gradient(45deg, ${alt} 25%, transparent 25%, transparent 75%, ${alt} 75%)`,
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `0 0, ${half}px ${half}px`,
  };
}

/** Fills a 2D canvas area with the background (checkerboard in screen pixels). */
export function fillBackground(ctx: CanvasRenderingContext2D, width: number, height: number, bg: ViewBackground, size = 18): void {
  const { base, alt } = backgroundColours(bg);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  if (!bg.checker) return;
  const half = size / 2;
  ctx.fillStyle = alt;
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      ctx.fillRect(x, y, half, half);
      ctx.fillRect(x + half, y + half, half, half);
    }
  }
}

export function loadStoredBackground(): ViewBackground {
  try {
    const raw = window.localStorage.getItem("rodin-pipeline-background");
    if (!raw) return { ...DEFAULT_BACKGROUND };
    const parsed = JSON.parse(raw) as Partial<ViewBackground>;
    return {
      checker: typeof parsed.checker === "boolean" ? parsed.checker : DEFAULT_BACKGROUND.checker,
      brightness: typeof parsed.brightness === "number" && Number.isFinite(parsed.brightness) ? Math.max(0, Math.min(1, parsed.brightness)) : DEFAULT_BACKGROUND.brightness,
    };
  } catch {
    return { ...DEFAULT_BACKGROUND };
  }
}

export function storeBackground(bg: ViewBackground): void {
  try {
    window.localStorage.setItem("rodin-pipeline-background", JSON.stringify(bg));
  } catch {
    // ignore
  }
}
