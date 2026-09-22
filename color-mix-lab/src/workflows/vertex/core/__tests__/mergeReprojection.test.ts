import { describe, expect, it } from "vitest";
import { buildFaceAdjacency, connectedComponentsOfSubset, majorityVertexLabels } from "../meshAdjacency";
import {
  defaultMinBlobForColour,
  groupWeightFractions,
  isLikelyAmbiguousColour,
  isLikelyProtectedColour,
  mergeWithReprojection,
} from "../mergeReprojection";
import { gridMesh } from "./fixtures";

describe("mesh adjacency", () => {
  it("connects faces that share a vertex", () => {
    const grid = gridMesh(2, 2);
    const adjacency = buildFaceAdjacency(grid.triangles, grid.vertices.length);
    // Face 0 = [0, 1, 4]: shares the centre vertex 4 with faces 1, 3, 4, 6, 7
    // and vertex 1 with face 2; faces 2 and 5 never touch the centre.
    const neighbours = [...adjacency.neighbours.subarray(adjacency.offsets[0], adjacency.offsets[1])].sort();
    expect(neighbours).toEqual([1, 2, 3, 4, 6, 7]);
    const ofFace5 = [...adjacency.neighbours.subarray(adjacency.offsets[5], adjacency.offsets[6])].sort();
    expect(ofFace5).toEqual([1, 4, 7]);
    for (let f = 0; f < adjacency.faceCount; f++) {
      const own = adjacency.neighbours.subarray(adjacency.offsets[f], adjacency.offsets[f + 1]);
      expect([...own]).not.toContain(f);
    }
  });

  it("finds connected components inside a subset", () => {
    const grid = gridMesh(6, 1);
    const adjacency = buildFaceAdjacency(grid.triangles, grid.vertices.length);
    // Faces of cells 0 and 5 only: two separate islands.
    const ids = Int32Array.from([0, 1, 10, 11]);
    const lookup = new Int32Array(adjacency.faceCount).fill(-1);
    ids.forEach((id, pos) => (lookup[id] = pos));
    const components = connectedComponentsOfSubset(adjacency, ids, lookup);
    expect(components.count).toBe(2);
    expect([...components.componentSizes]).toEqual([2, 2]);
  });

  it("votes vertex labels by majority with lowest-label tie break", () => {
    const grid = gridMesh(2, 1);
    const labels = Int32Array.from([0, 0, 1, 1]);
    const result = majorityVertexLabels(grid.triangles, labels, grid.vertices.length, 2);
    expect(result[0]).toBe(0); // only white faces
    expect(result[2]).toBe(1); // only skin faces
    expect(result[1]).toBe(1); // middle-bottom vertex: 1 white face, 2 skin faces
    expect(result[4]).toBe(0); // middle-top vertex: 2 white faces, 1 skin face
    // Vertex 4 touches faces 0, 1 and 3: one vote each -> lowest label wins.
    const tie = majorityVertexLabels(grid.triangles, Int32Array.from([2, 1, 0, 0]), grid.vertices.length, 3);
    expect(tie[4]).toBe(0);
  });
});

describe("Feature B: merge with re-judgement", () => {
  // 40 x 20 grid. Labels: 0 white, 1 skin, 2 grey (ambiguous), 3 red (accent).
  const grid = gridMesh(40, 20);
  const adjacency = buildFaceAdjacency(grid.triangles, grid.vertices.length);
  const labels = new Int32Array(grid.triangles.length);
  for (let f = 0; f < grid.triangles.length; f++) {
    const [i, j] = grid.cellOfFace[f];
    let label = i < 20 ? 0 : 1; // left white, right skin
    if (i >= 5 && i < 9 && j >= 5 && j < 9) label = 2; // grey patch deep inside white
    if (i >= 18 && i < 22 && j >= 12 && j < 16) label = 2; // grey patch straddling the boundary
    if (i >= 30 && i < 32 && j >= 2 && j < 4) label = 3; // small red accent inside skin
    if (i >= 11 && i < 15 && j >= 12 && j < 16) label = 1; // 32-face skin island inside white (< min_blob 60)
    labels[f] = label;
  }

  it("keeps the user merge for certain colours but re-judges ambiguous ones", () => {
    // User: merge grey (2) into skin (1). Groups: 0 white, 1 skin(+grey), 2 red.
    const labelToGroup = Int32Array.from([0, 1, 1, 2]);
    const result = mergeWithReprojection(adjacency, {
      faceLabels: labels,
      labelToGroup,
      groupCount: 3,
      ambiguousLabels: [2],
      protectGroups: [2],
      minBlob: new Map([[0, 150], [1, 60], [2, 150]]),
    });

    const inner = grid.cellOfFace
      .map((cell, f) => ({ cell, f }))
      .filter(({ cell: [i, j] }) => i >= 5 && i < 9 && j >= 5 && j < 9)
      .map(({ f }) => f);
    // Naive merge painted the inner grey patch skin; re-judgement returns it to white.
    expect(inner.every((f) => result.naiveGroups[f] === 1)).toBe(true);
    expect(inner.every((f) => result.groups[f] === 0)).toBe(true);
    expect(result.stats.ambiguousFaceCount).toBe(inner.length * 2);
    expect(result.stats.filledByPropagation).toBe(inner.length * 2);
    expect(result.stats.isolatedFallback).toBe(0);

    // The straddling patch splits along the surface it touches.
    const straddleWhite = grid.cellOfFace
      .map((cell, f) => ({ cell, f }))
      .filter(({ cell: [i, j] }) => i === 18 && j >= 12 && j < 16)
      .map(({ f }) => f);
    const straddleSkin = grid.cellOfFace
      .map((cell, f) => ({ cell, f }))
      .filter(({ cell: [i, j] }) => i === 21 && j >= 12 && j < 16)
      .map(({ f }) => f);
    expect(straddleWhite.every((f) => result.groups[f] === 0)).toBe(true);
    expect(straddleSkin.every((f) => result.groups[f] === 1)).toBe(true);

    // The protected red accent survives although it is far below min_blob.
    const red = grid.cellOfFace
      .map((cell, f) => ({ cell, f }))
      .filter(({ cell: [i, j] }) => i >= 30 && i < 32 && j >= 2 && j < 4)
      .map(({ f }) => f);
    expect(red.every((f) => result.groups[f] === 2)).toBe(true);

    // The skin island (32 faces < 60) inside white survives the boundary
    // smoothing (its interior faces only see skin) but is absorbed in step 3.
    const island = grid.cellOfFace
      .map((cell, f) => ({ cell, f }))
      .filter(({ cell: [i, j] }) => i >= 11 && i < 15 && j >= 12 && j < 16)
      .map(({ f }) => f);
    expect(island.length).toBe(32);
    expect(island.every((f) => result.groups[f] === 0)).toBe(true);
    // The boundary smoothing erodes the island corners first; the remaining
    // core (< 60 faces) is then absorbed as one island.
    expect(result.stats.absorbedIslands).toBeGreaterThanOrEqual(1);
    expect(result.stats.absorbedFaces).toBeGreaterThanOrEqual(island.length / 2);

    // Area accounting: skin shrinks compared to the naive merge.
    const naiveFractions = groupWeightFractions(result.naiveGroups, 3);
    const fractions = groupWeightFractions(result.groups, 3);
    expect(fractions[1]).toBeLessThan(naiveFractions[1]);
    expect(fractions[0] + fractions[1] + fractions[2]).toBeCloseTo(1, 6);
  });

  it("falls back to the user merge for ambiguous faces without any certain neighbour", () => {
    const tiny = gridMesh(2, 2);
    const tinyAdjacency = buildFaceAdjacency(tiny.triangles, tiny.vertices.length);
    const faceLabels = Int32Array.from(tiny.triangles.map(() => 0));
    const result = mergeWithReprojection(tinyAdjacency, {
      faceLabels,
      labelToGroup: Int32Array.from([1]),
      groupCount: 2,
      ambiguousLabels: [0],
      minBlob: 0,
    });
    expect([...result.groups].every((g) => g === 1)).toBe(true);
    expect(result.stats.isolatedFallback).toBe(tiny.triangles.length);
  });

  it("removes single-face jaggies along a boundary", () => {
    const g = gridMesh(10, 10);
    const adj = buildFaceAdjacency(g.triangles, g.vertices.length);
    const faceLabels = new Int32Array(g.triangles.length);
    for (let f = 0; f < g.triangles.length; f++) {
      const [i] = g.cellOfFace[f];
      faceLabels[f] = i < 5 ? 0 : 1;
    }
    // One stray white face deep in the skin half.
    const stray = g.cellOfFace.findIndex(([i, j]) => i === 8 && j === 5);
    faceLabels[stray] = 0;
    const result = mergeWithReprojection(adj, {
      faceLabels,
      labelToGroup: Int32Array.from([0, 1]),
      groupCount: 2,
      minBlob: 0,
    });
    expect(result.groups[stray]).toBe(1);
    expect(result.stats.smoothedFaceChanges).toBeGreaterThanOrEqual(1);
  });
});

describe("Feature B heuristics", () => {
  it("flags low-saturation mid-value colours and rare colours as ambiguous", () => {
    expect(isLikelyAmbiguousColour([0xd6, 0xc0, 0xc3], 0.1)).toBe(true); // #D6C0C3
    expect(isLikelyAmbiguousColour([0x7d, 0x72, 0x7a], 0.1)).toBe(true); // #7D727A
    expect(isLikelyAmbiguousColour([0xd6, 0x28, 0x28], 0.1)).toBe(false); // red
    expect(isLikelyAmbiguousColour([0xd6, 0x28, 0x28], 0.02)).toBe(true); // rare
    expect(isLikelyAmbiguousColour([255, 255, 255], 0.2)).toBe(false); // white: V too high
  });

  it("protects small saturated accents", () => {
    expect(isLikelyProtectedColour([0xd6, 0x28, 0x28], 0.005)).toBe(true);
    expect(isLikelyProtectedColour([0xd6, 0x28, 0x28], 0.05)).toBe(false);
    expect(isLikelyProtectedColour([0xa4, 0x91, 0x9e], 0.005)).toBe(false);
  });

  it("recommends min_blob per colour family", () => {
    expect(defaultMinBlobForColour([0xf2, 0xc9, 0xa8])).toBe(60); // skin
    expect(defaultMinBlobForColour([0x11, 0x11, 0x11])).toBe(120); // dark
    expect(defaultMinBlobForColour([0xc9, 0xa0, 0xdc])).toBe(150); // lilac
  });
});
