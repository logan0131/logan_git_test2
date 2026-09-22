import type { PaletteEntry } from "@core/types";
import { rgbToHex } from "@core/colour";
import { FILAMENT_PRESETS, MAX_PHYSICAL, MIN_PHYSICAL, type FilamentSettings } from "../engine/types";
import { Row, Section, Swatch } from "./common";

export function FilamentSection({
  settings,
  onChange,
  palette,
}: {
  settings: FilamentSettings;
  onChange: (next: FilamentSettings) => void;
  palette: PaletteEntry[];
}) {
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
    <Section step={2} title="실물 필라멘트" badge={`${settings.count}개`}>
      <Row label="실물 익스트루더 수" hint="XL 5T는 5. 실물 + 가상 합계는 15를 넘을 수 없습니다.">
        <select value={settings.count} onChange={(e) => update({ count: Number(e.target.value) })}>
          {Array.from({ length: MAX_PHYSICAL - MIN_PHYSICAL + 1 }, (_v, i) => MIN_PHYSICAL + i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Row>
      <Row label="프리셋">
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
          <option value="">선택…</option>
          {FILAMENT_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label}
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
            onHex={(hex) => setHex(i, hex)}
            onName={(name) => setName(i, name)}
          />
        ))}
      </div>
      <div className="inline">
        <button type="button" className="btn small" onClick={fillFromPalette} disabled={palette.length === 0} title="면적이 큰 팔레트 색부터 실물 슬롯에 채웁니다.">
          모델 팔레트에서 채우기
        </button>
        <span className="muted">실제 필라멘트의 색을 hex로 넣을수록 혼합 예측이 정확해집니다.</span>
      </div>
    </Section>
  );
}

function FilamentRow({
  index,
  hex,
  name,
  onHex,
  onName,
}: {
  index: number;
  hex: string;
  name: string;
  onHex: (hex: string) => void;
  onName: (name: string) => void;
}) {
  return (
    <>
      <span className="idx">E{index + 1}</span>
      <span className="cell-colour">
        <input type="color" value={hex} onChange={(e) => onHex(e.target.value)} />
      </span>
      <input type="text" value={name} onChange={(e) => onName(e.target.value)} placeholder="필라멘트 이름" />
      <input
        type="text"
        value={hex}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onHex(v);
        }}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (!/^#[0-9a-fA-F]{6}$/.test(v)) e.target.value = hex;
        }}
        style={{ width: 90, fontFamily: "monospace" }}
      />
      <Swatch hex={hex} size={0} />
    </>
  );
}
