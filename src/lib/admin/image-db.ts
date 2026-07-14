/**
 * ImageDB — IndexedDB-based image storage with synchronous read cache.
 *
 * localStorage has a hard ~5MB limit. IndexedDB can store hundreds of MB.
 * This module stores image data URLs in IndexedDB and keeps a synchronous
 * in-memory cache so the student app (vanilla JS) can read images without
 * async calls during render.
 */

const DB_NAME = "pythagoras-images";
const STORE_NAME = "images";
const DB_VERSION = 2;

const cache = new Map<string, string>();
const ERROR_LOG_LIMIT = 20;
const errorLog: ImageDBError[] = [];

let dbPromise: Promise<IDBDatabase> | null = null;
let preloaded = false;

export type ImageDBErrorCode =
  | "open_failed"
  | "write_failed"
  | "read_failed"
  | "delete_failed"
  | "quota_exceeded"
  | "corrupt_data"
  | "unknown";

export interface ImageDBError {
  code: ImageDBErrorCode;
  message: string;
  key?: string;
  at: string;
}

export interface ImageDBStats {
  count: number;
  totalBytes: number;
  largestKey: string | null;
  largestBytes: number;
  lastAddedKey: string | null;
  lastAddedAt: string | null;
}

export interface ImageDBExportEntry {
  key: string;
  dataUrl: string;
  bytes: number;
}

export interface ImageDBExport {
  version: 2;
  exportedAt: string;
  count: number;
  totalBytes: number;
  images: ImageDBExportEntry[];
}

function pushError(code: ImageDBErrorCode, message: string, key?: string) {
  const entry: ImageDBError = { code, message, key, at: new Date().toISOString() };
  errorLog.unshift(entry);
  if (errorLog.length > ERROR_LOG_LIMIT) errorLog.pop();
  console.error(`[ImageDB:${code}]`, message, key ? `(key=${key})` : "");
}

export function getLastErrors(): ImageDBError[] {
  return errorLog.slice();
}

export function clearErrors(): void {
  errorLog.length = 0;
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      pushError("open_failed", "IndexedDB is not available in this environment.");
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        pushError("open_failed", `IndexedDB open failed: ${req.error?.message || "unknown"}`);
        reject(req.error || new Error("IndexedDB open failed"));
      };
      req.onblocked = () => {
        pushError("open_failed", "IndexedDB open blocked by another tab.");
        reject(new Error("IndexedDB open blocked"));
      };
    } catch (e) {
      pushError("open_failed", `IndexedDB open threw: ${e instanceof Error ? e.message : String(e)}`);
      reject(e);
    }
  });
  return dbPromise;
}

export async function preloadAllImages(): Promise<void> {
  if (preloaded) return;
  preloaded = true;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const [keys, values] = await Promise.all([
      reqToPromise<IDBValidKey[]>(store.getAllKeys()),
      reqToPromise<unknown[]>(store.getAll()),
    ]);
    for (let i = 0; i < keys.length; i++) {
      const key = String(keys[i]);
      const val = values[i];
      if (typeof val === "string" && val.length > 0) {
        cache.set(key, val);
      } else {
        pushError("corrupt_data", `Skipping non-string/empty value during preload.`, key);
      }
    }
  } catch (e) {
    pushError("read_failed", `preloadAllImages failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function getImageSync(key: string): string {
  return cache.get(key) || "";
}

export async function getImage(key: string): Promise<string> {
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    const result = await reqToPromise<unknown>(req);
    if (typeof result === "string") {
      cache.set(key, result);
      return result;
    }
    return "";
  } catch (e) {
    pushError("read_failed", `getImage failed: ${e instanceof Error ? e.message : String(e)}`, key);
    return "";
  }
}

export function hasImage(key: string): boolean {
  return cache.has(key) && !!cache.get(key);
}

export async function setImage(key: string, dataUrl: string): Promise<void> {
  if (!key || !dataUrl) {
    pushError("corrupt_data", "setImage called with empty key or dataUrl.", key);
    return;
  }
  const previousValue = cache.get(key);
  cache.set(key, dataUrl);
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(dataUrl, key);
    const metaTx = db.transaction("meta", "readwrite");
    metaTx.objectStore("meta").put(new Date().toISOString(), `lastWrite:${key}`);
    await Promise.all([txToPromise(tx), txToPromise(metaTx)]);
  } catch (e) {
    const isQuota =
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        e.code === 22 ||
        e.code === 1014);
    if (isQuota) {
      if (previousValue !== undefined) cache.set(key, previousValue);
      else cache.delete(key);
      pushError("quota_exceeded", `تعذّر حفظ الصورة — امتلأت مساحة التخزين.`, key);
    } else {
      pushError("write_failed", `setImage failed: ${e instanceof Error ? e.message : String(e)}`, key);
    }
  }
}

export async function deleteImage(key: string): Promise<void> {
  cache.delete(key);
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    const metaTx = db.transaction("meta", "readwrite");
    metaTx.objectStore("meta").delete(`lastWrite:${key}`);
    await Promise.all([txToPromise(tx), txToPromise(metaTx)]);
  } catch (e) {
    pushError("delete_failed", `deleteImage failed: ${e instanceof Error ? e.message : String(e)}`, key);
  }
}

export async function getStats(): Promise<ImageDBStats> {
  if (!preloaded) await preloadAllImages();
  let count = 0;
  let totalBytes = 0;
  let largestKey: string | null = null;
  let largestBytes = 0;
  for (const [key, dataUrl] of cache.entries()) {
    if (!dataUrl) continue;
    count++;
    const bytes = dataUrlBytes(dataUrl);
    totalBytes += bytes;
    if (bytes > largestBytes) {
      largestBytes = bytes;
      largestKey = key;
    }
  }
  let lastAddedKey: string | null = null;
  let lastAddedAt: string | null = null;
  try {
    const db = await openDB();
    if (db.objectStoreNames.contains("meta")) {
      const tx = db.transaction("meta", "readonly");
      const store = tx.objectStore("meta");
      const keys = await reqToPromise<IDBValidKey[]>(store.getAllKeys());
      const values = await reqToPromise<unknown[]>(store.getAll());
      let bestTime = 0;
      for (let i = 0; i < keys.length; i++) {
        const k = String(keys[i]);
        if (!k.startsWith("lastWrite:")) continue;
        const v = values[i];
        if (typeof v !== "string") continue;
        const t = Date.parse(v);
        if (Number.isFinite(t) && t > bestTime) {
          bestTime = t;
          lastAddedAt = v;
          lastAddedKey = k.slice("lastWrite:".length);
        }
      }
    }
  } catch {
    /* noop */
  }
  return { count, totalBytes, largestKey, largestBytes, lastAddedKey, lastAddedAt };
}

export function getAllKeys(): string[] {
  return Array.from(cache.keys()).filter((k) => !!cache.get(k));
}

export async function cleanupOrphans(referencedKeys: Set<string>): Promise<number> {
  if (!preloaded) await preloadAllImages();
  let deleted = 0;
  for (const key of Array.from(cache.keys())) {
    if (!referencedKeys.has(key)) {
      await deleteImage(key);
      deleted++;
    }
  }
  return deleted;
}

export async function clearAllImages(): Promise<number> {
  if (!preloaded) await preloadAllImages();
  const allKeys = Array.from(cache.keys());
  for (const k of allKeys) await deleteImage(k);
  return allKeys.length;
}

export async function exportAllImages(): Promise<ImageDBExport> {
  if (!preloaded) await preloadAllImages();
  const images: ImageDBExportEntry[] = [];
  let totalBytes = 0;
  for (const [key, dataUrl] of cache.entries()) {
    if (!dataUrl) continue;
    const bytes = dataUrlBytes(dataUrl);
    totalBytes += bytes;
    images.push({ key, dataUrl, bytes });
  }
  images.sort((a, b) => a.key.localeCompare(b.key));
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    count: images.length,
    totalBytes,
    images,
  };
}

export async function importAllImages(bundle: ImageDBExport): Promise<{ imported: number; failed: number }> {
  if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.images)) {
    pushError("corrupt_data", "Invalid import bundle: missing `images` array.");
    return { imported: 0, failed: 0 };
  }
  let imported = 0;
  let failed = 0;
  const CHUNK_SIZE = 5;
  for (let i = 0; i < bundle.images.length; i += CHUNK_SIZE) {
    const chunk = bundle.images.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (entry) => {
        if (!entry || typeof entry.key !== "string" || typeof entry.dataUrl !== "string") {
          pushError("corrupt_data", "Skipping malformed import entry.", entry?.key);
          failed++;
          return;
        }
        try {
          await setImage(entry.key, entry.dataUrl);
          imported++;
        } catch {
          failed++;
        }
      })
    );
  }
  return { imported, failed };
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

function dataUrlBytes(dataUrl: string): number {
  try {
    const base64 = dataUrl.split(",")[1] || "";
    const padding = (base64.match(/=+$/) || [""])[0].length;
    return Math.floor((base64.length * 3) / 4) - padding;
  } catch {
    return dataUrl.length;
  }
}
