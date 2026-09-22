import type { VirtualBlendEntry } from "@core/virtualExtruders";

/** "E2 67% + E4 33%" for a virtual blend. */
export function blendRecipeText(entry: VirtualBlendEntry): string {
  const total = Math.max(1, entry.sequence.length);
  return entry.components
    .map((c) => {
      const pctValue = (c.count / total) * 100;
      const text = total === 3 && c.count === 1 ? "33%" : `${Math.round(pctValue)}%`;
      return `E${c.extruder} ${text}`;
    })
    .join(" + ");
}
