import { useState } from "react";
import type { MeshModel, PaletteEntry } from "@core/types";
import type { Template3mfInfo } from "@core/template3mf";
import { rgbToHex } from "@core/colour";
import type { PaletteSettings } from "../engine/types";
import { useT } from "../i18n";
import { Row, Section, Swatch, pct } from "./common";

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

export interface WorkState {
  /** The model came back from the browser autosave on startup. */
  restored: boolean;
  /** Undo steps available (0 = colours are the original file colours). */
  undoSteps: number;
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
  paletteSettings,
  onPaletteSettingsChange,
  rememberTemplate,
  onRememberTemplate,
  rememberWork,
  onRememberWork,
  workState,
  onClearWork,
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
  paletteSettings: PaletteSettings;
  onPaletteSettingsChange: (next: PaletteSettings) => void;
  rememberTemplate: boolean;
  onRememberTemplate: (next: boolean) => void;
  rememberWork: boolean;
  onRememberWork: (next: boolean) => void;
  workState: WorkState | null;
  onClearWork: () => void;
}) {
  const t = useT();
  const rodin = sourceInfo?.rodin;
  const bedText = templateInfo?.bedSize
    ? t("load.bed", { x: templateInfo.bedSize.x.toFixed(0), y: templateInfo.bedSize.y.toFixed(0) })
    : t("load.noBed");
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
            {workState && (
              <>
                <span>{t("load.work")}</span>
                <b className="work-state">
                  {workState.restored ? `${t("load.workRestored")} · ` : ""}
                  {workState.undoSteps > 0 ? t("load.workModified", { n: workState.undoSteps }) : t("load.workUnmodified")}
                </b>
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
          <div className="inline" style={{ marginTop: 6 }}>
            <button type="button" className="btn small danger new-work" disabled={busy} onClick={onClearWork}>
              {t("load.newWork")}
            </button>
          </div>
        </div>
      )}
      <label className="inline remember-work" style={{ gap: 8 }}>
        <input type="checkbox" checked={rememberWork} onChange={(e) => onRememberWork(e.target.checked)} />
        <span className="muted">{t("load.rememberWork")}</span>
      </label>
      {model && (
        <>
          <Row label={t("load.paletteMax")} hint={t("load.paletteMaxHint")}>
            <select
              className="palette-max"
              value={paletteSettings.maxColours}
              onChange={(e) => onPaletteSettingsChange({ ...paletteSettings, maxColours: Number(e.target.value) })}
            >
              {Array.from({ length: 63 }, (_v, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("load.paletteAccent")} hint={t("load.paletteAccentHint")}>
            <select
              className="palette-accent"
              value={paletteSettings.accentProtection}
              onChange={(e) => onPaletteSettingsChange({ ...paletteSettings, accentProtection: e.target.value as PaletteSettings["accentProtection"] })}
            >
              <option value="off">{t("mix.accentOff")}</option>
              <option value="balanced">{t("mix.accentBalanced")}</option>
              <option value="strong">{t("mix.accentStrong")}</option>
            </select>
          </Row>
        </>
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
      <details className="template-block">
        <summary className={templateInfo ? "template-summary attached" : "template-summary muted"}>
          {templateInfo ? (
            <>
              {t("load.templateSummaryNamed", { name: templateInfo.fileName })} <span className="muted">· {bedText}</span>
            </>
          ) : (
            t("load.templateSummaryNone")
          )}
        </summary>
        <div className="template-card">
          {templateInfo ? (
            <div className="note">
              <div className="stats">
                <span>{t("load.currentTemplate")}</span>
                <b title={templateInfo.fileName}>{templateInfo.fileName}</b>
                <span>{t("load.bedLabel")}</span>
                <b>{bedText}</b>
                <span>{t("load.configLabel")}</span>
                <b>{templateInfo.configFound ? t("load.configFound") : t("load.noConfig")}</b>
                <span>{t("load.templateColoursLabel")}</span>
                <b>
                  {templateInfo.physicalColours.length > 0 ? (
                    <span className="swatch-row" style={{ display: "inline-flex" }}>
                      {templateInfo.physicalColours.map((rgb, i) => (
                        <Swatch key={`${rgbToHex(rgb)}-${i}`} rgb={rgb} size={14} title={`E${i + 1} ${rgbToHex(rgb)}`} />
                      ))}
                      <span className="muted">{t("load.templateColours", { n: templateInfo.physicalColours.length })}</span>
                    </span>
                  ) : (
                    t("load.templateNoColours")
                  )}
                </b>
              </div>
              <div className="inline" style={{ marginTop: 6 }}>
                <button type="button" className="btn small" onClick={onClearTemplate}>
                  {t("load.removeTemplate")}
                </button>
              </div>
            </div>
          ) : (
            <div className="muted template-none">{rememberTemplate ? t("load.templateRememberedNone") : t("load.templateNone")}</div>
          )}
          <Dropzone
            accept=".3mf"
            title={templateInfo ? t("load.templateReplace") : t("load.templateChoose")}
            hint={t("load.templateHint")}
            disabled={busy}
            onFile={onTemplateFile}
          />
          <label className="inline" style={{ gap: 8 }}>
            <input type="checkbox" checked={rememberTemplate} onChange={(e) => onRememberTemplate(e.target.checked)} />
            <span className="muted">{t("load.rememberTemplate")}</span>
          </label>
        </div>
      </details>
    </Section>
  );
}
