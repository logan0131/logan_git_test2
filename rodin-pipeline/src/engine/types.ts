import type {
  AccentProtectionMode,
  ColourDifferenceMetric,
  MappingStrategyMode,
  MixingRecipeResolution,
  VirtualMixPriorityMode,
} from "@core/types";

export const MAX_PHYSICAL = 8;
export const MIN_PHYSICAL = 2;

export interface FilamentSettings {
  /** Number of physical extruders in use (MIN_PHYSICAL..MAX_PHYSICAL). */
  count: number;
  /** Hex colour per slot, always MAX_PHYSICAL entries. */
  hex: string[];
  /** Display name per slot, always MAX_PHYSICAL entries. */
  names: string[];
}

export interface PaletteSettings {
  /** Maximum number of target colours after reduction. */
  maxColours: number;
  accentProtection: AccentProtectionMode;
}

export interface MergeSettings {
  ambiguousMaxSaturation: number;
  ambiguousMinValue: number;
  ambiguousMaxValue: number;
  ambiguousMinAreaPercent: number;
  protectMaxAreaPercent: number;
  protectMinSaturation: number;
  minBlobDefault: number;
  minBlobSkin: number;
  minBlobDark: number;
  propagationRounds: number;
  smoothingRounds: number;
}

export interface MixSettings {
  assignmentMode: "physical-and-virtual" | "physical-only";
  maxComponents: 2 | 3;
  recipeResolution: MixingRecipeResolution;
  accentProtection: AccentProtectionMode;
  mixPriority: VirtualMixPriorityMode;
  mappingStrategy: MappingStrategyMode;
  colourDifferenceMetric: ColourDifferenceMetric;
  previewLightnessOffset: number;
  purePhysicalThreshold: number;
  physicalDirectDeltaE: number;
  autoPhysicalDirect: boolean;
}

export interface ExportSettings {
  fileName: string;
  coordinateMode: "auto" | "keep" | "blender-y-up";
  scale: number;
  targetHeight: number | null;
  putOnBed: boolean;
  centerOnBed: boolean;
  bedX: number;
  bedY: number;
  defaultExtruder: number;
  includePrinterConfig: boolean;
}

/** Per palette colour (keyed by hex) merge decisions. */
export interface MergeFlag {
  /** Hex of the colour this one is merged into; null / own hex = keep. */
  target: string | null;
  ambiguous: boolean;
  protect: boolean;
  minBlob: number;
}

export interface FilamentListEntry {
  name: string;
  type: string;
  hex: string;
}

export interface PipelineSettings {
  version: 1;
  /** Imported filament list (Filament-DB style: name; type; #hex). */
  filamentList: FilamentListEntry[];
  /** Keep the loaded PrusaSlicer template in the browser for next time. */
  rememberTemplate: boolean;
  filaments: FilamentSettings;
  palette: PaletteSettings;
  merge: MergeSettings;
  mix: MixSettings;
  export: ExportSettings;
  mergeFlags: Record<string, MergeFlag>;
  /** Palette index -> physical extruder forced by the user. */
  manualPhysical: Record<string, number>;
}

export const FILAMENT_PRESETS: Array<{ name: string; hex: string[]; label: string }> = [
  { name: "XL5-WKCMY", label: "XL 5T: 흰 / 검 / 시안 / 마젠타 / 노랑", hex: ["#FFFFFF", "#111111", "#00B7EB", "#E4007C", "#FFE600"] },
  { name: "XL5-WKRBY", label: "XL 5T: 흰 / 검 / 빨강 / 파랑 / 노랑", hex: ["#FFFFFF", "#111111", "#C2001A", "#0065AA", "#EABD00"] },
  { name: "XL5-skin", label: "XL 5T 인물: 흰 / 검 / 살색 / 빨강 / 보라", hex: ["#FFFFFF", "#111111", "#F2C9A8", "#D62828", "#5B2C83"] },
  { name: "MMU5-CMYWK", label: "MMU3 5색: CMY + 흰 / 검", hex: ["#00FFFF", "#FF00FF", "#FFFF00", "#FFFFFF", "#000000"] },
  { name: "8-CMYWK+RGB", label: "8색: CMYWK + 빨 / 초 / 파", hex: ["#00FFFF", "#FF00FF", "#FFFF00", "#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF"] },
];

export const DEFAULT_SETTINGS: PipelineSettings = {
  version: 1,
  filamentList: [],
  rememberTemplate: true,
  filaments: {
    count: 5,
    hex: ["#FFFFFF", "#111111", "#00B7EB", "#E4007C", "#FFE600", "#FF0000", "#00FF00", "#0000FF"],
    names: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"],
  },
  palette: { maxColours: 16, accentProtection: "off" },
  merge: {
    ambiguousMaxSaturation: 0.25,
    ambiguousMinValue: 0.3,
    ambiguousMaxValue: 0.85,
    ambiguousMinAreaPercent: 3,
    protectMaxAreaPercent: 1,
    protectMinSaturation: 0.5,
    minBlobDefault: 150,
    minBlobSkin: 60,
    minBlobDark: 120,
    propagationRounds: 80,
    smoothingRounds: 3,
  },
  mix: {
    assignmentMode: "physical-and-virtual",
    maxComponents: 2,
    recipeResolution: "thirds",
    accentProtection: "off",
    mixPriority: "accurate",
    mappingStrategy: "closest",
    colourDifferenceMetric: "ciede2000",
    previewLightnessOffset: -36,
    purePhysicalThreshold: 0.985,
    physicalDirectDeltaE: 6,
    autoPhysicalDirect: true,
  },
  export: {
    fileName: "",
    coordinateMode: "keep",
    scale: 1,
    targetHeight: null,
    putOnBed: true,
    centerOnBed: true,
    bedX: 360,
    bedY: 360,
    defaultExtruder: 1,
    includePrinterConfig: false,
  },
  mergeFlags: {},
  manualPhysical: {},
};

export type ViewName = "front" | "back" | "left" | "right" | "top" | "iso";
export type PreviewMode = "source" | "palette" | "print";
