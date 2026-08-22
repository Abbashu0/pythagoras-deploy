import {
  LEGACY_SNAPSHOT_FORMAT,
  LEGACY_SNAPSHOT_VERSION,
  LEGACY_STORAGE_KEYS,
  type LegacyBrowserScanResult,
  type LegacyBrowserSnapshot,
  type LegacyImageCandidate,
  type LegacyImageBinaryReader,
  type LegacyImageSourceKind,
  type LegacyMigrationIssue,
  type LegacyStorageEvidence,
  type LegacyStorageKey,
} from "./contracts";

export interface ReadonlyLegacyStorage {
  getItem(key: string): string | null;
}

export interface LegacyImageInput {
  key: string;
  dataUrl: string;
}

export interface LegacyIndexedImageReader {
  readDataUrl(key: string): Promise<string | null>;
  listKeys(): Promise<string[]>;
}

interface LegacyInlineLocator {
  storageKey: LegacyStorageKey;
  path: Array<string | number>;
  contexts: string[];
}

const JSON_KEYS = new Set<LegacyStorageKey>([
  "pythagoras-admin-banners",
  "pythagoras-admin-history",
  "pythagoras-admin-carousel-settings",
  "pythagoras-admin-materials",
  "pythagoras-admin-materials-settings",
  "pythagoras-admin-tools",
  "pythagoras-admin-tools-settings",
  "pythagoras-admin-nav-items",
]);

const SECTION_NAMES: Record<LegacyStorageKey, string> = {
  "pythagoras-admin-banners": "banners",
  "pythagoras-admin-history": "legacyActivityHistory",
  "pythagoras-admin-theme": "adminThemePreference",
  "pythagoras-admin-carousel-settings": "carouselSettings",
  "pythagoras-admin-materials": "materials",
  "pythagoras-admin-materials-settings": "materialsSettings",
  "pythagoras-admin-materials-fade": "legacyMaterialsFade",
  "pythagoras-admin-tools": "tools",
  "pythagoras-admin-tools-settings": "legacyToolsSettings",
  "pythagoras-admin-tools-fade": "legacyToolsFade",
  "pythagoras-admin-nav-items": "navigation",
  "pythagoras-theme": "studentThemePreference",
  "pythagoras-density": "studentDensityPreference",
};

const SAFE_DATA_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalLegacyJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function decodeSafeImageDataUrl(dataUrl: string): Promise<{ mimeType: string; bytes: Uint8Array }> {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/u.exec(dataUrl);
  if (!match || !SAFE_DATA_MIMES.has(match[1].toLowerCase())) throw new Error("UNSUPPORTED_IMAGE");
  const binary = atob(match[2].replace(/\s/gu, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength === 0) throw new Error("INVALID_IMAGE_DATA_URL");
  const mimeType = match[1].toLowerCase();
  return { bytes, mimeType };
}

function recordIssue(
  issues: LegacyMigrationIssue[],
  severity: LegacyMigrationIssue["severity"],
  code: string,
  section: string | null,
  message: string,
  legacyReference: string | null = null,
) {
  issues.push({ severity, code, section, message, legacyReference });
}

function inspectOrdering(records: unknown[], section: string, issues: LegacyMigrationIssue[]) {
  const present = records
    .map((record) => record && typeof record === "object" ? (record as Record<string, unknown>).order ?? (record as Record<string, unknown>).displayOrder : undefined)
    .filter((order) => order !== undefined);
  if (present.some((order) => typeof order !== "number" || !Number.isInteger(order))) {
    recordIssue(issues, "WARNING", "INVALID_ORDER", section, "توجد قيمة ترتيب غير صحيحة؛ تم الاحتفاظ بالقيمة الأصلية دون تعديل.");
  }
  const orders = present.filter((order): order is number => typeof order === "number" && Number.isInteger(order)).sort((a, b) => a - b);
  if (new Set(orders).size !== orders.length) {
    recordIssue(issues, "WARNING", "DUPLICATE_ORDER", section, "توجد قيم ترتيب مكررة؛ تم الاحتفاظ بالقيم الأصلية دون إعادة فهرسة.");
  }
  const unique = [...new Set(orders)];
  if (unique.some((order, index) => index > 0 && order - unique[index - 1] > 1)) {
    recordIssue(issues, "WARNING", "ORDER_GAP", section, "توجد فجوة داخل تسلسل الترتيب؛ تم الاحتفاظ بالقيم الأصلية دون إعادة فهرسة.");
  }
}

function inspectIds(records: unknown[], section: string, issues: LegacyMigrationIssue[]) {
  const seen = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== "object" || typeof (record as Record<string, unknown>).id !== "string") {
      recordIssue(issues, "ERROR", "INVALID_RECORD", section, "سجل قديم لا يحتوي على معرّف نصي صالح.");
      continue;
    }
    const id = String((record as Record<string, unknown>).id);
    if (seen.has(id)) recordIssue(issues, "ERROR", "DUPLICATE_RECORD_ID", section, `المعرّف القديم مكرر داخل ${section}.`);
    seen.add(id);
  }
}

function extractInlineImages(
  value: unknown,
  context: string,
  storageKey: LegacyStorageKey,
  path: Array<string | number>,
  inline: Map<string, LegacyInlineLocator>,
): unknown {
  if (typeof value === "string" && value.startsWith("data:")) {
    const reference = `inline:${context}`;
    inline.set(reference, { storageKey, path, contexts: [context] });
    return { legacyImageReference: reference, originallyInline: true };
  }
  if (Array.isArray(value)) return value.map((child, index) => extractInlineImages(child, `${context}[${index}]`, storageKey, [...path, index], inline));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, extractInlineImages(child, `${context}.${key}`, storageKey, [...path, key], inline)]));
  }
  return value;
}

function createArrayImageReader(images: readonly LegacyImageInput[]): LegacyIndexedImageReader {
  const values = new Map(images.map((image) => [image.key, image.dataUrl]));
  return {
    async readDataUrl(key) { return values.get(key) ?? null; },
    async listKeys() { return [...values.keys()]; },
  };
}

function readInlineDataUrl(storage: ReadonlyLegacyStorage, locator: LegacyInlineLocator): string | null {
  const raw = storage.getItem(locator.storageKey);
  if (raw === null) return null;
  try {
    let value: unknown = JSON.parse(raw);
    for (const segment of locator.path) {
      if (typeof segment === "number" && Array.isArray(value)) value = value[segment];
      else if (typeof segment === "string" && value && typeof value === "object" && !Array.isArray(value)) value = (value as Record<string, unknown>)[segment];
      else return null;
    }
    return typeof value === "string" ? value : null;
  } catch { return null; }
}

function collectImageKeyReferences(value: unknown, context: string, output: Map<string, string[]>) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectImageKeyReferences(child, `${context}[${index}]`, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = `${context}.${key}`;
    if (key === "imageKey" && typeof child === "string" && child.trim()) {
      const contexts = output.get(child) ?? [];
      contexts.push(path);
      output.set(child, contexts);
    } else collectImageKeyReferences(child, path, output);
  }
}

export async function scanLegacySource(
  storage: ReadonlyLegacyStorage,
  indexedImages: readonly LegacyImageInput[] | LegacyIndexedImageReader,
  origin: string,
  capturedAt = new Date().toISOString(),
): Promise<LegacyBrowserScanResult> {
  const evidence: LegacyStorageEvidence[] = [];
  const sections: Record<string, unknown> = {};
  const issues: LegacyMigrationIssue[] = [];
  const inline = new Map<string, LegacyInlineLocator>();
  const references = new Map<string, string[]>();
  const indexedReader: LegacyIndexedImageReader = Array.isArray(indexedImages)
    ? createArrayImageReader(indexedImages)
    : indexedImages as LegacyIndexedImageReader;

  for (const key of LEGACY_STORAGE_KEYS) {
    const raw = storage.getItem(key);
    if (raw === null) {
      evidence.push({ key, present: false, parsedStatus: "MISSING", rawValue: null });
      recordIssue(issues, "INFO", "MISSING_LOCALSTORAGE_KEY", SECTION_NAMES[key], `المفتاح ${key} غير موجود؛ لم تُفترض بيانات بديلة.`);
      sections[SECTION_NAMES[key]] = null;
      continue;
    }
    if (!JSON_KEYS.has(key)) {
      evidence.push({ key, present: true, parsedStatus: "TEXT", rawValue: raw });
      sections[SECTION_NAMES[key]] = raw;
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      const sanitized = extractInlineImages(parsed, SECTION_NAMES[key], key, [], inline);
      sections[SECTION_NAMES[key]] = sanitized;
      evidence.push({ key, present: true, parsedStatus: "JSON", rawValue: canonicalLegacyJson(sanitized) });
      collectImageKeyReferences(sanitized, SECTION_NAMES[key], references);
      if (["banners", "materials", "tools", "navigation"].includes(SECTION_NAMES[key])) {
        if (!Array.isArray(sanitized)) recordIssue(issues, "ERROR", "INVALID_RECORD", SECTION_NAMES[key], "القسم المتوقع ليس قائمة سجلات.");
        else {
          inspectIds(sanitized, SECTION_NAMES[key], issues);
          inspectOrdering(sanitized, SECTION_NAMES[key], issues);
        }
      }
    } catch {
      evidence.push({ key, present: true, parsedStatus: "MALFORMED_JSON", rawValue: raw.slice(0, 64 * 1024) });
      sections[SECTION_NAMES[key]] = null;
      recordIssue(issues, "ERROR", "MALFORMED_JSON", SECTION_NAMES[key], `تعذر تحليل JSON للمفتاح ${key}.`);
    }
  }

  const imageCandidates: LegacyImageCandidate[] = [];
  const imageReferences: LegacyBrowserSnapshot["references"]["images"] = [];

  const inspectImage = async (legacyReference: string, sourceKind: LegacyImageSourceKind, contexts: string[], state: "REFERENCED" | "ORPHAN", dataUrl: string) => {
    const decoded = await decodeSafeImageDataUrl(dataUrl);
    const digest = await sha256(decoded.bytes);
    const metadata = { legacyReference, sourceKind, contexts, state, mimeType: decoded.mimeType, byteSize: decoded.bytes.byteLength, sha256: digest } satisfies LegacyImageCandidate;
    imageCandidates.push(metadata);
    imageReferences.push(metadata);
  };

  for (const [legacyReference, contexts] of references) {
    const dataUrl = await indexedReader.readDataUrl(legacyReference);
    if (!dataUrl) {
      imageReferences.push({ legacyReference, sourceKind: "INDEXED_DB", contexts, state: "MISSING_REFERENCE", mimeType: null, byteSize: null, sha256: null });
      recordIssue(issues, "ERROR", "MISSING_IMAGE_REFERENCE", "images", "مرجع صورة مستخدم غير موجود في IndexedDB.", legacyReference);
      continue;
    }
    try {
      await inspectImage(legacyReference, "INDEXED_DB", contexts, "REFERENCED", dataUrl);
    } catch (error) {
      const code = error instanceof Error ? error.message : "INVALID_IMAGE_DATA_URL";
      recordIssue(issues, "ERROR", code, "images", "صورة قديمة غير صالحة أو من نوع غير آمن.", legacyReference);
    }
  }

  for (const [legacyReference, source] of inline) {
    try {
      const dataUrl = readInlineDataUrl(storage, source);
      if (!dataUrl) throw new Error("INVALID_IMAGE_DATA_URL");
      await inspectImage(legacyReference, "INLINE", source.contexts, "REFERENCED", dataUrl);
      recordIssue(issues, "INFO", "INLINE_IMAGE_FOUND", "images", "تم استخراج صورة مضمنة من snapshot قبل الإرسال.", legacyReference);
    } catch (error) {
      const code = error instanceof Error ? error.message : "INVALID_IMAGE_DATA_URL";
      recordIssue(issues, "ERROR", code, "images", "تعذر فك صورة مضمنة قديمة بأمان.", legacyReference);
    }
  }

  for (const key of await indexedReader.listKeys()) {
    if (references.has(key)) continue;
    try {
      const dataUrl = await indexedReader.readDataUrl(key);
      if (!dataUrl) continue;
      await inspectImage(key, "INDEXED_DB", [], "ORPHAN", dataUrl);
      recordIssue(issues, "WARNING", "ORPHAN_IMAGE", "images", "صورة قديمة غير مرتبطة بسجل حالي؛ لم تُحذف.", key);
    } catch {
      recordIssue(issues, "WARNING", "UNSUPPORTED_IMAGE", "images", "صورة يتيمة غير صالحة أو غير مدعومة؛ لم تُحذف.", key);
    }
  }

  const snapshot: LegacyBrowserSnapshot = {
    format: LEGACY_SNAPSHOT_FORMAT,
    version: LEGACY_SNAPSHOT_VERSION,
    capturedAt,
    origin,
    evidence,
    sections,
    references: { images: imageReferences.sort((a, b) => a.legacyReference.localeCompare(b.legacyReference)) },
    issues,
  };
  const fingerprintPayload = { format: snapshot.format, version: snapshot.version, origin, sections, images: snapshot.references.images.map(({ legacyReference, sourceKind, state, sha256: digest }) => ({ legacyReference, sourceKind, state, sha256: digest })) };
  const sourceFingerprint = await sha256(new TextEncoder().encode(canonicalLegacyJson(fingerprintPayload)));
  const imageReader: LegacyImageBinaryReader = {
    async readBlob(legacyReference, sourceKind) {
      const dataUrl = sourceKind === "INDEXED_DB"
        ? await indexedReader.readDataUrl(legacyReference)
        : (() => { const locator = inline.get(legacyReference); return locator ? readInlineDataUrl(storage, locator) : null; })();
      if (!dataUrl) throw new Error("LEGACY_IMAGE_NOT_FOUND");
      const decoded = await decodeSafeImageDataUrl(dataUrl);
      const bytes = decoded.bytes.buffer.slice(decoded.bytes.byteOffset, decoded.bytes.byteOffset + decoded.bytes.byteLength) as ArrayBuffer;
      return new Blob([bytes], { type: decoded.mimeType });
    },
  };
  return { snapshot, sourceFingerprint, imageCandidates, imageReader };
}
