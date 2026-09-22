import { DEFAULT_SETTINGS, type PipelineSettings } from "./types";
import type { RGB } from "@core/types";

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
  if (Array.isArray(stored.filamentList))
    out.filamentList = stored.filamentList.filter(
      (entry): entry is PipelineSettings["filamentList"][number] =>
        isRecord(entry) && typeof entry.name === "string" && typeof entry.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(entry.hex),
    );
  if (typeof stored.rememberTemplate === "boolean") out.rememberTemplate = stored.rememberTemplate;
  if (typeof stored.rememberWork === "boolean") out.rememberWork = stored.rememberWork;
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

// ---------------------------------------------------------------------------
// IndexedDB for binary blobs (template 3MF) that do not fit localStorage.
// ---------------------------------------------------------------------------

const DB_NAME = "rodin-pipeline";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Work autosave: the loaded model file plus the current face colours.
// ---------------------------------------------------------------------------

export const WORK_FILE_KEY = "work-file";
export const WORK_COLOURS_KEY = "work-colours";

export interface StoredWorkFile {
  /** Original file name, e.g. "typhoeus.3mf". */
  name: string;
  /** "rodin" (3MF), "obj" (vertex-colour OBJ) or "nomad" (OBJ imported as a full reload). */
  kind: "rodin" | "obj" | "nomad";
  /** Raw file bytes. */
  buffer: ArrayBuffer;
  /** Palette used for snapping a Nomad OBJ (3 bytes per colour); only for kind "nomad". */
  palette?: Uint8Array;
  savedAt: number;
}

export interface StoredWorkColours {
  faceCount: number;
  /** 3 bytes per face, in face order. */
  colours: Uint8Array;
  savedAt: number;
}

export function packColours(colours: ArrayLike<RGB>): Uint8Array {
  const out = new Uint8Array(colours.length * 3);
  for (let i = 0; i < colours.length; i++) {
    const rgb = colours[i];
    out[i * 3] = rgb[0];
    out[i * 3 + 1] = rgb[1];
    out[i * 3 + 2] = rgb[2];
  }
  return out;
}

export function unpackColours(packed: Uint8Array, faceCount: number): RGB[] | null {
  if (packed.length !== faceCount * 3) return null;
  const out: RGB[] = new Array(faceCount);
  for (let i = 0; i < faceCount; i++) out[i] = [packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2]];
  return out;
}

export function isStoredWorkFile(value: unknown): value is StoredWorkFile {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.kind === "rodin" || value.kind === "obj" || value.kind === "nomad") &&
    value.buffer instanceof ArrayBuffer
  );
}

export function isStoredWorkColours(value: unknown): value is StoredWorkColours {
  return isRecord(value) && typeof value.faceCount === "number" && value.colours instanceof Uint8Array;
}

export async function clearStoredWork(): Promise<void> {
  await Promise.all([idbDelete(WORK_FILE_KEY), idbDelete(WORK_COLOURS_KEY)]);
}
