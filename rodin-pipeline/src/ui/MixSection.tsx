import { MAX_PAINTABLE_EXTRUDER_ID } from "@core/paintCodes";
import type { PaletteEntry, PhysicalSlot, RGB } from "@core/types";
import { rgbToHex } from "@core/colour";
import type { VirtualBlendEntry, VirtualExtruderPlan } from "@core/virtualExtruders";
import type { MixSettings } from "../engine/types";
import { useT } from "../i18n";
import { NumberField, Row, Section, Swatch } from "./common";
import { ColourSelect } from "./ColourSelect";

export interface PhysicalDirectSuggestion {
  extruder: number;
  deltaE: number;
}

function componentText(entry: VirtualBlendEntry): string {
  const total = Math.max(1, entry.sequence.length);
  return entry.components
    .map((c) => {
      const pctValue = (c.count / total) * 100;
      const text = total === 3 && c.count === 1 ? "33%" : `${Math.round(pctValue)}%`;
      return `E${c.extruder} ${text}`;
    })
    .join(" + ");
}

function SequenceBar({ sequence, slotRgb }: { sequence: number[]; slotRgb: Map<number, RGB> }) {
  return (
    <span className="seq-bar" title={sequence.map((e) => `E${e}`).join(" ")}>
      {sequence.map((extruder, i) => (
        <span key={i} style={{ background: rgbToHex(slotRgb.get(extruder) ?? [120, 120, 120]) }} />
      ))}
    </span>
  );
}

export function MixSection({
  settings,
  onChange,
  plan,
  palette,
  slots,
  suggestions,
  manualPhysical,
  onManualPhysical,
}: {
  settings: MixSettings;
  onChange: (next: MixSettings) => void;
  plan: VirtualExtruderPlan | null;
  palette: PaletteEntry[];
  slots: PhysicalSlot[];
  suggestions: Map<number, PhysicalDirectSuggestion>;
  manualPhysical: Record<string, number>;
  onManualPhysical: (paletteIndex: number, extruder: number | null) => void;
}) {
  const t = useT();
  const set = (patch: Partial<MixSettings>) => onChange({ ...settings, ...patch });
  const slotRgb = new Map(slots.map((slot) => [slot.slot, slot.filament.effectiveRgb]));
  const virtualCount = plan?.virtualBlends.length ?? 0;
  const total = slots.length + virtualCount;
  const physicalOnlyMode = settings.assignmentMode === "physical-only";

  return (
    <Section step={4} title={t("mix.title")} badge={plan ? `${t("mix.badge", { p: slots.length, v: virtualCount, t: total })}${total > MAX_PAINTABLE_EXTRUDER_ID ? " ⚠" : ""}` : t("load.noModel")}>
      <Row label={t("mix.assignmentMode")}>
        <select value={settings.assignmentMode} onChange={(e) => set({ assignmentMode: e.target.value as MixSettings["assignmentMode"] })}>
          <option value="physical-and-virtual">{t("mix.physicalAndVirtual")}</option>
          <option value="physical-only">{t("mix.physicalOnly")}</option>
        </select>
      </Row>
      <Row label={t("mix.maxComponents")} hint={t("mix.maxComponentsHint")}>
        <select value={settings.maxComponents} disabled={physicalOnlyMode} onChange={(e) => set({ maxComponents: Number(e.target.value) === 3 ? 3 : 2 })}>
          <option value={2}>{t("mix.colours2")}</option>
          <option value={3}>{t("mix.colours3")}</option>
        </select>
      </Row>
      <Row label={t("mix.resolution")} hint={t("mix.resolutionHint")}>
        <select value={settings.recipeResolution} disabled={physicalOnlyMode} onChange={(e) => set({ recipeResolution: e.target.value as MixSettings["recipeResolution"] })}>
          <option value="thirds">{t("mix.thirds")}</option>
          <option value="half-thirds">50% + thirds</option>
          <option value="grid25">25% + thirds</option>
          <option value="grid20">20% + thirds</option>
          <option value="grid10">10% + thirds</option>
          <option value="grid5">5% + thirds</option>
        </select>
      </Row>
      <Row label={t("mix.model")}>
        <select value={settings.mixPriority} disabled={physicalOnlyMode} onChange={(e) => set({ mixPriority: e.target.value as MixSettings["mixPriority"] })}>
          <option value="accurate">{t("mix.modelAccurate")}</option>
          <option value="preserve-hue">{t("mix.modelHue")}</option>
          <option value="avoid-muddy">{t("mix.modelAccent")}</option>
        </select>
      </Row>
      <Row label={t("mix.mapping")}>
        <select value={settings.mappingStrategy} onChange={(e) => set({ mappingStrategy: e.target.value as MixSettings["mappingStrategy"] })}>
          <option value="closest">{t("mix.mapClosest")}</option>
          <option value="smooth">{t("mix.mapSmooth")}</option>
          <option value="preserve-hue">{t("mix.mapHue")}</option>
          <option value="preserve-accent">{t("mix.mapAccent")}</option>
          <option value="warm-neutral">{t("mix.mapWarm")}</option>
        </select>
      </Row>
      <Row label={t("mix.metric")}>
        <select value={settings.colourDifferenceMetric} onChange={(e) => set({ colourDifferenceMetric: e.target.value as MixSettings["colourDifferenceMetric"] })}>
          <option value="ciede2000">CIEDE2000 (ΔE00)</option>
          <option value="cie76">CIE76 (ΔE76)</option>
        </select>
      </Row>
      <Row label={t("mix.accent")}>
        <select value={settings.accentProtection} onChange={(e) => set({ accentProtection: e.target.value as MixSettings["accentProtection"] })}>
          <option value="off">{t("mix.accentOff")}</option>
          <option value="balanced">{t("mix.accentBalanced")}</option>
          <option value="strong">{t("mix.accentStrong")}</option>
        </select>
      </Row>
      <Row label={t("mix.lightness")} hint={t("mix.lightnessHint")}>
        <NumberField value={settings.previewLightnessOffset} min={-90} max={30} step={2} onChange={(v) => set({ previewLightnessOffset: v })} />
      </Row>
      <Row label={t("mix.pureThreshold")} hint={t("mix.pureThresholdHint")}>
        <NumberField value={settings.purePhysicalThreshold} min={0.5} max={1} step={0.005} onChange={(v) => set({ purePhysicalThreshold: v })} />
      </Row>
      <Row label={t("mix.autoDirect")} hint={t("mix.autoDirectHint")}>
        <input type="checkbox" checked={settings.autoPhysicalDirect} onChange={(e) => set({ autoPhysicalDirect: e.target.checked })} />
        <NumberField value={settings.physicalDirectDeltaE} min={0} max={30} step={0.5} width={64} onChange={(v) => set({ physicalDirectDeltaE: v })} />
      </Row>

      {plan && palette.length > 0 && (
        <>
          <div className="muted">
            {t("mix.diagnostics", {
              a: plan.mappingDiagnostics.averageError.toFixed(1),
              w: plan.mappingDiagnostics.worstError.toFixed(1),
              n: plan.mappingDiagnostics.poorMatchCount,
              m: plan.mappingDiagnostics.targetPaletteCount,
            })}
            {total > MAX_PAINTABLE_EXTRUDER_ID && <span className="danger">{t("mix.overLimit", { t: total, max: MAX_PAINTABLE_EXTRUDER_ID })}</span>}
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>{t("mix.extruder")}</th>
                  <th>{t("mix.colour")}</th>
                  <th>{t("mix.recipe")}</th>
                  <th>{t("mix.layerOrder")}</th>
                  <th>{t("mix.palette")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.virtualBlends.map((entry) => (
                  <tr key={`v${entry.virtualId}`}>
                    <td>
                      <b>VE{entry.virtualId}</b>
                    </td>
                    <td>
                      <span className="cell-colour">
                        <Swatch rgb={entry.displayRgb} />
                        <code>{rgbToHex(entry.displayRgb)}</code>
                      </span>
                    </td>
                    <td>{componentText(entry)}</td>
                    <td>
                      <SequenceBar sequence={entry.sequence} slotRgb={slotRgb} />
                    </td>
                    <td>{entry.targetPaletteIndices.map((i) => `#${i}`).join(" ")}</td>
                  </tr>
                ))}
                {plan.physicalOnly.map((entry) => (
                  <tr key={`p${entry.physicalExtruder}-${entry.paletteIndex}`}>
                    <td>
                      <b>E{entry.physicalExtruder}</b>
                    </td>
                    <td>
                      <span className="cell-colour">
                        <Swatch rgb={entry.physicalRgb} />
                        <code>{rgbToHex(entry.physicalRgb)}</code>
                      </span>
                    </td>
                    <td>{t("mix.physical100")}</td>
                    <td>
                      <SequenceBar sequence={[entry.physicalExtruder]} slotRgb={slotRgb} />
                    </td>
                    <td>{entry.targetPaletteIndices.map((i) => `#${i}`).join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary className="muted">{t("mix.forceTitle")}</summary>
            <div className="table-wrap" style={{ marginTop: 6 }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>{t("mix.palette")}</th>
                    <th>{t("mix.suggested")}</th>
                    <th>{t("mix.assignment")}</th>
                  </tr>
                </thead>
                <tbody>
                  {palette.map((entry) => {
                    const suggestion = suggestions.get(entry.index);
                    const manual = manualPhysical[String(entry.index)];
                    return (
                      <tr key={entry.index}>
                        <td>
                          <span className="cell-colour">
                            <Swatch rgb={entry.rgb} />#{entry.index} <code>{rgbToHex(entry.rgb)}</code>
                          </span>
                        </td>
                        <td>{suggestion ? <span className="badge">→ E{suggestion.extruder} (ΔE {suggestion.deltaE.toFixed(1)})</span> : <span className="muted">-</span>}</td>
                        <td>
                          <ColourSelect
                            value={manual !== undefined ? String(manual) : ""}
                            placeholder={suggestion && settings.autoPhysicalDirect ? t("mix.autoWith", { n: suggestion.extruder }) : t("mix.autoVirtual")}
                            onChange={(next) => onManualPhysical(entry.index, next ? Number(next) : null)}
                            options={[
                              { value: "", label: suggestion && settings.autoPhysicalDirect ? t("mix.autoWith", { n: suggestion.extruder }) : t("mix.autoVirtual") },
                              ...slots.map((slot) => ({ value: String(slot.slot), hex: rgbToHex(slot.filament.rgb), label: `E${slot.slot} ${slot.filament.name}`, sub: rgbToHex(slot.filament.rgb) })),
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Section>
  );
}
