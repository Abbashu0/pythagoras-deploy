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
import { isMaterialQuestionBankError } from "@/server/material-question-bank";
import { isQuestionImportError } from "@/server/question-import";
import { isQuestionEditorError } from "@/server/question-editor";
import { isQuestionDomainError } from "@/server/questions";
import { isQuestionSearchError } from "@/server/question-search";
import { isAIAdminDirectError } from "@/server/ai/admin-direct-service";
import { isEphemeralModelChatError } from "@/server/ai/ephemeral-model-chat-service";
import { isAIProviderConfigError } from "@/server/ai/configuration";
import { isAIModelConfigError } from "@/server/ai/model-registry";
import { isAISecretStoreError } from "@/server/ai/secrets";

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
  if (isEphemeralModelChatError(error)) {
    const status =
      error.code === "AI_EPHEMERAL_MODEL_NOT_FOUND"
        ? 404
        : error.code === "AI_EPHEMERAL_PROVIDER_NOT_READY" ||
            error.code === "AI_EPHEMERAL_MODEL_UNAVAILABLE"
          ? 409
          : error.code === "AI_EPHEMERAL_CHAT_FAILED"
            ? error.providerErrorCode === "TIMEOUT"
              ? 504
              : 502
            : 400;
    return localJson(
      {
        ok: false,
        code: error.code,
        ...(error.providerErrorCode
          ? { errorCode: error.providerErrorCode }
          : {}),
      },
      { status },
    );
  }

  if (isAIAdminDirectError(error)) {
    const status =
      error.code.endsWith("_NOT_FOUND")
        ? 404
        : error.code.endsWith("_CONFLICT") ||
            error.code.endsWith("_BLOCKED") ||
            error.code === "AI_ADMIN_PROVIDER_NOT_READY"
          ? 409
          : error.code === "AI_ADMIN_MODEL_TEST_FAILED"
            ? 422
            : 400;
    return localJson(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      { status },
    );
  }

  if (isAIProviderConfigError(error) || isAIModelConfigError(error)) {
    const conflict = error.code.endsWith("_CONFLICT");
    return localJson(
      { ok: false, code: error.code },
      { status: conflict ? 409 : 400 },
    );
  }

  if (isAISecretStoreError(error)) {
    const status =
      error.code === "AI_SECRET_INPUT_INVALID" || error.code === "AI_SECRET_REF_INVALID"
        ? 400
        : error.code === "AI_SECRET_CONFLICT" || error.code === "AI_SECRET_VERSION_CHANGED"
          ? 409
          : 503;
    return localJson({ ok: false, code: error.code }, { status });
  }

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

  if (isMaterialQuestionBankError(error)) {
    const status =
      error.code === "MATERIAL_BANK_NOT_FOUND"
        ? 404
        : error.code === "MATERIAL_BANK_CONFLICT"
          ? 409
          : 400;
    return localJson({ ok: false, code: error.code }, { status });
  }

  if (isQuestionImportError(error)) {
    const status =
      error.code === "QUESTION_IMPORT_NOT_FOUND"
        ? 404
        : error.code === "QUESTION_IMPORT_CONFLICT"
          ? 409
          : 400;
    return localJson({ ok: false, code: error.code }, { status });
  }

  if (isQuestionEditorError(error)) {
    const status = error.code === "QUESTION_EDITOR_NOT_FOUND"
      ? 404
      : error.code === "QUESTION_EDITOR_CONFLICT"
        ? 409
        : error.code === "QUESTION_EDITOR_FORBIDDEN"
          ? 403
          : 400;
    return localJson({ ok: false, code: error.code }, { status });
  }

  if (isQuestionDomainError(error)) {
    return localJson(
      { ok: false, code: error.code },
      { status: error.code === "QUESTION_DOMAIN_NOT_FOUND" ? 404 : error.code === "QUESTION_DOMAIN_CONFLICT" ? 409 : 400 },
    );
  }

  if (isQuestionSearchError(error)) {
    return localJson({ ok: false, code: error.code }, { status: 400 });
  }

  console.error("[local-admin] request failed", "UNEXPECTED_ERROR");
  return localJson({ ok: false, code: "LOCAL_ADMIN_UNAVAILABLE" }, { status: 500 });
}
