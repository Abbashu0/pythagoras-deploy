import type { NextRequest } from "next/server";

import { AIProviderConfigError, SQLiteAIProviderConfigRepository, toSafeAIProviderConfigDTO } from "@/server/ai/configuration";
import { SQLiteAISecretMetadataRepository } from "@/server/ai/secrets";
import { publishAIAdminChange } from "@/server/ai/admin-governed-config";
import { assertTrustedMutationRequest, getAdminActor, isAdminAuthError } from "@/server/admin-auth";
import { createLocalAISecretStore, AISecretStoreError } from "@/server/ai/secrets";
import { getContentDatabase } from "@/server/content";
import { aiJson, readAIJson, requireAIOwner } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ providerId: string }> }) {
  let providerId = "";
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireAIOwner(request);
    ({ providerId } = await context.params);
    const body = await readAIJson(request, 8 * 1024);
    if (typeof body.enabled !== "boolean" || !Number.isSafeInteger(body.expectedRevision)) return aiJson({ ok: false, code: "AI_PROVIDER_UPDATE_INVALID" }, { status: 400 });
    const database = getContentDatabase();
    const providers = new SQLiteAIProviderConfigRepository(database);
    const provider = providers.getById(providerId);
    if (!provider) return aiJson({ ok: false, code: "AI_PROVIDER_NOT_FOUND" }, { status: 404 });
    if (body.expectedRevision !== provider.revision) return aiJson({ ok: false, code: "AI_PROVIDER_CONFIG_CONFLICT" }, { status: 409 });
    if (body.enabled) {
      const credential = provider.credentialRef ? new SQLiteAISecretMetadataRepository(database).get(provider.credentialRef) : null;
      if (!credential || credential.status !== "ACTIVE") return aiJson({ ok: false, code: "AI_PROVIDER_NOT_READY" }, { status: 409 });
    }
    publishAIAdminChange({
      title: `${body.enabled ? "Enable" : "Disable"} AI Provider: ${provider.displayName}`,
      resourceType: "ai.provider-config",
      resourceId: provider.id,
      expectedRevision: provider.revision,
      operation: "UPDATE",
      desired: providerContent(provider, body.enabled),
      actor: getAdminActor(authentication),
    });
    const updated = providers.getById(provider.id);
    if (!updated) throw new Error("Updated Provider configuration could not be read.");
    return aiJson({ ok: true, provider: toSafeAIProviderConfigDTO(updated, updated.credentialRef ? "ACTIVE" : "NOT_CONFIGURED"), messageCode: "AI_PROVIDER_UPDATED" });
  } catch (error) {
    if (isAdminAuthError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
    if (error instanceof AIProviderConfigError) return aiJson({ ok: false, code: error.code }, { status: 409 });
    console.error("[admin-ai] provider update failed", providerId ? "KNOWN_PROVIDER" : "UNKNOWN_PROVIDER");
    return aiJson({ ok: false, code: "AI_PROVIDER_UPDATE_FAILED" }, { status: 409 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ providerId: string }> }) {
  let providerId = "";
  try {
    assertTrustedMutationRequest(_request);
    const authentication = requireAIOwner(_request);
    ({ providerId } = await context.params);
    const database = getContentDatabase();
    const providers = new SQLiteAIProviderConfigRepository(database);
    const provider = providers.getById(providerId);
    if (!provider) return aiJson({ ok: false, code: "AI_PROVIDER_NOT_FOUND" }, { status: 404 });

    const dependentModels = database.client.prepare("select count(*) as count from ai_model_configs where provider_config_id = ?").get(providerId) as { count: number };
    if (Number(dependentModels?.count ?? 0) > 0) return aiJson({ ok: false, code: "AI_PROVIDER_HAS_MODELS" }, { status: 409 });

    // Deletion is a dependency-checked lifecycle operation. First publish the
    // governed disabled state so the audit/publication stream records the
    // retirement; only then remove the now-unreferenced identity.
    const previousCredentialRef = provider.credentialRef;
    if (provider.enabled || provider.credentialRef !== null) {
      publishAIAdminChange({
        title: `Retire AI Provider: ${provider.displayName}`,
        description: "Owner-published retirement of an unreferenced Provider configuration.",
        resourceType: "ai.provider-config",
        resourceId: provider.id,
        expectedRevision: provider.revision,
        operation: "UPDATE",
        desired: providerContent(provider, false, null),
        actor: getAdminActor(authentication),
      });
    }
    const disabled = providers.getById(provider.id);
    if (!disabled) throw new Error("Retired Provider configuration could not be read.");
    const removed = providers.remove({ id: disabled.id, expectedRevision: disabled.revision });
    if (previousCredentialRef && !hasOtherProviderReference(database, previousCredentialRef)) {
      try {
        await createLocalAISecretStore(database).revoke({ credentialRef: previousCredentialRef, actor: { type: "ADMIN", actorUserId: getAdminActor(authentication).actorUserId } });
      } catch (error) {
        if (!(error instanceof AISecretStoreError && error.code === "AI_SECRET_NOT_FOUND")) {
          console.error("[admin-ai] removed provider credential cleanup failed", "UNEXPECTED_ERROR");
        }
      }
    }
    return aiJson({ ok: true, providerId: removed.id, messageCode: "AI_PROVIDER_REMOVED" });
  } catch (error) {
    if (isAdminAuthError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
    if (error instanceof AIProviderConfigError) return aiJson({ ok: false, code: error.code }, { status: error.code === "AI_PROVIDER_CONFIG_NOT_FOUND" ? 404 : 409 });
    console.error("[admin-ai] provider removal failed", providerId ? "KNOWN_PROVIDER" : "UNKNOWN_PROVIDER");
    return aiJson({ ok: false, code: "AI_PROVIDER_REMOVE_FAILED" }, { status: 409 });
  }
}

function hasOtherProviderReference(database: ReturnType<typeof getContentDatabase>, credentialRef: string): boolean {
  const row = database.client.prepare("select count(*) as count from ai_provider_configs where credential_ref = ?").get(credentialRef) as { count: number };
  return Number(row?.count ?? 0) > 0;
}

function providerContent(provider: NonNullable<ReturnType<SQLiteAIProviderConfigRepository["getById"]>>, enabled: boolean, credentialRef = provider.credentialRef) {
  return { key: provider.key, displayName: provider.displayName, baseUrl: provider.baseUrl, credentialRef, enabled, retentionPolicy: provider.retentionPolicy, trainingPolicy: provider.trainingPolicy, zdrSupported: provider.zdrSupported, zdrRequired: provider.zdrRequired };
}
