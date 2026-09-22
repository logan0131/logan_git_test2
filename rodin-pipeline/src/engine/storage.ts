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
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
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

// ---------------------------------------------------------------------------
// Local data store: files served by the app's own dev/preview server when it is
// running (rodin-pipeline/user-data/), otherwise IndexedDB in the browser.
// ---------------------------------------------------------------------------

const MAGIC = "RDN1";
let serverProbe: Promise<boolean> | null = null;

function dataUrl(key: string): string {
  return new URL(`__rodin/data/${key}`, document.baseURI).toString();
}

/** True when the page is served by the Rodin Pipeline dev/preview server (cached). */
export function localServerAvailable(): Promise<boolean> {
  if (!serverProbe) {
    serverProbe = (async () => {
      try {
        const res = await fetch(new URL("__rodin/ping", document.baseURI).toString(), { cache: "no-store" });
        return res.ok && (await res.text()).trim() === "ok";
      } catch {
        return false;
      }
    })();
  }
  return serverProbe;
}

function packRecord(header: Record<string, unknown>, payload: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + headerBytes.length + payload.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  out.set(payload, 8 + headerBytes.length);
  return out;
}

function unpackRecord(buffer: ArrayBuffer): { header: Record<string, unknown>; payload: Uint8Array } | null {
  if (buffer.byteLength < 8) return null;
  const bytes = new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) return null;
  const headerLength = new DataView(buffer).getUint32(4, true);
  if (8 + headerLength > buffer.byteLength) return null;
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as Record<string, unknown>;
  return { header, payload: bytes.slice(8 + headerLength) };
}

/** Serialises the records the app stores (template, work file, work colours). */
function serialiseRecord(value: unknown): Uint8Array | null {
  if (isStoredWorkFile(value)) {
    const palette = value.palette ?? new Uint8Array(0);
    const payload = new Uint8Array(palette.length + value.buffer.byteLength);
    payload.set(palette, 0);
    payload.set(new Uint8Array(value.buffer), palette.length);
    return packRecord({ type: "work-file", name: value.name, kind: value.kind, savedAt: value.savedAt, paletteLength: palette.length }, payload);
  }
  if (isStoredWorkColours(value)) {
    return packRecord({ type: "work-colours", faceCount: value.faceCount, savedAt: value.savedAt }, value.colours);
  }
  if (isRecord(value) && typeof value.name === "string" && value.buffer instanceof ArrayBuffer) {
    return packRecord({ type: "template", name: value.name }, new Uint8Array(value.buffer));
  }
  return null;
}

function deserialiseRecord(buffer: ArrayBuffer): unknown {
  const record = unpackRecord(buffer);
  if (!record) return null;
  const { header, payload } = record;
  if (header.type === "work-file") {
    const paletteLength = Number(header.paletteLength) || 0;
    const palette = paletteLength > 0 ? payload.slice(0, paletteLength) : undefined;
    const body = payload.slice(paletteLength);
    const out: StoredWorkFile = {
      name: String(header.name),
      kind: header.kind === "obj" || header.kind === "nomad" ? header.kind : "rodin",
      buffer: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      palette,
      savedAt: Number(header.savedAt) || 0,
    };
    return out;
  }
  if (header.type === "work-colours") {
    const out: StoredWorkColours = { faceCount: Number(header.faceCount) || 0, colours: payload, savedAt: Number(header.savedAt) || 0 };
    return out;
  }
  if (header.type === "template") {
    return { name: String(header.name), buffer: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) };
  }
  return null;
}

/** Reads a record: the local server's file when available (migrating a browser copy to it once), else IndexedDB. */
export async function dataGet<T>(key: string): Promise<T | null> {
  if (await localServerAvailable()) {
    try {
      const res = await fetch(dataUrl(key), { cache: "no-store" });
      const missing = res.status === 204 || res.status === 404;
      if (res.ok && !missing) return deserialiseRecord(await res.arrayBuffer()) as T | null;
      if (missing) {
        // Nothing in the folder yet: carry over what an earlier version kept in the browser.
        const legacy = await idbGet<T>(key);
        if (legacy !== null) {
          await dataSet(key, legacy);
          return legacy;
        }
        return null;
      }
    } catch {
      // fall through to the browser store
    }
  }
  return idbGet<T>(key);
}

export async function dataSet(key: string, value: unknown): Promise<boolean> {
  if (await localServerAvailable()) {
    const bytes = serialiseRecord(value);
    if (bytes) {
      try {
        const res = await fetch(dataUrl(key), { method: "PUT", body: bytes.buffer as ArrayBuffer, headers: { "Content-Type": "application/octet-stream" } });
        if (res.ok) return true;
      } catch {
        // fall through
      }
    }
  }
  return idbSet(key, value);
}

export async function dataDelete(key: string): Promise<void> {
  if (await localServerAvailable()) {
    try {
      await fetch(dataUrl(key), { method: "DELETE" });
    } catch {
      // ignore
    }
  }
  await idbDelete(key);
}

export async function clearStoredWorkEverywhere(): Promise<void> {
  await Promise.all([dataDelete(WORK_FILE_KEY), dataDelete(WORK_COLOURS_KEY)]);
}

/** Settings kept as JSON in the local server's folder (null when the server is not running or has none). */
export async function loadServerSettings(): Promise<PipelineSettings | null> {
  if (!(await localServerAvailable())) return null;
  try {
    const res = await fetch(dataUrl("settings"), { cache: "no-store" });
    if (!res.ok || res.status === 204) return null;
    return mergeSettings(JSON.parse(await res.text()));
  } catch {
    return null;
  }
}

export async function storeServerSettings(settings: PipelineSettings): Promise<boolean> {
  if (!(await localServerAvailable())) return false;
  try {
    const res = await fetch(dataUrl("settings"), { method: "PUT", body: settingsToJson(settings), headers: { "Content-Type": "application/json" } });
    return res.ok;
  } catch {
    return false;
  }
}
