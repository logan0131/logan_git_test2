/**
 * PrusaSlicer / Bambu Studio MMU painting codes.
 *
 * Both slicers serialise the per-triangle extruder state of a painted mesh
 * with the same compact hex encoding (3MF attribute
 * `slic3rpe:mmu_segmentation` in PrusaSlicer, `paint_color` in Bambu Studio).
 *
 *   extruder 1  -> "4"
 *   extruder 2  -> "8"
 *   extruder 3+ -> hex(extruder - 3) + "C"      ("0C" = 3 … "CC" = 15, "DC" = 16)
 *   extruder 17+ -> two hex digits (extruder - 17) + "EC"   (extended form)
 *
 * PrusaSlicer Full Spectrum (ColorMix) virtual extruders share the same
 * numbering space with the physical extruders, so the total number of
 * physical + virtual extruders is limited by this encoding:
 *
 *   PrusaSlicer <= 2.9.5: TriangleSelector states are 6-bit, max extruder 15
 *                         (the original work order's "15 colours" limit).
 *   PrusaSlicer >= 2.9.6: TRIANGLE_STATE_TYPE_COUNT = 256; states 17..255 use
 *                         the 14-bit "vvEC" form and the file must carry
 *                         <metadata name="slic3rpe:MmPaintingVersion">2</metadata>
 *                         (which the exporter always writes).
 *
 * ColorMix itself only exists from 2.9.6 on, so the export accepts up to 255.
 */

/** Highest physical + virtual extruder id the export accepts (PrusaSlicer 2.9.6+ paint state limit). */
export const MAX_PAINTABLE_EXTRUDER_ID = 255;

export function encodePaintCode(extruderId: number): string {
  const id = Math.round(extruderId);
  if (!Number.isFinite(id) || id < 1) throw new Error("Extruder ID is too small.");
  if (id > MAX_PAINTABLE_EXTRUDER_ID) throw new Error(`Extruder ID ${id} exceeds the PrusaSlicer paint state limit (${MAX_PAINTABLE_EXTRUDER_ID}).`);
  if (id === 1) return "4";
  if (id === 2) return "8";
  const state = id - 3;
  if (state <= 13) return `${state.toString(16).toUpperCase()}C`;
  const value = state - 14;
  if (value > 0xff) throw new Error("Too many extruders for this encoder.");
  return `${value.toString(16).toUpperCase().padStart(2, "0")}EC`;
}

/**
 * Inverse of encodePaintCode.  An empty code means "not painted" (0).
 * Throws for codes the encoder can never produce.
 */
export function decodePaintCode(code: string): number {
  const c = code.trim().toUpperCase();
  if (c === "") return 0;
  if (c === "4") return 1;
  if (c === "8") return 2;
  const compact = /^([0-9A-D])C$/.exec(c);
  if (compact) return parseInt(compact[1], 16) + 3;
  const extended = /^([0-9A-F]{2})EC$/.exec(c);
  if (extended) return parseInt(extended[1], 16) + 17;
  throw new Error(`Unsupported MMU paint code "${code}".`);
}

/** Lenient variant for parsers: returns null instead of throwing. */
export function tryDecodePaintCode(code: string): number | null {
  try {
    return decodePaintCode(code);
  } catch {
    return null;
  }
}
