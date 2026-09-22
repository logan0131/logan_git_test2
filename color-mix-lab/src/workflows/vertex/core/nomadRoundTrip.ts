import type { MeshModel, RGB, Tri, Vec3 } from "./types";
import { clamp255, rgbToHex, parseHexColour } from "./colour";
import { deltaE2000, rgbToLab } from "./prusaFdmMixer";
import { majorityVertexLabels } from "./meshAdjacency";

/**
 * Feature C of the Rodin work order: Nomad Sculpt round trip.
 *
 * C-1  Export the merged model as a vertex-colour OBJ with exactly N palette
 *      colours.  Vertices are written as they are (no positional welding) so
 *      that the face order can be matched again when the file comes back.
 * C-2  Import the OBJ that Nomad exports (`v x y z r g b`).  When the topology
 *      is unchanged only the colours are updated; otherwise the whole model is
 *      reloaded.  Every vertex colour is snapped to the nearest palette colour
 *      (CIEDE2000) and faces take the majority colour of their three corners.
 */

export const NOMAD_OFF_PALETTE_DELTA_E = 8;
export const NOMAD_OFF_PALETTE_WARN_FRACTION = 0.01;
export const NOMAD_OFF_PALETTE_WARNING =
  "Colours outside the palette were painted. In Nomad, pick existing model colours with the eyedropper only. " +
  "/ 팔레트에 없는 색이 칠해져 있습니다. 노마드에서 스포이트로 기존 색만 쓰세요.";

export const NOMAD_USAGE_RULES: string[] = [
  "Do not create new colours: pick the model's existing colours with the eyedropper and paint with those.",
  "Brush strength 100%, no falloff, and never use Smooth color.",
  "Paint the Color channel only (turn Roughness and Metalness off).",
  "No Voxel remesh, Decimate or any other remesh: the face order must stay identical.",
  "Export as OBJ with vertex colours enabled.",
];

const PALETTE_COMMENT_PREFIX = "# CML palette:";

export interface NomadExportResult {
  obj: string;
  fileName: string;
  colourCount: number;
  vertexCount: number;
  faceCount: number;
  /** Palette colours actually written (index = label). */
  palette: RGB[];
}

function colourKey(rgb: RGB): number {
  return (clamp255(rgb[0]) << 16) | (clamp255(rgb[1]) << 8) | clamp255(rgb[2]);
}

function nearestPaletteLabel(rgb: RGB, palette: RGB[]): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - rgb[0];
    const dg = p[1] - rgb[1];
    const db = p[2] - rgb[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Palette label per face (exact colour match first, nearest RGB otherwise). */
export function faceLabelsForPalette(faceColours: ArrayLike<RGB>, palette: RGB[]): Int32Array {
  const labels = new Int32Array(faceColours.length);
  const cache = new Map<number, number>();
  for (let i = 0; i < palette.length; i++) {
    const key = colourKey(palette[i]);
    if (!cache.has(key)) cache.set(key, i);
  }
  for (let i = 0; i < faceColours.length; i++) {
    const rgb = faceColours[i];
    const key = colourKey(rgb);
    let label = cache.get(key);
    if (label === undefined) {
      label = nearestPaletteLabel(rgb, palette);
      cache.set(key, label);
    }
    labels[i] = label;
  }
  return labels;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(6)).toString();
}

function baseName(name: string): string {
  const stripped = name.replace(/\.[^.]+$/, "").replace(/_\d+colors_for_nomad$/i, "");
  return (stripped || "model").replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

export function nomadExportFileName(modelName: string, colourCount: number): string {
  return `${baseName(modelName)}_${colourCount}colors_for_nomad.obj`;
}

/**
 * C-1: vertex-colour OBJ for Nomad.  `faceColours` are the current model face
 * colours; `palette` is the fixed set of N colours the file may contain.
 */
export function buildNomadObj(
  model: MeshModel,
  faceColours: ArrayLike<RGB>,
  palette: RGB[],
  modelName = model.name,
): NomadExportResult {
  if (palette.length === 0) throw new Error("The palette is empty.");
  if (faceColours.length !== model.triangles.length)
    throw new Error("Face colour data does not match the model.");
  const faceLabels = faceLabelsForPalette(faceColours, palette);
  const vertexLabels = majorityVertexLabels(
    model.triangles,
    faceLabels,
    model.vertices.length,
    palette.length,
  );
  const usedLabels = new Set<number>();
  for (let i = 0; i < faceLabels.length; i++) usedLabels.add(faceLabels[i]);
  const colourCount = usedLabels.size;
  const fileName = nomadExportFileName(modelName, colourCount);

  const lines: string[] = [];
  lines.push("# Color Mix Lab: vertex-colour OBJ for Nomad Sculpt round trip");
  lines.push(`# colours: ${colourCount}`);
  lines.push(`${PALETTE_COMMENT_PREFIX} ${palette.map(rgbToHex).join(" ")}`);
  lines.push("# Vertices are NOT welded; keep the face order (no remesh/decimate) so colours can be re-imported.");
  lines.push("# Vertex colour = majority colour of the adjacent faces.");
  lines.push(`o ${baseName(modelName)}`);
  const paletteText = palette.map((rgb) => `${fmt(rgb[0] / 255)} ${fmt(rgb[1] / 255)} ${fmt(rgb[2] / 255)}`);
  for (let v = 0; v < model.vertices.length; v++) {
    const [x, y, z] = model.vertices[v];
    const label = vertexLabels[v] >= 0 ? vertexLabels[v] : 0;
    lines.push(`v ${fmt(x)} ${fmt(y)} ${fmt(z)} ${paletteText[label]}`);
  }
  for (const tri of model.triangles) {
    lines.push(`f ${tri[0] + 1} ${tri[1] + 1} ${tri[2] + 1}`);
  }
  lines.push("");
  return {
    obj: lines.join("\n"),
    fileName,
    colourCount,
    vertexCount: model.vertices.length,
    faceCount: model.triangles.length,
    palette,
  };
}

// ---------------------------------------------------------------------------
// C-2: import
// ---------------------------------------------------------------------------

export interface ParsedNomadObj {
  vertices: Vec3[];
  vertexColours: Array<RGB | null>;
  triangles: Tri[];
  colouredVertexCount: number;
  paletteHint: RGB[] | null;
}

function parseColourTokens(tokens: string[]): RGB | null {
  if (tokens.length < 3) return null;
  const r = Number(tokens[0]);
  const g = Number(tokens[1]);
  const b = Number(tokens[2]);
  if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
  if (Math.max(r, g, b) <= 1.0) return [clamp255(r * 255), clamp255(g * 255), clamp255(b * 255)];
  return [clamp255(r), clamp255(g), clamp255(b)];
}

function resolveIndex(token: string, vertexCount: number): number {
  const vi = Number.parseInt(token.split("/")[0], 10);
  if (!Number.isFinite(vi) || vi === 0) return -1;
  return vi < 0 ? vertexCount + vi : vi - 1;
}

export function parseNomadObj(text: string): ParsedNomadObj {
  const vertices: Vec3[] = [];
  const vertexColours: Array<RGB | null> = [];
  const triangles: Tri[] = [];
  let colouredVertexCount = 0;
  let paletteHint: RGB[] | null = null;

  let start = 0;
  const length = text.length;
  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("#")) {
      if (line.startsWith(PALETTE_COMMENT_PREFIX)) {
        const colours = line
          .slice(PALETTE_COMMENT_PREFIX.length)
          .trim()
          .split(/\s+/)
          .flatMap((token) => {
            const rgba = parseHexColour(token);
            return rgba ? [[rgba[0], rgba[1], rgba[2]] as RGB] : [];
          });
        if (colours.length > 0) paletteHint = colours;
      }
      return;
    }
    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) return;
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (![x, y, z].every(Number.isFinite)) return;
      vertices.push([x, y, z]);
      const rgb = parseColourTokens(parts.slice(4, 7));
      if (rgb) colouredVertexCount++;
      vertexColours.push(rgb);
      return;
    }
    if (line.startsWith("f ")) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) return;
      const indices = parts.slice(1).map((token) => resolveIndex(token, vertices.length));
      if (indices.some((idx) => idx < 0 || idx >= vertices.length)) return;
      for (let i = 1; i < indices.length - 1; i++) {
        triangles.push([indices[0], indices[i], indices[i + 1]]);
      }
    }
  };
  for (let i = 0; i < length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10 || ch === 13) {
      if (i > start) handleLine(text.slice(start, i));
      if (ch === 13 && text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
  }
  if (start < length) handleLine(text.slice(start));
  return { vertices, vertexColours, triangles, colouredVertexCount, paletteHint };
}

export interface NomadSnapReport {
  /** Palette label per vertex (0-based; vertices without colour get the nearest of black). */
  labels: Int32Array;
  offPaletteVertexCount: number;
  offPaletteFraction: number;
  maxDeltaE: number;
  uniqueColourCount: number;
  warning: string | null;
}

/** Snap every vertex colour to the nearest palette colour using CIEDE2000. */
export function snapVertexColoursToPalette(
  colours: ArrayLike<RGB | null>,
  palette: RGB[],
  options: { deltaEThreshold?: number; warnFraction?: number } = {},
): NomadSnapReport {
  if (palette.length === 0) throw new Error("The palette is empty.");
  const threshold = options.deltaEThreshold ?? NOMAD_OFF_PALETTE_DELTA_E;
  const warnFraction = options.warnFraction ?? NOMAD_OFF_PALETTE_WARN_FRACTION;
  const paletteLab = palette.map((rgb) => rgbToLab(rgb));
  const cache = new Map<number, { label: number; deltaE: number }>();
  const labels = new Int32Array(colours.length);
  let offPalette = 0;
  let maxDeltaE = 0;
  let colouredCount = 0;
  for (let i = 0; i < colours.length; i++) {
    const rgb = colours[i];
    if (!rgb) {
      labels[i] = 0;
      continue;
    }
    colouredCount++;
    const key = colourKey(rgb);
    let hit = cache.get(key);
    if (!hit) {
      const lab = rgbToLab(rgb);
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let p = 0; p < paletteLab.length; p++) {
        const d = deltaE2000(lab, paletteLab[p]);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      hit = { label: best, deltaE: bestD };
      cache.set(key, hit);
    }
    labels[i] = hit.label;
    if (hit.deltaE >= threshold) offPalette++;
    if (hit.deltaE > maxDeltaE) maxDeltaE = hit.deltaE;
  }
  const offPaletteFraction = colouredCount > 0 ? offPalette / colouredCount : 0;
  return {
    labels,
    offPaletteVertexCount: offPalette,
    offPaletteFraction,
    maxDeltaE,
    uniqueColourCount: cache.size,
    warning: offPaletteFraction > warnFraction ? NOMAD_OFF_PALETTE_WARNING : null,
  };
}

/**
 * Face label = majority of the three corner labels; when all three differ,
 * the corner closest to the face centroid wins.
 */
export function faceLabelsFromVertexLabels(
  vertices: ArrayLike<Vec3>,
  triangles: ArrayLike<Tri>,
  vertexLabels: ArrayLike<number>,
): Int32Array {
  const out = new Int32Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    const [a, b, c] = triangles[i];
    const la = vertexLabels[a];
    const lb = vertexLabels[b];
    const lc = vertexLabels[c];
    if (la === lb || la === lc) {
      out[i] = la;
      continue;
    }
    if (lb === lc) {
      out[i] = lb;
      continue;
    }
    const va = vertices[a];
    const vb = vertices[b];
    const vc = vertices[c];
    const cx = (va[0] + vb[0] + vc[0]) / 3;
    const cy = (va[1] + vb[1] + vc[1]) / 3;
    const cz = (va[2] + vb[2] + vc[2]) / 3;
    const da = (va[0] - cx) ** 2 + (va[1] - cy) ** 2 + (va[2] - cz) ** 2;
    const db = (vb[0] - cx) ** 2 + (vb[1] - cy) ** 2 + (vb[2] - cz) ** 2;
    const dc = (vc[0] - cx) ** 2 + (vc[1] - cy) ** 2 + (vc[2] - cz) ** 2;
    out[i] = da <= db && da <= dc ? la : db <= dc ? lb : lc;
  }
  return out;
}

export interface NomadImportResult {
  model: MeshModel;
  mode: "colours-only" | "full-reload";
  snap: NomadSnapReport;
  colourCount: number;
  warnings: string[];
}

/**
 * C-2: apply a Nomad OBJ to the current model.  When vertex and face counts
 * match, only the face colours change; otherwise the imported geometry
 * replaces the model (with a warning).
 */
export function applyNomadObjToModel(
  current: MeshModel | null,
  parsed: ParsedNomadObj,
  palette: RGB[],
  name: string,
): NomadImportResult {
  if (parsed.vertices.length === 0 || parsed.triangles.length === 0)
    throw new Error("The OBJ has no usable vertices/faces.");
  if (parsed.colouredVertexCount === 0)
    throw new Error("The OBJ has no vertex colours. Export from Nomad with vertex colours enabled.");
  const effectivePalette = palette.length > 0 ? palette : parsed.paletteHint ?? [];
  if (effectivePalette.length === 0)
    throw new Error("No palette available for snapping. Load the model first or export the Nomad OBJ from Color Mix Lab.");

  const warnings: string[] = [];
  const snap = snapVertexColoursToPalette(parsed.vertexColours, effectivePalette);
  if (snap.warning) warnings.push(snap.warning);

  const sameTopology =
    current !== null &&
    current.vertices.length === parsed.vertices.length &&
    current.triangles.length === parsed.triangles.length;
  const mode: NomadImportResult["mode"] = sameTopology ? "colours-only" : "full-reload";
  if (!sameTopology) {
    warnings.push(
      current
        ? `Vertex/face counts differ from the loaded model (${current.vertices.length}/${current.triangles.length} vs ${parsed.vertices.length}/${parsed.triangles.length}); the Nomad geometry replaced the model. / 노마드에서 리메쉬된 것 같습니다. 전체를 다시 불러왔습니다.`
        : "No model was loaded; the Nomad OBJ was loaded as a new model.",
    );
  }

  const vertices = sameTopology && current ? current.vertices : parsed.vertices;
  const triangles = sameTopology && current ? current.triangles : parsed.triangles;
  const faceLabels = faceLabelsFromVertexLabels(vertices, triangles, snap.labels);
  const triangleColors: RGB[] = new Array(triangles.length);
  const used = new Set<number>();
  for (let i = 0; i < triangles.length; i++) {
    const label = faceLabels[i];
    used.add(label);
    triangleColors[i] = effectivePalette[label];
  }
  const model: MeshModel = {
    name: sameTopology && current ? current.name : name,
    vertices,
    triangles,
    triangleColors,
    stats: {
      vertexCount: vertices.length,
      triangleCount: triangles.length,
      coloredVertexCount: parsed.colouredVertexCount,
      uniqueFaceColors: used.size,
      objectFaceCounts:
        sameTopology && current ? current.stats.objectFaceCounts : { nomad: triangles.length },
    },
  };
  return { model, mode, snap, colourCount: used.size, warnings };
}
