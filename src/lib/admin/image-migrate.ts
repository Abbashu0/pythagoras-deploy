/**
 * Image migration: legacy localStorage data URLs → IndexedDB.
 */

"use client";

import { setImage as setImageInDB, hasImage } from "./image-db";

const BANNERS_KEY = "pythagoras-admin-banners";
const MATERIALS_KEY = "pythagoras-admin-materials";

export interface MigrationResult {
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
  migratedKeys: string[];
}

function isDataUrl(s: unknown): s is string {
  return (
    typeof s === "string" &&
    s.startsWith("data:image/") &&
    s.includes(";base64,") &&
    s.length > 100
  );
}

async function migrateStorageKey(
  storageKey: string,
  keyPrefix: string,
  idField: string = "id"
): Promise<MigrationResult> {
  const result: MigrationResult = {
    scanned: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    migratedKeys: [],
  };
  if (typeof window === "undefined") return result;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    return result;
  }
  if (!raw) return result;
  let items: any[];
  try {
    items = JSON.parse(raw);
    if (!Array.isArray(items)) return result;
  } catch {
    return result;
  }
  let modified = false;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    result.scanned++;
    const imageField = item.image;
    const existingKey = item.imageKey;
    if (existingKey && typeof existingKey === "string" && existingKey.length > 0) {
      result.skipped++;
      continue;
    }
    if (!isDataUrl(imageField)) {
      result.skipped++;
      continue;
    }
    const itemId = String(item[idField] || `item-${result.scanned}`);
    const newKey = `${keyPrefix}-${itemId}`;
    try {
      if (!hasImage(newKey)) {
        await setImageInDB(newKey, imageField);
      }
      item.image = "";
      item.imageKey = newKey;
      modified = true;
      result.migrated++;
      result.migratedKeys.push(newKey);
    } catch (e) {
      console.error(`[image-migrate] Failed to migrate ${newKey}:`, e);
      result.failed++;
    }
  }
  if (modified) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch (e) {
      console.error(`[image-migrate] Failed to persist migrated ${storageKey}:`, e);
    }
  }
  return result;
}

export async function migrateLegacyImages(): Promise<MigrationResult> {
  const [bannersRes, materialsRes] = await Promise.all([
    migrateStorageKey(BANNERS_KEY, "banner"),
    migrateStorageKey(MATERIALS_KEY, "mat"),
  ]);
  return {
    scanned: bannersRes.scanned + materialsRes.scanned,
    migrated: bannersRes.migrated + materialsRes.migrated,
    skipped: bannersRes.skipped + materialsRes.skipped,
    failed: bannersRes.failed + materialsRes.failed,
    migratedKeys: [...bannersRes.migratedKeys, ...materialsRes.migratedKeys],
  };
}

export function collectReferencedImageKeys(): Set<string> {
  const keys = new Set<string>();
  if (typeof window === "undefined") return keys;
  const storageKeys = [BANNERS_KEY, MATERIALS_KEY];
  for (const sk of storageKeys) {
    try {
      const raw = localStorage.getItem(sk);
      if (!raw) continue;
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (item && typeof item === "object" && typeof item.imageKey === "string") {
          if (item.imageKey.length > 0) keys.add(item.imageKey);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return keys;
}
