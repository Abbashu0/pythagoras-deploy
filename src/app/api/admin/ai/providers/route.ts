import { v7 as uuidv7 } from "uuid";
import type { NextRequest } from "next/server";

import {
  AIProviderConfigError,
  normalizeAIProviderConfigContent,
  SQLiteAIProviderConfigRepository,
  toSafeAIProviderConfigDTO,
} from "@/server/ai/configuration";
import { publishAIAdminChange } from "@/server/ai/admin-governed-config";
import { assertTrustedMutationRequest, getAdminActor, isAdminAuthError } from "@/server/admin-auth";
import { AISecretStoreError, createLocalAISecretStore } from "@/server/ai/secrets";
import { getContentDatabase } from "@/server/content";
import { isChangeManagementError } from "@/server/change-management";
import { aiJson, readAIJson, requireAIOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SECRET_BYTES = 16 * 1024;

export async function POST(request: NextRequest) {
  let createdCredentialRef: string | null = null;
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireAIOwner(request);
    const body = await readAIJson(request, 24 * 1024);
    if (typeof body.secret !== "string" || !body.secret.length || Buffer.byteLength(body.secret, "utf8") > MAX_SECRET_BYTES) {
      return aiJson({ ok: false, code: "AI_SECRET_INPUT_INVALID" }, { status: 400 });
    }

    const database = getContentDatabase();
    const providers = new SQLiteAIProviderConfigRepository(database);
    const candidate = normalizeAIProviderConfigContent({
      key: body.key,
      displayName: body.displayName,
      baseUrl: body.baseUrl,
      credentialRef: uuidv7(),
      enabled: true,
      retentionPolicy: body.retentionPolicy,
      trainingPolicy: body.trainingPolicy,
      zdrSupported: body.zdrSupported,
      zdrRequired: body.zdrRequired,
    });
    if (providers.getByKey(candidate.key)) {
      return aiJson({ ok: false, code: "AI_PROVIDER_KEY_CONFLICT" }, { status: 409 });
    }

    const secrets = createLocalAISecretStore(database);
    const secret = await secrets.create({
      secret: body.secret,
      actor: { type: "ADMIN", actorUserId: getAdminActor(authentication).actorUserId },
    });
    createdCredentialRef = secret.credentialRef;
    const actor = getAdminActor(authentication);
    const providerId = uuidv7();
    publishAIAdminChange({
      title: `Add AI Provider: ${candidate.displayName}`,
      description: "Owner-published Provider configuration from the Admin Control Center.",
      resourceType: "ai.provider-config",
      resourceId: providerId,
      expectedRevision: 0,
      operation: "CREATE",
      desired: { ...candidate, credentialRef: secret.credentialRef },
      actor,
    });
    const provider = providers.getById(providerId);
    if (!provider) throw new Error("Published Provider configuration could not be read.");
    createdCredentialRef = null;
    return aiJson({ ok: true, provider: toSafeAIProviderConfigDTO(provider, "ACTIVE"), messageCode: "AI_PROVIDER_CREATED" }, { status: 201 });
  } catch (error) {
    if (createdCredentialRef) {
      try {
        await createLocalAISecretStore(getContentDatabase()).revoke({ credentialRef: createdCredentialRef, actor: { type: "SYSTEM" } });
      } catch {
        console.error("[admin-ai] orphaned provider credential cleanup failed", "UNEXPECTED_ERROR");
      }
    }
    if (isAdminAuthError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
    if (error instanceof AIProviderConfigError) return aiJson({ ok: false, code: error.code }, { status: error.code === "AI_PROVIDER_CONFIG_CONFLICT" ? 409 : 400 });
    if (isChangeManagementError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "CHANGE_AUTHORIZATION_FAILED" ? 403 : error.code === "CHANGE_CONFLICT" ? 409 : 400 });
    if (error instanceof AISecretStoreError) return aiJson({ ok: false, code: error.code }, { status: error.code === "AI_SECRET_INPUT_INVALID" ? 400 : 503 });
    if (error instanceof Error && ["AI_BODY_TOO_LARGE", "AI_BODY_INVALID"].includes(error.message)) return aiJson({ ok: false, code: error.message }, { status: error.message === "AI_BODY_TOO_LARGE" ? 413 : 400 });
    console.error("[admin-ai] provider creation failed", "UNEXPECTED_ERROR");
    return aiJson({ ok: false, code: "AI_PROVIDER_CREATE_FAILED" }, { status: 503 });
  }
}
