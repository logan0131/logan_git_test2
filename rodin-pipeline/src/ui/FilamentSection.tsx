import { useState } from "react";
import type { Filament, PaletteEntry } from "@core/types";
import { rgbToHex } from "@core/colour";
import { parseFilamentList, suggestPhysicalSlots } from "@core/filaments";
import { FILAMENT_PRESETS, MAX_PHYSICAL, MIN_PHYSICAL, type FilamentListEntry, type FilamentSettings } from "../engine/types";
import { hexToRgb } from "../engine/mesh";
import { useT, type Key } from "../i18n";
import { Row, Section, Swatch } from "./common";
import { ColourSelect } from "./ColourSelect";
import { ColourPicker } from "./ColourPicker";

function toFilament(entry: FilamentListEntry): Filament {
  const rgb = hexToRgb(entry.hex);
  return { name: entry.name, type: entry.type, rgb, effectiveRgb: rgb, sourceLine: `${entry.name}; ${entry.type}; ${entry.hex}` };
}

/**
 * Parse "name; type; #hex" lines. A line may start with a slot prefix such as
 * "E1:" / "E1;" / "1." to put the filament straight into that slot.
 */
export function parseListText(text: string): { entries: FilamentListEntry[]; assignments: Array<{ slot: number; entry: FilamentListEntry }> } {
  const entries: FilamentListEntry[] = [];
  const assignments: Array<{ slot: number; entry: FilamentListEntry }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const prefixed = /^[Ee]?(\d{1,2})\s*[:;.)\-]\s*(.+)$/.exec(line);
    const body = prefixed ? prefixed[2] : line;
    const parsed = parseFilamentList(body);
    if (parsed.length === 0) continue;
    const entry: FilamentListEntry = { name: parsed[0].name, type: parsed[0].type, hex: rgbToHex(parsed[0].rgb) };
    entries.push(entry);
    if (prefixed) {
      const slot = Number(prefixed[1]);
      if (slot >= 1 && slot <= MAX_PHYSICAL) assignments.push({ slot, entry });
    }
  }
  return { entries, assignments };
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
  const swapSlots = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= settings.count || b >= settings.count) return;
    const nextHex = [...settings.hex];
    const nextNames = [...settings.names];
    [nextHex[a], nextHex[b]] = [nextHex[b], nextHex[a]];
    [nextNames[a], nextNames[b]] = [nextNames[b], nextNames[a]];
    update({ hex: nextHex, names: nextNames });
  };
  /** 1-based slot currently holding this list entry (matched by colour), 0 when none. */
  const slotOfEntry = (entry: FilamentListEntry, hexes: string[] = settings.hex): number => {
    for (let i = 0; i < settings.count; i++) {
      if (hexes[i]?.toUpperCase() === entry.hex.toUpperCase()) return i + 1;
    }
    return 0;
  };
  /**
   * Put a list entry into a slot. If the entry already sits in another slot the
   * two slots swap contents, so a filament never ends up in two slots at once.
   */
  const moveEntryToSlot = (hexes: string[], names: string[], entry: FilamentListEntry, target: number): void => {
    const current = slotOfEntry(entry, hexes) - 1;
    if (current === target) return;
    if (current >= 0) {
      hexes[current] = hexes[target];
      names[current] = names[target];
    }
    hexes[target] = entry.hex.toUpperCase();
    names[target] = entry.name;
  };
  const assignEntryToSlot = (entry: FilamentListEntry, target: number) => {
    const nextHex = [...settings.hex];
    const nextNames = [...settings.names];
    moveEntryToSlot(nextHex, nextNames, entry, target);
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
    const { entries, assignments } = parseListText(text);
    if (entries.length === 0) return;
    const merged = [...list];
    for (const entry of entries) {
      if (!merged.some((e) => e.name === entry.name && e.hex === entry.hex)) merged.push(entry);
    }
    onListChange(merged);
    if (assignments.length > 0) {
      const nextHex = [...settings.hex];
      const nextNames = [...settings.names];
      let count = settings.count;
      for (const { slot } of assignments) if (slot > count) count = slot;
      for (const { slot, entry } of assignments) moveEntryToSlot(nextHex, nextNames, entry, slot - 1);
      update({ hex: nextHex, names: nextNames, count });
    }
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
    <Section step={2} title={t("fil.title")} help={t("help.filaments")} badge={t("fil.badge", { n: settings.count })}>
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
            count={settings.count}
            hex={settings.hex[i]}
            name={settings.names[i]}
            placeholder={t("fil.name")}
            list={list}
            listLabel={t("fil.pickFromList")}
            moveUpLabel={t("fil.moveUp")}
            moveDownLabel={t("fil.moveDown")}
            onHex={(hex) => setSlot(i, hex)}
            onName={(name) => setSlot(i, settings.hex[i], name)}
            onPick={(entry) => assignEntryToSlot(entry, i)}
            onMove={(delta) => swapSlots(i, i + delta)}
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
      <details className="filament-list" open={list.length > 0 ? true : undefined}>
        <summary className="muted">
          {t("fil.listTitle")} · {list.length > 0 ? t("fil.listCount", { n: list.length }) : t("fil.noList")}
        </summary>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          {list.length > 0 && (
            <>
              <p className="muted">{t("fil.listAssignHint", { n: settings.count })}</p>
              <div className="table-wrap">
                <table className="grid filament-list-table">
                  <thead>
                    <tr>
                      <th>{t("load.colour")}</th>
                      <th>{t("fil.listName")}</th>
                      <th>{t("fil.listType")}</th>
                      <th>{t("fil.listSlot")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((entry, index) => {
                      const slot = slotOfEntry(entry);
                      return (
                        <tr key={`${entry.name}-${entry.hex}-${index}`}>
                          <td>
                            <span className="cell-colour">
                              <Swatch hex={entry.hex} />
                              <code>{entry.hex}</code>
                            </span>
                          </td>
                          <td style={{ whiteSpace: "normal" }}>{entry.name}</td>
                          <td>{entry.type || "-"}</td>
                          <td>
                            <select
                              value={slot || ""}
                              onChange={(e) => {
                                const target = Number(e.target.value);
                                if (target >= 1) assignEntryToSlot(entry, target - 1);
                              }}
                            >
                              <option value="">{t("fil.unassigned")}</option>
                              {Array.from({ length: settings.count }, (_v, i) => (
                                <option key={i} value={i + 1}>
                                  E{i + 1}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button type="button" className="btn small" title={t("fil.listRemove")} onClick={() => onListChange(list.filter((_e, i) => i !== index))}>
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
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
          <textarea value={pasted} placeholder={`E1: ${t("fil.listExample")}`} onChange={(e) => setPasted(e.target.value)} />
          <span className="muted">{t("fil.listFormatHint")}</span>
          <div className="inline">
            <button type="button" className="btn small" disabled={!pasted.trim()} onClick={() => applyListText(pasted)}>
              {t("fil.listApply")}
            </button>
            <button type="button" className="btn small" disabled={list.length === 0} onClick={() => onListChange([])}>
              {t("fil.listClear")}
            </button>
          </div>
        </div>
      </details>
    </Section>
  );
}

function FilamentRow({
  index,
  count,
  hex,
  name,
  placeholder,
  list,
  listLabel,
  moveUpLabel,
  moveDownLabel,
  onHex,
  onName,
  onPick,
  onMove,
}: {
  index: number;
  count: number;
  hex: string;
  name: string;
  placeholder: string;
  list: FilamentListEntry[];
  listLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  onHex: (hex: string) => void;
  onName: (name: string) => void;
  onPick: (entry: FilamentListEntry) => void;
  onMove: (delta: number) => void;
}) {
  return (
    <>
      <span className="idx">E{index + 1}</span>
      <span className="cell-colour">
        <ColourPicker value={hex.toUpperCase()} onChange={onHex} size={24} className="slot-colour">
          <Swatch hex={hex} size={24} />
        </ColourPicker>
      </span>
      <input type="text" value={name} onChange={(e) => onName(e.target.value)} placeholder={placeholder} title={name} />
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
      <ColourSelect
        value=""
        disabled={list.length === 0}
        placeholder={listLabel}
        title={listLabel}
        filterable
        onChange={(next) => {
          const entry = list[Number(next)];
          if (entry) onPick(entry);
        }}
        options={list.map((entry, i) => ({ value: String(i), hex: entry.hex, label: entry.name, sub: `${entry.type ? `${entry.type} · ` : ""}${entry.hex}` }))}
      />
      <span className="slot-order">
        <button type="button" className="btn" title={moveUpLabel} disabled={index === 0} onClick={() => onMove(-1)}>
          ▲
        </button>
        <button type="button" className="btn" title={moveDownLabel} disabled={index >= count - 1} onClick={() => onMove(1)}>
          ▼
        </button>
      </span>
    </>
  );
}
