import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  paletteLabels,
  representativeColoursByPosition,
  triangleAreaWeights,
} from "./engine/mesh";
import { downloadTextFile, loadStoredSettings, mergeSettings, settingsToJson, storeSettings } from "./engine/storage";
import { MeshViewer } from "./ui/MeshViewer";
import { LoadSection, type SourceInfo } from "./ui/LoadSection";
import { FilamentSection } from "./ui/FilamentSection";
import { MergeSection, type MergeReportData } from "./ui/MergeSection";
import { MixSection, type PhysicalDirectSuggestion } from "./ui/MixSection";
import { ExportSection, type ExportCheck } from "./ui/ExportSection";
import { Swatch, pct } from "./ui/common";

const APP_VERSION = "0.1.0";

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || "model";
}

function yieldToUi(ms = 30): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function App() {
  const [settings, setSettings] = useState<PipelineSettings>(() => loadStoredSettings());
  const [model, setModel] = useState<MeshModel | null>(null);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [history, setHistory] = useState<RGB[][]>([]);
  const [template, setTemplate] = useState<{ info: Template3mfInfo; buffer: ArrayBuffer } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("준비됨. Rodin 3MF를 불러오세요.");
  const [mergeReport, setMergeReport] = useState<MergeReportData | null>(null);
  const [nomadReport, setNomadReport] = useState<{ message: string; warnings: string[] } | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("palette");
  const [split, setSplit] = useState(true);
  const [view, setView] = useState<ViewName>("front");
  const [fitNonce, setFitNonce] = useState(0);
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
    setModel(next);
    setSourceInfo(info);
    setSettings((prev) => ({ ...prev, manualPhysical: {}, export: { ...prev.export, fileName: "" } }));
    setFitNonce((n) => n + 1);
  }

  async function onModelFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    setBusy(lower.endsWith(".3mf") ? "Rodin 3MF 읽는 중…" : "OBJ 읽는 중…");
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
          `Rodin 3MF 불러옴: ${result.stats.triangleCount.toLocaleString()}면, ${result.stats.vertexCount.toLocaleString()}정점, 팔레트 ${result.stats.paletteCount}색 중 ${result.stats.usedColourCount}색 사용`,
        );
      } else {
        const parsed = await parseObjFile(file, (p) => {
          if (p.totalBytes && p.loadedBytes !== undefined) setBusy(`OBJ 읽는 중… ${Math.round((p.loadedBytes / p.totalBytes) * 100)}%`);
        });
        installModel(parsed, { kind: "obj", fileName: file.name, uniqueColours: parsed.stats.uniqueFaceColors }, file);
        setStatus(`OBJ 불러옴: ${parsed.stats.triangleCount.toLocaleString()}면, 면 색 ${parsed.stats.uniqueFaceColors}개`);
      }
    } catch (err) {
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function onTemplateFile(file: File): Promise<void> {
    setBusy("템플릿 읽는 중…");
    try {
      const [info, buffer] = await Promise.all([readTemplate3mf(file), file.arrayBuffer()]);
      setTemplate({ info, buffer });
      if (info.bedSize) patchSettings("export", { ...settings.export, bedX: Math.round(info.bedSize.x), bedY: Math.round(info.bedSize.y) });
      setStatus(`템플릿 불러옴: ${file.name}${info.bedSize ? ` (베드 ${info.bedSize.x} × ${info.bedSize.y})` : ""}`);
    } catch (err) {
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
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
  }

  async function runMerge(): Promise<void> {
    if (!model || palette.length === 0) return;
    setBusy("면 인접 관계 계산 중…");
    await yieldToUi();
    try {
      const hexes = palette.map((entry) => rgbToHex(entry.rgb));
      const positionByHex = new Map(hexes.map((hex, position) => [hex, position]));
      const targetOf = (position: number): number => {
        let current = position;
        for (let hop = 0; hop < palette.length; hop++) {
          const target = settings.mergeFlags[hexes[current]]?.target;
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
        setStatus("합칠 대상이 지정된 색이 없습니다.");
        return;
      }
      const flagOf = (position: number) => settings.mergeFlags[hexes[position]];
      const ambiguousLabels = hexes.map((_h, p) => p).filter((p) => headOf[p] !== p && flagOf(p)?.ambiguous);
      const protectGroups = new Set<number>();
      hexes.forEach((_h, p) => {
        if (flagOf(p)?.protect) protectGroups.add(labelToGroup[p]);
      });
      const minBlob = new Map<number, number>();
      heads.forEach((head, group) => minBlob.set(group, flagOf(head)?.minBlob ?? settings.merge.minBlobDefault));

      const adjacency = adjacencyFor(model);
      setBusy("그늘 재판정 + 정리 중…");
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
        `병합 완료: ${palette.length}색 → ${groupCount}색 (재판정 ${result.stats.ambiguousFaceCount.toLocaleString()}면, 톱니 정리 ${result.stats.smoothedFaceChanges.toLocaleString()}면, 조각 흡수 ${result.stats.absorbedIslands}개)`,
      );
    } catch (err) {
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
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
    setStatus("마지막 병합을 되돌렸습니다.");
  }

  // ------------------------------------------------------------------
  // Feature D: export
  // ------------------------------------------------------------------
  async function export3mf(): Promise<void> {
    if (!model || !plan || palette.length === 0) return;
    setBusy("3MF 만드는 중…");
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
      const renumbered = result.summary.renumberedVirtuals.length > 0 ? `, 재번호 ${result.summary.renumberedVirtuals.map((r) => `VE${r.from}→VE${r.to}`).join(" ")}` : "";
      setStatus(
        `3MF 내보냄: ${result.fileName} · 실물 ${result.summary.physicalExtruderCount} + 가상 ${result.summary.virtualCount} (VE ${result.summary.virtualIds.join(", ") || "-"}${renumbered}) · ${result.summary.printerConfigIncluded ? "템플릿 프린터 설정 포함" : "프린터 설정 제외"}`,
      );
    } catch (err) {
      setStatus(`내보내기 실패: ${err instanceof Error ? err.message : String(err)}`);
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
      setNomadReport({ message: `내보냄: ${result.fileName} · ${result.colourCount}색 · ${result.vertexCount.toLocaleString()}정점 · ${result.faceCount.toLocaleString()}면`, warnings: [] });
      setStatus(`노마드용 OBJ 내보냄: ${result.fileName}`);
    } catch (err) {
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function nomadImport(file: File): Promise<void> {
    setBusy("노마드 OBJ 읽는 중…");
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
      const message = `적용됨: ${result.mode === "colours-only" ? "색만 갱신 (형상 유지)" : "형상 교체"} · ${result.colourCount}색 · 팔레트 밖 정점 ${result.snap.offPaletteVertexCount.toLocaleString()} (최대 ΔE ${result.snap.maxDeltaE.toFixed(1)})`;
      setNomadReport({ message, warnings: result.warnings });
      setStatus(result.warnings[0] ? `${message} · ${result.warnings[0]}` : message);
    } catch (err) {
      setNomadReport({ message: `오류: ${err instanceof Error ? err.message : String(err)}`, warnings: [] });
      setStatus(`오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------
  // Settings file
  // ------------------------------------------------------------------
  function saveSettingsFile(): void {
    downloadTextFile("rodin-pipeline-settings.json", settingsToJson(settings));
    setStatus("설정을 JSON으로 저장했습니다.");
  }
  async function loadSettingsFile(file: File): Promise<void> {
    try {
      setSettings(mergeSettings(JSON.parse(await file.text())));
      setStatus(`설정 불러옴: ${file.name}`);
    } catch (err) {
      setStatus(`설정 파일 오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const isBusy = busy !== null;
  const modeLabel: Record<PreviewMode, string> = { source: "원본 색", palette: "팔레트", print: "출력 시뮬레이션" };
  const viewLabels: Array<[ViewName, string]> = [
    ["front", "앞"],
    ["back", "뒤"],
    ["left", "왼쪽"],
    ["right", "오른쪽"],
    ["top", "위"],
    ["iso", "사선"],
  ];

  return (
    <div className="app">
      <header className="topbar">
        <h1>Rodin Pipeline</h1>
        <span className="sub">Rodin 3MF → 병합 → 컬러믹스 → PrusaSlicer 3MF · v{APP_VERSION}</span>
        <span className="spacer" />
        <button type="button" className="btn small" onClick={saveSettingsFile}>
          설정 저장
        </button>
        <label className="btn small">
          설정 불러오기
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
            setStatus("설정을 기본값으로 되돌렸습니다.");
          }}
        >
          기본값
        </button>
      </header>

      <div className="main">
        <aside className="sidebar">
          <LoadSection
            model={model}
            sourceInfo={sourceInfo}
            busy={isBusy}
            onModelFile={(file) => void onModelFile(file)}
            templateInfo={template?.info ?? null}
            onTemplateFile={(file) => void onTemplateFile(file)}
            onClearTemplate={() => setTemplate(null)}
            palette={palette}
            areaByIndex={areaByIndex}
          />
          <FilamentSection settings={settings.filaments} onChange={(next) => patchSettings("filaments", next)} palette={palette} />
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

        <section className="stage">
          <div className="stage-toolbar">
            <div className="group">
              <span>보기</span>
              {(["source", "palette", "print"] as PreviewMode[]).map((mode) => (
                <button key={mode} type="button" className={`btn small${previewMode === mode ? " active" : ""}`} onClick={() => setPreviewMode(mode)}>
                  {modeLabel[mode]}
                </button>
              ))}
              <label className="inline" style={{ marginLeft: 8 }}>
                <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> 팔레트 | 시뮬레이션 나란히
              </label>
            </div>
            <div className="group">
              <span>방향</span>
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
          <div className={`viewers${split ? " split" : ""}`}>
            {split ? (
              <>
                <MeshViewer positions={positions} colours={paletteColours} view={view} fitNonce={fitNonce} label="팔레트 (병합 결과)" />
                <MeshViewer positions={positions} colours={printColours} view={view} fitNonce={fitNonce} label="출력 시뮬레이션 (실물 + 가상 혼합)" />
              </>
            ) : (
              <MeshViewer positions={positions} colours={coloursForMode(previewMode)} view={view} fitNonce={fitNonce} label={modeLabel[previewMode]} />
            )}
          </div>
          <div className="legend">
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
        <span className="label">{isBusy ? busy : "상태"}</span>
        <span>{status}</span>
      </footer>
    </div>
  );
}
