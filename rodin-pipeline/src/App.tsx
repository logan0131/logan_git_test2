import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { MeshModel, PaletteEntry, PhysicalSlot, RGB } from "@core/types";
import { rgbToHex } from "@core/colour";
import { medianCutPalette } from "@core/quantize";
import { buildVirtualExtruderPlan } from "@core/virtualExtruders";
import { applyAssignmentOverridesToPlan, type AssignmentOverride } from "@core/assignmentOverrides";
import { loadRodin3mf } from "@core/rodin3mf";
import { parseObjFile } from "@core/objParser";
import { readTemplate3mf, type Template3mfInfo } from "@core/template3mf";
import { buildFaceAdjacency, type FaceAdjacency } from "@core/meshAdjacency";
import {
  groupWeightFractions,
  isLikelyAmbiguousColour,
  isLikelyProtectedColour,
  isDarkColour,
  isSkinLikeColour,
  mergeWithReprojection,
} from "@core/mergeReprojection";
import { buildExportAssignments, buildPrusa3mfBlob, validateExportAssignments } from "@core/export3mf";
import { decodePaintCode } from "@core/paintCodes";
import { applyNomadObjToModel, buildNomadObj, parseNomadObj } from "@core/nomadRoundTrip";
import { deltaE2000, rgbToLab } from "@core/prusaFdmMixer";
import { downloadBlob, downloadText } from "@core/exportCsv";
import {
  DEFAULT_SETTINGS,
  type MergeFlag,
  type PipelineSettings,
  type PreviewMode,
  type ViewName,
} from "./engine/types";
import {
  areaFractionByPosition,
  buildColourBuffer,
  buildPositions,
  colourKey,
  countUniqueColours,
  hexToRgb,
  highlightGeometry,
  maskFromFaces,
  maskFromLabels,
  paletteLabels,
  representativeColoursByPosition,
  sameLabelComponent,
  triangleAreaWeights,
} from "./engine/mesh";
import { downloadTextFile, idbDelete, idbGet, idbSet, loadStoredSettings, mergeSettings, settingsToJson, storeSettings } from "./engine/storage";
import { MeshViewer, type HighlightOverlay } from "./ui/MeshViewer";
import { LoadSection, type SourceInfo } from "./ui/LoadSection";
import { FilamentSection } from "./ui/FilamentSection";
import { MergeSection, type MergeReportData } from "./ui/MergeSection";
import { MixSection, type PhysicalDirectSuggestion } from "./ui/MixSection";
import { ExportSection, type ExportCheck } from "./ui/ExportSection";
import { Swatch, pct } from "./ui/common";
import { ColourSelect } from "./ui/ColourSelect";
import { LangContext, loadStoredLang, storeLang, translate, type Lang, type Params, type Key } from "./i18n";

const APP_VERSION = "0.2.3";

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "model";
}

function yieldToUi(ms = 30): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function App() {
  const [lang, setLangState] = useState<Lang>(() => loadStoredLang());
  const t = useCallback((key: Key, params?: Params) => translate(lang, key, params), [lang]);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    storeLang(next);
  }, []);
  const [settings, setSettings] = useState<PipelineSettings>(() => loadStoredSettings());
  const [model, setModel] = useState<MeshModel | null>(null);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [history, setHistory] = useState<RGB[][]>([]);
  const [template, setTemplate] = useState<{ info: Template3mfInfo; buffer: ArrayBuffer } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState(() => translate(loadStoredLang(), "status.ready"));
  const [mergeReport, setMergeReport] = useState<MergeReportData | null>(null);
  const [nomadReport, setNomadReport] = useState<{ message: string; warnings: string[] } | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("palette");
  const [split, setSplit] = useState(true);
  const [view, setView] = useState<ViewName>("front");
  const [fitNonce, setFitNonce] = useState(0);
  const [hoverHex, setHoverHex] = useState<string | null>(null);
  const [selectedHexes, setSelectedHexes] = useState<string[]>([]);
  const [picked, setPicked] = useState<{ faces: Int32Array; hex: string; index: number; fraction: number } | null>(null);
  const [pickTarget, setPickTarget] = useState("");
  const [pickCustom, setPickCustom] = useState("#FF0000");
  const hoverTimerRef = useRef<number | null>(null);
  const templateRestoredRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const stored = Number(window.localStorage.getItem("rodin-pipeline-sidebar-width"));
      return Number.isFinite(stored) && stored >= 320 ? stored : 600;
    } catch {
      return 600;
    }
  });
  const [splitterDragging, setSplitterDragging] = useState(false);
  const adjacencyRef = useRef<{ triangles: MeshModel["triangles"]; adjacency: FaceAdjacency } | null>(null);
  const modelFileRef = useRef<File | null>(null);

  useEffect(() => {
    storeSettings(settings);
  }, [settings]);

  const patchSettings = useCallback(<K extends keyof PipelineSettings>(key: K, value: PipelineSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ------------------------------------------------------------------
  // Derived data
  // ------------------------------------------------------------------
  const areaWeights = useMemo(() => (model ? triangleAreaWeights(model) : new Float32Array(0)), [model]);
  const areaWeightList = useMemo(() => Array.from(areaWeights), [areaWeights]);
  const positions = useMemo(() => (model ? buildPositions(model) : null), [model]);

  const palette = useMemo<PaletteEntry[]>(() => {
    if (!model) return [];
    return medianCutPalette(model.triangleColors, settings.palette.maxColours, areaWeightList, settings.palette.accentProtection);
  }, [model, settings.palette.maxColours, settings.palette.accentProtection, areaWeightList]);

  const labels = useMemo(
    () => (model ? paletteLabels(model.triangleColors, palette, settings.palette.accentProtection) : new Int32Array(0)),
    [model, palette, settings.palette.accentProtection],
  );
  const areaByPosition = useMemo(() => areaFractionByPosition(labels, palette.length, areaWeights), [labels, palette.length, areaWeights]);
  const areaByIndex = useMemo(() => {
    const map = new Map<number, number>();
    palette.forEach((entry, position) => map.set(entry.index, areaByPosition[position] ?? 0));
    return map;
  }, [palette, areaByPosition]);

  const slots = useMemo<PhysicalSlot[]>(
    () =>
      Array.from({ length: settings.filaments.count }, (_v, i) => {
        const rgb = hexToRgb(settings.filaments.hex[i] ?? "#808080");
        return {
          slot: i + 1,
          filament: {
            name: settings.filaments.names[i] || `E${i + 1}`,
            type: "",
            rgb,
            effectiveRgb: rgb,
            sourceLine: settings.filaments.hex[i] ?? "",
          },
          role: "fixed physical colour",
        };
      }),
    [settings.filaments],
  );

  const basePlan = useMemo(() => {
    if (palette.length === 0 || slots.length === 0) return null;
    const mix = settings.mix;
    return buildVirtualExtruderPlan(palette, slots, {
      maxComponents: mix.assignmentMode === "physical-only" ? 1 : mix.maxComponents,
      virtualStartId: slots.length + 1,
      purePhysicalThreshold: mix.purePhysicalThreshold,
      recipeResolution: mix.recipeResolution,
      accentProtection: mix.accentProtection,
      mixPriority: mix.mixPriority,
      mappingStrategy: mix.mappingStrategy,
      colourDifferenceMetric: mix.colourDifferenceMetric,
      previewLightnessOffset: mix.previewLightnessOffset,
    });
  }, [palette, slots, settings.mix]);

  const suggestions = useMemo(() => {
    const map = new Map<number, PhysicalDirectSuggestion>();
    if (!basePlan || slots.length === 0) return map;
    const slotLabs = slots.map((slot) => ({ slot: slot.slot, lab: rgbToLab(slot.filament.effectiveRgb) }));
    const byIndex = new Map(palette.map((entry) => [entry.index, entry]));
    for (const blend of basePlan.virtualBlends) {
      for (const paletteIndex of blend.targetPaletteIndices) {
        const entry = byIndex.get(paletteIndex);
        if (!entry) continue;
        const lab = rgbToLab(entry.rgb);
        let best: PhysicalDirectSuggestion | null = null;
        for (const candidate of slotLabs) {
          const deltaE = deltaE2000(lab, candidate.lab);
          if (!best || deltaE < best.deltaE) best = { extruder: candidate.slot, deltaE };
        }
        if (best && best.deltaE < settings.mix.physicalDirectDeltaE) map.set(paletteIndex, best);
      }
    }
    return map;
  }, [basePlan, palette, slots, settings.mix.physicalDirectDeltaE]);

  const plan = useMemo(() => {
    if (!basePlan) return null;
    const overrides: Record<number, AssignmentOverride> = {};
    if (settings.mix.autoPhysicalDirect) {
      for (const [paletteIndex, suggestion] of suggestions) overrides[paletteIndex] = { kind: "physical", extruder: suggestion.extruder };
    }
    for (const [key, extruder] of Object.entries(settings.manualPhysical)) {
      const paletteIndex = Number(key);
      if (Number.isFinite(paletteIndex) && extruder >= 1 && extruder <= slots.length) overrides[paletteIndex] = { kind: "physical", extruder };
    }
    return applyAssignmentOverridesToPlan(basePlan, palette, slots, overrides);
  }, [basePlan, palette, slots, suggestions, settings.mix.autoPhysicalDirect, settings.manualPhysical]);

  const effectiveByIndex = useMemo(() => {
    const map = new Map<number, RGB>();
    if (!plan) return map;
    for (const entry of plan.virtualBlends) for (const i of entry.targetPaletteIndices) map.set(i, entry.displayRgb);
    for (const entry of plan.physicalOnly) for (const i of entry.targetPaletteIndices) map.set(i, entry.physicalRgb);
    return map;
  }, [plan]);

  const sourceColours = useMemo(() => (model ? buildColourBuffer(model.triangles.length, (i) => model.triangleColors[i]) : null), [model]);
  const paletteColours = useMemo(
    () => (model && palette.length > 0 ? buildColourBuffer(model.triangles.length, (i) => palette[labels[i]]?.rgb ?? model.triangleColors[i]) : sourceColours),
    [model, palette, labels, sourceColours],
  );
  const printColours = useMemo(
    () =>
      model && palette.length > 0 && effectiveByIndex.size > 0
        ? buildColourBuffer(model.triangles.length, (i) => {
            const entry = palette[labels[i]];
            return (entry && effectiveByIndex.get(entry.index)) ?? entry?.rgb ?? model.triangleColors[i];
          })
        : paletteColours,
    [model, palette, labels, effectiveByIndex, paletteColours],
  );
  const coloursForMode = (mode: PreviewMode) => (mode === "source" ? sourceColours : mode === "palette" ? paletteColours : printColours);

  const defaultFileName = model ? `${baseName(model.name)}_colormix.3mf` : "model_colormix.3mf";

  const exportCheck = useMemo<ExportCheck | null>(() => {
    if (!plan || palette.length === 0) return null;
    try {
      const assignments = buildExportAssignments(plan, slots.length);
      const used = new Set<number>();
      for (const entry of palette) {
        const code = assignments.paletteToPaintCode.get(entry.index);
        used.add(code === undefined ? 0 : decodePaintCode(code));
      }
      const failures = validateExportAssignments({ physicalExtruderCount: slots.length, virtuals: assignments.virtuals, usedPaintStates: used });
      return {
        physicalCount: slots.length,
        virtualIds: assignments.virtuals.map((v) => v.id),
        renumbered: [...assignments.virtualIdRemap.entries()].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to })),
        failures,
      };
    } catch (err) {
      return { physicalCount: slots.length, virtualIds: [], renumbered: [], failures: [err instanceof Error ? err.message : String(err)] };
    }
  }, [plan, palette, slots.length]);

  // ------------------------------------------------------------------
  // Highlights (hover / selected colours / picked patch), picking, template memory
  // ------------------------------------------------------------------
  const hexByPosition = useMemo(() => palette.map((entry) => rgbToHex(entry.rgb)), [palette]);
  const positionByHex = useMemo(() => new Map(hexByPosition.map((hex, position) => [hex, position])), [hexByPosition]);

  const hoverOverlay = useMemo<HighlightOverlay | null>(() => {
    if (!model || !hoverHex) return null;
    const position = positionByHex.get(hoverHex);
    if (position === undefined) return null;
    const { fill, edges } = highlightGeometry(model, maskFromLabels(labels, [position]));
    return { id: "hover", colour: "#4fd8ff", opacity: 0.45, pulse: true, fill, edges };
  }, [model, hoverHex, positionByHex, labels]);

  const selectedOverlay = useMemo<HighlightOverlay | null>(() => {
    if (!model || selectedHexes.length === 0) return null;
    const wanted = selectedHexes.map((hex) => positionByHex.get(hex)).filter((p): p is number => p !== undefined);
    if (wanted.length === 0) return null;
    const { fill, edges } = highlightGeometry(model, maskFromLabels(labels, wanted));
    return { id: "selected", colour: "#ffd84f", opacity: 0.35, pulse: true, fill, edges };
  }, [model, selectedHexes, positionByHex, labels]);

  const pickedOverlay = useMemo<HighlightOverlay | null>(() => {
    if (!model || !picked) return null;
    const { fill, edges } = highlightGeometry(model, maskFromFaces(model.triangles.length, picked.faces));
    return { id: "picked", colour: "#ff8a3d", opacity: 0.55, pulse: true, fill, edges };
  }, [model, picked]);

  const overlays = useMemo(
    () => [selectedOverlay, hoverOverlay, pickedOverlay].filter((o): o is HighlightOverlay => o !== null),
    [selectedOverlay, hoverOverlay, pickedOverlay],
  );

  function handleHover(hex: string | null): void {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHoverHex(hex);
    }, hex ? 90 : 160);
  }

  function toggleSelectedHex(hex: string): void {
    setSelectedHexes((prev) => (prev.includes(hex) ? prev.filter((h) => h !== hex) : [...prev, hex]));
  }

  function mergeSelected(targetHex: string): void {
    if (!targetHex || !positionByHex.has(targetHex)) return;
    const nextFlags = { ...settings.mergeFlags };
    for (const hex of selectedHexes) {
      if (hex === targetHex || !positionByHex.has(hex)) continue;
      nextFlags[hex] = {
        ...(nextFlags[hex] ?? { target: null, ambiguous: false, protect: false, minBlob: settings.merge.minBlobDefault }),
        target: targetHex,
      };
    }
    setSettings((prev) => ({ ...prev, mergeFlags: nextFlags }));
    setSelectedHexes([]);
    void runMerge(nextFlags);
  }

  async function handlePick(faceIndex: number | null): Promise<void> {
    if (!model) return;
    if (faceIndex === null || faceIndex < 0 || faceIndex >= labels.length) {
      if (picked) setPicked(null);
      else setStatus(t("status.pickNothing"));
      return;
    }
    setBusy(t("busy.picking"));
    await yieldToUi();
    try {
      const adjacency = adjacencyFor(model);
      const faces = sameLabelComponent(adjacency.offsets, adjacency.neighbours, labels, faceIndex);
      const position = labels[faceIndex];
      const hex = hexByPosition[position] ?? rgbToHex(model.triangleColors[faceIndex]);
      let area = 0;
      let total = 0;
      for (let i = 0; i < areaWeights.length; i++) total += areaWeights[i];
      for (let i = 0; i < faces.length; i++) area += areaWeights[faces[i]];
      const fraction = total > 0 ? area / total : 0;
      const index = palette[position]?.index ?? 0;
      setPicked({ faces, hex, index, fraction });
      setPickTarget("");
      setStatus(t("status.picked", { index, hex, n: faces.length.toLocaleString(), pct: pct(fraction) }));
    } finally {
      setBusy(null);
    }
  }

  function applyPickColour(): void {
    if (!model || !picked) return;
    const targetHex = (pickTarget === "__new__" ? pickCustom : pickTarget).toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(targetHex)) return;
    const position = positionByHex.get(targetHex);
    const representatives = representativeColoursByPosition(model.triangleColors, labels, palette);
    const rgb: RGB = position !== undefined ? representatives[position] : hexToRgb(targetHex);
    const next = model.triangleColors.slice();
    for (let i = 0; i < picked.faces.length; i++) next[picked.faces[i]] = rgb;
    const count = picked.faces.length;
    applyColours(model, next);
    setStatus(t("status.recoloured", { n: count.toLocaleString(), hex: targetHex }));
  }

  // Remembered PrusaSlicer template (IndexedDB).
  useEffect(() => {
    if (templateRestoredRef.current) return;
    templateRestoredRef.current = true;
    if (!settings.rememberTemplate) return;
    void (async () => {
      const stored = await idbGet<{ name: string; buffer: ArrayBuffer }>("template");
      if (!stored || !(stored.buffer instanceof ArrayBuffer)) return;
      try {
        const file = new File([stored.buffer], stored.name, { type: "model/3mf" });
        const info = await readTemplate3mf(file);
        setTemplate({ info, buffer: stored.buffer });
        if (info.bedSize) {
          const bedX = Math.round(info.bedSize.x);
          const bedY = Math.round(info.bedSize.y);
          setSettings((prev) => ({ ...prev, export: { ...prev.export, bedX, bedY } }));
        }
        setStatus(t("status.templateRestored", { name: stored.name }));
      } catch {
        void idbDelete("template");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!settings.rememberTemplate) {
      void idbDelete("template");
      return;
    }
    if (template) void idbSet("template", { name: template.info.fileName, buffer: template.buffer });
  }, [settings.rememberTemplate, template]);

  function clearTemplate(): void {
    setTemplate(null);
    void idbDelete("template");
  }

  // Suggest merge flags for palette colours that have none yet.
  useEffect(() => {
    if (palette.length === 0) return;
    setSettings((prev) => {
      let changed = false;
      const next = { ...prev.mergeFlags };
      palette.forEach((entry, position) => {
        const hex = rgbToHex(entry.rgb);
        if (next[hex]) return;
        next[hex] = autoFlagFor(entry.rgb, areaByPosition[position] ?? 0, prev);
        changed = true;
      });
      return changed ? { ...prev, mergeFlags: next } : prev;
    });
  }, [palette, areaByPosition]);

  function autoFlagFor(rgb: RGB, area: number, current: PipelineSettings): MergeFlag {
    const m = current.merge;
    return {
      target: null,
      ambiguous: isLikelyAmbiguousColour(rgb, area, {
        maxSaturation: m.ambiguousMaxSaturation,
        minValue: m.ambiguousMinValue,
        maxValue: m.ambiguousMaxValue,
        minAreaFraction: m.ambiguousMinAreaPercent / 100,
      }),
      protect: isLikelyProtectedColour(rgb, area, { maxAreaFraction: m.protectMaxAreaPercent / 100, minSaturation: m.protectMinSaturation }),
      minBlob: isSkinLikeColour(rgb) ? m.minBlobSkin : isDarkColour(rgb) ? m.minBlobDark : m.minBlobDefault,
    };
  }

  function reapplyAutoFlags(): void {
    setSettings((prev) => {
      const next = { ...prev.mergeFlags };
      palette.forEach((entry, position) => {
        const hex = rgbToHex(entry.rgb);
        next[hex] = { ...autoFlagFor(entry.rgb, areaByPosition[position] ?? 0, prev), target: next[hex]?.target ?? null };
      });
      return { ...prev, mergeFlags: next };
    });
  }

  function updateFlag(hex: string, patch: Partial<MergeFlag>): void {
    setSettings((prev) => ({
      ...prev,
      mergeFlags: {
        ...prev.mergeFlags,
        [hex]: { ...(prev.mergeFlags[hex] ?? { target: null, ambiguous: false, protect: false, minBlob: prev.merge.minBlobDefault }), ...patch },
      },
    }));
  }

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------
  function installModel(next: MeshModel, info: SourceInfo, file: File | null): void {
    modelFileRef.current = file;
    adjacencyRef.current = null;
    setHistory([]);
    setMergeReport(null);
    setNomadReport(null);
    setPicked(null);
    setSelectedHexes([]);
    setHoverHex(null);
    setModel(next);
    setSourceInfo(info);
    setSettings((prev) => ({ ...prev, manualPhysical: {}, export: { ...prev.export, fileName: "" } }));
    setFitNonce((n) => n + 1);
  }

  async function onModelFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    setBusy(lower.endsWith(".3mf") ? t("busy.readingRodin") : t("busy.readingObj"));
    await yieldToUi();
    try {
      if (lower.endsWith(".3mf")) {
        const result = await loadRodin3mf(file, file.name);
        installModel(
          result.model,
          {
            kind: "rodin",
            fileName: file.name,
            uniqueColours: result.model.stats.uniqueFaceColors,
            rodin: {
              paletteHex: result.paletteHex,
              usedPaletteNumbers: result.usedPaletteNumbers,
              warnings: result.warnings,
              paletteSource: result.paletteSource,
              paletteCount: result.stats.paletteCount,
              usedColourCount: result.stats.usedColourCount,
              unpaintedTriangleCount: result.stats.unpaintedTriangleCount,
            },
          },
          file,
        );
        setStatus(
          t("status.rodinLoaded", {
            faces: result.stats.triangleCount.toLocaleString(),
            vertices: result.stats.vertexCount.toLocaleString(),
            palette: result.stats.paletteCount,
            used: result.stats.usedColourCount,
          }),
        );
      } else {
        const parsed = await parseObjFile(file, (p) => {
          if (p.totalBytes && p.loadedBytes !== undefined) setBusy(t("busy.readingObjPct", { pct: Math.round((p.loadedBytes / p.totalBytes) * 100) }));
        });
        installModel(parsed, { kind: "obj", fileName: file.name, uniqueColours: parsed.stats.uniqueFaceColors }, file);
        setStatus(t("status.objLoaded", { faces: parsed.stats.triangleCount.toLocaleString(), colours: parsed.stats.uniqueFaceColors }));
      }
    } catch (err) {
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function onTemplateFile(file: File): Promise<void> {
    setBusy(t("busy.readingTemplate"));
    try {
      const [info, buffer] = await Promise.all([readTemplate3mf(file), file.arrayBuffer()]);
      setTemplate({ info, buffer });
      if (info.bedSize) patchSettings("export", { ...settings.export, bedX: Math.round(info.bedSize.x), bedY: Math.round(info.bedSize.y) });
      setStatus(t("status.templateLoaded", { name: file.name, bed: info.bedSize ? t("status.templateBed", { x: info.bedSize.x, y: info.bedSize.y }) : "" }));
    } catch (err) {
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Feature B: merge
  // ------------------------------------------------------------------
  function adjacencyFor(current: MeshModel): FaceAdjacency {
    const cached = adjacencyRef.current;
    if (cached && cached.triangles === current.triangles) return cached.adjacency;
    const adjacency = buildFaceAdjacency(current.triangles, current.vertices.length);
    adjacencyRef.current = { triangles: current.triangles, adjacency };
    return adjacency;
  }

  function applyColours(current: MeshModel, next: RGB[]): void {
    setHistory((prev) => [...prev.slice(-9), current.triangleColors]);
    setModel({ ...current, triangleColors: next, stats: { ...current.stats, uniqueFaceColors: countUniqueColours(next) } });
    setSettings((prev) => ({ ...prev, manualPhysical: {} }));
    setPicked(null);
  }

  async function runMerge(flagsOverride?: Record<string, MergeFlag>): Promise<void> {
    if (!model || palette.length === 0) return;
    const flags = flagsOverride ?? settings.mergeFlags;
    setBusy(t("busy.adjacency"));
    await yieldToUi();
    try {
      const hexes = palette.map((entry) => rgbToHex(entry.rgb));
      const positionByHex = new Map(hexes.map((hex, position) => [hex, position]));
      const targetOf = (position: number): number => {
        let current = position;
        for (let hop = 0; hop < palette.length; hop++) {
          const target = flags[hexes[current]]?.target;
          const next = target ? positionByHex.get(target) : undefined;
          if (next === undefined || next === current) return current;
          current = next;
        }
        return current;
      };
      const headOf = hexes.map((_h, position) => targetOf(position));
      const heads = [...new Set(headOf)].sort((a, b) => a - b);
      const groupOfHead = new Map(heads.map((head, group) => [head, group]));
      const labelToGroup = Int32Array.from(headOf.map((head) => groupOfHead.get(head) ?? 0));
      const groupCount = heads.length;
      if (groupCount === palette.length) {
        setStatus(t("status.noMergeTargets"));
        return;
      }
      const flagOf = (position: number) => flags[hexes[position]];
      const ambiguousLabels = hexes.map((_h, p) => p).filter((p) => headOf[p] !== p && flagOf(p)?.ambiguous);
      const protectGroups = new Set<number>();
      hexes.forEach((_h, p) => {
        if (flagOf(p)?.protect) protectGroups.add(labelToGroup[p]);
      });
      const minBlob = new Map<number, number>();
      heads.forEach((head, group) => minBlob.set(group, flagOf(head)?.minBlob ?? settings.merge.minBlobDefault));

      const adjacency = adjacencyFor(model);
      setBusy(t("busy.merging"));
      await yieldToUi();
      const result = mergeWithReprojection(adjacency, {
        faceLabels: labels,
        labelToGroup,
        groupCount,
        ambiguousLabels,
        protectGroups,
        minBlob,
        maxPropagationRounds: settings.merge.propagationRounds,
        smoothingRounds: settings.merge.smoothingRounds,
      });
      const representatives = representativeColoursByPosition(model.triangleColors, labels, palette);
      const groupColour = heads.map((head) => representatives[head]);
      const next: RGB[] = new Array(result.groups.length);
      for (let i = 0; i < result.groups.length; i++) next[i] = groupColour[result.groups[i]];

      const before = groupWeightFractions(labels, palette.length, areaWeights);
      const naive = groupWeightFractions(result.naiveGroups, groupCount, areaWeights);
      const after = groupWeightFractions(result.groups, groupCount, areaWeights);
      const rows = heads
        .map((head, group) => ({
          label: `#${palette[head].index} ${hexes[head]}`,
          rgb: palette[head].rgb,
          before: before[head],
          naive: naive[group],
          after: after[group],
          merged: headOf.some((h, p) => h === head && p !== head),
        }))
        .sort((a, b) => Number(b.merged) - Number(a.merged) || b.after - a.after);
      setMergeReport({ rows, stats: result.stats, coloursBefore: countUniqueColours(model.triangleColors), coloursAfter: countUniqueColours(next) });
      applyColours(model, next);
      setStatus(
        t("status.mergeDone", {
          from: palette.length,
          to: groupCount,
          ambiguous: result.stats.ambiguousFaceCount.toLocaleString(),
          smoothed: result.stats.smoothedFaceChanges.toLocaleString(),
          islands: result.stats.absorbedIslands,
        }),
      );
    } catch (err) {
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  function undoMerge(): void {
    const last = history[history.length - 1];
    if (!model || !last || last.length !== model.triangles.length) return;
    setModel({ ...model, triangleColors: last, stats: { ...model.stats, uniqueFaceColors: countUniqueColours(last) } });
    setHistory((prev) => prev.slice(0, -1));
    setMergeReport(null);
    setStatus(t("status.undone"));
  }

  // ------------------------------------------------------------------
  // Feature D: export
  // ------------------------------------------------------------------
  async function export3mf(): Promise<void> {
    if (!model || !plan || palette.length === 0) return;
    setBusy(t("busy.exporting"));
    await yieldToUi();
    try {
      const e = settings.export;
      const fileName = (e.fileName.trim() || defaultFileName).replace(/\.3mf$/i, "") + ".3mf";
      const result = await buildPrusa3mfBlob({
        fileName,
        templateArrayBuffer: template?.buffer ?? null,
        templateInfo: template?.info ?? null,
        model,
        adjustedColors: model.triangleColors,
        palette,
        physicalSlots: slots,
        virtualPlan: plan,
        placement: {
          coordinateMode: e.coordinateMode,
          scale: e.scale,
          targetHeight: e.targetHeight,
          putOnBed: e.putOnBed,
          centerOnBed: e.centerOnBed,
          bedSource: "custom",
          customBedSize: { x: e.bedX, y: e.bedY },
          fallbackBedSize: { x: e.bedX, y: e.bedY },
          defaultExtruder: e.defaultExtruder,
        },
        accentProtection: settings.palette.accentProtection,
        includePrinterConfig: e.includePrinterConfig,
        effectiveRgbByPaletteIndex: effectiveByIndex,
      });
      downloadBlob(result.fileName, result.blob);
      const renumbered =
        result.summary.renumberedVirtuals.length > 0
          ? t("status.renumbered", { list: result.summary.renumberedVirtuals.map((r) => `VE${r.from}→VE${r.to}`).join(" ") })
          : "";
      setStatus(
        t("status.exported", {
          file: result.fileName,
          physical: result.summary.physicalExtruderCount,
          virtual: result.summary.virtualCount,
          ids: result.summary.virtualIds.join(", ") || "-",
          renumbered,
          config: result.summary.printerConfigIncluded ? t("status.configIncluded") : t("status.configOmitted"),
        }),
      );
    } catch (err) {
      setStatus(t("status.exportFailed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Feature C: Nomad
  // ------------------------------------------------------------------
  function nomadExport(): void {
    if (!model || palette.length === 0) return;
    try {
      const result = buildNomadObj(model, model.triangleColors, palette.map((entry) => entry.rgb), model.name);
      downloadText(result.fileName, result.obj);
      setNomadReport({
        message: t("nomad.exported", { file: result.fileName, colours: result.colourCount, vertices: result.vertexCount.toLocaleString(), faces: result.faceCount.toLocaleString() }),
        warnings: [],
      });
      setStatus(t("status.nomadExported", { file: result.fileName }));
    } catch (err) {
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    }
  }

  async function nomadImport(file: File): Promise<void> {
    setBusy(t("busy.readingNomad"));
    await yieldToUi();
    try {
      const parsed = parseNomadObj(await file.text());
      const paletteRgb = palette.map((entry) => entry.rgb);
      const result = applyNomadObjToModel(model, parsed, paletteRgb, file.name);
      if (result.mode === "colours-only" && model) {
        const representatives = representativeColoursByPosition(model.triangleColors, labels, palette);
        const positionByKey = new Map(paletteRgb.map((rgb, position) => [colourKey(rgb), position]));
        const next = result.model.triangleColors.map((rgb) => {
          const position = positionByKey.get(colourKey(rgb));
          return position === undefined ? rgb : representatives[position];
        });
        applyColours(model, next);
      } else {
        installModel(result.model, { kind: "nomad", fileName: file.name, uniqueColours: result.colourCount }, file);
      }
      const message = t("nomad.applied", {
        mode: result.mode === "colours-only" ? t("nomad.coloursOnly") : t("nomad.fullReload"),
        colours: result.colourCount,
        off: result.snap.offPaletteVertexCount.toLocaleString(),
        max: result.snap.maxDeltaE.toFixed(1),
      });
      setNomadReport({ message, warnings: result.warnings });
      setStatus(result.warnings[0] ? `${message} · ${result.warnings[0]}` : message);
    } catch (err) {
      setNomadReport({ message: t("status.error", { message: err instanceof Error ? err.message : String(err) }), warnings: [] });
      setStatus(t("status.error", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Settings file
  // ------------------------------------------------------------------
  function saveSettingsFile(): void {
    downloadTextFile("rodin-pipeline-settings.json", settingsToJson(settings));
    setStatus(t("status.settingsSaved"));
  }
  async function loadSettingsFile(file: File): Promise<void> {
    try {
      setSettings(mergeSettings(JSON.parse(await file.text())));
      setStatus(t("status.settingsLoaded", { name: file.name }));
    } catch (err) {
      setStatus(t("status.settingsFileError", { message: err instanceof Error ? err.message : String(err) }));
    }
  }

  function startSplitterDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    setSplitterDragging(true);
    const onMove = (move: PointerEvent) => {
      const next = Math.max(320, Math.min(Math.round(window.innerWidth * 0.75), startWidth + (move.clientX - startX)));
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSplitterDragging(false);
      setSidebarWidth((width) => {
        try {
          window.localStorage.setItem("rodin-pipeline-sidebar-width", String(width));
        } catch {
          // ignore
        }
        return width;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const isBusy = busy !== null;
  const modeLabel: Record<PreviewMode, string> = { source: t("view.source"), palette: t("view.palette"), print: t("view.print") };
  const viewLabels: Array<[ViewName, string]> = [
    ["front", t("view.front")],
    ["back", t("view.back")],
    ["left", t("view.left")],
    ["right", t("view.right")],
    ["top", t("view.top")],
    ["iso", t("view.iso")],
  ];

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
    <div className="app">
      <header className="topbar">
        <h1>Rodin Pipeline</h1>
        <span className="sub">{t("app.subtitle")} · v{APP_VERSION}</span>
        <span className="spacer" />
        <button type="button" className="btn small lang-toggle" onClick={() => setLang(lang === "ko" ? "en" : "ko")} title="한국어 / English">
          {t("app.language")}
        </button>
        <button type="button" className="btn small" onClick={saveSettingsFile}>
          {t("app.saveSettings")}
        </button>
        <label className="btn small">
          {t("app.loadSettings")}
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadSettingsFile(file);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setSettings(structuredClone(DEFAULT_SETTINGS));
            setStatus(t("status.settingsReset"));
          }}
        >
          {t("app.defaults")}
        </button>
      </header>

      <div className="main" style={{ "--sidebar-w": `${sidebarWidth}px` } as CSSProperties}>
        <aside className="sidebar">
          <LoadSection
            model={model}
            sourceInfo={sourceInfo}
            busy={isBusy}
            onModelFile={(file) => void onModelFile(file)}
            templateInfo={template?.info ?? null}
            onTemplateFile={(file) => void onTemplateFile(file)}
            onClearTemplate={clearTemplate}
            palette={palette}
            areaByIndex={areaByIndex}
            rememberTemplate={settings.rememberTemplate}
            onRememberTemplate={(next) => patchSettings("rememberTemplate", next)}
          />
          <FilamentSection
            settings={settings.filaments}
            onChange={(next) => patchSettings("filaments", next)}
            palette={palette}
            list={settings.filamentList}
            onListChange={(next) => patchSettings("filamentList", next)}
          />
          <MergeSection
            palette={palette}
            areaByPosition={areaByPosition}
            flags={settings.mergeFlags}
            onFlagChange={updateFlag}
            settings={settings.merge}
            onSettingsChange={(next) => patchSettings("merge", next)}
            onAutoFlags={reapplyAutoFlags}
            onRunMerge={() => void runMerge()}
            onUndo={undoMerge}
            undoCount={history.length}
            report={mergeReport}
            busy={isBusy}
            selected={selectedHexes}
            onToggleSelected={toggleSelectedHex}
            onClearSelection={() => setSelectedHexes([])}
            onMergeSelected={mergeSelected}
            hoverHex={hoverHex}
            onHover={handleHover}
          />
          <MixSection
            settings={settings.mix}
            onChange={(next) => patchSettings("mix", next)}
            plan={plan}
            palette={palette}
            slots={slots}
            suggestions={suggestions}
            manualPhysical={settings.manualPhysical}
            onManualPhysical={(paletteIndex, extruder) =>
              setSettings((prev) => {
                const next = { ...prev.manualPhysical };
                if (extruder === null) delete next[String(paletteIndex)];
                else next[String(paletteIndex)] = extruder;
                return { ...prev, manualPhysical: next };
              })
            }
          />
          <ExportSection
            settings={settings.export}
            onChange={(next) => patchSettings("export", next)}
            check={exportCheck}
            onExport={() => void export3mf()}
            busy={isBusy}
            templateInfo={template?.info ?? null}
            defaultFileName={defaultFileName}
            nomad={{
              canExport: Boolean(model) && palette.length > 0,
              colourCount: palette.length,
              onExport: nomadExport,
              onImport: (file) => void nomadImport(file),
              report: nomadReport,
            }}
          />
        </aside>
        <div
          className={`splitter${splitterDragging ? " dragging" : ""}`}
          title={t("layout.splitter")}
          onPointerDown={startSplitterDrag}
          onDoubleClick={() => {
            setSidebarWidth(600);
            try {
              window.localStorage.setItem("rodin-pipeline-sidebar-width", "600");
            } catch {
              // ignore
            }
          }}
        />

        <section className="stage">
          <div className="stage-toolbar">
            <div className="group">
              <span>{t("view.mode")}</span>
              {(["source", "palette", "print"] as PreviewMode[]).map((mode) => (
                <button key={mode} type="button" className={`btn small${previewMode === mode ? " active" : ""}`} onClick={() => setPreviewMode(mode)}>
                  {modeLabel[mode]}
                </button>
              ))}
              <label className="inline" style={{ marginLeft: 8 }}>
                <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> {t("view.split")}
              </label>
            </div>
            <div className="group">
              <span>{t("view.direction")}</span>
              {viewLabels.map(([name, label]) => (
                <button
                  key={name}
                  type="button"
                  className={`btn small${view === name ? " active" : ""}`}
                  onClick={() => {
                    setView(name);
                    setFitNonce((n) => n + 1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {model && (
            <div className="pick-panel">
              {picked ? (
                <>
                  <b>{t("pick.title")}</b>
                  <span className="cell-colour">
                    <Swatch hex={picked.hex} size={14} /> #{picked.index} <code>{picked.hex}</code>
                  </span>
                  <span className="muted">{t("pick.faces", { n: picked.faces.length.toLocaleString(), pct: pct(picked.fraction) })}</span>
                  <span>{t("pick.changeTo")}</span>
                  <ColourSelect
                    value={pickTarget}
                    placeholder="…"
                    onChange={setPickTarget}
                    options={[
                      ...palette.map((entry, position) => {
                        const hex = rgbToHex(entry.rgb);
                        return { value: hex, hex, label: `#${entry.index} ${hex}`, sub: pct(areaByPosition[position] ?? 0), disabled: hex === picked.hex };
                      }),
                      { value: "__new__", hex: pickCustom, label: t("pick.newColour") },
                    ]}
                  />
                  {pickTarget === "__new__" && <input type="color" value={pickCustom} onChange={(e) => setPickCustom(e.target.value.toUpperCase())} />}
                  <button
                    type="button"
                    className="btn primary small"
                    disabled={isBusy || !pickTarget || (pickTarget !== "__new__" && pickTarget === picked.hex)}
                    onClick={applyPickColour}
                  >
                    {t("pick.apply")}
                  </button>
                  <button type="button" className="btn small" onClick={() => setPicked(null)}>
                    {t("pick.clear")}
                  </button>
                </>
              ) : (
                <span className="muted">{t("pick.hint")}</span>
              )}
            </div>
          )}
          <div className={`viewers${split ? " split" : ""}`}>
            {split ? (
              <>
                <MeshViewer positions={positions} colours={paletteColours} view={view} fitNonce={fitNonce} overlays={overlays} onPick={(face) => void handlePick(face)} label={t("view.paletteLabel")} emptyLabel={t("view.empty")} />
                <MeshViewer positions={positions} colours={printColours} view={view} fitNonce={fitNonce} overlays={overlays} onPick={(face) => void handlePick(face)} label={t("view.printLabel")} emptyLabel={t("view.empty")} />
              </>
            ) : (
              <MeshViewer positions={positions} colours={coloursForMode(previewMode)} view={view} fitNonce={fitNonce} overlays={overlays} onPick={(face) => void handlePick(face)} label={modeLabel[previewMode]} emptyLabel={t("view.empty")} />
            )}
          </div>
          <div className="legend">
            {overlays.length > 0 && (
              <span className="legend-item">
                <span className="legend-key" style={{ background: "#4fd8ff" }} /> {t("legend.hover")}
                <span className="legend-key" style={{ background: "#ffd84f", marginLeft: 8 }} /> {t("legend.selected")}
                <span className="legend-key" style={{ background: "#ff8a3d", marginLeft: 8 }} /> {t("legend.picked")}
              </span>
            )}
            {plan &&
              plan.virtualBlends.map((entry) => (
                <span key={`v${entry.virtualId}`} className="legend-item">
                  <Swatch rgb={entry.displayRgb} size={14} /> VE{entry.virtualId}
                </span>
              ))}
            {plan &&
              plan.physicalOnly.map((entry) => (
                <span key={`p${entry.physicalExtruder}-${entry.paletteIndex}`} className="legend-item">
                  <Swatch rgb={entry.physicalRgb} size={14} /> E{entry.physicalExtruder}
                </span>
              ))}
            {!plan && palette.map((entry, position) => (
              <span key={entry.index} className="legend-item">
                <Swatch rgb={entry.rgb} size={14} /> #{entry.index} {pct(areaByPosition[position] ?? 0)}
              </span>
            ))}
          </div>
        </section>
      </div>

      <footer className={`statusbar${isBusy ? " busy" : ""}`} role="status" aria-live="polite">
        <span className="label">{isBusy ? busy : t("status.label")}</span>
        <span className="message" title={status}>{status}</span>
      </footer>
    </div>
    </LangContext.Provider>
  );
}
