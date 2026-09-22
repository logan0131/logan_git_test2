import { useEffect, useState } from "react";
import type { PaletteEntry, RGB } from "@core/types";
import { rgbToHex } from "@core/colour";
import type { MergeReprojectionStats } from "@core/mergeReprojection";
import type { MergeFlag, MergeSettings } from "../engine/types";
import { useT } from "../i18n";
import { NumberField, Row, Section, Swatch, pct } from "./common";
import { ColourSelect } from "./ColourSelect";
import { ColourPicker } from "./ColourPicker";

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

function Switch({
  checked,
  onChange,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="switch" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
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
  selected,
  onToggleSelected,
  onClearSelection,
  onMergeSelected,
  hoverHex,
  onHover,
  onRecolour,
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
  selected: string[];
  onToggleSelected: (hex: string) => void;
  onClearSelection: () => void;
  onMergeSelected: (targetHex: string) => void;
  hoverHex: string | null;
  onHover: (hex: string | null) => void;
  /** Change the value of a palette colour (every face of that colour). */
  onRecolour: (hex: string, next: string) => void;
}) {
  const t = useT();
  const hexes = palette.map((entry) => rgbToHex(entry.rgb));
  const selectedInPalette = selected.filter((hex) => hexes.includes(hex));
  const [mergeTarget, setMergeTarget] = useState<string>("");
  useEffect(() => {
    if (!selectedInPalette.includes(mergeTarget)) setMergeTarget(selectedInPalette[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join("|"), hexes.join("|")]);

  const plannedMerges = palette.filter((entry) => {
    const hex = rgbToHex(entry.rgb);
    const target = flags[hex]?.target;
    return target && target !== hex && hexes.includes(target);
  }).length;
  const set = (patch: Partial<MergeSettings>) => onSettingsChange({ ...settings, ...patch });
  const entryByHex = new Map(palette.map((entry) => [rgbToHex(entry.rgb), entry]));

  return (
    <Section step={3} title={t("merge.title")} help={t("help.merge")} badge={palette.length > 0 ? t("merge.badge", { n: palette.length, m: plannedMerges }) : t("load.noModel")}>
      <p className="muted">{t("merge.intro")}</p>
      <p className="muted">{t("merge.hoverHint")}</p>
      {palette.length > 0 && (
        <div className="table-wrap" onMouseLeave={() => onHover(null)}>
          <table className="grid">
            <thead>
              <tr>
                <th title={t("merge.select")}>{t("merge.select")}</th>
                <th>{t("merge.colour")}</th>
                <th>{t("merge.area")}</th>
                <th>{t("merge.target")}</th>
                <th title={t("merge.ambiguousTip")}>{t("merge.ambiguous")}</th>
                <th title={t("merge.protectTip")}>{t("merge.protect")}</th>
                <th title={t("merge.minBlobTip")}>{t("merge.minBlob")}</th>
              </tr>
            </thead>
            <tbody>
              {palette.map((entry, position) => {
                const hex = rgbToHex(entry.rgb);
                const flag = flags[hex] ?? { target: null, ambiguous: false, protect: false, minBlob: settings.minBlobDefault };
                const target = flag.target && hexes.includes(flag.target) && flag.target !== hex ? flag.target : "";
                const isSelected = selectedInPalette.includes(hex);
                const classes = [target ? "merged" : "", isSelected ? "row-selected" : "", hoverHex === hex ? "hover-row" : ""].filter(Boolean).join(" ");
                return (
                  <tr key={entry.index} className={classes} onMouseEnter={() => onHover(hex)} onFocus={() => onHover(hex)}>
                    <td>
                      <input type="checkbox" checked={isSelected} disabled={busy} onChange={() => onToggleSelected(hex)} title={t("merge.select")} />
                    </td>
                    <td>
                      <ColourPicker value={hex} commit disabled={busy} onChange={(next) => onRecolour(hex, next)} className="palette-colour">
                        <Swatch rgb={entry.rgb} />
                        <span>#{entry.index}</span>
                        <code>{hex}</code>
                      </ColourPicker>
                    </td>
                    <td>{pct(areaByPosition[position] ?? 0)}</td>
                    <td>
                      <ColourSelect
                        value={target}
                        disabled={busy}
                        placeholder={t("merge.keep")}
                        onChange={(next) => onFlagChange(hex, { target: next || null })}
                        options={[
                          { value: "", label: t("merge.keep") },
                          ...palette
                            .filter((other) => other.index !== entry.index)
                            .map((other) => ({
                              value: rgbToHex(other.rgb),
                              hex: rgbToHex(other.rgb),
                              label: `→ #${other.index} ${rgbToHex(other.rgb)}`,
                              sub: pct(areaByPosition[palette.indexOf(other)] ?? 0),
                            })),
                        ]}
                      />
                    </td>
                    <td>
                      <Switch checked={flag.ambiguous} disabled={busy} onChange={(v) => onFlagChange(hex, { ambiguous: v })} title={t("merge.ambiguousTip")} />
                    </td>
                    <td>
                      <Switch checked={flag.protect} disabled={busy} onChange={(v) => onFlagChange(hex, { protect: v })} title={t("merge.protectTip")} />
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
      {selectedInPalette.length > 0 && (
        <div className="selection-bar">
          <span>{t("merge.selectedBar", { n: selectedInPalette.length })}</span>
          <ColourSelect
            value={mergeTarget}
            disabled={busy}
            placeholder="…"
            onChange={setMergeTarget}
            options={selectedInPalette.map((hex) => {
              const entry = entryByHex.get(hex);
              return { value: hex, hex, label: `#${entry?.index ?? "?"} ${hex}`, sub: entry ? pct(areaByPosition[palette.indexOf(entry)] ?? 0) : undefined };
            })}
          />
          <button type="button" className="btn primary small" disabled={busy || selectedInPalette.length < 2 || !mergeTarget} onClick={() => onMergeSelected(mergeTarget)}>
            {t("merge.runSelected")}
          </button>
          <button type="button" className="btn small" disabled={busy} onClick={onClearSelection}>
            {t("merge.clearSelection")}
          </button>
        </div>
      )}
      <div className="inline">
        <button type="button" className="btn primary" disabled={busy || plannedMerges === 0} onClick={onRunMerge} title={t("merge.runTip")}>
          {t("merge.run", { n: plannedMerges })}
        </button>
        <button type="button" className="btn" disabled={busy || undoCount === 0} onClick={onUndo}>
          {t("merge.undo")} {undoCount > 0 ? `(${undoCount})` : ""}
        </button>
        <button type="button" className="btn small" disabled={busy || palette.length === 0} onClick={onAutoFlags} title={t("merge.autoFlagsTip")}>
          {t("merge.autoFlags")}
        </button>
      </div>
      <details>
        <summary className="muted">{t("merge.advanced")}</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <Row label={t("merge.satMax")}>
            <NumberField value={settings.ambiguousMaxSaturation} min={0} max={1} step={0.05} onChange={(v) => set({ ambiguousMaxSaturation: v })} />
          </Row>
          <Row label={t("merge.valueRange")}>
            <NumberField value={settings.ambiguousMinValue} min={0} max={1} step={0.05} width={70} onChange={(v) => set({ ambiguousMinValue: v })} />
            <span className="muted">~</span>
            <NumberField value={settings.ambiguousMaxValue} min={0} max={1} step={0.05} width={70} onChange={(v) => set({ ambiguousMaxValue: v })} />
          </Row>
          <Row label={t("merge.areaBelow")}>
            <NumberField value={settings.ambiguousMinAreaPercent} min={0} max={100} step={0.5} onChange={(v) => set({ ambiguousMinAreaPercent: v })} />
          </Row>
          <Row label={t("merge.protectRule")}>
            <NumberField value={settings.protectMaxAreaPercent} min={0} max={100} step={0.5} width={70} onChange={(v) => set({ protectMaxAreaPercent: v })} />
            <NumberField value={settings.protectMinSaturation} min={0} max={1} step={0.05} width={70} onChange={(v) => set({ protectMinSaturation: v })} />
          </Row>
          <Row label={t("merge.minBlobDefaults")}>
            <NumberField value={settings.minBlobDefault} min={0} step={10} width={64} onChange={(v) => set({ minBlobDefault: v })} />
            <NumberField value={settings.minBlobSkin} min={0} step={10} width={64} onChange={(v) => set({ minBlobSkin: v })} />
            <NumberField value={settings.minBlobDark} min={0} step={10} width={64} onChange={(v) => set({ minBlobDark: v })} />
          </Row>
          <Row label={t("merge.rounds")}>
            <NumberField value={settings.propagationRounds} min={1} max={500} width={64} onChange={(v) => set({ propagationRounds: Math.round(v) })} />
            <NumberField value={settings.smoothingRounds} min={0} max={20} width={64} onChange={(v) => set({ smoothingRounds: Math.round(v) })} />
          </Row>
        </div>
      </details>
      {report && (
        <div className="note">
          <div className="muted" style={{ marginBottom: 4 }}>
            {t("merge.report", {
              a: report.coloursBefore,
              b: report.coloursAfter,
              n: report.stats.ambiguousFaceCount.toLocaleString(),
              rounds: report.stats.propagationRounds,
              iso: report.stats.isolatedFallback.toLocaleString(),
              s: report.stats.smoothedFaceChanges.toLocaleString(),
              islands: report.stats.absorbedIslands,
              faces: report.stats.absorbedFaces.toLocaleString(),
            })}
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>{t("merge.group")}</th>
                  <th>{t("merge.before")}</th>
                  <th>{t("merge.naive")}</th>
                  <th>{t("merge.after")}</th>
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
