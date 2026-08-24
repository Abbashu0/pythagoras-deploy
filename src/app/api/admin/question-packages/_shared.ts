import { NextResponse, type NextRequest } from "next/server";
import { getAdminAuthService, getAdminSessionTokenFromRequest, isAdminAuthError, requireAdmin, type AdminAuthentication } from "@/server/admin-auth";
import { isChangeManagementError } from "@/server/change-management";
import { isQuestionImportError, QuestionImportError } from "@/server/question-import";

export function requireQuestionAdmin(request: NextRequest): AdminAuthentication {
  return requireAdmin(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
}
export function questionJson(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
export async function readQuestionBody(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 16 * 1024) throw new QuestionImportError("QUESTION_IMPORT_INVALID", "Request is too large.");
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new QuestionImportError("QUESTION_IMPORT_INVALID", "Request body is invalid.");
  return body as Record<string, unknown>;
}
export function questionApiError(error: unknown) {
  if (isAdminAuthError(error)) return questionJson({ ok: false, code: error.code }, error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403);
  if (isQuestionImportError(error)) {
    const status = error.code === "QUESTION_IMPORT_NOT_FOUND" ? 404 : error.code === "QUESTION_IMPORT_CONFLICT" ? 409 : 400;
    return questionJson({ ok: false, code: error.code }, status);
  }
  if (isChangeManagementError(error)) return questionJson({ ok: false, code: error.code }, error.code === "CHANGE_CONFLICT" ? 409 : 400);
  console.error("[question-import] request failed", "UNEXPECTED_ERROR");
  return questionJson({ ok: false, code: "QUESTION_IMPORT_UNAVAILABLE" }, 500);
}
