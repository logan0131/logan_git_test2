import type { PaletteEntry, PhysicalSlot, RGB } from "@core/types";
import { rgbToHex } from "@core/colour";
import type { VirtualBlendEntry, VirtualExtruderPlan } from "@core/virtualExtruders";
import type { MixSettings } from "../engine/types";
import { NumberField, Row, Section, Swatch } from "./common";

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
  const set = (patch: Partial<MixSettings>) => onChange({ ...settings, ...patch });
  const slotRgb = new Map(slots.map((slot) => [slot.slot, slot.filament.effectiveRgb]));
  const virtualCount = plan?.virtualBlends.length ?? 0;
  const total = slots.length + virtualCount;
  const physicalOnlyMode = settings.assignmentMode === "physical-only";

  return (
    <Section step={4} title="컬러믹스 수치" badge={plan ? `실물 ${slots.length} + 가상 ${virtualCount} = ${total}${total > 15 ? " ⚠" : ""}` : "모델 없음"}>
      <Row label="색 배정 방식">
        <select value={settings.assignmentMode} onChange={(e) => set({ assignmentMode: e.target.value as MixSettings["assignmentMode"] })}>
          <option value="physical-and-virtual">실물 + 가상 혼합</option>
          <option value="physical-only">실물만</option>
        </select>
      </Row>
      <Row label="혼합당 최대 색 수" hint="2색 기본: 층 교대 주기가 짧아 줄무늬가 덜 보입니다.">
        <select value={settings.maxComponents} disabled={physicalOnlyMode} onChange={(e) => set({ maxComponents: Number(e.target.value) === 3 ? 3 : 2 })}>
          <option value={2}>2색</option>
          <option value={3}>3색</option>
        </select>
      </Row>
      <Row label="혼합 비율 해상도" hint="5% 단위는 20층 주기(0.05 mm 층에서 1 mm마다 줄). thirds 또는 25%를 권장합니다.">
        <select value={settings.recipeResolution} disabled={physicalOnlyMode} onChange={(e) => set({ recipeResolution: e.target.value as MixSettings["recipeResolution"] })}>
          <option value="thirds">Thirds only (권장)</option>
          <option value="half-thirds">50% + thirds</option>
          <option value="grid25">25% + thirds</option>
          <option value="grid20">20% + thirds</option>
          <option value="grid10">10% + thirds</option>
          <option value="grid5">5% + thirds</option>
        </select>
      </Row>
      <Row label="혼합 모델">
        <select value={settings.mixPriority} disabled={physicalOnlyMode} onChange={(e) => set({ mixPriority: e.target.value as MixSettings["mixPriority"] })}>
          <option value="accurate">Prusa FDM mixer</option>
          <option value="preserve-hue">Prusa FDM + 색상 보존</option>
          <option value="avoid-muddy">Prusa FDM + 포인트 분리</option>
        </select>
      </Row>
      <Row label="매핑 전략">
        <select value={settings.mappingStrategy} onChange={(e) => set({ mappingStrategy: e.target.value as MixSettings["mappingStrategy"] })}>
          <option value="closest">가장 가까운 색</option>
          <option value="smooth">부드러운 전환</option>
          <option value="preserve-hue">색상 우선</option>
          <option value="preserve-accent">포인트 우선</option>
          <option value="warm-neutral">따뜻한/중립 보존</option>
        </select>
      </Row>
      <Row label="색차 기준">
        <select value={settings.colourDifferenceMetric} onChange={(e) => set({ colourDifferenceMetric: e.target.value as MixSettings["colourDifferenceMetric"] })}>
          <option value="ciede2000">CIEDE2000 (ΔE00)</option>
          <option value="cie76">CIE76 (ΔE76)</option>
        </select>
      </Row>
      <Row label="포인트 색 보존">
        <select value={settings.accentProtection} onChange={(e) => set({ accentProtection: e.target.value as MixSettings["accentProtection"] })}>
          <option value="off">끔</option>
          <option value="balanced">보통</option>
          <option value="strong">강함</option>
        </select>
      </Row>
      <Row label="미리보기 밝기 보정 (L*)" hint="가상 혼합 색의 미리보기 밝기. 출력 파일에는 영향 없음.">
        <NumberField value={settings.previewLightnessOffset} min={-90} max={30} step={2} onChange={(v) => set({ previewLightnessOffset: v })} />
      </Row>
      <Row label="실물 단독 판정 비율" hint="지배 성분 비율이 이 값 이상이면 가상 대신 실물 익스트루더로 보냅니다.">
        <NumberField value={settings.purePhysicalThreshold} min={0.5} max={1} step={0.005} onChange={(v) => set({ purePhysicalThreshold: v })} />
      </Row>
      <Row label="실물 직결 자동 (ΔE00 미만)" hint="팔레트 색이 실물 필라멘트 색과 이 값보다 가까우면 자동으로 실물로 보냅니다 (검정/흰색 등).">
        <input type="checkbox" checked={settings.autoPhysicalDirect} onChange={(e) => set({ autoPhysicalDirect: e.target.checked })} />
        <NumberField value={settings.physicalDirectDeltaE} min={0} max={30} step={0.5} width={64} onChange={(v) => set({ physicalDirectDeltaE: v })} />
      </Row>

      {plan && palette.length > 0 && (
        <>
          <div className="muted">
            평균 ΔE {plan.mappingDiagnostics.averageError.toFixed(1)} · 최악 ΔE {plan.mappingDiagnostics.worstError.toFixed(1)} · 미흡{" "}
            {plan.mappingDiagnostics.poorMatchCount}/{plan.mappingDiagnostics.targetPaletteCount}
            {total > 15 && <span className="danger"> · 실물 + 가상 {total} &gt; 15: 색을 더 합치거나 실물로 보내세요.</span>}
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>익스트루더</th>
                  <th>색</th>
                  <th>구성</th>
                  <th>층 순서</th>
                  <th>팔레트</th>
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
                    <td>실물 100%</td>
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
            <summary className="muted">팔레트 색별 실물 직결 지정</summary>
            <div className="table-wrap" style={{ marginTop: 6 }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>팔레트</th>
                    <th>추천</th>
                    <th>지정</th>
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
                          <select value={manual ?? ""} onChange={(e) => onManualPhysical(entry.index, e.target.value ? Number(e.target.value) : null)}>
                            <option value="">{suggestion && settings.autoPhysicalDirect ? `자동 (E${suggestion.extruder})` : "자동 (가상 허용)"}</option>
                            {slots.map((slot) => (
                              <option key={slot.slot} value={slot.slot}>
                                E{slot.slot} {rgbToHex(slot.filament.rgb)}
                              </option>
                            ))}
                          </select>
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
