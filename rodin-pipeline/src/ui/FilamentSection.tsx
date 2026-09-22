import type { PaletteEntry } from "@core/types";
import { rgbToHex } from "@core/colour";
import { FILAMENT_PRESETS, MAX_PHYSICAL, MIN_PHYSICAL, type FilamentSettings } from "../engine/types";
import { useT, type Key } from "../i18n";
import { Row, Section } from "./common";

export function FilamentSection({
  settings,
  onChange,
  palette,
}: {
  settings: FilamentSettings;
  onChange: (next: FilamentSettings) => void;
  palette: PaletteEntry[];
}) {
  const t = useT();
  const update = (patch: Partial<FilamentSettings>) => onChange({ ...settings, ...patch });
  const setHex = (i: number, hex: string) => {
    const next = [...settings.hex];
    next[i] = hex.toUpperCase();
    update({ hex: next });
  };
  const setName = (i: number, name: string) => {
    const next = [...settings.names];
    next[i] = name;
    update({ names: next });
  };
  const fillFromPalette = () => {
    if (palette.length === 0) return;
    const sorted = [...palette].sort((a, b) => b.count - a.count);
    const next = [...settings.hex];
    for (let i = 0; i < settings.count; i++) {
      const entry = sorted[i];
      if (entry) next[i] = rgbToHex(entry.rgb);
    }
    update({ hex: next });
  };
  return (
    <Section step={2} title={t("fil.title")} badge={t("fil.badge", { n: settings.count })}>
      <Row label={t("fil.count")} hint={t("fil.countHint")}>
        <select value={settings.count} onChange={(e) => update({ count: Number(e.target.value) })}>
          {Array.from({ length: MAX_PHYSICAL - MIN_PHYSICAL + 1 }, (_v, i) => MIN_PHYSICAL + i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("fil.preset")}>
        <select
          value=""
          onChange={(e) => {
            const preset = FILAMENT_PRESETS.find((p) => p.name === e.target.value);
            if (!preset) return;
            const next = [...settings.hex];
            preset.hex.forEach((hex, i) => (next[i] = hex));
            update({ hex: next, count: preset.hex.length });
          }}
        >
          <option value="">{t("fil.choose")}</option>
          {FILAMENT_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {t(`preset.${p.name}` as Key)}
            </option>
          ))}
        </select>
      </Row>
      <div className="filament-grid">
        {Array.from({ length: settings.count }, (_v, i) => (
          <FilamentRow key={i} index={i} hex={settings.hex[i]} name={settings.names[i]} placeholder={t("fil.name")} onHex={(hex) => setHex(i, hex)} onName={(name) => setName(i, name)} />
        ))}
      </div>
      <div className="inline">
        <button type="button" className="btn small" onClick={fillFromPalette} disabled={palette.length === 0} title={t("fil.fillHint")}>
          {t("fil.fillFromPalette")}
        </button>
        <span className="muted">{t("fil.hexNote")}</span>
      </div>
    </Section>
  );
}

function FilamentRow({
  index,
  hex,
  name,
  placeholder,
  onHex,
  onName,
}: {
  index: number;
  hex: string;
  name: string;
  placeholder: string;
  onHex: (hex: string) => void;
  onName: (name: string) => void;
}) {
  return (
    <>
      <span className="idx">E{index + 1}</span>
      <span className="cell-colour">
        <input type="color" value={hex} onChange={(e) => onHex(e.target.value)} />
      </span>
      <input type="text" value={name} onChange={(e) => onName(e.target.value)} placeholder={placeholder} />
      <input
        type="text"
        defaultValue={hex}
        key={hex}
        onBlur={(e) => {
          const v = e.target.value.trim().toUpperCase();
          if (/^#[0-9A-F]{6}$/.test(v)) onHex(v);
          else e.target.value = hex;
        }}
        style={{ width: 90, fontFamily: "monospace" }}
      />
    </>
  );
}
