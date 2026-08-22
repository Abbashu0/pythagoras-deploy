"use client";

import { LEGACY_INDEXED_DB_NAME, LEGACY_IMAGE_STORE, type LegacyBrowserScanResult } from "./contracts";
import { scanLegacySource, type LegacyIndexedImageReader } from "./scanner";

async function legacyDatabaseExists(): Promise<boolean> {
  if (!("indexedDB" in window) || typeof indexedDB.databases !== "function") return false;
  const databases = await indexedDB.databases();
  return databases.some((database) => database.name === LEGACY_INDEXED_DB_NAME);
}

async function openExistingLegacyDatabase(): Promise<IDBDatabase | null> {
  if (!(await legacyDatabaseExists())) return null;
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_INDEXED_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر فتح مخزن الصور القديم."));
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(new Error("تم إيقاف الفحص لمنع ترقية IndexedDB."));
    };
  });
}

async function readOnlyRequest<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const database = await openExistingLegacyDatabase();
  if (!database) return null;
  try {
    if (!database.objectStoreNames.contains(LEGACY_IMAGE_STORE)) return null;
    const transaction = database.transaction(LEGACY_IMAGE_STORE, "readonly");
    const request = operation(transaction.objectStore(LEGACY_IMAGE_STORE));
    return await new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("تعذرت قراءة صورة قديمة."));
    });
  } finally {
    database.close();
  }
}

async function listLegacyImageKeysWithCursor(): Promise<string[]> {
  const database = await openExistingLegacyDatabase();
  if (!database) return [];
  try {
    if (!database.objectStoreNames.contains(LEGACY_IMAGE_STORE)) return [];
    const transaction = database.transaction(LEGACY_IMAGE_STORE, "readonly");
    const request = transaction.objectStore(LEGACY_IMAGE_STORE).openKeyCursor();
    return await new Promise<string[]>((resolve, reject) => {
      const keys: string[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(keys); return; }
        keys.push(String(cursor.key));
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("تعذر حصر مفاتيح الصور القديمة."));
    });
  } finally {
    database.close();
  }
}

const browserIndexedImageReader: LegacyIndexedImageReader = {
  async readDataUrl(key) {
    const value = await readOnlyRequest((store) => store.get(key));
    return typeof value === "string" ? value : null;
  },
  listKeys: listLegacyImageKeysWithCursor,
};

export async function scanCurrentLegacyBrowser(): Promise<LegacyBrowserScanResult> {
  return scanLegacySource(
    { getItem: (key) => window.localStorage.getItem(key) },
    browserIndexedImageReader,
    window.location.origin,
  );
}
