import { DEFAULT_SETTINGS, type PipelineSettings } from "./types";

const STORAGE_KEY = "rodin-pipeline-settings-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shallow-per-section merge of a stored object onto the defaults. */
export function mergeSettings(stored: unknown): PipelineSettings {
  if (!isRecord(stored)) return structuredClone(DEFAULT_SETTINGS);
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const section of ["filaments", "palette", "merge", "mix", "export"] as const) {
    const value = stored[section];
    if (isRecord(value)) Object.assign(out[section] as unknown as Record<string, unknown>, value);
  }
  if (isRecord(stored.mergeFlags)) out.mergeFlags = stored.mergeFlags as PipelineSettings["mergeFlags"];
  if (isRecord(stored.manualPhysical)) out.manualPhysical = stored.manualPhysical as PipelineSettings["manualPhysical"];
  // Keep fixed-length arrays well formed.
  const hex = Array.isArray(out.filaments.hex) ? out.filaments.hex : [];
  const names = Array.isArray(out.filaments.names) ? out.filaments.names : [];
  out.filaments.hex = DEFAULT_SETTINGS.filaments.hex.map((fallback, i) =>
    typeof hex[i] === "string" && /^#[0-9a-fA-F]{6}$/.test(hex[i]) ? hex[i].toUpperCase() : fallback,
  );
  out.filaments.names = DEFAULT_SETTINGS.filaments.names.map((fallback, i) =>
    typeof names[i] === "string" && names[i].trim() ? names[i] : fallback,
  );
  out.filaments.count = Math.max(2, Math.min(8, Math.round(Number(out.filaments.count) || 5)));
  return out;
}

export function loadStoredSettings(): PipelineSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return mergeSettings(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function storeSettings(settings: PipelineSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); ignore.
  }
}

export function settingsToJson(settings: PipelineSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function downloadTextFile(fileName: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
