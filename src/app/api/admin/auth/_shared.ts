import { NextResponse } from "next/server";
import {
  isAdminAuthError,
} from "@/server/admin-auth";

export function noStoreJson(
  body: Record<string, unknown>,
  init?: { status?: number; headers?: HeadersInit },
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export function adminAuthErrorResponse(
  error: unknown,
  operation: "setup" | "login" | "logout",
): NextResponse {
  if (isAdminAuthError(error)) {
    switch (error.code) {
      case "ADMIN_UNTRUSTED_ORIGIN":
        return noStoreJson({ ok: false, code: error.code }, { status: 403 });
      case "ADMIN_INVALID_INPUT":
        return noStoreJson({ ok: false, code: error.code }, { status: 400 });
      case "ADMIN_SETUP_UNAVAILABLE":
        return noStoreJson({ ok: false, code: error.code }, { status: 409 });
      case "ADMIN_INVALID_CREDENTIALS":
        return noStoreJson(
          { ok: false, code: error.code, message: "Invalid email or password." },
          { status: 401 },
        );
      case "ADMIN_RATE_LIMITED": {
        const retryAfterSeconds =
          "retryAfterSeconds" in error &&
          typeof error.retryAfterSeconds === "number"
            ? Math.max(1, Math.ceil(error.retryAfterSeconds))
            : 1;
        return noStoreJson(
          { ok: false, code: error.code, retryAfter: retryAfterSeconds },
          {
            status: 429,
            headers: { "Retry-After": String(retryAfterSeconds) },
          },
        );
      }
      default:
        console.error(`[admin-auth] ${operation} failed`, error.code);
        return noStoreJson(
          { ok: false, code: "ADMIN_AUTH_UNAVAILABLE" },
          { status: 500 },
        );
    }
  }

  console.error(`[admin-auth] ${operation} failed`, "UNEXPECTED_ERROR");
  return noStoreJson(
    { ok: false, code: "ADMIN_AUTH_UNAVAILABLE" },
    { status: 500 },
  );
}
