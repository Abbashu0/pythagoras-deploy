import { NextResponse, type NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminAuthService, getAdminSessionTokenFromRequest, isAdminAuthError, requireAdmin, requireOwner, type AdminAuthentication } from "@/server/admin-auth";
import { AITelemetryError } from "@/server/ai/telemetry";

export function requireAIAdmin(request: NextRequest) {
  return requireAdmin(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
}

export function requireAIOwner(request: NextRequest): AdminAuthentication {
  return requireOwner(getAdminAuthService().authenticateSessionToken(getAdminSessionTokenFromRequest(request)));
}

export function assertAITrustedMutation(request: NextRequest): void {
  assertTrustedMutationRequest(request);
}

export async function readAIJson(request: NextRequest, maxBytes = 24 * 1024): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("AI_BODY_TOO_LARGE");
  const text = await request.text();
  if (!text || Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("AI_BODY_TOO_LARGE");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("AI_BODY_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI_BODY_INVALID");
  return value as Record<string, unknown>;
}

export function aiJson(body: Record<string, unknown>, init?: { status?: number }): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function aiApiError(error: unknown): NextResponse {
  if (isAdminAuthError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
  if (error instanceof AITelemetryError) return aiJson({ ok: false, code: error.code }, { status: error.code === "AI_TELEMETRY_RANGE_INVALID" ? 400 : 409 });
  if (error instanceof Error && error.message === "AI_BODY_TOO_LARGE") return aiJson({ ok: false, code: "AI_BODY_TOO_LARGE" }, { status: 413 });
  if (error instanceof Error && error.message === "AI_BODY_INVALID") return aiJson({ ok: false, code: "AI_BODY_INVALID" }, { status: 400 });
  console.error("[admin-ai] request failed", "UNEXPECTED_ERROR");
  return aiJson({ ok: false, code: "ADMIN_AI_UNAVAILABLE" }, { status: 500 });
}
