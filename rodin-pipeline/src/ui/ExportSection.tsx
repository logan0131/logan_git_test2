import type { Template3mfInfo } from "@core/template3mf";
import type { ExportSettings } from "../engine/types";
import { useT } from "../i18n";
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
  const t = useT();
  const set = (patch: Partial<ExportSettings>) => onChange({ ...settings, ...patch });
  const ok = check !== null && check.failures.length === 0;
  const configAvailable = Boolean(templateInfo?.configFound);
  const configIncluded = settings.includePrinterConfig && configAvailable;
  return (
    <Section step={5} title={t("exp.title")} badge={check ? (ok ? t("exp.badgeOk") : t("exp.badgeFail", { n: check.failures.length })) : t("load.noModel")}>
      <Row label={t("exp.fileName")}>
        <input type="text" value={settings.fileName} placeholder={defaultFileName} style={{ width: 230 }} onChange={(e) => set({ fileName: e.target.value })} />
      </Row>
      <Row label={t("exp.coordinates")} hint={t("exp.coordinatesHint")}>
        <select value={settings.coordinateMode} onChange={(e) => set({ coordinateMode: e.target.value as ExportSettings["coordinateMode"] })}>
          <option value="keep">keep</option>
          <option value="auto">auto</option>
          <option value="blender-y-up">blender-y-up</option>
        </select>
      </Row>
      <Row label={t("exp.scaleHeight")}>
        <NumberField value={settings.scale} min={0.001} step={0.1} width={70} onChange={(v) => set({ scale: v > 0 ? v : 1 })} />
        <input
          type="number"
          placeholder={t("exp.optional")}
          value={settings.targetHeight ?? ""}
          min={1}
          style={{ width: 80 }}
          onChange={(e) => set({ targetHeight: e.target.value ? Number(e.target.value) : null })}
        />
      </Row>
      <Row label={t("exp.bedPlace")}>
        <input type="checkbox" checked={settings.putOnBed} onChange={(e) => set({ putOnBed: e.target.checked })} />
        <input type="checkbox" checked={settings.centerOnBed} onChange={(e) => set({ centerOnBed: e.target.checked })} />
      </Row>
      <Row label={t("exp.bedSize")} hint={templateInfo?.bedSize ? t("exp.bedFromTemplate", { x: templateInfo.bedSize.x, y: templateInfo.bedSize.y }) : t("exp.bedXl")}>
        <NumberField value={settings.bedX} min={10} width={70} onChange={(v) => set({ bedX: v })} />
        <span className="muted">×</span>
        <NumberField value={settings.bedY} min={10} width={70} onChange={(v) => set({ bedY: v })} />
      </Row>
      <Row label={t("exp.defaultExtruder")}>
        <NumberField value={settings.defaultExtruder} min={1} max={8} width={60} onChange={(v) => set({ defaultExtruder: Math.round(v) })} />
      </Row>
      <Row label={t("exp.includeConfig")} hint={t("exp.includeConfigHint")}>
        <input type="checkbox" checked={configIncluded} disabled={!configAvailable} onChange={(e) => set({ includePrinterConfig: e.target.checked })} />
        <span className="muted">{configAvailable ? t("exp.configFromTemplate") : t("exp.configNoTemplate")}</span>
      </Row>

      {check && (
        <div className="note">
          <div className="check-list">
            <div className={check.failures.some((f) => /contiguous/.test(f)) ? "fail" : ""}>
              {t("exp.checkContiguous", {
                range: check.virtualIds.length > 0 ? `VE${check.virtualIds[0]}~VE${check.virtualIds[check.virtualIds.length - 1]}` : t("exp.noVirtual"),
              })}
              {check.renumbered.length > 0 ? t("exp.renumbered", { list: check.renumbered.map((r) => `${r.from}→${r.to}`).join(", ") }) : ""}
            </div>
            <div className={check.failures.some((f) => /at most 15/.test(f)) ? "fail" : ""}>
              {t("exp.checkLimit", { p: check.physicalCount, v: check.virtualIds.length, t: check.physicalCount + check.virtualIds.length })}
            </div>
            <div className={check.failures.some((f) => /JSON|defined/.test(f)) ? "fail" : ""}>{t("exp.checkStates")}</div>
            <div className={check.failures.some((f) => /outside|Unpainted/.test(f)) ? "fail" : ""}>{t("exp.checkPhysical", { p: check.physicalCount })}</div>
            <div>{t("exp.checkConfig", { state: configIncluded ? t("exp.configStateIncluded") : t("exp.configStateOmitted") })}</div>
            <div>{t("exp.checkThumbnail")}</div>
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
          {t("exp.button")}
        </button>
      </div>

      <details>
        <summary className="muted">{t("exp.nomadTitle")}</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <p className="muted">{t("exp.nomadIntro")}</p>
          <div className="inline">
            <button type="button" className="btn" disabled={busy || !nomad.canExport} onClick={nomad.onExport}>
              {t("exp.nomadExport", { n: nomad.colourCount })}
            </button>
            <label className="btn">
              {t("exp.nomadImport")}
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
          <div className="muted">{t("exp.nomadRules")}</div>
          <ul className="rules">
            <li>{t("exp.rule1")}</li>
            <li>{t("exp.rule2")}</li>
            <li>{t("exp.rule3")}</li>
            <li>{t("exp.rule4")}</li>
            <li>{t("exp.rule5")}</li>
          </ul>
        </div>
      </details>
    </Section>
  );
}
