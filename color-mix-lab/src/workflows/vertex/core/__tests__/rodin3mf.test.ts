import { describe, expect, it } from "vitest";
import {
  loadRodin3mf,
  parseModelXml,
  parseProjectSettingsPalette,
  RODIN_TEXTURE_MODE_MESSAGE,
} from "../rodin3mf";
import { rgbToHex } from "../colour";
import { buildRodin3mf, gridMesh, THIRTEEN_PALETTE } from "./fixtures";

function extrudersForGrid(grid: ReturnType<typeof gridMesh>): number[] {
  // Left third = 1 (white), middle third = 2 (skin), right third = 6 (red);
  // one face unpainted.
  return grid.cellOfFace.map(([i], f) => {
    if (f === 5) return 0;
    if (i < grid.nx / 3) return 1;
    if (i < (2 * grid.nx) / 3) return 2;
    return 6;
  });
}

describe("Feature A: Rodin Face Color 3MF", () => {
  it("loads geometry, exact palette face colours and majority vertex colours", async () => {
    const grid = gridMesh(12, 6);
    const extruders = extrudersForGrid(grid);
    const bytes = await buildRodin3mf({
      vertices: grid.vertices,
      triangles: grid.triangles,
      extruders,
      paletteHex: THIRTEEN_PALETTE,
    });
    const result = await loadRodin3mf(bytes, "typhoeus.3mf");
    expect(result.model.stats.vertexCount).toBe(grid.vertices.length);
    expect(result.model.stats.triangleCount).toBe(grid.triangles.length);
    expect(result.paletteSource).toBe("project_settings");
    expect(result.palette.length).toBe(13);
    expect(result.paletteHex).toEqual(THIRTEEN_PALETTE);
    expect(result.usedPaletteNumbers).toEqual([1, 2, 6]);
    expect(result.model.stats.uniqueFaceColors).toBe(3);
    expect(result.stats.unpaintedTriangleCount).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/unpainted/);

    // Face colours are the exact palette colours, never averages.
    const hexes = new Set(result.model.triangleColors.map(rgbToHex));
    expect([...hexes].sort()).toEqual(["#D62828", "#F2C9A8", "#FFFFFF"].sort());
    expect(rgbToHex(result.model.triangleColors[0])).toBe("#FFFFFF");
    expect(result.faceExtruder[5]).toBe(0);
    expect(rgbToHex(result.model.triangleColors[5])).toBe("#FFFFFF"); // unpainted -> E1

    // Vertex colour = majority of adjacent faces. Vertex at column 4 sits on the
    // white/skin boundary: 3 white faces vs 3 skin faces around an interior
    // vertex -> tie resolves to the lower palette number (white).
    const boundaryVertex = 1 * (grid.nx + 1) + 4;
    expect(result.vertexExtruder[boundaryVertex]).toBe(1);
    const interiorSkin = 1 * (grid.nx + 1) + 6;
    expect(result.vertexExtruder[interiorSkin]).toBe(2);
    const interiorRed = 3 * (grid.nx + 1) + 10;
    expect(result.vertexExtruder[interiorRed]).toBe(6);
    expect([...result.vertexExtruder].every((n) => n >= 1)).toBe(true);
  });

  it("rejects Texture Map exports with the Rodin hint", async () => {
    const grid = gridMesh(3, 3);
    const bytes = await buildRodin3mf({
      vertices: grid.vertices,
      triangles: grid.triangles,
      extruders: grid.triangles.map(() => 1),
      paletteHex: THIRTEEN_PALETTE,
      attributeMode: "texture",
    });
    await expect(loadRodin3mf(bytes)).rejects.toThrow(RODIN_TEXTURE_MODE_MESSAGE);
  });

  it("accepts Bambu paint_color only and PrusaSlicer mmu_segmentation only", async () => {
    const grid = gridMesh(3, 3);
    const extruders = grid.triangles.map((_t, i) => (i % 2 === 0 ? 3 : 13));
    for (const attributeMode of ["bambu", "prusa"] as const) {
      const bytes = await buildRodin3mf({
        vertices: grid.vertices,
        triangles: grid.triangles,
        extruders,
        paletteHex: THIRTEEN_PALETTE,
        attributeMode,
      });
      const result = await loadRodin3mf(bytes);
      expect(result.usedPaletteNumbers).toEqual([3, 13]);
      expect(rgbToHex(result.model.triangleColors[1])).toBe(THIRTEEN_PALETTE[12]);
    }
  });

  it("falls back to placeholder colours when project_settings.config is missing", async () => {
    const grid = gridMesh(2, 2);
    const bytes = await buildRodin3mf({
      vertices: grid.vertices,
      triangles: grid.triangles,
      extruders: grid.triangles.map((_t, i) => (i < 4 ? 1 : 2)),
      includeSettings: false,
    });
    const result = await loadRodin3mf(bytes);
    expect(result.paletteSource).toBe("fallback");
    expect(result.palette.length).toBe(2);
    expect(result.warnings.join(" ")).toMatch(/placeholder/);
  });

  it("extends a short palette when the mesh uses higher extruders", async () => {
    const grid = gridMesh(2, 2);
    const bytes = await buildRodin3mf({
      vertices: grid.vertices,
      triangles: grid.triangles,
      extruders: grid.triangles.map(() => 5),
      paletteHex: ["#FFFFFF", "#000000"],
    });
    const result = await loadRodin3mf(bytes);
    expect(result.palette.length).toBe(5);
    expect(result.warnings.join(" ")).toMatch(/lists 2 colours/);
  });

  it("applies build transforms and follows component references into other model files", async () => {
    const grid = gridMesh(2, 2);
    const bytes = await buildRodin3mf({
      vertices: grid.vertices,
      triangles: grid.triangles,
      extruders: grid.triangles.map(() => 2),
      paletteHex: THIRTEEN_PALETTE,
      buildTransform: "1 0 0 0 1 0 0 0 1 10 20 30",
      splitIntoObjectFile: true,
    });
    const result = await loadRodin3mf(bytes);
    expect(result.model.stats.triangleCount).toBe(grid.triangles.length);
    expect(result.model.vertices[0]).toEqual([10, 20, 30]);
    expect(result.model.vertices[grid.vertices.length - 1]).toEqual([12, 22, 30]);
    expect(result.stats.objectCount).toBe(1);
    expect(result.model.stats.objectFaceCounts.part).toBe(grid.triangles.length);
  });

  it("parses the palette from JSON and from a loose text scan", () => {
    expect(parseProjectSettingsPalette('{"filament_colour":["#FFFFFF","#00ff00FF"]}')).toEqual(["#FFFFFF", "#00FF00"]);
    expect(parseProjectSettingsPalette('garbage "filament_colour": [ "#123456", "#ABCDEF" ] more')).toEqual(["#123456", "#ABCDEF"]);
    expect(parseProjectSettingsPalette("{}")).toEqual([]);
  });

  it("parses attributes in any order", () => {
    const parsed = parseModelXml(
      '<model><resources><object type="model" id="7"><mesh><vertices><vertex z="3" x="1" y="2"/><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/></vertices><triangles><triangle slic3rpe:mmu_segmentation="1C" v3="2" v1="0" v2="1" paint_color="1C"/></triangles></mesh></object></resources><build><item objectid="7"/></build></model>',
    );
    const object = parsed.objects.get("7")!;
    expect(object.mesh?.vertices[0]).toEqual([1, 2, 3]);
    expect(object.mesh?.triangles[0]).toEqual([0, 1, 2]);
    expect(object.mesh?.codes[0]).toBe("1C");
    expect(parsed.buildItems[0].objectId).toBe("7");
  });
});
