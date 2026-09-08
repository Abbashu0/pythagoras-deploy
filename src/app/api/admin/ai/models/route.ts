import type { NextRequest } from "next/server";

import {
  AIModelConfigError,
  normalizeAIModelConfigContent,
  SQLiteAIModelConfigRepository,
  toSafeAIModelConfigDTO,
} from "@/server/ai/model-registry";
import { publishAIAdminChange } from "@/server/ai/admin-governed-config";
import { assertTrustedMutationRequest, isAdminAuthError } from "@/server/admin-auth";
import { SQLiteAIProviderConfigRepository } from "@/server/ai/configuration";
import { SQLiteAISecretMetadataRepository } from "@/server/ai/secrets";
import { getContentDatabase } from "@/server/content";
import { isChangeManagementError } from "@/server/change-management";
import { aiJson, readAIJson, requireAIOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireAIOwner(request);
    const body = await readAIJson(request);
    const content = normalizeAIModelConfigContent({
      key: body.key,
      displayName: body.displayName,
      providerConfigId: body.providerConfigId,
      providerModelId: body.providerModelId,
      capability: body.capability,
      adapterKey: body.adapterKey,
      enabled: true,
      contextWindowTokens: body.contextWindowTokens,
      maxOutputTokens: body.maxOutputTokens,
      embeddingDimensions: body.embeddingDimensions,
      supportsStreaming: body.supportsStreaming,
      supportsReasoning: body.supportsReasoning,
      supportsStructuredOutput: body.supportsStructuredOutput,
    });

    const database = getContentDatabase();
    const models = new SQLiteAIModelConfigRepository(database);
    if (models.getByKey(content.key)) return aiJson({ ok: false, code: "AI_MODEL_KEY_CONFLICT" }, { status: 409 });

    const provider = new SQLiteAIProviderConfigRepository(database).getById(content.providerConfigId);
    if (!provider) return aiJson({ ok: false, code: "AI_PROVIDER_NOT_FOUND" }, { status: 404 });
    if (!provider.enabled || !provider.credentialRef) return aiJson({ ok: false, code: "AI_PROVIDER_NOT_READY" }, { status: 409 });
    const credential = new SQLiteAISecretMetadataRepository(database).get(provider.credentialRef);
    if (!credential || credential.status !== "ACTIVE") return aiJson({ ok: false, code: "AI_PROVIDER_NOT_READY" }, { status: 409 });

    const actor = { actorUserId: authentication.user.id, actorRole: "OWNER" as const };
    const modelId = crypto.randomUUID();
    publishAIAdminChange({
      title: `Add AI Model: ${content.displayName}`,
      description: "Owner-published Model configuration from the Admin Control Center.",
      resourceType: "ai.model-config",
      resourceId: modelId,
      expectedRevision: 0,
      operation: "CREATE",
      desired: content,
      actor,
    });
    const model = models.getById(modelId);
    if (!model) throw new Error("Published Model configuration could not be read.");
    return aiJson({ ok: true, model: toSafeAIModelConfigDTO(model), messageCode: "AI_MODEL_CREATED" }, { status: 201 });
  } catch (error) {
    if (isAdminAuthError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
    if (error instanceof AIModelConfigError) return aiJson({ ok: false, code: error.code }, { status: error.code === "AI_MODEL_CONFIG_CONFLICT" ? 409 : 400 });
    if (isChangeManagementError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "CHANGE_AUTHORIZATION_FAILED" ? 403 : error.code === "CHANGE_CONFLICT" ? 409 : 400 });
    if (error instanceof Error && ["AI_BODY_TOO_LARGE", "AI_BODY_INVALID"].includes(error.message)) return aiJson({ ok: false, code: error.message }, { status: error.message === "AI_BODY_TOO_LARGE" ? 413 : 400 });
    console.error("[admin-ai] model creation failed", "UNEXPECTED_ERROR");
    return aiJson({ ok: false, code: "AI_MODEL_CREATE_FAILED" }, { status: 503 });
  }
}
