import type { PaletteEntry, RGB } from "@core/types";
import { rgbToHex } from "@core/colour";
import type { MergeReprojectionStats } from "@core/mergeReprojection";
import type { MergeFlag, MergeSettings } from "../engine/types";
import { NumberField, Row, Section, Swatch, pct } from "./common";

export interface MergeReportRowData {
  label: string;
  rgb: RGB;
  before: number;
  naive: number;
  after: number;
  merged: boolean;
}

export interface MergeReportData {
  rows: MergeReportRowData[];
  stats: MergeReprojectionStats;
  coloursBefore: number;
  coloursAfter: number;
}

export function MergeSection({
  palette,
  areaByPosition,
  flags,
  onFlagChange,
  settings,
  onSettingsChange,
  onAutoFlags,
  onRunMerge,
  onUndo,
  undoCount,
  report,
  busy,
}: {
  palette: PaletteEntry[];
  areaByPosition: Float64Array;
  flags: Record<string, MergeFlag>;
  onFlagChange: (hex: string, patch: Partial<MergeFlag>) => void;
  settings: MergeSettings;
  onSettingsChange: (next: MergeSettings) => void;
  onAutoFlags: () => void;
  onRunMerge: () => void;
  onUndo: () => void;
  undoCount: number;
  report: MergeReportData | null;
  busy: boolean;
}) {
  const hexes = palette.map((entry) => rgbToHex(entry.rgb));
  const plannedMerges = palette.filter((entry) => {
    const hex = rgbToHex(entry.rgb);
    const target = flags[hex]?.target;
    return target && target !== hex && hexes.includes(target);
  }).length;
  const set = (patch: Partial<MergeSettings>) => onSettingsChange({ ...settings, ...patch });

  return (
    <Section
      step={3}
      title="색 병합 (그늘 재판정 + 정리)"
      badge={palette.length > 0 ? `${palette.length}색 · 병합 예정 ${plannedMerges}` : "모델 없음"}
    >
      <p className="muted">
        각 색을 어느 색에 합칠지 고릅니다. <b>그늘/경계</b>로 표시된 색은 합칠 때 비워 두고 이어진 표면의 다수결로 다시
        판정하고, 경계 톱니와 작은 조각을 정리합니다. <b>보호</b>된 색은 정리에서 건드리지 않습니다.
      </p>
      {palette.length > 0 && (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>색</th>
                <th>면적</th>
                <th>합칠 대상</th>
                <th title="채도가 낮고 명도가 중간이거나 면적이 작은 색은 자동으로 체크됩니다.">그늘/경계</th>
                <th title="작지만 중요한 포인트 색(빨간 보석 등). 정리에서 제외.">보호</th>
                <th title="이 면 수보다 작은 조각은 주변 색에 흡수됩니다.">최소 조각</th>
              </tr>
            </thead>
            <tbody>
              {palette.map((entry, position) => {
                const hex = rgbToHex(entry.rgb);
                const flag = flags[hex] ?? { target: null, ambiguous: false, protect: false, minBlob: settings.minBlobDefault };
                const target = flag.target && hexes.includes(flag.target) && flag.target !== hex ? flag.target : "";
                return (
                  <tr key={entry.index} className={target ? "merged" : ""}>
                    <td>
                      <span className="cell-colour">
                        <Swatch rgb={entry.rgb} />
                        <span>#{entry.index}</span>
                        <code>{hex}</code>
                      </span>
                    </td>
                    <td>{pct(areaByPosition[position] ?? 0)}</td>
                    <td>
                      <select value={target} disabled={busy} onChange={(e) => onFlagChange(hex, { target: e.target.value || null })}>
                        <option value="">(유지)</option>
                        {palette
                          .filter((other) => other.index !== entry.index)
                          .map((other) => (
                            <option key={other.index} value={rgbToHex(other.rgb)}>
                              → #{other.index} {rgbToHex(other.rgb)}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <input type="checkbox" checked={flag.ambiguous} disabled={busy} onChange={(e) => onFlagChange(hex, { ambiguous: e.target.checked })} />
                    </td>
                    <td>
                      <input type="checkbox" checked={flag.protect} disabled={busy} onChange={(e) => onFlagChange(hex, { protect: e.target.checked })} />
                    </td>
                    <td>
                      <NumberField value={flag.minBlob} min={0} step={10} width={64} disabled={busy} onChange={(v) => onFlagChange(hex, { minBlob: Math.max(0, Math.round(v)) })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="inline">
        <button type="button" className="btn primary" disabled={busy || plannedMerges === 0} onClick={onRunMerge} title="합칠 대상이 지정된 색을 한 번에 병합하고 재판정·정리를 실행합니다. 결과는 모델 면 색에 반영됩니다.">
          병합 실행 ({plannedMerges}색)
        </button>
        <button type="button" className="btn" disabled={busy || undoCount === 0} onClick={onUndo}>
          되돌리기 {undoCount > 0 ? `(${undoCount})` : ""}
        </button>
        <button type="button" className="btn small" disabled={busy || palette.length === 0} onClick={onAutoFlags} title="아래 기준으로 그늘/보호/최소 조각을 다시 채웁니다 (합칠 대상은 유지).">
          자동 판별 다시 적용
        </button>
      </div>
      <details>
        <summary className="muted">자동 판별 기준과 정리 수치</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <Row label="그늘: 최대 채도 (HSV S)">
            <NumberField value={settings.ambiguousMaxSaturation} min={0} max={1} step={0.05} onChange={(v) => set({ ambiguousMaxSaturation: v })} />
          </Row>
          <Row label="그늘: 명도 범위 (HSV V)">
            <NumberField value={settings.ambiguousMinValue} min={0} max={1} step={0.05} width={70} onChange={(v) => set({ ambiguousMinValue: v })} />
            <span className="muted">~</span>
            <NumberField value={settings.ambiguousMaxValue} min={0} max={1} step={0.05} width={70} onChange={(v) => set({ ambiguousMaxValue: v })} />
          </Row>
          <Row label="그늘: 면적 미만 (%)">
            <NumberField value={settings.ambiguousMinAreaPercent} min={0} max={100} step={0.5} onChange={(v) => set({ ambiguousMinAreaPercent: v })} />
          </Row>
          <Row label="보호: 면적 미만 (%) & 채도 이상">
            <NumberField value={settings.protectMaxAreaPercent} min={0} max={100} step={0.5} width={70} onChange={(v) => set({ protectMaxAreaPercent: v })} />
            <NumberField value={settings.protectMinSaturation} min={0} max={1} step={0.05} width={70} onChange={(v) => set({ protectMinSaturation: v })} />
          </Row>
          <Row label="최소 조각 기본 / 살색 / 진한 색">
            <NumberField value={settings.minBlobDefault} min={0} step={10} width={64} onChange={(v) => set({ minBlobDefault: v })} />
            <NumberField value={settings.minBlobSkin} min={0} step={10} width={64} onChange={(v) => set({ minBlobSkin: v })} />
            <NumberField value={settings.minBlobDark} min={0} step={10} width={64} onChange={(v) => set({ minBlobDark: v })} />
          </Row>
          <Row label="채우기 반복 / 톱니 정리 반복">
            <NumberField value={settings.propagationRounds} min={1} max={500} width={64} onChange={(v) => set({ propagationRounds: Math.round(v) })} />
            <NumberField value={settings.smoothingRounds} min={0} max={20} width={64} onChange={(v) => set({ smoothingRounds: Math.round(v) })} />
          </Row>
        </div>
      </details>
      {report && (
        <div className="note">
          <div className="muted" style={{ marginBottom: 4 }}>
            마지막 병합: 면 색 {report.coloursBefore} → {report.coloursAfter} · 재판정 {report.stats.ambiguousFaceCount.toLocaleString()}면 (
            {report.stats.propagationRounds}회, 고립 {report.stats.isolatedFallback.toLocaleString()}) · 톱니 정리{" "}
            {report.stats.smoothedFaceChanges.toLocaleString()}면 · 조각 흡수 {report.stats.absorbedIslands}개 (
            {report.stats.absorbedFaces.toLocaleString()}면)
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>그룹</th>
                  <th>병합 전</th>
                  <th>단순 병합</th>
                  <th>재판정 후</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.label} className={row.merged ? "merged" : ""}>
                    <td>
                      <span className="cell-colour">
                        <Swatch rgb={row.rgb} />
                        {row.label}
                      </span>
                    </td>
                    <td>{pct(row.before)}</td>
                    <td>{pct(row.naive)}</td>
                    <td>
                      <b>{pct(row.after)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}
