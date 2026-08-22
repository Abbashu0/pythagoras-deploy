import { CANONICAL_BANNER_STATUSES, CANONICAL_BANNER_TYPES, CANONICAL_RUNTIME_SOURCE_MODES, type CanonicalBannerStatus, type CanonicalBannerType, type CanonicalRuntimeSourceMode } from "./contracts";
import { CanonicalContentError } from "./errors";

function fail(message: string): never {
  throw new CanonicalContentError("CANONICAL_VALIDATION_FAILED", message);
}

export function normalizedText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") fail(`${field} must be text.`);
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (result.length < min || result.length > max) fail(`${field} length is invalid.`);
  return result;
}

export function optionalText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") fail(`${field} must be text.`);
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (result.length > max) fail(`${field} is too long.`);
  return result;
}

export function semanticKey(value: unknown, field: string): string {
  const result = normalizedText(value, field, 1, 80).toLowerCase();
  if (!/^[a-z0-9-]+$/u.test(result)) fail(`${field} is not a trusted semantic key.`);
  return result;
}

export function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(`${field} must be boolean.`);
  return value;
}

export function integerRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail(`${field} is outside the accepted range.`);
  return value;
}

export function finiteRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${field} is outside the accepted range.`);
  return value;
}

export function nullableAssetId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 80 || !/^[0-9a-f-]+$/iu.test(value)) fail("Asset ID is invalid.");
  return value;
}

export function bannerType(value: unknown): CanonicalBannerType {
  if (!CANONICAL_BANNER_TYPES.includes(value as CanonicalBannerType)) fail("Banner type is invalid.");
  return value as CanonicalBannerType;
}

export function bannerStatus(value: unknown): CanonicalBannerStatus {
  if (!CANONICAL_BANNER_STATUSES.includes(value as CanonicalBannerStatus)) fail("Banner status is invalid.");
  return value as CanonicalBannerStatus;
}

export function runtimeSourceMode(value: unknown): CanonicalRuntimeSourceMode {
  if (!CANONICAL_RUNTIME_SOURCE_MODES.includes(value as CanonicalRuntimeSourceMode)) fail("Runtime source mode is invalid.");
  return value as CanonicalRuntimeSourceMode;
}

export function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Content proposal must be an object.");
  return value as Record<string, unknown>;
}

export function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) fail("Content proposal contains unsupported fields.");
}
