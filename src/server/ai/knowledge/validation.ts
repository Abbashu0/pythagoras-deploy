import { createHash } from "node:crypto";
import { assertCanonicalRichDocument, toCanonicalRichDocument } from "../../questions/canonical-rich-document";
import type { AIKnowledgeSourceRevision, AIKnowledgePackageV1, AIKnowledgePackageDiagnostic, AIKnowledgePackageInspection, AIKnowledgeSourceRepository, AIKnowledgePackageChangeContent } from "./contracts";
import {
  AI_KNOWLEDGE_PACKAGE_CONTENT_MODE,
  AI_KNOWLEDGE_PACKAGE_FORMAT,
  AI_KNOWLEDGE_PACKAGE_SCHEMA_ID,
  AI_KNOWLEDGE_PACKAGE_SCHEMA_VERSION,
  AI_KNOWLEDGE_PREPARATION_METHODS,
  AI_KNOWLEDGE_RIGHTS_BASES,
  AI_KNOWLEDGE_RIGHTS_STATUSES,
  AI_KNOWLEDGE_SOURCE_TYPES,
  AI_KNOWLEDGE_TRUST_TIERS,
} from "./contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]{0,79}$/u;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_REF_PATTERN = /^[A-Za-z0-9._-]{1,120}$/u;
const MAX_DIAGNOSTICS = 250;
const MAX_DOCUMENTS = 10_000;
const MAX_ASSETS = 10_000;
const MAX_ASSET_BYTES = 2_000_000_000;
const MAX_TEXT = 2_000;

export interface InspectAIKnowledgePackageOptions {
  canonicalSubjectKeys?: ReadonlySet<string>;
  sourceResolver?: Pick<AIKnowledgeSourceRepository, "getRevision">;
}

export function inspectAIKnowledgePackageJson(
  value: unknown,
  options: InspectAIKnowledgePackageOptions = {},
): AIKnowledgePackageInspection {
  if (!isRecord(value) || typeof value.format !== "string" || value.format !== AI_KNOWLEDGE_PACKAGE_FORMAT) {
    return { status: "GENERIC_JSON", package: null, diagnostics: [] };
  }

  const diagnostics: AIKnowledgePackageDiagnostic[] = [];
  const report = (diagnostic: AIKnowledgePackageDiagnostic): void => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
  };
  const error = (code: string, message: string, jsonPointer: string, entityId?: string): void => {
    report({ severity: "ERROR", code, message, jsonPointer, ...(entityId ? { entityId } : {}) });
  };
  const warning = (code: string, message: string, jsonPointer: string, entityId?: string): void => {
    report({ severity: "WARNING", code, message, jsonPointer, ...(entityId ? { entityId } : {}) });
  };

  checkExactKeys(value, ["$schema", "format", "schemaVersion", "contentMode", "package", "source", "documents", "assetsManifest"], "", error);
  if (value.$schema !== AI_KNOWLEDGE_PACKAGE_SCHEMA_ID) error("KNOWLEDGE_SCHEMA_INVALID", "Knowledge Package schema identifier is invalid.", "/$schema");
  if (value.schemaVersion !== AI_KNOWLEDGE_PACKAGE_SCHEMA_VERSION) {
    return {
      status: "UNSUPPORTED_VERSION",
      package: null,
      diagnostics: [{ severity: "ERROR", code: "KNOWLEDGE_SCHEMA_VERSION_UNSUPPORTED", message: "Knowledge Package schema version is unsupported.", jsonPointer: "/schemaVersion" }],
    };
  }
  if (value.contentMode !== AI_KNOWLEDGE_PACKAGE_CONTENT_MODE) error("KNOWLEDGE_CONTENT_MODE_INVALID", "Knowledge Package content mode is invalid.", "/contentMode");

  const packageValue = validatePackageMetadata(value.package, error, options.canonicalSubjectKeys);
  const sourceValue = validateSourcePin(value.source, error);
  if (packageValue && sourceValue && options.sourceResolver) {
    const source = options.sourceResolver.getRevision(sourceValue.id, sourceValue.revision);
    if (!source) {
      error("KNOWLEDGE_SOURCE_REVISION_NOT_FOUND", "The pinned Knowledge Source revision is not published.", "/source");
    } else {
      validateResolvedSource(source, packageValue.subjectKey, error, warning);
    }
  }

  const assets = new Map<string, AIKnowledgePackageV1["assetsManifest"][number]>();
  if (!Array.isArray(value.assetsManifest)) {
    error("KNOWLEDGE_ASSETS_INVALID", "assetsManifest must be an array.", "/assetsManifest");
  } else if (value.assetsManifest.length > MAX_ASSETS) {
    error("KNOWLEDGE_ASSETS_TOO_MANY", "Knowledge Package contains too many asset entries.", "/assetsManifest");
  } else {
    value.assetsManifest.forEach((entry, index) => {
      const pointer = `/assetsManifest/${index}`;
      const valid = validateAssetEntry(entry, pointer, error);
      if (!valid) return;
      if (assets.has(valid.ref)) error("KNOWLEDGE_ASSET_REF_DUPLICATE", "Asset references must be unique.", `${pointer}/ref`);
      else assets.set(valid.ref, valid);
      if ([...assets.values()].some((candidate) => candidate.ref !== valid.ref && candidate.sha256 === valid.sha256)) {
        error("KNOWLEDGE_ASSET_HASH_DUPLICATE", "Each asset content hash must have one manifest identity.", `${pointer}/sha256`);
      }
    });
  }

  const documents: AIKnowledgePackageV1["documents"] = [];
  const documentIds = new Set<string>();
  const orders = new Set<number>();
  if (!Array.isArray(value.documents)) {
    error("KNOWLEDGE_DOCUMENTS_INVALID", "documents must be an array.", "/documents");
  } else if (value.documents.length > MAX_DOCUMENTS) {
    error("KNOWLEDGE_DOCUMENTS_TOO_MANY", "Knowledge Package contains too many documents.", "/documents");
  } else {
    value.documents.forEach((entry, index) => {
      const pointer = `/documents/${index}`;
      const valid = validateDocument(entry, pointer, error);
      if (!valid) return;
      if (documentIds.has(valid.id)) error("KNOWLEDGE_DOCUMENT_ID_DUPLICATE", "Document IDs must be unique within a Package.", `${pointer}/id`, valid.id);
      else documentIds.add(valid.id);
      if (orders.has(valid.order)) error("KNOWLEDGE_DOCUMENT_ORDER_DUPLICATE", "Document order values must be unique.", `${pointer}/order`, valid.id);
      else orders.add(valid.order);
      try {
        const canonical = toCanonicalRichDocument(valid.content, (ref) => syntheticAssetId(ref));
        assertCanonicalRichDocument(canonical, true);
        for (const ref of collectAssetRefs(valid.content)) {
          if (!assets.has(ref)) error("KNOWLEDGE_ASSET_REF_UNRESOLVED", "A document references an asset missing from assetsManifest.", `${pointer}/content`, valid.id);
        }
      } catch {
        error("KNOWLEDGE_RICH_DOCUMENT_INVALID", "Document content is not a valid RichDocument.", `${pointer}/content`, valid.id);
      }
      documents.push(valid);
    });
    const sortedOrders = [...orders].sort((left, right) => left - right);
    sortedOrders.forEach((order, index) => {
      if (order !== index + 1) warning("KNOWLEDGE_DOCUMENT_ORDER_GAP", "Document order is not contiguous; display order remains deterministic.", "/documents", undefined);
    });
    if (documents.length > 0 && !documents.some((document) => collectAssetRefs(document.content).size > 0)) {
      for (const asset of assets.values()) warning("KNOWLEDGE_ASSET_UNUSED", "An assetsManifest entry is not referenced by document content.", "/assetsManifest", asset.ref);
    }
  }

  if (!packageValue || !sourceValue || !Array.isArray(value.documents) || !Array.isArray(value.assetsManifest)) {
    return { status: diagnostics.some((item) => item.code === "KNOWLEDGE_SCHEMA_VERSION_UNSUPPORTED") ? "UNSUPPORTED_VERSION" : "INVALID", package: null, diagnostics };
  }
  const knowledgePackage: AIKnowledgePackageV1 = {
    $schema: AI_KNOWLEDGE_PACKAGE_SCHEMA_ID,
    format: AI_KNOWLEDGE_PACKAGE_FORMAT,
    schemaVersion: AI_KNOWLEDGE_PACKAGE_SCHEMA_VERSION,
    contentMode: AI_KNOWLEDGE_PACKAGE_CONTENT_MODE,
    package: packageValue,
    source: { id: sourceValue.id, revision: sourceValue.revision },
    documents,
    assetsManifest: [...assets.values()],
  };
  return {
    status: diagnostics.some((item) => item.severity === "ERROR") ? "INVALID" : diagnostics.length ? "VALID_WITH_WARNINGS" : "VALID",
    package: diagnostics.some((item) => item.severity === "ERROR") ? null : knowledgePackage,
    diagnostics,
  };
}

export function normalizeAIKnowledgeSourceContent(value: unknown): import("./contracts").AIKnowledgeSourceContent {
  if (!isRecord(value)) throw new Error("Knowledge Source content must be an object.");
  const content = value as Record<string, unknown>;
  const expectedKeys = ["key", "subjectKey", "sourceType", "displayName", "language", "edition", "authorityName", "authorityType", "trustTier", "rightsStatus", "rightsBasis", "licenseName", "attribution", "rightsNotes", "sourceUrl", "sourceAssetId", "enabled", "preparationMethod", "producerKey", "producerRevision"].sort();
  const actualKeys = Object.keys(content).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) throw new Error("Knowledge Source fields are invalid.");
  const result = {
    key: requiredText(content.key, "key", KEY_PATTERN),
    subjectKey: requiredText(content.subjectKey, "subjectKey", SUBJECT_PATTERN),
    sourceType: requiredEnum(content.sourceType, "sourceType", AI_KNOWLEDGE_SOURCE_TYPES),
    displayName: requiredText(content.displayName, "displayName"),
    language: requiredText(content.language, "language", LANGUAGE_PATTERN),
    edition: optionalText(content.edition, "edition"),
    authorityName: optionalText(content.authorityName, "authorityName"),
    authorityType: optionalText(content.authorityType, "authorityType"),
    trustTier: requiredEnum(content.trustTier, "trustTier", AI_KNOWLEDGE_TRUST_TIERS),
    rightsStatus: requiredEnum(content.rightsStatus, "rightsStatus", AI_KNOWLEDGE_RIGHTS_STATUSES),
    rightsBasis: optionalEnum(content.rightsBasis, "rightsBasis", AI_KNOWLEDGE_RIGHTS_BASES),
    licenseName: optionalText(content.licenseName, "licenseName"),
    attribution: optionalText(content.attribution, "attribution"),
    rightsNotes: optionalText(content.rightsNotes, "rightsNotes"),
    sourceUrl: optionalUrl(content.sourceUrl, "sourceUrl"),
    sourceAssetId: optionalUuid(content.sourceAssetId, "sourceAssetId"),
    enabled: requiredBoolean(content.enabled, "enabled"),
    preparationMethod: requiredEnum(content.preparationMethod, "preparationMethod", AI_KNOWLEDGE_PREPARATION_METHODS),
    producerKey: requiredText(content.producerKey, "producerKey", KEY_PATTERN),
    producerRevision: requiredText(content.producerRevision, "producerRevision"),
  };
  if (result.rightsStatus === "CLEARED" && !result.rightsBasis) throw new Error("Cleared Knowledge Sources require a reviewed rights basis.");
  if (result.rightsStatus !== "CLEARED" && result.rightsBasis) throw new Error("A rights basis is only valid for cleared Knowledge Sources.");
  return result;
}

export function normalizeAIKnowledgePackageChangeContent(value: unknown): AIKnowledgePackageChangeContent {
  if (!isRecord(value)) throw new Error("Knowledge Package Change Set content must be an object.");
  const content = value as Record<string, unknown>;
  const keys = ["key", "subjectKey", "title", "language", "contentRevision", "sourceId", "sourceRevision", "artifactRef", "artifactSha256", "artifactByteSize"];
  if (Object.keys(content).some((key) => !keys.includes(key)) || Object.keys(content).length !== keys.length) throw new Error("Knowledge Package Change Set content has unsupported fields.");
  const key = content.key;
  const subjectKey = content.subjectKey;
  const title = content.title;
  const language = content.language;
  const contentRevision = content.contentRevision;
  const sourceId = content.sourceId;
  const sourceRevision = content.sourceRevision;
  const artifactRef = content.artifactRef;
  const artifactSha256 = content.artifactSha256;
  const artifactByteSize = content.artifactByteSize;
  if (!isKey(key)) throw new Error("Knowledge Package key is invalid.");
  if (!isSubject(subjectKey)) throw new Error("Knowledge Package subject is invalid.");
  if (!isText(title, 1, 500)) throw new Error("Knowledge Package title is invalid.");
  if (!isLanguage(language)) throw new Error("Knowledge Package language is invalid.");
  if (!isPositiveInteger(contentRevision)) throw new Error("Knowledge Package contentRevision is invalid.");
  if (!isUuid(sourceId)) throw new Error("Knowledge Package source id is invalid.");
  if (!isPositiveInteger(sourceRevision)) throw new Error("Knowledge Package source revision is invalid.");
  if (!isSha256(artifactRef) || !isSha256(artifactSha256) || artifactRef !== artifactSha256) throw new Error("Knowledge Package artifact identity is invalid.");
  if (!isSafeInteger(artifactByteSize) || artifactByteSize <= 0 || artifactByteSize > MAX_ASSET_BYTES * 10) throw new Error("Knowledge Package artifact size is invalid.");
  return {
    key, subjectKey, title, language, contentRevision, sourceId, sourceRevision, artifactRef, artifactSha256, artifactByteSize,
  };
}

function validatePackageMetadata(value: unknown, error: (code: string, message: string, pointer: string, entityId?: string) => void, canonicalSubjectKeys?: ReadonlySet<string>): AIKnowledgePackageV1["package"] | null {
  if (!isRecord(value)) { error("KNOWLEDGE_PACKAGE_METADATA_INVALID", "package must be an object.", "/package"); return null; }
  checkExactKeys(value, ["id", "key", "title", "subjectKey", "language", "contentRevision"], "/package", error);
  const id = value.id; const key = value.key; const title = value.title; const subjectKey = value.subjectKey; const language = value.language; const contentRevision = value.contentRevision;
  if (!isUuid(id)) error("KNOWLEDGE_PACKAGE_ID_INVALID", "Package id must be a stable UUID.", "/package/id");
  if (!isKey(key)) error("KNOWLEDGE_PACKAGE_KEY_INVALID", "Package key is invalid.", "/package/key");
  if (!isText(title, 1, 500)) error("KNOWLEDGE_PACKAGE_TITLE_INVALID", "Package title is invalid.", "/package/title");
  if (!isSubject(subjectKey)) error("KNOWLEDGE_PACKAGE_SUBJECT_INVALID", "Package subjectKey is invalid.", "/package/subjectKey");
  else if (canonicalSubjectKeys && !canonicalSubjectKeys.has(subjectKey)) error("KNOWLEDGE_PACKAGE_SUBJECT_UNKNOWN", "Package subjectKey is not a canonical subject.", "/package/subjectKey");
  if (!isLanguage(language)) error("KNOWLEDGE_PACKAGE_LANGUAGE_INVALID", "Package language is invalid.", "/package/language");
  if (!isPositiveInteger(contentRevision)) error("KNOWLEDGE_PACKAGE_REVISION_INVALID", "Package contentRevision must be positive.", "/package/contentRevision");
  return isUuid(id) && isKey(key) && isText(title, 1, 500) && isSubject(subjectKey) && isLanguage(language) && isPositiveInteger(contentRevision)
    ? { id, key, title, subjectKey, language, contentRevision }
    : null;
}

function validateSourcePin(value: unknown, error: (code: string, message: string, pointer: string, entityId?: string) => void): { id: string; revision: number } | null {
  if (!isRecord(value)) { error("KNOWLEDGE_SOURCE_PIN_INVALID", "source must be an object.", "/source"); return null; }
  checkExactKeys(value, ["id", "revision"], "/source", error);
  const id = value.id; const revision = value.revision;
  if (!isUuid(id)) error("KNOWLEDGE_SOURCE_ID_INVALID", "Source id must be a stable UUID.", "/source/id");
  if (!isPositiveInteger(revision)) error("KNOWLEDGE_SOURCE_REVISION_INVALID", "Source revision must be positive.", "/source/revision");
  return isUuid(id) && isPositiveInteger(revision) ? { id, revision } : null;
}

function validateResolvedSource(source: AIKnowledgeSourceRevision, subjectKey: string, error: (code: string, message: string, pointer: string, entityId?: string) => void, warning: (code: string, message: string, pointer: string, entityId?: string) => void): void {
  if (source.subjectKey !== subjectKey) error("KNOWLEDGE_SOURCE_SUBJECT_MISMATCH", "Package subject must match the pinned Source subject.", "/source", source.sourceId);
  if (!AI_KNOWLEDGE_SOURCE_TYPES.includes(source.sourceType)) error("KNOWLEDGE_SOURCE_TYPE_INVALID", "Source type is not recognized.", "/source", source.sourceId);
  if (!AI_KNOWLEDGE_TRUST_TIERS.includes(source.trustTier)) error("KNOWLEDGE_SOURCE_TRUST_INVALID", "Source trust tier is not recognized.", "/source", source.sourceId);
  if (!AI_KNOWLEDGE_RIGHTS_STATUSES.includes(source.rightsStatus)) error("KNOWLEDGE_SOURCE_RIGHTS_INVALID", "Source rights status is not recognized.", "/source", source.sourceId);
  if (source.rightsStatus !== "CLEARED") warning("KNOWLEDGE_SOURCE_NOT_CLEARED", "The pinned Source revision is retained but is not projection eligible until rights are cleared.", "/source", source.sourceId);
  if (!source.enabled) warning("KNOWLEDGE_SOURCE_DISABLED", "The pinned Source revision is retained but is currently disabled for projection.", "/source", source.sourceId);
}

function validateAssetEntry(value: unknown, pointer: string, error: (code: string, message: string, pointer: string, entityId?: string) => void): AIKnowledgePackageV1["assetsManifest"][number] | null {
  if (!isRecord(value)) { error("KNOWLEDGE_ASSET_INVALID", "Asset manifest entry must be an object.", pointer); return null; }
  checkExactKeys(value, ["ref", "sha256", "filename", "mimeType", "byteSize", "metadata"], pointer, error);
  const ref = value.ref; const sha256 = value.sha256; const filename = value.filename; const mimeType = value.mimeType; const byteSize = value.byteSize; const metadata = value.metadata;
  const valid = SAFE_REF_PATTERN.test(String(ref ?? "")) && SHA256_PATTERN.test(String(sha256 ?? "")) && isFilename(filename) && isText(mimeType, 1, 200) && isSafeInteger(byteSize) && byteSize > 0 && byteSize <= MAX_ASSET_BYTES && (metadata === undefined || isSafeMetadata(metadata));
  if (!SAFE_REF_PATTERN.test(String(ref ?? ""))) error("KNOWLEDGE_ASSET_REF_INVALID", "Asset ref must be a safe opaque reference.", `${pointer}/ref`);
  if (!SHA256_PATTERN.test(String(sha256 ?? ""))) error("KNOWLEDGE_ASSET_HASH_INVALID", "Asset SHA-256 must be lowercase hexadecimal.", `${pointer}/sha256`);
  if (!isFilename(filename)) error("KNOWLEDGE_ASSET_FILENAME_INVALID", "Asset filename must be a safe leaf filename.", `${pointer}/filename`);
  if (!isText(mimeType, 1, 200)) error("KNOWLEDGE_ASSET_MIME_INVALID", "Asset MIME type is invalid.", `${pointer}/mimeType`);
  if (!isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_ASSET_BYTES) error("KNOWLEDGE_ASSET_SIZE_INVALID", "Asset byteSize is outside the supported range.", `${pointer}/byteSize`);
  if (metadata !== undefined && !isSafeMetadata(metadata)) error("KNOWLEDGE_ASSET_METADATA_INVALID", "Asset metadata must contain only bounded scalar values.", `${pointer}/metadata`);
  return valid && typeof ref === "string" && typeof sha256 === "string" && typeof filename === "string" && typeof mimeType === "string" && typeof byteSize === "number" ? { ref, sha256, filename, mimeType, byteSize, ...(metadata === undefined ? {} : { metadata }) } : null;
}

function validateDocument(value: unknown, pointer: string, error: (code: string, message: string, pointer: string, entityId?: string) => void): AIKnowledgePackageV1["documents"][number] | null {
  if (!isRecord(value)) { error("KNOWLEDGE_DOCUMENT_INVALID", "Document must be an object.", pointer); return null; }
  checkExactKeys(value, ["id", "order", "title", "provenance", "content"], pointer, error);
  const id = value.id; const order = value.order; const title = value.title; const provenance = value.provenance; const content = value.content;
  if (!isUuid(id)) error("KNOWLEDGE_DOCUMENT_ID_INVALID", "Document id must be a stable UUID.", `${pointer}/id`);
  if (!isSafeInteger(order) || order < 1) error("KNOWLEDGE_DOCUMENT_ORDER_INVALID", "Document order must be a positive integer.", `${pointer}/order`, typeof id === "string" ? id : undefined);
  if (title !== null && !isText(title, 1, 500)) error("KNOWLEDGE_DOCUMENT_TITLE_INVALID", "Document title is invalid.", `${pointer}/title`);
  if (provenance !== null && provenance !== undefined) validateProvenance(provenance, `${pointer}/provenance`, error);
  try { assertCanonicalRichDocument(content, true); } catch { /* Conversion below emits one bounded document-level diagnostic. */ }
  return isUuid(id) && isSafeInteger(order) && order >= 1 && (title === null || isText(title, 1, 500)) && (provenance === null || provenance === undefined || isValidProvenance(provenance)) && isRecord(content)
    ? { id, order, title: title ?? null, provenance: provenance ?? null, content: content as unknown as AIKnowledgePackageV1["documents"][number]["content"] }
    : null;
}

function validateProvenance(value: unknown, pointer: string, error: (code: string, message: string, pointer: string, entityId?: string) => void): void {
  if (!isRecord(value)) { error("KNOWLEDGE_PROVENANCE_INVALID", "Document provenance must be an object.", pointer); return; }
  checkExactKeys(value, ["pageStart", "pageEnd", "section", "subsection", "paragraph", "sourceLocator"], pointer, error);
  const pageStart = value.pageStart; const pageEnd = value.pageEnd;
  if (pageStart !== undefined && (!isSafeInteger(pageStart) || pageStart < 1)) error("KNOWLEDGE_PROVENANCE_PAGE_INVALID", "pageStart must be positive.", `${pointer}/pageStart`);
  if (pageEnd !== undefined && (!isSafeInteger(pageEnd) || pageEnd < 1)) error("KNOWLEDGE_PROVENANCE_PAGE_INVALID", "pageEnd must be positive.", `${pointer}/pageEnd`);
  if (isSafeInteger(pageStart) && isSafeInteger(pageEnd) && pageEnd < pageStart) error("KNOWLEDGE_PROVENANCE_PAGE_ORDER_INVALID", "pageEnd must not be before pageStart.", pointer);
  for (const key of ["section", "subsection", "paragraph", "sourceLocator"]) { const item = value[key]; if (item !== undefined && !isText(item, 1, MAX_TEXT)) error("KNOWLEDGE_PROVENANCE_TEXT_INVALID", "Document provenance text is invalid.", `${pointer}/${key}`); }
}

function isValidProvenance(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const pageStart = value.pageStart; const pageEnd = value.pageEnd;
  if (pageStart !== undefined && (!isSafeInteger(pageStart) || pageStart < 1)) return false;
  if (pageEnd !== undefined && (!isSafeInteger(pageEnd) || pageEnd < 1)) return false;
  if (isSafeInteger(pageStart) && isSafeInteger(pageEnd) && pageEnd < pageStart) return false;
  return ["section", "subsection", "paragraph", "sourceLocator"].every((key) => value[key] === undefined || isText(value[key], 1, MAX_TEXT));
}

function collectAssetRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { value.forEach((item) => collectAssetRefs(item, refs)); return refs; }
  if (!isRecord(value)) return refs;
  if (value.type === "image" && typeof value.assetRef === "string") refs.add(value.assetRef);
  Object.values(value).forEach((item) => collectAssetRefs(item, refs));
  return refs;
}

function syntheticAssetId(ref: string): string {
  const bytes = createHash("sha256").update(`knowledge-asset:${ref}`).digest("hex");
  return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-4${bytes.slice(13, 16)}-8${bytes.slice(17, 20)}-${bytes.slice(20, 32)}`;
}

function checkExactKeys(value: Record<string, unknown>, allowed: string[], pointer: string, error: (code: string, message: string, pointer: string, entityId?: string) => void): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) error("KNOWLEDGE_UNKNOWN_FIELD", "Unknown fields are not accepted in the Knowledge Package contract.", pointer ? `${pointer}/${escapePointer(key)}` : `/${escapePointer(key)}`);
}

function escapePointer(value: string): string { return value.replace(/~/gu, "~0").replace(/\//gu, "~1"); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
function isKey(value: unknown): value is string { return typeof value === "string" && KEY_PATTERN.test(value); }
function isSubject(value: unknown): value is string { return typeof value === "string" && SUBJECT_PATTERN.test(value); }
function isLanguage(value: unknown): value is string { return typeof value === "string" && LANGUAGE_PATTERN.test(value); }
function isText(value: unknown, min: number, max: number): value is string { return typeof value === "string" && value.trim().length >= min && value.length <= max; }
function isFilename(value: unknown): value is string { return isText(value, 1, 255) && !/[\\/\u0000-\u001f]/u.test(value) && value !== "." && value !== ".." && !value.includes(".."); }
function isSha256(value: unknown): value is string { return typeof value === "string" && SHA256_PATTERN.test(value); }
function isPositiveInteger(value: unknown): value is number { return isSafeInteger(value) && value > 0; }
function isSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function isSafeMetadata(value: unknown): value is Record<string, string | number | boolean | null> { return isRecord(value) && Object.keys(value).length <= 50 && Object.entries(value).every(([key, item]) => SAFE_REF_PATTERN.test(key) && !/(?:api[-_]?key|secret|authorization|bearer|credential|master[-_]?key)/iu.test(key) && (item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) && (typeof item !== "string" || item.length <= 500)); }
function requiredText(value: unknown, name: string, pattern?: RegExp): string { if (!isText(value, 1, MAX_TEXT) || (pattern && !pattern.test(value))) throw new Error(`Knowledge Source ${name} is invalid.`); return value; }
function requiredBoolean(value: unknown, name: string): boolean { if (typeof value !== "boolean") throw new Error(`Knowledge Source ${name} is invalid.`); return value; }
function optionalText(value: unknown, name: string): string | null { if (value === null || value === undefined) return null; if (!isText(value, 1, MAX_TEXT)) throw new Error(`Knowledge Source ${name} is invalid.`); return value; }
function requiredEnum<T extends readonly string[]>(value: unknown, name: string, allowed: T): T[number] { if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`Knowledge Source ${name} is invalid.`); return value as T[number]; }
function optionalEnum<T extends readonly string[]>(value: unknown, name: string, allowed: T): T[number] | null { if (value === null || value === undefined) return null; return requiredEnum(value, name, allowed); }
function optionalUuid(value: unknown, name: string): string | null { if (value === null || value === undefined) return null; if (!isUuid(value)) throw new Error(`Knowledge Source ${name} is invalid.`); return value; }
function optionalUrl(value: unknown, name: string): string | null { if (value === null || value === undefined) return null; if (!isText(value, 1, 2000)) throw new Error(`Knowledge Source ${name} is invalid.`); let url: URL; try { url = new URL(value); } catch { throw new Error(`Knowledge Source ${name} is invalid.`); } if (url.protocol !== "https:") throw new Error(`Knowledge Source ${name} is invalid.`); if (url.username || url.password) throw new Error(`Knowledge Source ${name} is invalid.`); return url.toString(); }
