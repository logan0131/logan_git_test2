import JSZip from "jszip";
import type { Filament, PhysicalSlot, RGB, Tri, Vec3 } from "../types";
import { encodePaintCode } from "../paintCodes";

export interface GridMesh {
  vertices: Vec3[];
  triangles: Tri[];
  nx: number;
  ny: number;
  /** Cell column/row of every face (two faces per cell). */
  cellOfFace: Array<[number, number]>;
}

/** Flat grid in the XY plane (Z = 0), two triangles per cell. */
export function gridMesh(nx: number, ny: number, size = 1): GridMesh {
  const vertices: Vec3[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) vertices.push([i * size, j * size, 0]);
  }
  const triangles: Tri[] = [];
  const cellOfFace: Array<[number, number]> = [];
  const idx = (i: number, j: number) => j * (nx + 1) + i;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      triangles.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
      triangles.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
      cellOfFace.push([i, j], [i, j]);
    }
  }
  return { vertices, triangles, nx, ny, cellOfFace };
}

export function makeSlots(hexes: string[]): PhysicalSlot[] {
  return hexes.map((hex, index) => {
    const rgb: RGB = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const filament: Filament = {
      name: `F${index + 1}`,
      type: "PLA",
      rgb,
      effectiveRgb: rgb,
      sourceLine: hex,
    };
    return { slot: index + 1, filament, role: "" };
  });
}

export interface Rodin3mfFixtureOptions {
  vertices: Vec3[];
  triangles: Tri[];
  /** 1-based extruder per face; 0 = unpainted. */
  extruders: number[];
  paletteHex?: string[];
  includeSettings?: boolean;
  settingsAsPlainText?: boolean;
  /** "both" writes paint_color + mmu_segmentation, "bambu" paint_color only, "texture" pid only. */
  attributeMode?: "both" | "bambu" | "prusa" | "texture";
  buildTransform?: string;
  /** Put the mesh into 3D/Objects/part.model and reference it via a component. */
  splitIntoObjectFile?: boolean;
}

function meshXml(options: Rodin3mfFixtureOptions): string {
  const mode = options.attributeMode ?? "both";
  const lines: string[] = ["<mesh>", "<vertices>"];
  for (const [x, y, z] of options.vertices) lines.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
  lines.push("</vertices>", "<triangles>");
  options.triangles.forEach((tri, i) => {
    const code = options.extruders[i] > 0 ? encodePaintCode(options.extruders[i]) : "";
    let attrs = "";
    if (mode === "both") attrs = ` paint_color="${code}" slic3rpe:mmu_segmentation="${code}"`;
    else if (mode === "bambu") attrs = ` paint_color="${code}"`;
    else if (mode === "prusa") attrs = ` slic3rpe:mmu_segmentation="${code}"`;
    else attrs = ` pid="1" p1="${i}"`;
    lines.push(`<triangle v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}"${attrs}/>`);
  });
  lines.push("</triangles>", "</mesh>");
  return lines.join("\n");
}

export async function buildRodin3mf(options: Rodin3mfFixtureOptions): Promise<Uint8Array> {
  const zip = new JSZip();
  const transform = options.buildTransform ? ` transform="${options.buildTransform}"` : "";
  const head =
    '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">';
  if (options.splitIntoObjectFile) {
    zip.file(
      "3D/3dmodel.model",
      `${head}\n<resources>\n<object id="2" type="model"><components><component objectid="1" p:path="/3D/Objects/part.model"/></components></object>\n</resources>\n<build><item objectid="2"${transform} printable="1"/></build>\n</model>`,
    );
    zip.file(
      "3D/Objects/part.model",
      `${head}\n<resources>\n<object id="1" name="part" type="model">${meshXml(options)}</object>\n</resources>\n</model>`,
    );
  } else {
    zip.file(
      "3D/3dmodel.model",
      `${head}\n<resources>\n<object id="1" name="typhoeus" type="model">${meshXml(options)}</object>\n</resources>\n<build><item objectid="1"${transform} printable="1"/></build>\n</model>`,
    );
  }
  if (options.includeSettings !== false) {
    const palette = options.paletteHex ?? [];
    if (options.settingsAsPlainText) {
      zip.file(
        "Metadata/project_settings.config",
        `{\n  "other": 1,\n  "filament_colour": [\n${palette.map((hex) => `    "${hex}"`).join(",\n")}\n  ],\n  "filament_type": ["PLA"]\n}`,
      );
    } else {
      zip.file(
        "Metadata/project_settings.config",
        JSON.stringify({ filament_colour: palette, filament_type: palette.map(() => "PLA") }, null, 2),
      );
    }
  }
  zip.file("[Content_Types].xml", "<Types/>");
  return zip.generateAsync({ type: "uint8array" });
}

export const THIRTEEN_PALETTE = [
  "#FFFFFF", "#F2C9A8", "#C9A0DC", "#5B2C83", "#111111", "#D62828", "#A4919E",
  "#595159", "#D6C0C3", "#7D727A", "#E8E1D9", "#3A2A45", "#B08D78",
];
