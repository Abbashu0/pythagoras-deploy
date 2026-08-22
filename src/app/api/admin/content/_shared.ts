import { NextResponse, type NextRequest } from "next/server";
import { getAdminAuthService, getAdminSessionTokenFromRequest, isAdminAuthError, requireAdmin, requireOwner } from "@/server/admin-auth";
import { isCanonicalContentError } from "@/server/canonical-content";
import { isChangeManagementError } from "@/server/change-management";

export function requireCanonicalAdmin(request: NextRequest) {
  return requireAdmin(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
}

export function requireCanonicalOwner(request: NextRequest) {
  return requireOwner(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
}

export function contentJson(body: Record<string, unknown>, init?: { status?: number }) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function contentApiError(error: unknown) {
  if (isAdminAuthError(error)) return contentJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
  if (isCanonicalContentError(error)) {
    const status = error.code === "CANONICAL_NOT_FOUND" ? 404 : error.code === "CANONICAL_CONFLICT" ? 409 : error.code === "CANONICAL_AUTHORIZATION_FAILED" ? 403 : 400;
    return contentJson({ ok: false, code: error.code }, { status });
  }
  if (isChangeManagementError(error)) {
    const status = error.code === "CHANGE_CONFLICT" ? 409 : error.code === "CHANGE_AUTHORIZATION_FAILED" ? 403 : error.code === "CHANGE_NOT_FOUND" ? 404 : 400;
    return contentJson({ ok: false, code: error.code }, { status });
  }
  console.error("[canonical-content] request failed", "UNEXPECTED_ERROR");
  return contentJson({ ok: false, code: "CANONICAL_UNAVAILABLE" }, { status: 500 });
}
