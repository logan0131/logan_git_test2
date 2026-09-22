import type { MeshModel, RGB } from "@core/types";
import type { FaceAdjacency } from "@core/meshAdjacency";
import type { FaceGeometry } from "./mesh";

/**
 * A 2D "colour map" of a face-coloured mesh: every face gets a place in a
 * square atlas (Smart-UV style: faces are grouped by dominant normal axis into
 * connected charts, each chart is projected onto its axis plane and the charts
 * are shelf-packed). Pixels map back to faces through `idMap`, so the map can
 * be clicked and painted like the 3D view.
 */
export interface FaceAtlas {
  size: number;
  /** Face index per pixel (row-major), -1 where empty. */
  idMap: Int32Array;
  /** CSR: pixels covered by each face. */
  pixelOffsets: Int32Array;
  pixelIndices: Int32Array;
  /** Atlas-pixel coordinates of the three corners of each face (6 floats per face). */
  faceUv: Float32Array;
  /** Atlas pixels per model unit. */
  scale: number;
  chartCount: number;
  /** Scratch marks for circle queries. */
  marks: Uint8Array;
}

/** Per-chart projection basis: charts are projected onto the plane facing their average normal, kept upright. */
function chartBasis(d: [number, number, number]): { right: [number, number, number]; up: [number, number, number] } {
  let up0: [number, number, number] = Math.abs(d[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  // right = up0 × d, up = d × right
  let rx = up0[1] * d[2] - up0[2] * d[1];
  let ry = up0[2] * d[0] - up0[0] * d[2];
  let rz = up0[0] * d[1] - up0[1] * d[0];
  let len = Math.hypot(rx, ry, rz);
  if (len < 1e-9) {
    up0 = [1, 0, 0];
    rx = up0[1] * d[2] - up0[2] * d[1];
    ry = up0[2] * d[0] - up0[0] * d[2];
    rz = up0[0] * d[1] - up0[1] * d[0];
    len = Math.hypot(rx, ry, rz) || 1;
  }
  rx /= len;
  ry /= len;
  rz /= len;
  const ux = d[1] * rz - d[2] * ry;
  const uy = d[2] * rx - d[0] * rz;
  const uz = d[0] * ry - d[1] * rx;
  const ulen = Math.hypot(ux, uy, uz) || 1;
  return { right: [rx, ry, rz], up: [ux / ulen, uy / ulen, uz / ulen] };
}

/** Maximum angle between a face normal and its chart's seed normal. */
const CHART_CONE_DEGREES = 70;
/** Charts with fewer faces are absorbed by their best-connected neighbour chart. */
const MIN_CHART_FACES = 24;

export function buildFaceAtlas(
  model: MeshModel,
  adjacency: FaceAdjacency,
  geometry: FaceGeometry,
  areas: ArrayLike<number>,
  size: number,
): FaceAtlas {
  const n = model.triangles.length;
  const { normals, centroids } = geometry;
  const { offsets, neighbours } = adjacency;

  // 1. Smoothed normals (face + neighbours) so noisy faces do not break charts apart.
  const smooth = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = normals[i * 3] * 2;
    let y = normals[i * 3 + 1] * 2;
    let z = normals[i * 3 + 2] * 2;
    for (let k = offsets[i]; k < offsets[i + 1]; k++) {
      const g = neighbours[k];
      x += normals[g * 3];
      y += normals[g * 3 + 1];
      z += normals[g * 3 + 2];
    }
    const len = Math.hypot(x, y, z);
    if (len > 0) {
      x /= len;
      y /= len;
      z /= len;
    } else {
      x = normals[i * 3];
      y = normals[i * 3 + 1];
      z = normals[i * 3 + 2];
    }
    smooth[i * 3] = x;
    smooth[i * 3 + 1] = y;
    smooth[i * 3 + 2] = z;
  }

  // 2. Region growing: seeds in order of face area, faces join while their normal stays within the cone.
  const cosLimit = Math.cos((CHART_CONE_DEGREES * Math.PI) / 180);
  const seeds = Array.from({ length: n }, (_v, i) => i).sort((a, b) => areas[b] - areas[a]);
  const chartOf = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let chartCount = 0;
  for (const seed of seeds) {
    if (chartOf[seed] !== -1) continue;
    const chart = chartCount++;
    const dx = smooth[seed * 3];
    const dy = smooth[seed * 3 + 1];
    const dz = smooth[seed * 3 + 2];
    let top = 0;
    stack[top++] = seed;
    chartOf[seed] = chart;
    while (top > 0) {
      const f = stack[--top];
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        if (chartOf[g] !== -1) continue;
        if (smooth[g * 3] * dx + smooth[g * 3 + 1] * dy + smooth[g * 3 + 2] * dz < cosLimit) continue;
        chartOf[g] = chart;
        stack[top++] = g;
      }
    }
  }

  // 3. Absorb tiny charts into the neighbouring chart they touch most (prefer a large one).
  for (let pass = 0; pass < 3; pass++) {
    const sizes = new Int32Array(chartCount);
    for (let i = 0; i < n; i++) sizes[chartOf[i]]++;
    const contacts: Array<Map<number, number> | null> = new Array(chartCount).fill(null);
    for (let i = 0; i < n; i++) {
      const c = chartOf[i];
      if (sizes[c] >= MIN_CHART_FACES) continue;
      let map = contacts[c];
      if (!map) {
        map = new Map();
        contacts[c] = map;
      }
      for (let k = offsets[i]; k < offsets[i + 1]; k++) {
        const other = chartOf[neighbours[k]];
        if (other !== c) map.set(other, (map.get(other) ?? 0) + 1);
      }
    }
    const remap = new Int32Array(chartCount);
    let changed = 0;
    for (let c = 0; c < chartCount; c++) {
      remap[c] = c;
      const map = contacts[c];
      if (!map) continue;
      let best = -1;
      let bestScore = -1;
      for (const [other, count] of map) {
        const score = count + (sizes[other] >= MIN_CHART_FACES ? 1e9 : sizes[other]);
        if (score > bestScore) {
          best = other;
          bestScore = score;
        }
      }
      if (best >= 0) {
        remap[c] = best;
        changed++;
      }
    }
    if (changed === 0) break;
    // Resolve chains (a small chart absorbed into another small chart that was itself absorbed).
    for (let c = 0; c < chartCount; c++) {
      let target = remap[c];
      for (let hop = 0; hop < 8 && remap[target] !== target; hop++) target = remap[target];
      remap[c] = target;
    }
    for (let i = 0; i < n; i++) chartOf[i] = remap[chartOf[i]];
  }
  // Compact chart ids.
  {
    const used = new Int32Array(chartCount).fill(-1);
    let next = 0;
    for (let i = 0; i < n; i++) {
      const c = chartOf[i];
      if (used[c] === -1) used[c] = next++;
      chartOf[i] = used[c];
    }
    chartCount = next;
  }

  // 4. Chart direction (area-weighted normal), basis and bounds; chart centre z for the layout order.
  const dirX = new Float64Array(chartCount);
  const dirY = new Float64Array(chartCount);
  const dirZ = new Float64Array(chartCount);
  const centreZ = new Float64Array(chartCount);
  const weight = new Float64Array(chartCount);
  for (let i = 0; i < n; i++) {
    const c = chartOf[i];
    const a = Math.max(1e-12, areas[i]);
    dirX[c] += normals[i * 3] * a;
    dirY[c] += normals[i * 3 + 1] * a;
    dirZ[c] += normals[i * 3 + 2] * a;
    centreZ[c] += centroids[i * 3 + 2] * a;
    weight[c] += a;
  }
  const bases: Array<{ right: [number, number, number]; up: [number, number, number] }> = new Array(chartCount);
  for (let c = 0; c < chartCount; c++) {
    const len = Math.hypot(dirX[c], dirY[c], dirZ[c]);
    const d: [number, number, number] = len > 0 ? [dirX[c] / len, dirY[c] / len, dirZ[c] / len] : [0, 0, 1];
    bases[c] = chartBasis(d);
    centreZ[c] /= weight[c] || 1;
  }
  const minU = new Float64Array(chartCount).fill(Infinity);
  const minV = new Float64Array(chartCount).fill(Infinity);
  const maxU = new Float64Array(chartCount).fill(-Infinity);
  const maxV = new Float64Array(chartCount).fill(-Infinity);
  const uv = new Float32Array(n * 6);
  for (let f = 0; f < n; f++) {
    const c = chartOf[f];
    const { right, up } = bases[c];
    const tri = model.triangles[f];
    for (let corner = 0; corner < 3; corner++) {
      const v = model.vertices[tri[corner]];
      const u = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
      const w = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
      uv[f * 6 + corner * 2] = u;
      uv[f * 6 + corner * 2 + 1] = w;
      if (u < minU[c]) minU[c] = u;
      if (u > maxU[c]) maxU[c] = u;
      if (w < minV[c]) minV[c] = w;
      if (w > maxV[c]) maxV[c] = w;
    }
  }

  // 5. Scale + shelf packing. Charts are laid out top-to-bottom following the model (bands by
  //    chart height in the model); inside a band, taller charts first. Retry smaller until it fits.
  const pad = 1;
  let area = 0;
  for (let c = 0; c < chartCount; c++) area += Math.max(1e-9, (maxU[c] - minU[c]) * (maxV[c] - minV[c]));
  let scale = Math.sqrt((0.55 * size * size) / Math.max(area, 1e-9));
  const byZ = Array.from({ length: chartCount }, (_v, c) => c).sort((a, b) => centreZ[b] - centreZ[a]);
  const bandCount = Math.max(1, Math.min(12, Math.round(Math.sqrt(chartCount / 8))));
  const bandSize = Math.ceil(chartCount / bandCount);
  const chartX = new Float64Array(chartCount);
  const chartY = new Float64Array(chartCount);
  const widths = new Float64Array(chartCount);
  const heights = new Float64Array(chartCount);
  let fits = false;
  for (let attempt = 0; attempt < 16 && !fits; attempt++) {
    for (let c = 0; c < chartCount; c++) {
      widths[c] = Math.ceil((maxU[c] - minU[c]) * scale) + 2 * pad + 1;
      heights[c] = Math.ceil((maxV[c] - minV[c]) * scale) + 2 * pad + 1;
    }
    let x = 0;
    let y = 0;
    let shelf = 0;
    fits = true;
    for (let b = 0; b < bandCount && fits; b++) {
      const band = byZ.slice(b * bandSize, (b + 1) * bandSize).sort((p, q) => heights[q] - heights[p] || widths[q] - widths[p]);
      if (band.length === 0) continue;
      // A band always starts a new shelf so the vertical order follows the model.
      if (x > 0) {
        y += shelf;
        x = 0;
        shelf = 0;
      }
      for (const c of band) {
        const w = widths[c];
        const h = heights[c];
        if (w > size) {
          fits = false;
          break;
        }
        if (x + w > size) {
          y += shelf;
          x = 0;
          shelf = 0;
        }
        if (y + h > size) {
          fits = false;
          break;
        }
        chartX[c] = x;
        chartY[c] = y;
        x += w;
        if (h > shelf) shelf = h;
      }
    }
    if (!fits) scale *= 0.85;
  }
  if (!fits) throw new Error("Colour map layout did not fit; the mesh is too fragmented for this atlas size.");

  // 5. Face corner pixel coordinates (v axis flipped so "up" is up).
  const faceUv = new Float32Array(n * 6);
  for (let f = 0; f < n; f++) {
    const c = chartOf[f];
    for (let corner = 0; corner < 3; corner++) {
      faceUv[f * 6 + corner * 2] = chartX[c] + pad + 0.5 + (uv[f * 6 + corner * 2] - minU[c]) * scale;
      faceUv[f * 6 + corner * 2 + 1] = chartY[c] + pad + 0.5 + (maxV[c] - uv[f * 6 + corner * 2 + 1]) * scale;
    }
  }

  // 6. Rasterise face ids.
  const idMap = new Int32Array(size * size).fill(-1);
  for (let f = 0; f < n; f++) {
    const x0 = faceUv[f * 6], y0 = faceUv[f * 6 + 1];
    const x1 = faceUv[f * 6 + 2], y1 = faceUv[f * 6 + 3];
    const x2 = faceUv[f * 6 + 4], y2 = faceUv[f * 6 + 5];
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    const areaSign = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    let written = false;
    if (areaSign !== 0) {
      const eps = Math.abs(areaSign) * 1e-4;
      const sign = areaSign > 0 ? 1 : -1;
      for (let py = minY; py <= maxY; py++) {
        const cy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const cx = px + 0.5;
          const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * sign;
          if (w0 < -eps) continue;
          const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * sign;
          if (w1 < -eps) continue;
          const w2 = ((x0 - cx) * (y1 - cy) - (x1 - cx) * (y0 - cy)) * sign;
          if (w2 < -eps) continue;
          idMap[py * size + px] = f;
          written = true;
        }
      }
    }
    if (!written) {
      // Sub-pixel face: claim the pixel under its centroid so it stays reachable.
      const cx = Math.min(size - 1, Math.max(0, Math.floor((x0 + x1 + x2) / 3)));
      const cy = Math.min(size - 1, Math.max(0, Math.floor((y0 + y1 + y2) / 3)));
      idMap[cy * size + cx] = f;
    }
  }

  // 7. CSR of pixels per face.
  const counts = new Int32Array(n + 1);
  for (let i = 0; i < idMap.length; i++) if (idMap[i] >= 0) counts[idMap[i] + 1]++;
  for (let f = 0; f < n; f++) counts[f + 1] += counts[f];
  const pixelOffsets = counts;
  const fill = new Int32Array(n);
  const pixelIndices = new Int32Array(pixelOffsets[n]);
  for (let i = 0; i < idMap.length; i++) {
    const f = idMap[i];
    if (f < 0) continue;
    pixelIndices[pixelOffsets[f] + fill[f]++] = i;
  }

  return { size, idMap, pixelOffsets, pixelIndices, faceUv, scale, chartCount, marks: new Uint8Array(n) };
}

/** Writes face colours into an RGBA buffer (all faces, or only `faces`). Returns the dirty rectangle. */
export function paintAtlasImage(
  atlas: FaceAtlas,
  colourOf: (face: number) => RGB,
  data: Uint8ClampedArray,
  faces?: ArrayLike<number>,
): { x: number; y: number; w: number; h: number } {
  const { idMap, size, pixelOffsets, pixelIndices } = atlas;
  if (!faces) {
    let last = -2;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < idMap.length; i++) {
      const f = idMap[i];
      if (f < 0) {
        data[i * 4 + 3] = 0;
        continue;
      }
      if (f !== last) {
        const rgb = colourOf(f);
        r = rgb[0];
        g = rgb[1];
        b = rgb[2];
        last = f;
      }
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    return { x: 0, y: 0, w: size, h: size };
  }
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let k = 0; k < faces.length; k++) {
    const f = faces[k];
    const rgb = colourOf(f);
    for (let p = pixelOffsets[f]; p < pixelOffsets[f + 1]; p++) {
      const i = pixelIndices[p];
      data[i * 4] = rgb[0];
      data[i * 4 + 1] = rgb[1];
      data[i * 4 + 2] = rgb[2];
      data[i * 4 + 3] = 255;
      const x = i % size;
      const y = (i - x) / size;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export interface AtlasMasks {
  hover: Uint8Array | null;
  selected: Uint8Array | null;
  picked: Uint8Array | null;
}

/** Writes the selection overlay (orange picked, yellow selected, blue hover) into an RGBA buffer. */
export function paintAtlasOverlay(atlas: FaceAtlas, masks: AtlasMasks, data: Uint8ClampedArray): boolean {
  const { idMap } = atlas;
  const { hover, selected, picked } = masks;
  if (!hover && !selected && !picked) {
    data.fill(0);
    return false;
  }
  let any = false;
  for (let i = 0; i < idMap.length; i++) {
    const f = idMap[i];
    if (f < 0) {
      data[i * 4 + 3] = 0;
      continue;
    }
    if (picked && picked[f]) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 138;
      data[i * 4 + 2] = 61;
      data[i * 4 + 3] = 150;
      any = true;
    } else if (selected && selected[f]) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 216;
      data[i * 4 + 2] = 79;
      data[i * 4 + 3] = 120;
      any = true;
    } else if (hover && hover[f]) {
      data[i * 4] = 79;
      data[i * 4 + 1] = 216;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = 130;
      any = true;
    } else {
      data[i * 4 + 3] = 0;
    }
  }
  return any;
}

/** Faces under a circle (atlas pixels). */
export function facesInAtlasCircle(atlas: FaceAtlas, cx: number, cy: number, radius: number): Int32Array {
  const { idMap, size, marks } = atlas;
  const r = Math.max(0.5, radius);
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(size - 1, Math.ceil(cx + r));
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(size - 1, Math.ceil(cy + r));
  const r2 = r * r;
  const out: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy > r2) continue;
      const f = idMap[y * size + x];
      if (f < 0 || marks[f]) continue;
      marks[f] = 1;
      out.push(f);
    }
  }
  for (const f of out) marks[f] = 0;
  return Int32Array.from(out);
}

/** Face under an atlas pixel, or -1. */
export function faceAtAtlasPixel(atlas: FaceAtlas, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= atlas.size || py >= atlas.size) return -1;
  return atlas.idMap[py * atlas.size + px];
}

/** Atlas-pixel centroid of a face. */
export function faceAtlasCentre(atlas: FaceAtlas, face: number): [number, number] {
  const o = face * 6;
  return [(atlas.faceUv[o] + atlas.faceUv[o + 2] + atlas.faceUv[o + 4]) / 3, (atlas.faceUv[o + 1] + atlas.faceUv[o + 3] + atlas.faceUv[o + 5]) / 3];
}
