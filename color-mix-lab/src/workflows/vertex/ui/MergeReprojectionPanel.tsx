import type { PaletteEntry, RGB } from "../core/types";
import { rgbToHex } from "../core/colour";
import type { MergeReprojectionStats } from "../core/mergeReprojection";

export interface PaletteMergeFlag {
  /** Treat as shade / boundary colour: cleared on merge and re-judged by adjacency. */
  ambiguous: boolean;
  /** Never touched by boundary smoothing or island absorption. */
  protect: boolean;
  /** Islands of this colour below this face count are absorbed by their surroundings. */
  minBlob: number;
}

export interface MergeReportRow {
  label: string;
  rgb: RGB;
  /** Fractions of the model area (0..1). */
  before: number;
  naive: number;
  after: number;
  merged: boolean;
}

export interface MergeReportThumbnails {
  beforeFront: string;
  beforeBack: string;
  afterFront: string;
  afterBack: string;
}

export interface MergeReport {
  title: string;
  rows: MergeReportRow[];
  stats: MergeReprojectionStats;
  thumbnails: MergeReportThumbnails | null;
  faceColourCountBefore: number;
  faceColourCountAfter: number;
}

type Dict = Record<string, string>;

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function Swatch({ rgb, title }: { rgb: RGB; title?: string }) {
  return <span className="swatch" style={{ background: rgbToHex(rgb) }} title={title ?? rgbToHex(rgb)} />;
}

export function MergeReprojectionPanel({
  t,
  palette,
  areaFractionByIndex,
  flags,
  onFlagChange,
  report,
  undoCount,
  onUndo,
  busy,
}: {
  t: Dict;
  palette: PaletteEntry[];
  areaFractionByIndex: Map<number, number>;
  flags: Record<string, PaletteMergeFlag>;
  onFlagChange: (hex: string, patch: Partial<PaletteMergeFlag>) => void;
  report: MergeReport | null;
  undoCount: number;
  onUndo: () => void;
  busy: boolean;
}) {
  return (
    <div className="virtual-edit-box merge-reprojection-panel" title={t.tipMergeReprojection}>
      <div className="section-subtitle">{t.mergeReprojectionTitle}</div>
      <p className="muted small-note">{t.mergeReprojectionIntro}</p>

      {palette.length > 0 && (
        <div className="merge-flag-table-wrap">
          <table className="merge-flag-table">
            <thead>
              <tr>
                <th>{t.paletteColour}</th>
                <th>{t.mergeFlagArea}</th>
                <th title={t.tipMergeFlagAmbiguous}>{t.mergeFlagAmbiguous}</th>
                <th title={t.tipMergeFlagProtect}>{t.mergeFlagProtect}</th>
                <th title={t.tipMergeFlagMinBlob}>{t.mergeFlagMinBlob}</th>
              </tr>
            </thead>
            <tbody>
              {palette.map((entry) => {
                const hex = rgbToHex(entry.rgb);
                const flag = flags[hex] ?? { ambiguous: false, protect: false, minBlob: 150 };
                const area = areaFractionByIndex.get(entry.index) ?? 0;
                return (
                  <tr key={entry.index}>
                    <td>
                      <span className="merge-flag-colour">
                        <Swatch rgb={entry.rgb} />
                        <b>#{entry.index}</b>
                        <code>{hex}</code>
                      </span>
                    </td>
                    <td>{pct(area)}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={flag.ambiguous}
                        disabled={busy}
                        onChange={(e) => onFlagChange(hex, { ambiguous: e.target.checked })}
                        title={t.tipMergeFlagAmbiguous}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={flag.protect}
                        disabled={busy}
                        onChange={(e) => onFlagChange(hex, { protect: e.target.checked })}
                        title={t.tipMergeFlagProtect}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        step={10}
                        value={flag.minBlob}
                        disabled={busy}
                        onChange={(e) => onFlagChange(hex, { minBlob: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        title={t.tipMergeFlagMinBlob}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="virtual-edit-action-row">
        <div>
          <b>{t.mergeUndoTitle}</b>
          <p className="muted small-note">
            {undoCount > 0 ? `${undoCount} ${t.mergeUndoAvailable}` : t.mergeUndoNone}
          </p>
        </div>
        <button
          type="button"
          className="secondary small-button"
          disabled={undoCount === 0 || busy}
          onClick={onUndo}
          title={t.tipMergeUndo}
        >
          {t.mergeUndo}
        </button>
      </div>

      {report && (
        <div className="merge-report">
          <div className="section-subtitle">{report.title}</div>
          <table className="merge-flag-table merge-report-table">
            <thead>
              <tr>
                <th>{t.mergeReportGroup}</th>
                <th>{t.mergeReportBefore}</th>
                <th>{t.mergeReportNaive}</th>
                <th>{t.mergeReportAfter}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.label} className={row.merged ? "merged" : ""}>
                  <td>
                    <span className="merge-flag-colour">
                      <Swatch rgb={row.rgb} />
                      <span>{row.label}</span>
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
          <p className="muted small-note">
            {t.mergeReportColours}: {report.faceColourCountBefore} → {report.faceColourCountAfter} ·{" "}
            {t.mergeReportAmbiguousFaces}: {report.stats.ambiguousFaceCount.toLocaleString()} ·{" "}
            {t.mergeReportPropagated}: {report.stats.filledByPropagation.toLocaleString()} ({report.stats.propagationRounds}{" "}
            {t.mergeReportRounds}) · {t.mergeReportFallback}: {report.stats.isolatedFallback.toLocaleString()} ·{" "}
            {t.mergeReportSmoothed}: {report.stats.smoothedFaceChanges.toLocaleString()} · {t.mergeReportIslands}:{" "}
            {report.stats.absorbedIslands.toLocaleString()} ({report.stats.absorbedFaces.toLocaleString()} {t.trianglesShort})
          </p>
          {report.thumbnails && (
            <div className="merge-compare-grid">
              <figure>
                <img src={report.thumbnails.beforeFront} alt={`${t.mergeReportBefore} ${t.viewFront}`} />
                <figcaption>
                  {t.mergeReportBefore} · {t.viewFront}
                </figcaption>
              </figure>
              <figure>
                <img src={report.thumbnails.afterFront} alt={`${t.mergeReportAfter} ${t.viewFront}`} />
                <figcaption>
                  {t.mergeReportAfter} · {t.viewFront}
                </figcaption>
              </figure>
              <figure>
                <img src={report.thumbnails.beforeBack} alt={`${t.mergeReportBefore} ${t.viewBack}`} />
                <figcaption>
                  {t.mergeReportBefore} · {t.viewBack}
                </figcaption>
              </figure>
              <figure>
                <img src={report.thumbnails.afterBack} alt={`${t.mergeReportAfter} ${t.viewBack}`} />
                <figcaption>
                  {t.mergeReportAfter} · {t.viewBack}
                </figcaption>
              </figure>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
