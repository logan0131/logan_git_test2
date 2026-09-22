import { useState } from "react";
import type { MeshModel, PaletteEntry } from "@core/types";
import type { Template3mfInfo } from "@core/template3mf";
import { rgbToHex } from "@core/colour";
import { useT } from "../i18n";
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
  rememberTemplate,
  onRememberTemplate,
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
  rememberTemplate: boolean;
  onRememberTemplate: (next: boolean) => void;
}) {
  const t = useT();
  const rodin = sourceInfo?.rodin;
  return (
    <Section step={1} title={t("load.title")} badge={model ? t("load.faces", { n: model.stats.triangleCount.toLocaleString() }) : t("load.noModel")}>
      <Dropzone accept=".3mf,.obj" title={t("load.dropTitle")} hint={t("load.dropHint")} disabled={busy} onFile={onModelFile} />
      {model && sourceInfo && (
        <div className="note">
          <div className="stats">
            <span>{t("load.file")}</span>
            <b title={sourceInfo.fileName}>{sourceInfo.fileName}</b>
            <span>{t("load.facesVertices")}</span>
            <b>
              {model.stats.triangleCount.toLocaleString()} / {model.stats.vertexCount.toLocaleString()}
            </b>
            <span>{t("load.uniqueColours")}</span>
            <b>{sourceInfo.uniqueColours}</b>
            {rodin && (
              <>
                <span>{t("load.rodinPalette")}</span>
                <b>
                  {t("load.paletteUsed", { count: rodin.paletteCount, used: rodin.usedColourCount })}
                  {rodin.paletteSource === "fallback" ? t("load.paletteFallback") : ""}
                </b>
              </>
            )}
            {rodin && rodin.unpaintedTriangleCount > 0 && (
              <>
                <span>{t("load.unpainted")}</span>
                <b className="warn">{t("load.unpaintedValue", { n: rodin.unpaintedTriangleCount.toLocaleString() })}</b>
              </>
            )}
          </div>
          {rodin && (
            <div className="swatch-row" style={{ marginTop: 6 }}>
              {rodin.paletteHex.map((hex, i) => {
                const used = rodin.usedPaletteNumbers.includes(i + 1);
                return <Swatch key={`${hex}-${i}`} hex={hex} title={`E${i + 1} ${hex}${used ? "" : ` ${t("load.unused")}`}`} size={20} />;
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
                <th>{t("load.colour")}</th>
                <th>{t("load.area")}</th>
                <th>{t("load.faceCount")}</th>
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
        <summary className="muted">{t("load.templateSummary")}</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <Dropzone
            accept=".3mf"
            title={templateInfo ? t("load.templateNamed", { name: templateInfo.fileName }) : t("load.templateChoose")}
            hint={t("load.templateHint")}
            disabled={busy}
            onFile={onTemplateFile}
          />
          <label className="inline" style={{ gap: 8 }}>
            <input type="checkbox" checked={rememberTemplate} onChange={(e) => onRememberTemplate(e.target.checked)} />
            <span className="muted">{t("load.rememberTemplate")}</span>
          </label>
          {templateInfo && (
            <div className="inline">
              <span className="muted">
                {templateInfo.bedSize ? t("load.bed", { x: templateInfo.bedSize.x.toFixed(0), y: templateInfo.bedSize.y.toFixed(0) }) : t("load.noBed")} ·{" "}
                {templateInfo.configFound ? t("load.configFound") : t("load.noConfig")}
              </span>
              <button type="button" className="btn small" onClick={onClearTemplate}>
                {t("load.removeTemplate")}
              </button>
            </div>
          )}
        </div>
      </details>
    </Section>
  );
}
