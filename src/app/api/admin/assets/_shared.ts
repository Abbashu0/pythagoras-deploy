import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminAuthService,
  getAdminSessionTokenFromRequest,
  isAdminAuthError,
  requireAdmin,
  type AdminAuthentication,
} from "@/server/admin-auth";
import { isAssetError } from "@/server/assets";

export function requireAssetApiAdmin(request: NextRequest): AdminAuthentication {
  return requireAdmin(
    getAdminAuthService().authenticateSessionToken(
      getAdminSessionTokenFromRequest(request),
    ),
  );
}

export function noStoreAssetJson(
  body: Record<string, unknown>,
  init?: { status?: number; headers?: HeadersInit },
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function assetApiErrorResponse(error: unknown): NextResponse {
  if (isAdminAuthError(error)) {
    if (error.code === "ADMIN_AUTH_REQUIRED") {
      return noStoreAssetJson({ ok: false, code: error.code }, { status: 401 });
    }
    if (error.code === "ADMIN_FORBIDDEN" || error.code === "ADMIN_UNTRUSTED_ORIGIN") {
      return noStoreAssetJson({ ok: false, code: error.code }, { status: 403 });
    }
  }

  if (isAssetError(error)) {
    const status = {
      ASSET_CONFLICT: 409,
      ASSET_DUPLICATE: 409,
      ASSET_INTEGRITY_FAILED: 409,
      ASSET_NOT_FOUND: 404,
      ASSET_STORAGE_UNAVAILABLE: 503,
      ASSET_TOO_LARGE: 413,
      ASSET_UNSUPPORTED_TYPE: 415,
      ASSET_UPLOAD_INVALID: 400,
      ASSET_VALIDATION_FAILED: 400,
    }[error.code];
    return noStoreAssetJson({ ok: false, code: error.code }, { status });
  }

  console.error("[assets] request failed", "UNEXPECTED_ERROR");
  return noStoreAssetJson(
    { ok: false, code: "ASSET_UNAVAILABLE" },
    { status: 500 },
  );
}
