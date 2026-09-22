import { NOMAD_USAGE_RULES } from "../core/nomadRoundTrip";

type Dict = Record<string, string>;

export interface NomadPanelReport {
  message: string;
  warnings: string[];
}

export function NomadRoundTripPanel({
  t,
  canExport,
  colourCount,
  onExport,
  onImportFile,
  busy,
  report,
  fileInputKey,
}: {
  t: Dict;
  canExport: boolean;
  colourCount: number;
  onExport: () => void;
  onImportFile: (file: File) => void;
  busy: boolean;
  report: NomadPanelReport | null;
  fileInputKey: number;
}) {
  return (
    <div className="nomad-panel">
      <div className="section-subtitle spaced">{t.nomadTitle}</div>
      <p className="muted workflow-intro">{t.nomadIntro}</p>

      <div className="virtual-edit-action-row">
        <div>
          <b>{t.nomadExportTitle}</b>
          <p className="muted small-note">
            {canExport ? `${colourCount} ${t.nomadExportColours}` : t.nomadExportUnavailable}
          </p>
        </div>
        <button
          type="button"
          className="secondary small-button"
          disabled={!canExport || busy}
          onClick={onExport}
          title={t.tipNomadExport}
        >
          {t.nomadExport}
        </button>
      </div>

      <label className="file-drop staged-file-picker nomad-import-picker" title={t.tipNomadImport}>
        <span>{t.nomadImportTitle}</span>
        <strong>{t.chooseFile}</strong>
        <input
          disabled={busy}
          type="file"
          accept=".obj,text/plain"
          key={`nomad-${fileInputKey}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
          }}
        />
      </label>

      {report && (
        <div className={`file-summary full${report.warnings.length > 0 ? " nomad-report-warning" : ""}`}>
          <b>{report.message}</b>
          {report.warnings.map((warning) => (
            <span key={warning} className="warning-text">
              {warning}
            </span>
          ))}
        </div>
      )}

      <details className="file-summary full nomad-rules">
        <summary>{t.nomadRulesTitle}</summary>
        <ol className="nomad-rules-list">
          {NOMAD_USAGE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
