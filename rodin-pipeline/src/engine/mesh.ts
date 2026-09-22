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

export function srgbToLinear(v: number): number {
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

// ---------------------------------------------------------------------------
// Highlighting and region picking
// ---------------------------------------------------------------------------

/** 1 for every face whose palette position is in `positions`. */
export function maskFromLabels(labels: Int32Array, positions: Iterable<number>): Uint8Array {
  const wanted = new Set(positions);
  const mask = new Uint8Array(labels.length);
  if (wanted.size === 0) return mask;
  for (let i = 0; i < labels.length; i++) if (wanted.has(labels[i])) mask[i] = 1;
  return mask;
}

export function maskFromFaces(faceCount: number, faces: ArrayLike<number>): Uint8Array {
  const mask = new Uint8Array(faceCount);
  for (let i = 0; i < faces.length; i++) mask[faces[i]] = 1;
  return mask;
}

export interface HighlightGeometry {
  /** Non-indexed positions of the highlighted faces (3 corners each). */
  fill: Float32Array;
  /** Boundary edges of the highlighted region as line segments (2 points each). */
  edges: Float32Array;
  faceCount: number;
}

/**
 * Geometry for a glowing region highlight: the faces themselves plus the
 * outline where a highlighted face meets a non-highlighted one.
 */
export function highlightGeometry(model: MeshModel, mask: Uint8Array): HighlightGeometry {
  let faceCount = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) faceCount++;
  const fill = new Float32Array(faceCount * 9);
  const edgeCount = new Map<number, number>();
  const vertexCount = model.vertices.length;
  let p = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const tri = model.triangles[i];
    for (let k = 0; k < 3; k++) {
      const v = model.vertices[tri[k]];
      fill[p++] = v[0];
      fill[p++] = v[1];
      fill[p++] = v[2];
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const key = (a < b ? a : b) * vertexCount + (a < b ? b : a);
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const count of edgeCount.values()) if (count === 1) boundary++;
  const edges = new Float32Array(boundary * 6);
  let e = 0;
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const a = Math.floor(key / vertexCount);
    const b = key - a * vertexCount;
    const va = model.vertices[a];
    const vb = model.vertices[b];
    edges[e++] = va[0];
    edges[e++] = va[1];
    edges[e++] = va[2];
    edges[e++] = vb[0];
    edges[e++] = vb[1];
    edges[e++] = vb[2];
  }
  return { fill, edges, faceCount };
}

/** Faces connected to `start` (sharing vertices) that carry the same label. */
export function sameLabelComponent(
  adjacencyOffsets: Int32Array,
  adjacencyNeighbours: Int32Array,
  labels: Int32Array,
  start: number,
): Int32Array {
  const label = labels[start];
  const visited = new Uint8Array(labels.length);
  const queue: number[] = [start];
  visited[start] = 1;
  const out: number[] = [];
  while (queue.length > 0) {
    const f = queue.pop() as number;
    out.push(f);
    const end = adjacencyOffsets[f + 1];
    for (let i = adjacencyOffsets[f]; i < end; i++) {
      const n = adjacencyNeighbours[i];
      if (visited[n] || labels[n] !== label) continue;
      visited[n] = 1;
      queue.push(n);
    }
  }
  return Int32Array.from(out);
}

// ---------------------------------------------------------------------------
// Face geometry (centroids / normals) and brush queries
// ---------------------------------------------------------------------------

export interface FaceGeometry {
  /** 3 floats per face. */
  centroids: Float32Array;
  /** 3 floats per face, unit length (zero for degenerate faces). */
  normals: Float32Array;
  /** Half of the largest bounding-box extent: a size reference for brush radii. */
  radius: number;
}

export function faceGeometry(model: MeshModel): FaceGeometry {
  const n = model.triangles.length;
  const centroids = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of model.vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  for (let i = 0; i < n; i++) {
    const tri = model.triangles[i];
    const a = model.vertices[tri[0]];
    const b = model.vertices[tri[1]];
    const c = model.vertices[tri[2]];
    centroids[i * 3] = (a[0] + b[0] + c[0]) / 3;
    centroids[i * 3 + 1] = (a[1] + b[1] + c[1]) / 3;
    centroids[i * 3 + 2] = (a[2] + b[2] + c[2]) / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return { centroids, normals, radius: Number.isFinite(extent) ? extent / 2 : 1 };
}

/**
 * Faces whose centroid lies within `radius` of `point`. With `viewDir` (the
 * direction the camera looks along), back-facing faces are skipped so a brush
 * does not leak through thin parts.
 */
export function facesInSphere(
  geometry: FaceGeometry,
  point: [number, number, number],
  radius: number,
  viewDir: [number, number, number] | null,
): Int32Array {
  const { centroids, normals } = geometry;
  const n = centroids.length / 3;
  const r2 = radius * radius;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = centroids[i * 3] - point[0];
    if (dx > radius || dx < -radius) continue;
    const dy = centroids[i * 3 + 1] - point[1];
    if (dy > radius || dy < -radius) continue;
    const dz = centroids[i * 3 + 2] - point[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (viewDir) {
      const dot = normals[i * 3] * viewDir[0] + normals[i * 3 + 1] * viewDir[1] + normals[i * 3 + 2] * viewDir[2];
      if (dot > 0.25) continue;
    }
    out.push(i);
  }
  return Int32Array.from(out);
}
