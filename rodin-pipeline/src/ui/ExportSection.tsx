import { NOMAD_USAGE_RULES } from "@core/nomadRoundTrip";
import type { Template3mfInfo } from "@core/template3mf";
import type { ExportSettings } from "../engine/types";
import { NumberField, Row, Section } from "./common";

export interface ExportCheck {
  physicalCount: number;
  virtualIds: number[];
  renumbered: Array<{ from: number; to: number }>;
  failures: string[];
}

export interface NomadPanelState {
  canExport: boolean;
  colourCount: number;
  onExport: () => void;
  onImport: (file: File) => void;
  report: { message: string; warnings: string[] } | null;
}

export function ExportSection({
  settings,
  onChange,
  check,
  onExport,
  busy,
  templateInfo,
  defaultFileName,
  nomad,
}: {
  settings: ExportSettings;
  onChange: (next: ExportSettings) => void;
  check: ExportCheck | null;
  onExport: () => void;
  busy: boolean;
  templateInfo: Template3mfInfo | null;
  defaultFileName: string;
  nomad: NomadPanelState;
}) {
  const set = (patch: Partial<ExportSettings>) => onChange({ ...settings, ...patch });
  const ok = check !== null && check.failures.length === 0;
  const configAvailable = Boolean(templateInfo?.configFound);
  return (
    <Section step={5} title="내보내기" badge={check ? (ok ? "검증 통과" : `검증 실패 ${check.failures.length}`) : "모델 없음"}>
      <Row label="파일 이름">
        <input type="text" value={settings.fileName} placeholder={defaultFileName} style={{ width: 230 }} onChange={(e) => set({ fileName: e.target.value })} />
      </Row>
      <Row label="좌표" hint="Rodin 3MF는 keep (mm, Z-up). Blender OBJ만 blender-y-up.">
        <select value={settings.coordinateMode} onChange={(e) => set({ coordinateMode: e.target.value as ExportSettings["coordinateMode"] })}>
          <option value="keep">keep</option>
          <option value="auto">auto</option>
          <option value="blender-y-up">blender-y-up</option>
        </select>
      </Row>
      <Row label="배율 / 목표 높이 (mm)">
        <NumberField value={settings.scale} min={0.001} step={0.1} width={70} onChange={(v) => set({ scale: v > 0 ? v : 1 })} />
        <input
          type="number"
          placeholder="선택"
          value={settings.targetHeight ?? ""}
          min={1}
          style={{ width: 80 }}
          onChange={(e) => set({ targetHeight: e.target.value ? Number(e.target.value) : null })}
        />
      </Row>
      <Row label="베드에 놓기 / 중앙 정렬">
        <input type="checkbox" checked={settings.putOnBed} onChange={(e) => set({ putOnBed: e.target.checked })} />
        <input type="checkbox" checked={settings.centerOnBed} onChange={(e) => set({ centerOnBed: e.target.checked })} />
      </Row>
      <Row label="베드 크기 (mm)" hint={templateInfo?.bedSize ? `템플릿: ${templateInfo.bedSize.x} × ${templateInfo.bedSize.y}` : "XL: 360 × 360"}>
        <NumberField value={settings.bedX} min={10} width={70} onChange={(v) => set({ bedX: v })} />
        <span className="muted">×</span>
        <NumberField value={settings.bedY} min={10} width={70} onChange={(v) => set({ bedY: v })} />
      </Row>
      <Row label="기본 익스트루더">
        <NumberField value={settings.defaultExtruder} min={1} max={8} width={60} onChange={(v) => set({ defaultExtruder: Math.round(v) })} />
      </Row>
      <Row label="템플릿 프린터 설정 포함" hint="끄면 Slic3r_PE.config를 넣지 않아 PrusaSlicer의 현재 XL 프로필이 그대로 유지됩니다 (권장).">
        <input type="checkbox" checked={settings.includePrinterConfig && configAvailable} disabled={!configAvailable} onChange={(e) => set({ includePrinterConfig: e.target.checked })} />
        <span className="muted">{configAvailable ? "템플릿에서 복사" : "템플릿 없음 → 항상 제외"}</span>
      </Row>

      {check && (
        <div className="note">
          <div className="check-list">
            <div className={check.failures.some((f) => /contiguous/.test(f)) ? "fail" : ""}>
              VE 번호 연속: {check.virtualIds.length > 0 ? `VE${check.virtualIds[0]}~VE${check.virtualIds[check.virtualIds.length - 1]}` : "가상 없음"}
              {check.renumbered.length > 0 ? ` (재번호 ${check.renumbered.map((r) => `${r.from}→${r.to}`).join(", ")})` : ""}
            </div>
            <div className={check.failures.some((f) => /at most 15/.test(f)) ? "fail" : ""}>
              실물 {check.physicalCount} + 가상 {check.virtualIds.length} = {check.physicalCount + check.virtualIds.length} ≤ 15
            </div>
            <div className={check.failures.some((f) => /JSON|defined/.test(f)) ? "fail" : ""}>칠하기 상태 집합 == JSON 가상 익스트루더 id 집합</div>
            <div className={check.failures.some((f) => /outside|Unpainted/.test(f)) ? "fail" : ""}>실물 번호 1..{check.physicalCount}, 미칠 면 없음</div>
            <div>Slic3r_PE.config {settings.includePrinterConfig && configAvailable ? "포함 (템플릿)" : "제외 → PrusaSlicer 프로필 유지"}</div>
            <div>썸네일: 병합 후 유효 색으로 렌더</div>
          </div>
          {check.failures.length > 0 && (
            <ul className="rules danger">
              {check.failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="inline">
        <button type="button" className="btn primary" disabled={busy || !ok} onClick={onExport}>
          PrusaSlicer 3MF 내보내기
        </button>
      </div>

      <details>
        <summary className="muted">노마드 왕복 (선택)</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <p className="muted">
            색 개수가 확정된 뒤, 혼합 계산 전에 넣는 단계입니다. 팔레트 N색만으로 정점색 OBJ를 내보내고, 노마드에서 눈·경계선을 손본 뒤
            다시 불러옵니다. 면 순서가 같으면 색만 갱신하고, 정점 색은 CIEDE2000으로 팔레트에 스냅합니다.
          </p>
          <div className="inline">
            <button type="button" className="btn" disabled={busy || !nomad.canExport} onClick={nomad.onExport}>
              노마드용 OBJ 내보내기 ({nomad.colourCount}색)
            </button>
            <label className="btn">
              노마드에서 돌아온 OBJ 불러오기
              <input
                type="file"
                accept=".obj,text/plain"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) nomad.onImport(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {nomad.report && (
            <div className="note">
              <div>{nomad.report.message}</div>
              {nomad.report.warnings.map((w) => (
                <div key={w} className="warn">
                  {w}
                </div>
              ))}
            </div>
          )}
          <div className="muted">노마드 사용 규칙</div>
          <ul className="rules">
            <li>새 색을 만들지 말고 스포이트로 모델 색만 찍어서 칠하기</li>
            <li>브러시 강도 100%, Falloff 없음, Smooth color 사용 금지</li>
            <li>Color 채널만 (Roughness, Metalness 끄기)</li>
            <li>Voxel, Decimate, 리메쉬 금지 (면 순서 유지)</li>
            <li>OBJ로 내보내기, 정점색 포함</li>
          </ul>
          <details>
            <summary className="muted">English</summary>
            <ul className="rules">
              {NOMAD_USAGE_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </details>
        </div>
      </details>
    </Section>
  );
}
