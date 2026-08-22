import { NextResponse, type NextRequest } from "next/server";
import { getAdminActor, getAdminAuthService, getAdminSessionTokenFromRequest, isAdminAuthError, requireOwner, type AdminActor } from "@/server/admin-auth";
import { isAssetError } from "@/server/assets";
import { isLegacyMigrationError, resolveLegacySnapshotMaximumBytes } from "@/server/legacy-migration";

export function requireLegacyOwner(request: NextRequest): AdminActor {
  const authentication = requireOwner(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
  return getAdminActor(authentication);
}

export function legacyJson(body: Record<string, unknown>, init?: { status?: number }) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function readLegacyJson(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const limit = resolveLegacySnapshotMaximumBytes() + 64 * 1024;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (type !== "application/json" || !Number.isFinite(declared) || declared > limit) throw new Error("INVALID_JSON");
  const text = await request.text();
  if (!text || Buffer.byteLength(text, "utf8") > limit) throw new Error("INVALID_JSON");
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON");
  return value as Record<string, unknown>;
}

export function legacyErrorResponse(error: unknown) {
  if (isAdminAuthError(error)) return legacyJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
  if (isLegacyMigrationError(error)) {
    const status = error.code === "LEGACY_MIGRATION_NOT_FOUND" ? 404 : error.code === "LEGACY_MIGRATION_CONFLICT" || error.code === "LEGACY_MIGRATION_IMMUTABLE" || error.code === "LEGACY_MIGRATION_SOURCE_CHANGED" || error.code === "LEGACY_MIGRATION_NOT_READY" ? 409 : 400;
    return legacyJson({ ok: false, code: error.code }, { status });
  }
  if (isAssetError(error)) {
    const status = error.code === "ASSET_TOO_LARGE" ? 413 : error.code === "ASSET_UNSUPPORTED_TYPE" ? 415 : 400;
    return legacyJson({ ok: false, code: error.code }, { status });
  }
  if (error instanceof SyntaxError || (error instanceof Error && error.message === "INVALID_JSON")) return legacyJson({ ok: false, code: "LEGACY_MIGRATION_INVALID" }, { status: 400 });
  console.error("[legacy-migration] request failed", "UNEXPECTED_ERROR");
  return legacyJson({ ok: false, code: "LEGACY_MIGRATION_UNAVAILABLE" }, { status: 500 });
}
