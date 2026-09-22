import JSZip from "jszip";
import type { MeshModel, RGB, Tri, Vec3 } from "./types";
import { parseHexColour, rgbToHex } from "./colour";
import { tryDecodePaintCode } from "./paintCodes";
import { majorityVertexLabels } from "./meshAdjacency";

/**
 * Feature A of the Rodin work order: load a Hyper3D Rodin "3D Print" 3MF
 * (Output Mode: Face Color).  The file is a Bambu Studio project:
 *
 *   3D/3dmodel.model                  geometry + per-face paint codes
 *   Metadata/project_settings.config  JSON, includes the filament_colour palette
 *
 * Every triangle carries `paint_color` and `slic3rpe:mmu_segmentation` with the
 * same MMU paint code.  The loader decodes the codes to 1-based palette numbers,
 * colours every face with its exact palette colour and derives per-vertex
 * colours by majority vote (never by averaging, which would create new
 * intermediate colours along the boundaries).
 */

export const RODIN_MODEL_PATH = "3D/3dmodel.model";
export const RODIN_PROJECT_SETTINGS_PATH = "Metadata/project_settings.config";

export const RODIN_TEXTURE_MODE_MESSAGE =
  "This 3MF has no face colours (it looks like a Texture Map export). " +
  "In Rodin, set Output Mode to Face Color and download the 3MF again. " +
  "/ Face Color 모드가 아닙니다. Rodin에서 Output Mode를 Face Color로 바꿔서 다시 받으세요.";

export interface Rodin3mfStats {
  vertexCount: number;
  triangleCount: number;
  paletteCount: number;
  usedColourCount: number;
  unpaintedTriangleCount: number;
  unknownCodeTriangleCount: number;
  objectCount: number;
}

export interface Rodin3mfLoadResult {
  model: MeshModel;
  /** Palette colours from project_settings.config (index 0 = extruder 1). */
  palette: RGB[];
  paletteHex: string[];
  paletteSource: "project_settings" | "fallback";
  /** Painted extruder number per face (1-based, 0 = unpainted). */
  faceExtruder: Int32Array;
  /** Majority extruder number per vertex (1-based, 0 = no incident face). */
  vertexExtruder: Int32Array;
  usedPaletteNumbers: number[];
  warnings: string[];
  stats: Rodin3mfStats;
}

type Transform = number[]; // 12 numbers, 3MF row-vector convention

interface ParsedMesh {
  vertices: Vec3[];
  triangles: Tri[];
  codes: string[];
  paintedAttributeCount: number;
  textureAttributeCount: number;
}

interface ParsedComponent {
  objectId: string;
  path: string | null;
  transform: Transform | null;
}

interface ParsedObject {
  id: string;
  name: string;
  mesh: ParsedMesh | null;
  components: ParsedComponent[];
}

interface ParsedBuildItem {
  objectId: string;
  path: string | null;
  transform: Transform | null;
}

export interface ParsedModelFile {
  objects: Map<string, ParsedObject>;
  buildItems: ParsedBuildItem[];
}

const ATTRIBUTE_RE = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;

function parseAttributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTRIBUTE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTRIBUTE_RE.exec(source)) !== null) out[m[1]] = m[2];
  return out;
}

function parseTransform(value: string | undefined): Transform | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) return null;
  const isIdentity =
    parts[0] === 1 && parts[1] === 0 && parts[2] === 0 &&
    parts[3] === 0 && parts[4] === 1 && parts[5] === 0 &&
    parts[6] === 0 && parts[7] === 0 && parts[8] === 1 &&
    parts[9] === 0 && parts[10] === 0 && parts[11] === 0;
  return isIdentity ? null : parts;
}

export function apply3mfTransform(v: Vec3, m: Transform): Vec3 {
  const [x, y, z] = v;
  return [
    x * m[0] + y * m[3] + z * m[6] + m[9],
    x * m[1] + y * m[4] + z * m[7] + m[10],
    x * m[2] + y * m[5] + z * m[8] + m[11],
  ];
}

function parseMesh(meshXml: string): ParsedMesh {
  const vertices: Vec3[] = [];
  const triangles: Tri[] = [];
  const codes: string[] = [];
  let paintedAttributeCount = 0;
  let textureAttributeCount = 0;

  const vertexRe = /<vertex\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = vertexRe.exec(meshXml)) !== null) {
    const a = parseAttributes(m[1]);
    const x = Number(a.x);
    const y = Number(a.y);
    const z = Number(a.z);
    vertices.push([
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(z) ? z : 0,
    ]);
  }

  const triangleRe = /<triangle\b([^>]*)>/g;
  while ((m = triangleRe.exec(meshXml)) !== null) {
    const a = parseAttributes(m[1]);
    const v1 = Number(a.v1);
    const v2 = Number(a.v2);
    const v3 = Number(a.v3);
    if (![v1, v2, v3].every((v) => Number.isInteger(v) && v >= 0 && v < vertices.length)) continue;
    triangles.push([v1, v2, v3]);
    let code: string | undefined = a["slic3rpe:mmu_segmentation"];
    if (code === undefined) code = a.paint_color;
    if (code !== undefined) paintedAttributeCount++;
    if (a.pid !== undefined || a.p1 !== undefined) textureAttributeCount++;
    codes.push(code ?? "");
  }
  return { vertices, triangles, codes, paintedAttributeCount, textureAttributeCount };
}

export function parseModelXml(xml: string): ParsedModelFile {
  const objects = new Map<string, ParsedObject>();
  const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m: RegExpExecArray | null;
  while ((m = objectRe.exec(xml)) !== null) {
    const attrs = parseAttributes(m[1]);
    const body = m[2];
    const id = attrs.id ?? String(objects.size + 1);
    const meshMatch = /<mesh\b[^>]*>([\s\S]*?)<\/mesh>/.exec(body);
    const mesh = meshMatch ? parseMesh(meshMatch[1]) : null;
    const components: ParsedComponent[] = [];
    const componentRe = /<component\b([^>]*)>/g;
    let c: RegExpExecArray | null;
    while ((c = componentRe.exec(body)) !== null) {
      const ca = parseAttributes(c[1]);
      if (!ca.objectid) continue;
      components.push({
        objectId: ca.objectid,
        path: ca["p:path"] ?? null,
        transform: parseTransform(ca.transform),
      });
    }
    objects.set(id, { id, name: attrs.name ?? `object_${id}`, mesh, components });
  }

  const buildItems: ParsedBuildItem[] = [];
  const buildMatch = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml);
  if (buildMatch) {
    const itemRe = /<item\b([^>]*)>/g;
    let it: RegExpExecArray | null;
    while ((it = itemRe.exec(buildMatch[1])) !== null) {
      const ia = parseAttributes(it[1]);
      if (!ia.objectid) continue;
      buildItems.push({
        objectId: ia.objectid,
        path: ia["p:path"] ?? null,
        transform: parseTransform(ia.transform),
      });
    }
  }
  return { objects, buildItems };
}

function normalizeZipPath(path: string): string {
  return path.replace(/^\/+/, "");
}

/** Extract the filament_colour palette from Bambu Studio project_settings.config. */
export function parseProjectSettingsPalette(text: string): string[] {
  const normalise = (values: unknown[]): string[] =>
    values.flatMap((value) => {
      if (typeof value !== "string") return [];
      const rgba = parseHexColour(value);
      return rgba ? [rgbToHex([rgba[0], rgba[1], rgba[2]])] : [];
    });
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const colours = data.filament_colour;
    if (Array.isArray(colours)) {
      const parsed = normalise(colours);
      if (parsed.length > 0) return parsed;
    }
  } catch {
    // Fall back to a tolerant regex scan below.
  }
  const marker = text.indexOf('"filament_colour"');
  if (marker < 0) return [];
  const rest = text.slice(marker + '"filament_colour"'.length);
  const close = rest.indexOf("]");
  const section = close >= 0 ? rest.slice(0, close) : rest;
  const matches = section.match(/#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?/g) ?? [];
  return normalise(matches);
}

const FALLBACK_PALETTE_HEX = [
  "#FFFFFF", "#202020", "#E53935", "#1E88E5", "#43A047", "#FDD835", "#FB8C00", "#8E24AA",
  "#00ACC1", "#F06292", "#795548", "#9E9E9E", "#C0CA33", "#3949AB", "#00897B", "#FFB74D",
];

function hexToRgb(hex: string): RGB {
  const rgba = parseHexColour(hex);
  return rgba ? [rgba[0], rgba[1], rgba[2]] : [180, 180, 180];
}

interface AssembledMesh {
  vertices: Vec3[];
  triangles: Tri[];
  codes: string[];
  objectFaceCounts: Record<string, number>;
  paintedAttributeCount: number;
  textureAttributeCount: number;
  objectCount: number;
  warnings: string[];
}

/**
 * Walk the build items and flatten all referenced meshes (including
 * components stored in other model files) into one vertex/triangle list.
 */
export function assembleModelFiles(
  files: Map<string, ParsedModelFile>,
  mainPath: string,
): AssembledMesh {
  const out: AssembledMesh = {
    vertices: [],
    triangles: [],
    codes: [],
    objectFaceCounts: {},
    paintedAttributeCount: 0,
    textureAttributeCount: 0,
    objectCount: 0,
    warnings: [],
  };
  const visiting = new Set<string>();

  const emitMesh = (object: ParsedObject, transforms: Transform[]) => {
    const mesh = object.mesh;
    if (!mesh) return;
    const offset = out.vertices.length;
    for (const v of mesh.vertices) {
      let p = v;
      for (let i = transforms.length - 1; i >= 0; i--) p = apply3mfTransform(p, transforms[i]);
      out.vertices.push(p);
    }
    for (let i = 0; i < mesh.triangles.length; i++) {
      const t = mesh.triangles[i];
      out.triangles.push([t[0] + offset, t[1] + offset, t[2] + offset]);
      out.codes.push(mesh.codes[i]);
    }
    out.paintedAttributeCount += mesh.paintedAttributeCount;
    out.textureAttributeCount += mesh.textureAttributeCount;
    out.objectFaceCounts[object.name] =
      (out.objectFaceCounts[object.name] ?? 0) + mesh.triangles.length;
    out.objectCount++;
  };

  const visit = (path: string, objectId: string, transforms: Transform[]) => {
    const file = files.get(normalizeZipPath(path));
    const object = file?.objects.get(objectId);
    const key = `${path}#${objectId}`;
    if (!object) {
      out.warnings.push(`Object ${objectId} in ${path} was not found.`);
      return;
    }
    if (visiting.has(key)) {
      out.warnings.push(`Recursive component reference for object ${objectId} ignored.`);
      return;
    }
    visiting.add(key);
    emitMesh(object, transforms);
    for (const component of object.components) {
      const nextPath = component.path ?? path;
      visit(
        nextPath,
        component.objectId,
        component.transform ? [...transforms, component.transform] : transforms,
      );
    }
    visiting.delete(key);
  };

  const main = files.get(normalizeZipPath(mainPath));
  if (!main) throw new Error(`${mainPath} not found in the 3MF archive.`);
  if (main.buildItems.length > 0) {
    for (const item of main.buildItems) {
      visit(item.path ?? mainPath, item.objectId, item.transform ? [item.transform] : []);
    }
  } else {
    // No <build> section: fall back to every mesh object in file order.
    for (const object of main.objects.values()) emitMesh(object, []);
  }
  return out;
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(normalizeZipPath(path));
  return file ? await file.async("text") : null;
}

export async function loadRodin3mf(
  source: File | Blob | ArrayBuffer | Uint8Array,
  name = "rodin_model.3mf",
): Promise<Rodin3mfLoadResult> {
  const buffer =
    source instanceof ArrayBuffer || source instanceof Uint8Array
      ? source
      : await source.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const mainXml = await readZipText(zip, RODIN_MODEL_PATH);
  if (mainXml === null) throw new Error(`${RODIN_MODEL_PATH} not found. Is this a 3MF project?`);

  const files = new Map<string, ParsedModelFile>();
  files.set(RODIN_MODEL_PATH, parseModelXml(mainXml));

  // Resolve components/build items that live in other model files
  // (Bambu Studio stores split objects in 3D/Objects/*.model).
  const pending: string[] = [];
  const collectPaths = (parsed: ParsedModelFile) => {
    for (const item of parsed.buildItems) if (item.path) pending.push(item.path);
    for (const object of parsed.objects.values())
      for (const component of object.components) if (component.path) pending.push(component.path);
  };
  collectPaths(files.get(RODIN_MODEL_PATH)!);
  while (pending.length > 0) {
    const path = normalizeZipPath(pending.pop()!);
    if (files.has(path)) continue;
    const xml = await readZipText(zip, path);
    if (xml === null) continue;
    const parsed = parseModelXml(xml);
    files.set(path, parsed);
    collectPaths(parsed);
  }

  const assembled = assembleModelFiles(files, RODIN_MODEL_PATH);
  if (assembled.triangles.length === 0 || assembled.vertices.length === 0)
    throw new Error("No triangles were found in the 3MF.");
  if (assembled.paintedAttributeCount === 0) throw new Error(RODIN_TEXTURE_MODE_MESSAGE);

  const warnings = [...assembled.warnings];
  const settingsText = await readZipText(zip, RODIN_PROJECT_SETTINGS_PATH);
  let paletteHex = settingsText ? parseProjectSettingsPalette(settingsText) : [];
  let paletteSource: Rodin3mfLoadResult["paletteSource"] = "project_settings";
  if (paletteHex.length === 0) {
    paletteSource = "fallback";
    warnings.push(
      `${RODIN_PROJECT_SETTINGS_PATH} has no filament_colour palette; placeholder colours were used.`,
    );
  }

  const faceCount = assembled.triangles.length;
  const faceExtruder = new Int32Array(faceCount);
  let unpaintedTriangleCount = 0;
  let unknownCodeTriangleCount = 0;
  let maxExtruder = 0;
  for (let i = 0; i < faceCount; i++) {
    const decoded = tryDecodePaintCode(assembled.codes[i]);
    if (decoded === null) {
      unknownCodeTriangleCount++;
      faceExtruder[i] = 0;
      continue;
    }
    faceExtruder[i] = decoded;
    if (decoded === 0) unpaintedTriangleCount++;
    if (decoded > maxExtruder) maxExtruder = decoded;
  }
  if (unknownCodeTriangleCount > 0)
    warnings.push(`${unknownCodeTriangleCount} triangles carry an unsupported paint code and were treated as unpainted.`);
  if (unpaintedTriangleCount > 0)
    warnings.push(`${unpaintedTriangleCount} triangles are unpainted and use extruder 1 (slicer default).`);

  // Extend a short palette so that every painted extruder has a colour.
  const neededPalette = Math.max(1, maxExtruder);
  if (paletteHex.length < neededPalette) {
    if (paletteSource === "project_settings")
      warnings.push(
        `The palette lists ${paletteHex.length} colours but the mesh uses extruder ${maxExtruder}; placeholder colours were added.`,
      );
    const extended = [...paletteHex];
    let k = 0;
    while (extended.length < neededPalette) {
      extended.push(FALLBACK_PALETTE_HEX[k % FALLBACK_PALETTE_HEX.length]);
      k++;
    }
    paletteHex = extended;
  }
  const palette = paletteHex.map(hexToRgb);

  // Face colours: exact palette colours (shared tuples keep memory low).
  const triangleColors: RGB[] = new Array(faceCount);
  const usedNumbers = new Set<number>();
  for (let i = 0; i < faceCount; i++) {
    const number = faceExtruder[i] > 0 ? faceExtruder[i] : 1;
    usedNumbers.add(number);
    triangleColors[i] = palette[number - 1];
  }

  // Vertex colours by majority (0-based labels for the helper).
  const faceLabels = new Int32Array(faceCount);
  for (let i = 0; i < faceCount; i++) faceLabels[i] = (faceExtruder[i] > 0 ? faceExtruder[i] : 1) - 1;
  const vertexLabels = majorityVertexLabels(
    assembled.triangles,
    faceLabels,
    assembled.vertices.length,
    palette.length,
  );
  const vertexExtruder = new Int32Array(vertexLabels.length);
  for (let v = 0; v < vertexLabels.length; v++) vertexExtruder[v] = vertexLabels[v] >= 0 ? vertexLabels[v] + 1 : 0;

  const usedPaletteNumbers = [...usedNumbers].sort((a, b) => a - b);
  const model: MeshModel = {
    name,
    vertices: assembled.vertices,
    triangles: assembled.triangles,
    triangleColors,
    stats: {
      vertexCount: assembled.vertices.length,
      triangleCount: faceCount,
      coloredVertexCount: assembled.vertices.length,
      uniqueFaceColors: new Set(usedPaletteNumbers.map((n) => paletteHex[n - 1])).size,
      objectFaceCounts: assembled.objectFaceCounts,
    },
  };

  return {
    model,
    palette,
    paletteHex,
    paletteSource,
    faceExtruder,
    vertexExtruder,
    usedPaletteNumbers,
    warnings,
    stats: {
      vertexCount: assembled.vertices.length,
      triangleCount: faceCount,
      paletteCount: palette.length,
      usedColourCount: usedPaletteNumbers.length,
      unpaintedTriangleCount,
      unknownCodeTriangleCount,
      objectCount: assembled.objectCount,
    },
  };
}
