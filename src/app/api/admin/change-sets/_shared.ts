import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminAuthService,
  getAdminSessionTokenFromRequest,
  isAdminAuthError,
  requireAdmin,
  requireOwner,
  type AdminAuthentication,
} from "@/server/admin-auth";
import { isChangeManagementError } from "@/server/change-management";

const MAX_CHANGE_REQUEST_BYTES = 128 * 1024;

export function requireChangeAdmin(request: NextRequest): AdminAuthentication {
  return requireAdmin(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
}

export function requireChangeOwner(request: NextRequest): AdminAuthentication {
  return requireOwner(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
}

export async function readChangeJson(request: NextRequest): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_CHANGE_REQUEST_BYTES) throw new Error("CHANGE_BODY_TOO_LARGE");
  let body: unknown;
  try { body = await request.json(); }
  catch { throw new Error("CHANGE_BODY_INVALID"); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("CHANGE_BODY_INVALID");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_CHANGE_REQUEST_BYTES) throw new Error("CHANGE_BODY_TOO_LARGE");
  return body as Record<string, unknown>;
}

export function changeJson(body: Record<string, unknown>, init?: { status?: number }): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function changeApiError(error: unknown): NextResponse {
  if (isAdminAuthError(error)) {
    const status = error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403;
    return changeJson({ ok: false, code: error.code }, { status });
  }
  if (isChangeManagementError(error)) {
    const status = {
      CHANGE_AUTHORIZATION_FAILED: 403,
      CHANGE_CONFLICT: 409,
      CHANGE_INVALID_STATE: 409,
      CHANGE_NOT_FOUND: 404,
      CHANGE_VALIDATION_FAILED: 400,
      CHANGE_RESOURCE_UNSUPPORTED: 400,
      CHANGE_PUBLICATION_FAILED: 503,
    }[error.code];
    return changeJson({ ok: false, code: error.code }, { status });
  }
  if (error instanceof Error && error.message === "CHANGE_BODY_TOO_LARGE") return changeJson({ ok: false, code: "CHANGE_BODY_TOO_LARGE" }, { status: 413 });
  if (error instanceof Error && error.message === "CHANGE_BODY_INVALID") return changeJson({ ok: false, code: "CHANGE_BODY_INVALID" }, { status: 400 });
  console.error("[change-management] request failed", "UNEXPECTED_ERROR");
  return changeJson({ ok: false, code: "CHANGE_UNAVAILABLE" }, { status: 500 });
}

export function integer(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}
