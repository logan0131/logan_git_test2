import type { RGB, Tri, Vec3 } from "./types";

/**
 * Small CPU rasteriser shared by the 3MF thumbnail export and the merge
 * before/after comparison.  It has no canvas dependency; only the PNG/data-URL
 * helpers at the bottom need a browser.
 */

export type ThumbnailView = "front-top-left" | "front" | "back" | "left" | "right" | "top";
export type ThumbnailCoordinateMode = "keep" | "blender-y-up";

export interface ThumbnailRenderOptions {
  width?: number;
  height?: number;
  view?: ThumbnailView;
  coordinateMode?: ThumbnailCoordinateMode;
  background?: RGB;
  /** Fraction of the image the model may fill (0..1). */
  fill?: number;
}

export interface ThumbnailRaster {
  width: number;
  height: number;
  /** RGBA bytes, row-major, top-left origin. */
  data: Uint8ClampedArray;
}

interface Basis {
  view: Vec3;
  right: Vec3;
  up: Vec3;
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function viewVector(view: ThumbnailView): Vec3 {
  // Vector from the model centre towards the virtual camera (Z-up world).
  switch (view) {
    case "front":
      return [0, -1, 0];
    case "back":
      return [0, 1, 0];
    case "left":
      return [-1, 0, 0];
    case "right":
      return [1, 0, 0];
    case "top":
      return [0, 0, 1];
    default:
      return normalize3([-0.72, -1.0, 0.68]);
  }
}

function basisFor(view: ThumbnailView): Basis {
  const v = viewVector(view);
  const worldUp: Vec3 = [0, 0, 1];
  let right = cross3(worldUp, v);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-9) right = [1, 0, 0];
  right = normalize3(right);
  const up = normalize3(cross3(v, right));
  return { view: v, right, up };
}

function transformVertex(v: Vec3, mode: ThumbnailCoordinateMode): Vec3 {
  if (mode === "keep") return v;
  const [x, y, z] = v;
  return [x, -z, y];
}

function project(basis: Basis, v: Vec3): [number, number, number] {
  return [dot3(v, basis.right), dot3(v, basis.up), dot3(v, basis.view)];
}

function shade(rgb: RGB, normal: Vec3, basis: Basis): RGB {
  const facing = Math.abs(dot3(normal, basis.view));
  const factor = 0.58 + 0.42 * Math.max(0, Math.min(1, facing));
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * factor))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * factor))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * factor))),
  ];
}

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

interface Target {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  z: Float32Array;
}

function writePixel(target: Target, x: number, y: number, depth: number, rgb: RGB): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const zi = y * target.width + x;
  if (depth <= target.z[zi]) return;
  target.z[zi] = depth;
  const oi = zi * 4;
  target.data[oi] = rgb[0];
  target.data[oi + 1] = rgb[1];
  target.data[oi + 2] = rgb[2];
  target.data[oi + 3] = 255;
}

function rasterizeTriangle(
  target: Target,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  d0: number,
  d1: number,
  d2: number,
  rgb: RGB,
): void {
  const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
  const maxX = Math.min(target.width - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
  const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
  const maxY = Math.min(target.height - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
  if (maxX < minX || maxY < minY) return;

  const area = edge(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]);
  if (Math.abs(area) < 1e-6 || (maxX - minX <= 1 && maxY - minY <= 1)) {
    writePixel(
      target,
      Math.round((p0[0] + p1[0] + p2[0]) / 3),
      Math.round((p0[1] + p1[1] + p2[1]) / 3),
      (d0 + d1 + d2) / 3,
      rgb,
    );
    if (Math.abs(area) < 1e-6) return;
  }

  const invArea = 1 / area;
  const epsilon = -1e-5;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = edge(p1[0], p1[1], p2[0], p2[1], px, py) * invArea;
      const w1 = edge(p2[0], p2[1], p0[0], p0[1], px, py) * invArea;
      const w2 = 1 - w0 - w1;
      if (w0 < epsilon || w1 < epsilon || w2 < epsilon) continue;
      writePixel(target, x, y, w0 * d0 + w1 * d1 + w2 * d2, rgb);
    }
  }
}

export function renderModelThumbnail(
  mesh: { vertices: ArrayLike<Vec3>; triangles: ArrayLike<Tri> },
  colourOfTriangle: (index: number) => RGB,
  options: ThumbnailRenderOptions = {},
): ThumbnailRaster {
  const width = Math.max(4, Math.round(options.width ?? 768));
  const height = Math.max(4, Math.round(options.height ?? width));
  const mode = options.coordinateMode ?? "keep";
  const basis = basisFor(options.view ?? "front-top-left");
  const fill = Math.max(0.1, Math.min(1, options.fill ?? 0.78));
  const bg = options.background ?? [178, 178, 178];

  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < mesh.vertices.length; i++) {
    const [u, v] = project(basis, transformVertex(mesh.vertices[i], mode));
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (!Number.isFinite(minU)) {
    minU = maxU = minV = maxV = 0;
  }
  const spanU = Math.max(1e-9, maxU - minU);
  const spanV = Math.max(1e-9, maxV - minV);
  const scale = Math.min((width * fill) / spanU, (height * fill) / spanV);
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0];
    data[i + 1] = bg[1];
    data[i + 2] = bg[2];
    data[i + 3] = 255;
  }
  const target: Target = { width, height, data, z: new Float32Array(width * height) };
  target.z.fill(Number.NEGATIVE_INFINITY);

  for (let i = 0; i < mesh.triangles.length; i++) {
    const tri = mesh.triangles[i];
    const a0 = mesh.vertices[tri[0]];
    const b0 = mesh.vertices[tri[1]];
    const c0 = mesh.vertices[tri[2]];
    if (!a0 || !b0 || !c0) continue;
    const a = transformVertex(a0, mode);
    const b = transformVertex(b0, mode);
    const c = transformVertex(c0, mode);
    const normal = normalize3(cross3(subtract3(b, a), subtract3(c, a)));
    const rgb = shade(colourOfTriangle(i), normal, basis);
    const pa = project(basis, a);
    const pb = project(basis, b);
    const pc = project(basis, c);
    const p0: [number, number] = [width / 2 + (pa[0] - centerU) * scale, height / 2 - (pa[1] - centerV) * scale];
    const p1: [number, number] = [width / 2 + (pb[0] - centerU) * scale, height / 2 - (pb[1] - centerV) * scale];
    const p2: [number, number] = [width / 2 + (pc[0] - centerU) * scale, height / 2 - (pc[1] - centerV) * scale];
    rasterizeTriangle(target, p0, p1, p2, pa[2], pb[2], pc[2], rgb);
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// Browser helpers (canvas based)
// ---------------------------------------------------------------------------

function rasterToCanvas(raster: ThumbnailRaster): HTMLCanvasElement | OffscreenCanvas {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(raster.width, raster.height)
      : Object.assign(document.createElement("canvas"), { width: raster.width, height: raster.height });
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d", { alpha: false }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Could not create thumbnail canvas context.");
  const image = ctx.createImageData(raster.width, raster.height);
  image.data.set(raster.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export async function rasterToPngBytes(raster: ThumbnailRaster): Promise<Uint8Array> {
  const canvas = rasterToCanvas(raster);
  let blob: Blob;
  if ("convertToBlob" in canvas) {
    blob = await canvas.convertToBlob({ type: "image/png" });
  } else {
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("Could not create thumbnail PNG."));
      }, "image/png");
    });
  }
  return new Uint8Array(await blob.arrayBuffer());
}

export async function rasterToDataUrl(raster: ThumbnailRaster): Promise<string> {
  const canvas = rasterToCanvas(raster);
  if ("toDataURL" in canvas) return canvas.toDataURL("image/png");
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read thumbnail."));
    reader.readAsDataURL(blob);
  });
}
