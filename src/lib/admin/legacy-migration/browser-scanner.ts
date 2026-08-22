"use client";

import { LEGACY_INDEXED_DB_NAME, LEGACY_IMAGE_STORE, type LegacyBrowserScanResult } from "./contracts";
import { scanLegacySource } from "./scanner";

async function readLegacyImagesWithoutUpgrade(): Promise<{ key: string; dataUrl: string }[]> {
  if (!("indexedDB" in window) || typeof indexedDB.databases !== "function") return [];
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === LEGACY_INDEXED_DB_NAME)) return [];
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_INDEXED_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر فتح مخزن الصور القديم."));
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(new Error("تم إيقاف الفحص لمنع ترقية IndexedDB."));
    };
  });
  try {
    if (!database.objectStoreNames.contains(LEGACY_IMAGE_STORE)) return [];
    const transaction = database.transaction(LEGACY_IMAGE_STORE, "readonly");
    const store = transaction.objectStore(LEGACY_IMAGE_STORE);
    const [keys, values] = await Promise.all([
      new Promise<IDBValidKey[]>((resolve, reject) => { const request = store.getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }),
      new Promise<unknown[]>((resolve, reject) => { const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }),
    ]);
    return keys.flatMap((key, index) => typeof values[index] === "string" ? [{ key: String(key), dataUrl: values[index] }] : []);
  } finally {
    database.close();
  }
}

export async function scanCurrentLegacyBrowser(): Promise<LegacyBrowserScanResult> {
  const images = await readLegacyImagesWithoutUpgrade();
  return scanLegacySource({ getItem: (key) => window.localStorage.getItem(key) }, images, window.location.origin);
}
