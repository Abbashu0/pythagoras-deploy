import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminAuthService,
  getAdminSessionTokenFromRequest,
  isAdminAuthError,
  requireAdmin,
  type AdminAuthentication,
} from "@/server/admin-auth";
import { isChangeManagementError } from "@/server/change-management";
import { isMaterialQuestionBankError } from "@/server/material-question-bank";

const MAX_LAYOUT_BYTES = 256 * 1024;

export function requireMaterialBankAdmin(request: NextRequest): AdminAuthentication {
  return requireAdmin(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
}

export async function readMaterialBankBody(request: NextRequest): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_LAYOUT_BYTES) throw new Error("MATERIAL_BANK_BODY_TOO_LARGE");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("MATERIAL_BANK_BODY_INVALID");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_LAYOUT_BYTES) throw new Error("MATERIAL_BANK_BODY_TOO_LARGE");
  return body as Record<string, unknown>;
}

export function materialBankJson(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function materialBankApiError(error: unknown) {
  if (isAdminAuthError(error)) return materialBankJson({ ok: false, code: error.code }, error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403);
  if (isMaterialQuestionBankError(error)) {
    const status = error.code === "MATERIAL_BANK_NOT_FOUND" ? 404 : error.code === "MATERIAL_BANK_CONFLICT" ? 409 : 400;
    return materialBankJson({ ok: false, code: error.code }, status);
  }
  if (isChangeManagementError(error)) {
    const status = error.code === "CHANGE_NOT_FOUND" ? 404 : error.code === "CHANGE_AUTHORIZATION_FAILED" ? 403 : error.code === "CHANGE_CONFLICT" || error.code === "CHANGE_INVALID_STATE" ? 409 : 400;
    return materialBankJson({ ok: false, code: error.code }, status);
  }
  if (error instanceof Error && error.message === "MATERIAL_BANK_BODY_TOO_LARGE") return materialBankJson({ ok: false, code: error.message }, 413);
  if (error instanceof Error && error.message === "MATERIAL_BANK_BODY_INVALID") return materialBankJson({ ok: false, code: error.message }, 400);
  console.error("[material-question-bank] request failed", "UNEXPECTED_ERROR");
  return materialBankJson({ ok: false, code: "MATERIAL_BANK_UNAVAILABLE" }, 500);
}
