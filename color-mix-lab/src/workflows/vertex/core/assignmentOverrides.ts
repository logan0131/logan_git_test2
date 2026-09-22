import type { PaletteEntry, PhysicalSlot, RGB } from "./types";
import type {
  PhysicalOnlyEntry,
  VirtualBlendEntry,
  VirtualExtruderPlan,
} from "./virtualExtruders";

/**
 * Manual edits on top of a virtual extruder plan: force a palette colour onto
 * a physical extruder, or merge it into another palette colour's assignment.
 * Shared by the Color Mix Lab UI and the Rodin pipeline app.
 */
export type AssignmentOverride =
  | { kind: "physical"; extruder: number }
  | { kind: "merge"; targetPaletteIndex: number };

function paletteMapByIndex(palette: PaletteEntry[]): Map<number, PaletteEntry> {
  return new Map(palette.map((entry) => [entry.index, entry]));
}

function simpleRgbDistance(a: RGB, b: RGB): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function applyAssignmentOverridesToPlan(
  basePlan: VirtualExtruderPlan,
  palette: PaletteEntry[],
  physicalSlots: PhysicalSlot[],
  overrides: Record<number, AssignmentOverride>,
): VirtualExtruderPlan {
  const paletteByIndex = paletteMapByIndex(palette);
  const baseVirtualById = new Map(
    basePlan.virtualBlends.map((entry) => [entry.virtualId, entry]),
  );
  const physicalRgbByExtruder = new Map(
    physicalSlots.map((slot) => [slot.slot, slot.filament.effectiveRgb]),
  );
  const basePhysicalByPaletteIndex = new Map<number, PhysicalOnlyEntry>();
  for (const entry of basePlan.physicalOnly) {
    for (const paletteIndex of entry.targetPaletteIndices)
      basePhysicalByPaletteIndex.set(paletteIndex, entry);
  }
  const paletteToAssignment = new Map<
    number,
    | { kind: "physical"; extruder: number }
    | { kind: "virtual"; virtualId: number }
  >();
  const virtualPaletteIndices = new Map<number, number[]>();
  const physicalPaletteIndices = new Map<number, number[]>();

  const baseAssignmentFor = (paletteIndex: number) =>
    basePlan.paletteToAssignment.get(paletteIndex) ?? null;

  const resolvedAssignmentFor = (
    paletteIndex: number,
  ):
    | { kind: "physical"; extruder: number }
    | { kind: "virtual"; virtualId: number }
    | null => {
    const override = overrides[paletteIndex];
    if (override?.kind === "physical")
      return { kind: "physical", extruder: override.extruder };
    if (override?.kind === "merge") {
      const targetOverride = overrides[override.targetPaletteIndex];
      if (targetOverride?.kind === "physical")
        return { kind: "physical", extruder: targetOverride.extruder };
      return (
        baseAssignmentFor(override.targetPaletteIndex) ??
        baseAssignmentFor(paletteIndex)
      );
    }
    return baseAssignmentFor(paletteIndex);
  };

  for (const entry of palette) {
    const assignment = resolvedAssignmentFor(entry.index);
    if (!assignment) continue;
    paletteToAssignment.set(entry.index, assignment);
    if (assignment.kind === "virtual") {
      const list = virtualPaletteIndices.get(assignment.virtualId) ?? [];
      list.push(entry.index);
      virtualPaletteIndices.set(assignment.virtualId, list);
    } else {
      const list = physicalPaletteIndices.get(assignment.extruder) ?? [];
      list.push(entry.index);
      physicalPaletteIndices.set(assignment.extruder, list);
    }
  }

  const virtualBlends: VirtualBlendEntry[] = [];
  for (const [virtualId, indices] of virtualPaletteIndices) {
    const template = baseVirtualById.get(virtualId);
    if (!template) continue;
    const sorted = [...indices].sort((a, b) => a - b);
    const triangleCount = sorted.reduce(
      (sum, index) => sum + (paletteByIndex.get(index)?.count ?? 0),
      0,
    );
    virtualBlends.push({
      ...template,
      targetPaletteIndices: sorted,
      triangleCount,
      // Keep the preview colour from the base plan. It already contains the
      // selected FDM mixer prediction and virtual preview brightness calibration.
      displayRgb: template.displayRgb,
    });
  }
  virtualBlends.sort((a, b) => a.virtualId - b.virtualId);

  const physicalOnly = [...physicalPaletteIndices.entries()]
    .map(([extruder, indices]) => {
      const sorted = [...indices].sort((a, b) => a - b);
      const rawPhysicalRgb =
        physicalRgbByExtruder.get(extruder) ?? ([120, 120, 120] as RGB);
      const basePhysical = sorted
        .map((paletteIndex) => basePhysicalByPaletteIndex.get(paletteIndex))
        .find((entry) => entry?.physicalExtruder === extruder);
      const physicalRgb = basePhysical?.physicalRgb ?? rawPhysicalRgb;
      const triangleCount = sorted.reduce(
        (sum, paletteIndex) =>
          sum + (paletteByIndex.get(paletteIndex)?.count ?? 0),
        0,
      );
      const linearRgbError = sorted.reduce((maxError, paletteIndex) => {
        const p = paletteByIndex.get(paletteIndex);
        return Math.max(
          maxError,
          p ? simpleRgbDistance(p.rgb, rawPhysicalRgb) : 0,
        );
      }, 0);
      const firstPalette = paletteByIndex.get(sorted[0] ?? -1);
      return {
        paletteIndex: sorted[0] ?? extruder,
        targetPaletteIndices: sorted,
        targetRgb: firstPalette?.rgb ?? physicalRgb,
        physicalRgb,
        physicalExtruder: extruder,
        triangleCount,
        linearRgbError,
      };
    })
    .sort((a, b) => a.paletteIndex - b.paletteIndex);

  return {
    virtualBlends,
    physicalOnly,
    paletteToAssignment,
    mappingDiagnostics: basePlan.mappingDiagnostics,
  };
}
