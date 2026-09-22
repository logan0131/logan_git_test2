import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { MeshModel, PaletteEntry, RGB } from "../types";
import type { VirtualBlendEntry, VirtualExtruderPlan } from "../virtualExtruders";
import {
  buildExportAssignments,
  buildPrusa3mfBlob,
  validateExportAssignments,
  type Export3mfOptions,
} from "../export3mf";
import { decodePaintCode } from "../paintCodes";
import { renderModelThumbnail, type ThumbnailRaster } from "../modelThumbnail";
import { gridMesh, makeSlots } from "./fixtures";

const PHYSICAL = makeSlots(["#FFFFFF", "#000000", "#FF0000", "#0000FF", "#FFFF00"]);

function blend(virtualId: number, rgb: RGB, paletteIndices: number[]): VirtualBlendEntry {
  return {
    virtualId,
    displayRgb: rgb,
    layerAverageRgb: rgb,
    components: [
      { extruder: 1, ratio: 0.5, count: 1, rgb: [255, 255, 255] },
      { extruder: 3, ratio: 0.5, count: 1, rgb: [255, 0, 0] },
    ],
    sequence: [1, 3],
    sequenceKey: `${virtualId}:1-3`,
    targetPaletteIndices: paletteIndices,
    triangleCount: 10,
    linearRgbError: 0,
  };
}

function planWithGaps(): { plan: VirtualExtruderPlan; palette: PaletteEntry[] } {
  // Virtual ids 6, 7, 9, 13, 14, 15 (the gap pattern from the work order) plus
  // one physical-only palette colour on E2 and one unused virtual (id 8).
  const paletteColours: RGB[] = [
    [255, 200, 200], [200, 255, 200], [200, 200, 255], [255, 255, 200], [200, 255, 255], [255, 200, 255], [0, 0, 0],
  ];
  const palette: PaletteEntry[] = paletteColours.map((rgb, i) => ({ index: i + 1, rgb, count: 10 }));
  const plan: VirtualExtruderPlan = {
    virtualBlends: [
      blend(6, paletteColours[0], [1]),
      blend(7, paletteColours[1], [2]),
      blend(8, [1, 2, 3], []), // merged away: no palette colour left
      blend(9, paletteColours[2], [3]),
      blend(13, paletteColours[3], [4]),
      blend(14, paletteColours[4], [5]),
      blend(15, paletteColours[5], [6]),
    ],
    physicalOnly: [
      {
        paletteIndex: 7,
        targetPaletteIndices: [7],
        targetRgb: [0, 0, 0],
        physicalRgb: [0, 0, 0],
        physicalExtruder: 2,
        triangleCount: 10,
        linearRgbError: 0,
      },
    ],
    mappingDiagnostics: {
      targetPaletteCount: 7,
      averageError: 0,
      worstError: 0,
      poorMatchCount: 0,
      poorMatchThreshold: 8,
      collapsedTargetColours: 0,
    },
    paletteToAssignment: new Map(),
  };
  return { plan, palette };
}

function modelForPalette(palette: PaletteEntry[]): MeshModel {
  const grid = gridMesh(7, 2);
  const triangleColors: RGB[] = grid.triangles.map((_t, i) => palette[i % palette.length].rgb);
  return {
    name: "typhoeus.obj",
    vertices: grid.vertices,
    triangles: grid.triangles,
    triangleColors,
    stats: {
      vertexCount: grid.vertices.length,
      triangleCount: grid.triangles.length,
      coloredVertexCount: grid.vertices.length,
      uniqueFaceColors: palette.length,
      objectFaceCounts: { grid: grid.triangles.length },
    },
  };
}

const stubEncoder = async (raster: ThumbnailRaster) => new Uint8Array([raster.width, raster.height]);

function exportOptions(overrides: Partial<Export3mfOptions> = {}): Export3mfOptions {
  const { plan, palette } = planWithGaps();
  const model = modelForPalette(palette);
  return {
    fileName: "typhoeus_XL_ready",
    model,
    adjustedColors: model.triangleColors,
    palette,
    physicalSlots: PHYSICAL,
    virtualPlan: plan,
    placement: {
      coordinateMode: "keep",
      scale: 1,
      putOnBed: false,
      centerOnBed: false,
      bedSource: "custom",
      customBedSize: { x: 360, y: 360 },
      fallbackBedSize: { x: 250, y: 210 },
      defaultExtruder: 1,
    },
    accentProtection: "off",
    thumbnailEncoder: stubEncoder,
    ...overrides,
  };
}

async function readZip(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
}

describe("D-1 contiguous virtual extruder ids", () => {
  it("renumbers used virtual extruders from physical count + 1 and drops unused ones", () => {
    const { plan } = planWithGaps();
    const result = buildExportAssignments(plan, 5);
    expect(result.virtuals.map((v) => v.id)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(result.virtuals.map((v) => v.sourceId)).toEqual([6, 7, 9, 13, 14, 15]);
    expect(result.virtualIdRemap.get(9)).toBe(8);
    expect(result.virtualIdRemap.get(15)).toBe(11);
    expect(result.virtualIdRemap.has(8)).toBe(false);
    // Palette 3 was VE9 -> now VE8 -> paint code "5C".
    expect(result.paletteToPaintCode.get(3)).toBe("5C");
    expect(decodePaintCode(result.paletteToPaintCode.get(7)!)).toBe(2);
  });

  it("writes the same ids into mmu_segmentation and full_spectrum.json", async () => {
    const result = await buildPrusa3mfBlob(exportOptions());
    expect(result.summary.virtualIds).toEqual([6, 7, 8, 9, 10, 11]);
    expect(result.summary.renumberedVirtuals).toEqual([
      { from: 9, to: 8 },
      { from: 13, to: 9 },
      { from: 14, to: 10 },
      { from: 15, to: 11 },
    ]);
    const zip = await readZip(result.blob);
    const json = JSON.parse(await zip.file("Metadata/Prusa_Slicer_full_spectrum.json")!.async("text"));
    const jsonIds = json.virtual_extruders.map((v: { id: number }) => v.id);
    expect(jsonIds).toEqual([6, 7, 8, 9, 10, 11]);
    expect(json.physical_extruders.map((p: { id: number }) => p.id)).toEqual([1, 2, 3, 4, 5]);

    const modelXml = await zip.file("3D/3dmodel.model")!.async("text");
    const codes = [...modelXml.matchAll(/slic3rpe:mmu_segmentation="([0-9A-F]*)"/g)].map((m) => m[1]);
    expect(codes.length).toBe(exportOptions().model.triangles.length);
    const states = new Set(codes.map(decodePaintCode));
    const virtualStates = [...states].filter((s) => s > 5).sort((a, b) => a - b);
    expect(virtualStates).toEqual(jsonIds);
    expect([...states].filter((s) => s <= 5)).toEqual([2]);
  });
});

describe("D-2 printer config", () => {
  it("does not write Metadata/Slic3r_PE.config by default", async () => {
    const result = await buildPrusa3mfBlob(exportOptions());
    const zip = await readZip(result.blob);
    expect(zip.file("Metadata/Slic3r_PE.config")).toBeNull();
    expect(result.summary.printerConfigIncluded).toBe(false);
    for (const path of [
      "3D/3dmodel.model",
      "Metadata/Slic3r_PE_model.config",
      "Metadata/Prusa_Slicer_full_spectrum.json",
      "Metadata/Prusa_Slicer_wipe_tower_information.xml",
      "Metadata/thumbnail.png",
      "[Content_Types].xml",
      "_rels/.rels",
    ]) {
      expect(zip.file(path), path).not.toBeNull();
    }
  });

  it("copies the template config only when explicitly requested", async () => {
    const template = new JSZip();
    template.file("Metadata/Slic3r_PE.config", "; extruders_count = 5\n; filament_colour = #FFFFFF;#000000;#FF0000;#0000FF;#FFFF00\n");
    const templateArrayBuffer = (await template.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;

    const withoutFlag = await buildPrusa3mfBlob(exportOptions({ templateArrayBuffer }));
    expect((await readZip(withoutFlag.blob)).file("Metadata/Slic3r_PE.config")).toBeNull();

    const withFlag = await buildPrusa3mfBlob(exportOptions({ templateArrayBuffer, includePrinterConfig: true }));
    const zip = await readZip(withFlag.blob);
    expect(withFlag.summary.printerConfigIncluded).toBe(true);
    const config = await zip.file("Metadata/Slic3r_PE.config")!.async("text");
    expect(config).toContain("extruders_count");
  });

  it("never invents a config when no template is loaded", async () => {
    const result = await buildPrusa3mfBlob(exportOptions({ includePrinterConfig: true }));
    expect((await readZip(result.blob)).file("Metadata/Slic3r_PE.config")).toBeNull();
    expect(result.summary.printerConfigIncluded).toBe(false);
  });
});

describe("D-3 validation", () => {
  it("accepts a consistent export", () => {
    expect(
      validateExportAssignments({
        physicalExtruderCount: 5,
        virtuals: [{ id: 6 }, { id: 7 }],
        usedPaintStates: [1, 6, 7],
      }),
    ).toEqual([]);
  });

  it("reports gaps, missing JSON entries, unused virtuals, unpainted faces and the 15 limit", () => {
    const failures = validateExportAssignments({
      physicalExtruderCount: 5,
      virtuals: [{ id: 6 }, { id: 8 }],
      usedPaintStates: [0, 6, 9],
    });
    expect(failures.join("\n")).toMatch(/contiguous/);
    expect(failures.join("\n")).toMatch(/Painted virtual states 9/);
    expect(failures.join("\n")).toMatch(/Virtual extruders 8 are defined/);
    expect(failures.join("\n")).toMatch(/Unpainted triangles/);

    const tooMany = validateExportAssignments({
      physicalExtruderCount: 5,
      virtuals: Array.from({ length: 11 }, (_v, i) => ({ id: 6 + i })),
      usedPaintStates: Array.from({ length: 11 }, (_v, i) => 6 + i),
    });
    expect(tooMany.join("\n")).toMatch(/at most 15/);
  });

  it("refuses to export more than 15 physical + virtual extruders", async () => {
    const { palette } = planWithGaps();
    const extraPalette: PaletteEntry[] = Array.from({ length: 11 }, (_v, i) => ({
      index: i + 1,
      rgb: [i * 20, 100, 200 - i * 10] as RGB,
      count: 5,
    }));
    const plan: VirtualExtruderPlan = {
      virtualBlends: extraPalette.map((entry, i) => blend(6 + i, entry.rgb, [entry.index])),
      physicalOnly: [],
      mappingDiagnostics: { targetPaletteCount: 11, averageError: 0, worstError: 0, poorMatchCount: 0, poorMatchThreshold: 8, collapsedTargetColours: 0 },
      paletteToAssignment: new Map(),
    };
    const model = modelForPalette(extraPalette);
    await expect(
      buildPrusa3mfBlob(exportOptions({ virtualPlan: plan, palette: extraPalette, model, adjustedColors: model.triangleColors })),
    ).rejects.toThrow(/at most 15/);
    expect(palette.length).toBe(7);
  });

  it("refuses physical extruders outside 1..n_physical", async () => {
    const { plan } = planWithGaps();
    plan.physicalOnly[0].physicalExtruder = 7;
    await expect(buildPrusa3mfBlob(exportOptions({ virtualPlan: plan }))).rejects.toThrow(/outside 1\.\.5/);
  });
});

describe("D-4 thumbnail", () => {
  it("renders the effective (post-merge) colour of each palette index", () => {
    // One square facing the front camera exactly (normal along -Y).
    const vertices = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 10],
      [0, 0, 10],
    ] as MeshModel["vertices"];
    const triangles = [
      [0, 1, 2],
      [0, 2, 3],
    ] as MeshModel["triangles"];
    const effective: RGB = [10, 200, 30];
    const raster = renderModelThumbnail({ vertices, triangles }, () => effective, { width: 64, height: 64, view: "front" });
    const centre = (32 * 64 + 32) * 4;
    expect([raster.data[centre], raster.data[centre + 1], raster.data[centre + 2]]).toEqual([10, 200, 30]);
    // Corner stays background.
    expect(raster.data[0]).toBe(178);
  });

  it("passes the effective colour map into the export thumbnail", async () => {
    let seen: ThumbnailRaster | null = null;
    const effective = new Map<number, RGB>();
    for (let i = 1; i <= 7; i++) effective.set(i, [7, 7, 7]);
    await buildPrusa3mfBlob(
      exportOptions({
        effectiveRgbByPaletteIndex: effective,
        thumbnailEncoder: async (raster) => {
          seen = raster;
          return new Uint8Array(1);
        },
      }),
    );
    expect(seen).not.toBeNull();
    const raster = seen as unknown as ThumbnailRaster;
    expect(raster.width).toBe(768);
    // Every model pixel is a shade of the single effective grey (r == g == b),
    // never one of the pastel palette colours.
    let modelPixels = 0;
    for (let i = 0; i < raster.data.length; i += 4) {
      const [r, g, b] = [raster.data[i], raster.data[i + 1], raster.data[i + 2]];
      if (r === 178 && g === 178 && b === 178) continue;
      modelPixels++;
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
    expect(modelPixels).toBeGreaterThan(0);
  });
});
