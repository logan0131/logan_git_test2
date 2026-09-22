import { useState } from "react";
import type { MeshModel, PaletteEntry } from "@core/types";
import type { Template3mfInfo } from "@core/template3mf";
import { rgbToHex } from "@core/colour";
import { Section, Swatch, pct } from "./common";

export interface SourceInfo {
  kind: "rodin" | "obj" | "nomad";
  fileName: string;
  uniqueColours: number;
  rodin?: {
    paletteHex: string[];
    usedPaletteNumbers: number[];
    warnings: string[];
    paletteSource: "project_settings" | "fallback";
    paletteCount: number;
    usedColourCount: number;
    unpaintedTriangleCount: number;
  };
}

function Dropzone({
  accept,
  title,
  hint,
  disabled,
  onFile,
}: {
  accept: string;
  title: string;
  hint: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <label
      className={`dropzone${active ? " active" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !disabled) onFile(file);
      }}
    >
      <strong>{title}</strong>
      <span className="muted">{hint}</span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}

export function LoadSection({
  model,
  sourceInfo,
  busy,
  onModelFile,
  templateInfo,
  onTemplateFile,
  onClearTemplate,
  palette,
  areaByIndex,
}: {
  model: MeshModel | null;
  sourceInfo: SourceInfo | null;
  busy: boolean;
  onModelFile: (file: File) => void;
  templateInfo: Template3mfInfo | null;
  onTemplateFile: (file: File) => void;
  onClearTemplate: () => void;
  palette: PaletteEntry[];
  areaByIndex: Map<number, number>;
}) {
  const rodin = sourceInfo?.rodin;
  return (
    <Section step={1} title="불러오기" badge={model ? `${model.stats.triangleCount.toLocaleString()} 면` : "모델 없음"}>
      <Dropzone
        accept=".3mf,.obj"
        title="Rodin 3D Print 3MF (Face Color) 또는 정점색 OBJ"
        hint="여기에 끌어다 놓거나 클릭해서 선택. Rodin은 Output Mode를 Face Color로 받은 3MF만 됩니다."
        disabled={busy}
        onFile={onModelFile}
      />
      {model && sourceInfo && (
        <div className="note">
          <div className="stats">
            <span>파일</span>
            <b title={sourceInfo.fileName}>{sourceInfo.fileName}</b>
            <span>면 / 정점</span>
            <b>
              {model.stats.triangleCount.toLocaleString()} / {model.stats.vertexCount.toLocaleString()}
            </b>
            <span>면 색 고유값</span>
            <b>{sourceInfo.uniqueColours}</b>
            {rodin && (
              <>
                <span>Rodin 팔레트</span>
                <b>
                  {rodin.paletteCount}색 중 {rodin.usedColourCount}색 사용
                  {rodin.paletteSource === "fallback" ? " (팔레트 없음 → 임시 색)" : ""}
                </b>
              </>
            )}
            {rodin && rodin.unpaintedTriangleCount > 0 && (
              <>
                <span>미칠 면</span>
                <b className="warn">{rodin.unpaintedTriangleCount.toLocaleString()} (1번으로 처리)</b>
              </>
            )}
          </div>
          {rodin && (
            <div className="swatch-row" style={{ marginTop: 6 }}>
              {rodin.paletteHex.map((hex, i) => {
                const used = rodin.usedPaletteNumbers.includes(i + 1);
                return <Swatch key={`${hex}-${i}`} hex={hex} title={`E${i + 1} ${hex}${used ? "" : " (미사용)"}`} size={20} />;
              })}
            </div>
          )}
          {rodin?.warnings.map((w) => (
            <div key={w} className="muted warn">
              {w}
            </div>
          ))}
        </div>
      )}
      {model && palette.length > 0 && (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>#</th>
                <th>색</th>
                <th>면적</th>
                <th>면 수</th>
              </tr>
            </thead>
            <tbody>
              {palette.map((entry) => (
                <tr key={entry.index}>
                  <td>#{entry.index}</td>
                  <td>
                    <span className="cell-colour">
                      <Swatch rgb={entry.rgb} />
                      <code>{rgbToHex(entry.rgb)}</code>
                    </span>
                  </td>
                  <td>{pct(areaByIndex.get(entry.index) ?? 0)}</td>
                  <td>{entry.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary className="muted">PrusaSlicer 3MF 템플릿 (선택, 베드 크기 / 프린터 설정용)</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <Dropzone
            accept=".3mf"
            title={templateInfo ? `템플릿: ${templateInfo.fileName}` : "템플릿 3MF 선택"}
            hint="PrusaSlicer에서 XL 프로필로 저장한 빈 프로젝트를 넣으면 베드 크기를 가져옵니다. 프린터 설정 파일은 기본으로 넣지 않습니다."
            disabled={busy}
            onFile={onTemplateFile}
          />
          {templateInfo && (
            <div className="inline">
              <span className="muted">
                베드 {templateInfo.bedSize ? `${templateInfo.bedSize.x.toFixed(0)} × ${templateInfo.bedSize.y.toFixed(0)} mm` : "정보 없음"} ·{" "}
                {templateInfo.configFound ? "Slic3r_PE.config 있음" : "설정 파일 없음"}
              </span>
              <button type="button" className="btn small" onClick={onClearTemplate}>
                템플릿 제거
              </button>
            </div>
          )}
        </div>
      </details>
    </Section>
  );
}
