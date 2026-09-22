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

function dominantBin(nx: number, ny: number, nz: number): number {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ax >= ay && ax >= az) return nx >= 0 ? 0 : 1;
  if (ay >= az) return ny >= 0 ? 2 : 3;
  return nz >= 0 ? 4 : 5;
}

/** Projection of a vertex onto the chart plane of a bin: returns [u, v]. */
function project(bin: number, x: number, y: number, z: number): [number, number] {
  switch (bin) {
    case 0:
      return [y, z];
    case 1:
      return [-y, z];
    case 2:
      return [-x, z];
    case 3:
      return [x, z];
    case 4:
      return [x, y];
    default:
      return [-x, y];
  }
}

export function buildFaceAtlas(model: MeshModel, adjacency: FaceAdjacency, geometry: FaceGeometry, size: number): FaceAtlas {
  const n = model.triangles.length;
  const { normals } = geometry;
  const { offsets, neighbours } = adjacency;

  // 1. Dominant-axis bins, smoothed once by neighbour majority to avoid confetti charts.
  const rawBins = new Uint8Array(n);
  for (let i = 0; i < n; i++) rawBins[i] = dominantBin(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
  const bins = new Uint8Array(n);
  const votes = new Int32Array(6);
  for (let i = 0; i < n; i++) {
    votes.fill(0);
    votes[rawBins[i]] += 2;
    for (let k = offsets[i]; k < offsets[i + 1]; k++) votes[rawBins[neighbours[k]]] += 1;
    let best = rawBins[i];
    for (let b = 0; b < 6; b++) if (votes[b] > votes[best]) best = b;
    bins[i] = best;
  }

  // 2. Charts = connected faces with the same bin.
  const chartOf = new Int32Array(n).fill(-1);
  const order = new Int32Array(n); // faces grouped by chart
  const chartStart: number[] = [];
  const stack = new Int32Array(n);
  let cursor = 0;
  let chartCount = 0;
  for (let seed = 0; seed < n; seed++) {
    if (chartOf[seed] !== -1) continue;
    const chart = chartCount++;
    chartStart.push(cursor);
    let top = 0;
    stack[top++] = seed;
    chartOf[seed] = chart;
    const bin = bins[seed];
    while (top > 0) {
      const f = stack[--top];
      order[cursor++] = f;
      for (let k = offsets[f]; k < offsets[f + 1]; k++) {
        const g = neighbours[k];
        if (chartOf[g] === -1 && bins[g] === bin) {
          chartOf[g] = chart;
          stack[top++] = g;
        }
      }
    }
  }
  chartStart.push(cursor);

  // 3. Chart bounds in projected model units.
  const minU = new Float64Array(chartCount).fill(Infinity);
  const minV = new Float64Array(chartCount).fill(Infinity);
  const maxU = new Float64Array(chartCount).fill(-Infinity);
  const maxV = new Float64Array(chartCount).fill(-Infinity);
  const uv = new Float32Array(n * 6);
  for (let c = 0; c < chartCount; c++) {
    for (let k = chartStart[c]; k < chartStart[c + 1]; k++) {
      const f = order[k];
      const tri = model.triangles[f];
      const bin = bins[f];
      for (let corner = 0; corner < 3; corner++) {
        const v = model.vertices[tri[corner]];
        const [u, w] = project(bin, v[0], v[1], v[2]);
        uv[f * 6 + corner * 2] = u;
        uv[f * 6 + corner * 2 + 1] = w;
        if (u < minU[c]) minU[c] = u;
        if (u > maxU[c]) maxU[c] = u;
        if (w < minV[c]) minV[c] = w;
        if (w > maxV[c]) maxV[c] = w;
      }
    }
  }

  // 4. Scale + shelf packing (retry with a smaller scale until everything fits).
  const pad = 1;
  let area = 0;
  for (let c = 0; c < chartCount; c++) area += Math.max(1e-9, (maxU[c] - minU[c]) * (maxV[c] - minV[c]));
  let scale = Math.sqrt((0.6 * size * size) / Math.max(area, 1e-9));
  const sorted = Array.from({ length: chartCount }, (_v, c) => c);
  const chartX = new Float64Array(chartCount);
  const chartY = new Float64Array(chartCount);
  let fits = false;
  for (let attempt = 0; attempt < 14 && !fits; attempt++) {
    const heights = new Float64Array(chartCount);
    const widths = new Float64Array(chartCount);
    for (let c = 0; c < chartCount; c++) {
      widths[c] = Math.ceil((maxU[c] - minU[c]) * scale) + 2 * pad + 1;
      heights[c] = Math.ceil((maxV[c] - minV[c]) * scale) + 2 * pad + 1;
    }
    sorted.sort((a, b) => heights[b] - heights[a] || widths[b] - widths[a]);
    let x = 0;
    let y = 0;
    let shelf = 0;
    fits = true;
    for (const c of sorted) {
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
