import type { MeshModel, PaletteEntry, RGB, AccentProtectionMode } from "@core/types";
import { nearestPaletteIndex } from "@core/quantize";

export function colourKey(rgb: RGB): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

export function keyToRgb(key: number): RGB {
  return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
}

export function triangleAreaWeights(model: MeshModel): Float32Array {
  const weights = new Float32Array(model.triangles.length);
  for (let i = 0; i < model.triangles.length; i++) {
    const tri = model.triangles[i];
    const a = model.vertices[tri[0]];
    const b = model.vertices[tri[1]];
    const c = model.vertices[tri[2]];
    if (!a || !b || !c) {
      weights[i] = 1;
      continue;
    }
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    const area = 0.5 * Math.hypot(cx, cy, cz);
    weights[i] = Number.isFinite(area) && area > 0 ? area : 1;
  }
  return weights;
}

/** Non-indexed position buffer (3 corners per face) for the viewer. */
export function buildPositions(model: MeshModel): Float32Array {
  const out = new Float32Array(model.triangles.length * 9);
  let p = 0;
  for (const tri of model.triangles) {
    for (let k = 0; k < 3; k++) {
      const v = model.vertices[tri[k]];
      out[p++] = v[0];
      out[p++] = v[1];
      out[p++] = v[2];
    }
  }
  return out;
}

function srgbToLinear(v: number): number {
  const c = Math.max(0, Math.min(1, v / 255));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Non-indexed linear colour buffer for the viewer (3 corners per face). */
export function buildColourBuffer(faceCount: number, colourOfFace: (index: number) => RGB): Float32Array {
  const out = new Float32Array(faceCount * 9);
  const cache = new Map<number, [number, number, number]>();
  let p = 0;
  for (let i = 0; i < faceCount; i++) {
    const rgb = colourOfFace(i);
    const key = colourKey(rgb);
    let lin = cache.get(key);
    if (!lin) {
      lin = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
      cache.set(key, lin);
    }
    for (let k = 0; k < 3; k++) {
      out[p++] = lin[0];
      out[p++] = lin[1];
      out[p++] = lin[2];
    }
  }
  return out;
}

/** Palette position (0-based) per face, with an exact-colour cache. */
export function paletteLabels(
  colours: ArrayLike<RGB>,
  palette: PaletteEntry[],
  accentProtection: AccentProtectionMode,
): Int32Array {
  const labels = new Int32Array(colours.length);
  if (palette.length === 0) return labels;
  const cache = new Map<number, number>();
  for (let i = 0; i < colours.length; i++) {
    const rgb = colours[i];
    const key = colourKey(rgb);
    let label = cache.get(key);
    if (label === undefined) {
      label = nearestPaletteIndex(rgb, palette, accentProtection);
      cache.set(key, label);
    }
    labels[i] = label;
  }
  return labels;
}

export function areaFractionByPosition(
  labels: Int32Array,
  positionCount: number,
  weights: Float32Array,
): Float64Array {
  const sums = new Float64Array(positionCount);
  let total = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label < 0 || label >= positionCount) continue;
    const w = weights[i] ?? 1;
    sums[label] += w;
    total += w;
  }
  if (total > 0) for (let k = 0; k < positionCount; k++) sums[k] /= total;
  return sums;
}

/** Most frequent real face colour per palette position. */
export function representativeColoursByPosition(
  colours: ArrayLike<RGB>,
  labels: Int32Array,
  palette: PaletteEntry[],
): RGB[] {
  const counts: Array<Map<number, number>> = palette.map(() => new Map());
  for (let i = 0; i < labels.length; i++) {
    const bucket = counts[labels[i]];
    if (!bucket) continue;
    const key = colourKey(colours[i]);
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  return palette.map((entry, position) => {
    let bestKey = -1;
    let bestCount = 0;
    for (const [key, count] of counts[position]) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    return bestKey < 0 ? entry.rgb : keyToRgb(bestKey);
  });
}

export function countUniqueColours(colours: ArrayLike<RGB>): number {
  const keys = new Set<number>();
  for (let i = 0; i < colours.length; i++) keys.add(colourKey(colours[i]));
  return keys.size;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
