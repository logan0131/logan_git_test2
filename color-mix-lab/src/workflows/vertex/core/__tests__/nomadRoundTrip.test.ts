import { describe, expect, it } from "vitest";
import type { MeshModel, RGB } from "../types";
import {
  applyNomadObjToModel,
  buildNomadObj,
  faceLabelsFromVertexLabels,
  nomadExportFileName,
  NOMAD_OFF_PALETTE_WARNING,
  NOMAD_USAGE_RULES,
  parseNomadObj,
  snapVertexColoursToPalette,
} from "../nomadRoundTrip";
import { rgbToHex } from "../colour";
import { gridMesh } from "./fixtures";

const WHITE: RGB = [255, 255, 255];
const SKIN: RGB = [0xf2, 0xc9, 0xa8];
const BLACK: RGB = [17, 17, 17];
const PALETTE: RGB[] = [WHITE, SKIN, BLACK];

function mergedModel(): MeshModel {
  const grid = gridMesh(10, 4);
  const triangleColors: RGB[] = grid.cellOfFace.map(([i]) => (i < 5 ? WHITE : SKIN));
  return {
    name: "typhoeus_rodin13.obj",
    vertices: grid.vertices,
    triangles: grid.triangles,
    triangleColors,
    stats: {
      vertexCount: grid.vertices.length,
      triangleCount: grid.triangles.length,
      coloredVertexCount: grid.vertices.length,
      uniqueFaceColors: 2,
      objectFaceCounts: { grid: grid.triangles.length },
    },
  };
}

describe("C-1 Nomad export", () => {
  it("writes an unwelded vertex-colour OBJ with only the palette colours", () => {
    const model = mergedModel();
    const result = buildNomadObj(model, model.triangleColors, [WHITE, SKIN]);
    expect(result.fileName).toBe("typhoeus_rodin13_2colors_for_nomad.obj");
    expect(result.vertexCount).toBe(model.vertices.length);
    expect(result.faceCount).toBe(model.triangles.length);
    const vertexLines = result.obj.split("\n").filter((line) => line.startsWith("v "));
    const faceLines = result.obj.split("\n").filter((line) => line.startsWith("f "));
    expect(vertexLines.length).toBe(model.vertices.length);
    expect(faceLines.length).toBe(model.triangles.length);
    expect(result.obj).toContain("# CML palette: #FFFFFF #F2C9A8");
    // Vertex colours are majority colours: a vertex on the white/skin boundary
    // has 3 white and 3 skin faces -> lowest label (white).
    const boundary = 1 * 11 + 5;
    expect(vertexLines[boundary]).toMatch(/ 1 1 1$/);
    expect(vertexLines[1 * 11 + 7]).toMatch(/ 0\.94902 0\.788235 0\.658824$/);
    expect(nomadExportFileName("typhoeus_6colors_for_nomad.obj", 6)).toBe("typhoeus_6colors_for_nomad.obj");
  });

  it("lists the Nomad usage rules", () => {
    expect(NOMAD_USAGE_RULES.length).toBe(5);
    expect(NOMAD_USAGE_RULES.join(" ")).toMatch(/eyedropper/);
  });
});

describe("C-2 Nomad import", () => {
  it("parses vertex colours (0..1 floats) and the palette hint", () => {
    const model = mergedModel();
    const exported = buildNomadObj(model, model.triangleColors, [WHITE, SKIN]);
    const parsed = parseNomadObj(exported.obj);
    expect(parsed.vertices.length).toBe(model.vertices.length);
    expect(parsed.triangles.length).toBe(model.triangles.length);
    expect(parsed.colouredVertexCount).toBe(model.vertices.length);
    expect(parsed.paletteHint?.map(rgbToHex)).toEqual(["#FFFFFF", "#F2C9A8"]);
    expect(parsed.vertexColours[0]).toEqual(WHITE);
  });

  it("updates only the colours when the topology is unchanged, and stays inside the palette", () => {
    const model = mergedModel();
    const exported = buildNomadObj(model, model.triangleColors, [WHITE, SKIN]);
    const parsed = parseNomadObj(exported.obj);
    // Nomad touch-up: paint the whole right column skin -> black? No: repaint a
    // few skin vertices back to white with a slightly off eyedropper colour.
    for (let v = 0; v < parsed.vertexColours.length; v++) {
      const i = v % 11;
      if (i >= 8) parsed.vertexColours[v] = [252, 253, 250];
    }
    const result = applyNomadObjToModel(model, parsed, PALETTE, "back.obj");
    expect(result.mode).toBe("colours-only");
    expect(result.warnings).toEqual([]);
    expect(result.snap.offPaletteVertexCount).toBe(0);
    expect(result.model.vertices).toBe(model.vertices);
    expect(result.colourCount).toBe(2);
    const hexes = new Set(result.model.triangleColors.map(rgbToHex));
    expect([...hexes].sort()).toEqual(["#F2C9A8", "#FFFFFF"]);
    // Cells 8 and 9 are now white and cell 6 is still skin. Cells 4/5 and 7
    // touch a colour boundary, where the vertex-colour representation decides
    // per triangle (majority of the three corners).
    const grid = gridMesh(10, 4);
    grid.cellOfFace.forEach(([i], f) => {
      const hex = rgbToHex(result.model.triangleColors[f]);
      if (i < 4 || i >= 8) expect(hex, `face ${f}`).toBe("#FFFFFF");
      else if (i === 6) expect(hex, `face ${f}`).toBe("#F2C9A8");
      else expect(["#FFFFFF", "#F2C9A8"], `face ${f}`).toContain(hex);
    });
    const skinBefore = model.triangleColors.filter((c) => rgbToHex(c) === "#F2C9A8").length;
    const skinAfter = result.model.triangleColors.filter((c) => rgbToHex(c) === "#F2C9A8").length;
    expect(skinAfter).toBeLessThan(skinBefore);
  });

  it("warns when more than 1% of the vertices carry colours far from the palette", () => {
    const model = mergedModel();
    const exported = buildNomadObj(model, model.triangleColors, [WHITE, SKIN]);
    const parsed = parseNomadObj(exported.obj);
    for (let v = 0; v < 5; v++) parsed.vertexColours[v] = [0, 255, 0];
    const result = applyNomadObjToModel(model, parsed, PALETTE, "back.obj");
    expect(result.snap.offPaletteVertexCount).toBe(5);
    expect(result.warnings).toContain(NOMAD_OFF_PALETTE_WARNING);
    // Still snapped to a palette colour.
    const hexes = new Set(result.model.triangleColors.map(rgbToHex));
    for (const hex of hexes) expect(["#FFFFFF", "#F2C9A8", "#111111"]).toContain(hex);
  });

  it("reloads the whole model with a warning when Nomad remeshed", () => {
    const model = mergedModel();
    const other = gridMesh(3, 3);
    const parsed = parseNomadObj(
      other.vertices.map(([x, y, z]) => `v ${x} ${y} ${z} 0.95 0.79 0.66`).join("\n") +
        "\n" +
        other.triangles.map((t) => `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}`).join("\n"),
    );
    const result = applyNomadObjToModel(model, parsed, PALETTE, "remeshed.obj");
    expect(result.mode).toBe("full-reload");
    expect(result.warnings.join(" ")).toMatch(/counts differ/);
    expect(result.model.vertices.length).toBe(other.vertices.length);
    expect(result.model.name).toBe("remeshed.obj");
    expect(new Set(result.model.triangleColors.map(rgbToHex))).toEqual(new Set(["#F2C9A8"]));
  });

  it("uses the palette comment when no palette is given", () => {
    const model = mergedModel();
    const exported = buildNomadObj(model, model.triangleColors, [WHITE, SKIN]);
    const parsed = parseNomadObj(exported.obj);
    const result = applyNomadObjToModel(null, parsed, [], "fresh.obj");
    expect(result.mode).toBe("full-reload");
    expect(result.colourCount).toBe(2);
  });

  it("snaps with CIEDE2000 and reports the maximum distance", () => {
    const report = snapVertexColoursToPalette([[250, 250, 250], [0, 0, 0], null], PALETTE);
    expect([...report.labels]).toEqual([0, 2, 0]);
    expect(report.maxDeltaE).toBeLessThan(8);
    expect(report.uniqueColourCount).toBe(2);
  });

  it("breaks three-way ties with the vertex nearest to the centroid", () => {
    const vertices = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
    ] as MeshModel["vertices"];
    const triangles = [[0, 1, 2]] as MeshModel["triangles"];
    expect([...faceLabelsFromVertexLabels(vertices, triangles, [5, 6, 7])]).toEqual([5]);
    expect([...faceLabelsFromVertexLabels(vertices, triangles, [5, 6, 6])]).toEqual([6]);
    const skewed = [
      [0, 0, 0],
      [3, 1, 0],
      [0, 10, 0],
    ] as MeshModel["vertices"];
    // Centroid (1, 3.67): vertex 1 (3,1) is closest.
    expect([...faceLabelsFromVertexLabels(skewed, triangles, [5, 6, 7])]).toEqual([6]);
  });
});
