import { NextResponse, type NextRequest } from "next/server";
import {
  AdminValidationError,
  assertLocalAdminRequest,
  assertTrustedLocalAdminMutationRequest,
  getLocalAdminActor,
  isAdminAuthError,
} from "@/server/admin-auth";
import { isAssetError } from "@/server/assets";
import { isCanonicalContentError } from "@/server/canonical-content";
import { getContentDatabase } from "@/server/content";

const LOCAL_JSON_MAX_BYTES = 64 * 1024;

export function requireLocalAdminRead(request: NextRequest): void {
  assertLocalAdminRequest(request);
}

export function requireLocalAdminMutation(request: NextRequest) {
  assertTrustedLocalAdminMutationRequest(request);
  return getLocalAdminActor(getContentDatabase());
}

export async function readLocalJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new AdminValidationError("A JSON request body is required.");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > LOCAL_JSON_MAX_BYTES) {
    throw new AdminValidationError("The request body is too large.");
  }

  const body = await request.text();
  if (!body || Buffer.byteLength(body, "utf8") > LOCAL_JSON_MAX_BYTES) {
    throw new AdminValidationError("The request body is invalid.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new AdminValidationError("The request body is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AdminValidationError("The request body is invalid.");
  }
  return parsed as Record<string, unknown>;
}

export function localJson(
  body: Record<string, unknown>,
  init?: { status?: number },
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function localApiError(error: unknown): NextResponse {
  if (isAdminAuthError(error)) {
    return localJson(
      { ok: false, code: error.code },
      { status: error.code === "ADMIN_UNTRUSTED_ORIGIN" ? 403 : 400 },
    );
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
    return localJson({ ok: false, code: error.code }, { status });
  }

  if (isCanonicalContentError(error)) {
    const status =
      error.code === "CANONICAL_NOT_FOUND"
        ? 404
        : error.code === "CANONICAL_CONFLICT"
          ? 409
          : 400;
    return localJson({ ok: false, code: error.code }, { status });
  }

  console.error("[local-admin] request failed", "UNEXPECTED_ERROR");
  return localJson({ ok: false, code: "LOCAL_ADMIN_UNAVAILABLE" }, { status: 500 });
}
