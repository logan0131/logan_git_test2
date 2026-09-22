import { describe, expect, it } from "vitest";
import { decodePaintCode, encodePaintCode, MAX_PAINTABLE_EXTRUDER_ID, tryDecodePaintCode } from "../paintCodes";

describe("paint codes", () => {
  it("uses the PrusaSlicer/Bambu encoding table", () => {
    expect(encodePaintCode(1)).toBe("4");
    expect(encodePaintCode(2)).toBe("8");
    expect(encodePaintCode(3)).toBe("0C");
    expect(encodePaintCode(4)).toBe("1C");
    expect(encodePaintCode(13)).toBe("AC");
    expect(encodePaintCode(14)).toBe("BC");
    expect(encodePaintCode(15)).toBe("CC");
    expect(encodePaintCode(17)).toBe("00EC");
  });

  it("round-trips every id the encoder can produce", () => {
    for (let id = 1; id <= MAX_PAINTABLE_EXTRUDER_ID; id++) expect(decodePaintCode(encodePaintCode(id))).toBe(id);
  });

  it("decodes the unpainted state and rejects garbage", () => {
    expect(decodePaintCode("")).toBe(0);
    expect(decodePaintCode("cc")).toBe(15);
    expect(tryDecodePaintCode("ZZ")).toBeNull();
    expect(() => decodePaintCode("EC")).toThrow();
    expect(() => encodePaintCode(0)).toThrow();
  });

  it("matches the PrusaSlicer 2.9.6 paint state limit (256 states, ids 1..255)", () => {
    expect(MAX_PAINTABLE_EXTRUDER_ID).toBe(255);
    expect(encodePaintCode(16)).toBe("DC");
    expect(encodePaintCode(MAX_PAINTABLE_EXTRUDER_ID)).toBe("EEEC");
    expect(decodePaintCode("EEEC")).toBe(255);
    expect(() => encodePaintCode(MAX_PAINTABLE_EXTRUDER_ID + 1)).toThrow(/limit/);
  });
});
