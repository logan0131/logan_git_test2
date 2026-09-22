import { useState } from "react";
import type { Filament, PaletteEntry } from "@core/types";
import { rgbToHex } from "@core/colour";
import { parseFilamentList, suggestPhysicalSlots } from "@core/filaments";
import { FILAMENT_PRESETS, MAX_PHYSICAL, MIN_PHYSICAL, type FilamentListEntry, type FilamentSettings } from "../engine/types";
import { hexToRgb } from "../engine/mesh";
import { useT, type Key } from "../i18n";
import { Row, Section } from "./common";

function toFilament(entry: FilamentListEntry): Filament {
  const rgb = hexToRgb(entry.hex);
  return { name: entry.name, type: entry.type, rgb, effectiveRgb: rgb, sourceLine: `${entry.name}; ${entry.type}; ${entry.hex}` };
}

export function FilamentSection({
  settings,
  onChange,
  palette,
  list,
  onListChange,
}: {
  settings: FilamentSettings;
  onChange: (next: FilamentSettings) => void;
  palette: PaletteEntry[];
  list: FilamentListEntry[];
  onListChange: (next: FilamentListEntry[]) => void;
}) {
  const t = useT();
  const [pasted, setPasted] = useState("");
  const update = (patch: Partial<FilamentSettings>) => onChange({ ...settings, ...patch });
  const setSlot = (i: number, hex: string, name?: string) => {
    const nextHex = [...settings.hex];
    nextHex[i] = hex.toUpperCase();
    const nextNames = [...settings.names];
    if (name !== undefined) nextNames[i] = name;
    update({ hex: nextHex, names: nextNames });
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
  const applyListText = (text: string) => {
    const parsed = parseFilamentList(text).map((f) => ({ name: f.name, type: f.type, hex: rgbToHex(f.rgb) }));
    if (parsed.length === 0) return;
    const merged = [...list];
    for (const entry of parsed) {
      if (!merged.some((e) => e.name === entry.name && e.hex === entry.hex)) merged.push(entry);
    }
    onListChange(merged);
    setPasted("");
  };
  const suggestFromList = () => {
    if (list.length === 0 || palette.length === 0) return;
    const filaments = list.map(toFilament);
    const slots = suggestPhysicalSlots(palette, filaments, settings.count, {
      saturationPenalty: 0.3,
      diversityPenalty: 0.25,
      balance: 0.4,
      weightExponent: 0.4,
      neutralWeight: 0.5,
      maxComponents: 2,
      recipeResolution: "thirds",
    });
    if (slots.length === 0) return;
    const nextHex = [...settings.hex];
    const nextNames = [...settings.names];
    slots.forEach((slot, i) => {
      if (i >= settings.count) return;
      nextHex[i] = rgbToHex(slot.filament.rgb);
      nextNames[i] = slot.filament.name;
    });
    update({ hex: nextHex, names: nextNames });
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
          <FilamentRow
            key={i}
            index={i}
            hex={settings.hex[i]}
            name={settings.names[i]}
            placeholder={t("fil.name")}
            list={list}
            listLabel={t("fil.pickFromList")}
            onHex={(hex) => setSlot(i, hex)}
            onName={(name) => setSlot(i, settings.hex[i], name)}
            onPick={(entry) => setSlot(i, entry.hex, entry.name)}
          />
        ))}
      </div>
      <div className="inline">
        <button type="button" className="btn small" onClick={fillFromPalette} disabled={palette.length === 0} title={t("fil.fillHint")}>
          {t("fil.fillFromPalette")}
        </button>
        <button type="button" className="btn small" onClick={suggestFromList} disabled={palette.length === 0 || list.length === 0} title={t("fil.suggestHint")}>
          {t("fil.suggest")}
        </button>
        <span className="muted">{t("fil.hexNote")}</span>
      </div>
      <details className="filament-list" open={list.length === 0 ? undefined : true}>
        <summary className="muted">
          {t("fil.listTitle")} · {list.length > 0 ? t("fil.listCount", { n: list.length }) : t("fil.noList")}
        </summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <label className="btn small" style={{ justifySelf: "start" }}>
            {t("fil.listFile")}
            <input
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void file.text().then(applyListText);
                e.target.value = "";
              }}
            />
          </label>
          <span className="muted">{t("fil.listPaste")}</span>
          <textarea value={pasted} placeholder={t("fil.listExample")} onChange={(e) => setPasted(e.target.value)} />
          <div className="inline">
            <button type="button" className="btn small" disabled={!pasted.trim()} onClick={() => applyListText(pasted)}>
              {t("fil.listApply")}
            </button>
            <button type="button" className="btn small" disabled={list.length === 0} onClick={() => onListChange([])}>
              {t("fil.listClear")}
            </button>
          </div>
          {list.length > 0 && (
            <div className="swatch-row">
              {list.map((entry) => (
                <span key={`${entry.name}-${entry.hex}`} className="swatch" style={{ background: entry.hex, width: 18, height: 18 }} title={`${entry.name} (${entry.type}) ${entry.hex}`} />
              ))}
            </div>
          )}
        </div>
      </details>
    </Section>
  );
}

function FilamentRow({
  index,
  hex,
  name,
  placeholder,
  list,
  listLabel,
  onHex,
  onName,
  onPick,
}: {
  index: number;
  hex: string;
  name: string;
  placeholder: string;
  list: FilamentListEntry[];
  listLabel: string;
  onHex: (hex: string) => void;
  onName: (name: string) => void;
  onPick: (entry: FilamentListEntry) => void;
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
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        style={{ fontFamily: "monospace" }}
      />
      <select
        value=""
        disabled={list.length === 0}
        onChange={(e) => {
          const entry = list[Number(e.target.value)];
          if (entry) onPick(entry);
        }}
        title={listLabel}
      >
        <option value="">{listLabel}</option>
        {list.map((entry, i) => (
          <option key={`${entry.name}-${i}`} value={i}>
            {entry.name} {entry.hex}
          </option>
        ))}
      </select>
    </>
  );
}
