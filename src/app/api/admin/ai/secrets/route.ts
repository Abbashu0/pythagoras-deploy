import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor, isAdminAuthError } from "@/server/admin-auth";
import { AISecretStoreError, createLocalAISecretStore } from "@/server/ai/secrets";
import { publishAIAdminChange } from "@/server/ai/admin-governed-config";
import { SQLiteAIProviderConfigRepository } from "@/server/ai/configuration";
import { getContentDatabase } from "@/server/content";
import { aiJson, readAIJson, requireAIOwner } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireAIOwner(request);
    const providerId = request.nextUrl.searchParams.get("providerId");
    if (!providerId) return aiJson({ ok: false, code: "AI_PROVIDER_NOT_FOUND" }, { status: 400 });
    const database = getContentDatabase();
    const providers = new SQLiteAIProviderConfigRepository(database);
    const provider = providers.getById(providerId);
    if (!provider) return aiJson({ ok: false, code: "AI_PROVIDER_NOT_FOUND" }, { status: 404 });
    if (!provider.credentialRef) return aiJson({ ok: true, messageCode: "AI_SECRET_ALREADY_REVOKED" });
    const credentialRef = provider.credentialRef;
    publishAIAdminChange({
      title: `Revoke AI Provider credential: ${provider.displayName}`,
      description: "Owner-published Provider disable and credential detachment.",
      resourceType: "ai.provider-config",
      resourceId: provider.id,
      expectedRevision: provider.revision,
      desired: providerContent(provider, null, false),
      operation: "UPDATE",
      actor: getAdminActor(authentication),
    });
    try { await createLocalAISecretStore(database).revoke({ credentialRef, actor: { type: "ADMIN", actorUserId: getAdminActor(authentication).actorUserId } }); } catch { /* already revoked is safe */ }
    return aiJson({ ok: true, messageCode: "AI_SECRET_REVOKED" });
  } catch (error) {
    if (isAdminAuthError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
    if (error instanceof Error && ["AI_BODY_TOO_LARGE", "AI_BODY_INVALID"].includes(error.message)) return aiJson({ ok: false, code: error.message }, { status: 400 });
    console.error("[admin-ai] secret revocation failed", "UNEXPECTED_ERROR");
    return aiJson({ ok: false, code: "AI_SECRET_STORE_UNAVAILABLE" }, { status: 409 });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireAIOwner(request);
    const body = await readAIJson(request, 20 * 1024);
    if (typeof body.secret !== "string" || !body.secret.length || Buffer.byteLength(body.secret, "utf8") > 16 * 1024) return aiJson({ ok: false, code: "AI_SECRET_INPUT_INVALID" }, { status: 400 });
    const database = getContentDatabase();
    const actor = getAdminActor(authentication);
    const providerId = typeof body.providerId === "string" ? body.providerId : null;
    if (providerId) {
      const providers = new SQLiteAIProviderConfigRepository(database);
      const provider = providers.getById(providerId);
      if (!provider) return aiJson({ ok: false, code: "AI_PROVIDER_NOT_FOUND" }, { status: 404 });
      const secret = await createLocalAISecretStore(database).create({ secret: body.secret, actor: { type: "ADMIN", actorUserId: actor.actorUserId } });
      try {
        publishAIAdminChange({
          title: `Rotate AI Provider credential: ${provider.displayName}`,
          description: "Owner-published credential reference replacement.",
          resourceType: "ai.provider-config",
          resourceId: provider.id,
          expectedRevision: provider.revision,
          desired: providerContent(provider, secret.credentialRef),
          operation: "UPDATE",
          actor,
        });
      } catch (error) {
        try { await createLocalAISecretStore(database).revoke({ credentialRef: secret.credentialRef, actor: { type: "SYSTEM" } }); } catch { /* preserve the primary publication error */ }
        throw error;
      }
      if (provider.credentialRef && provider.credentialRef !== secret.credentialRef && !hasOtherProviderReference(database, provider.credentialRef)) {
        try { await createLocalAISecretStore(database).revoke({ credentialRef: provider.credentialRef, actor: { type: "ADMIN", actorUserId: actor.actorUserId } }); } catch { /* old credential is no longer referenced */ }
      }
      return aiJson({ ok: true, credentialRef: secret.credentialRef, secretVersion: secret.secretVersion, messageCode: "AI_SECRET_CONFIGURED" }, { status: 201 });
    }
    const secret = await createLocalAISecretStore(database).create({ secret: body.secret, actor: { type: "ADMIN", actorUserId: actor.actorUserId } });
    return aiJson({ ok: true, credentialRef: secret.credentialRef, secretVersion: secret.secretVersion, messageCode: "AI_SECRET_CONFIGURED" }, { status: 201 });
  } catch (error) {
    if (isAdminAuthError(error)) return aiJson({ ok: false, code: error.code }, { status: error.code === "ADMIN_AUTH_REQUIRED" ? 401 : 403 });
    if (error instanceof AISecretStoreError) return aiJson({ ok: false, code: error.code }, { status: error.code === "AI_SECRET_INPUT_INVALID" ? 400 : 503 });
    if (error instanceof Error && ["AI_BODY_TOO_LARGE", "AI_BODY_INVALID"].includes(error.message)) return aiJson({ ok: false, code: error.message }, { status: error.message === "AI_BODY_TOO_LARGE" ? 413 : 400 });
    console.error("[admin-ai] secret operation failed", "UNEXPECTED_ERROR");
    return aiJson({ ok: false, code: "AI_SECRET_STORE_UNAVAILABLE" }, { status: 503 });
  }
}

function providerContent(provider: NonNullable<ReturnType<SQLiteAIProviderConfigRepository["getById"]>>, credentialRef: string | null, enabled = provider.enabled) {
  return { key: provider.key, displayName: provider.displayName, baseUrl: provider.baseUrl, credentialRef, enabled, retentionPolicy: provider.retentionPolicy, trainingPolicy: provider.trainingPolicy, zdrSupported: provider.zdrSupported, zdrRequired: provider.zdrRequired };
}

function hasOtherProviderReference(database: ReturnType<typeof getContentDatabase>, credentialRef: string): boolean {
  const row = database.client.prepare("select count(*) as count from ai_provider_configs where credential_ref = ?").get(credentialRef) as { count: number };
  return Number(row?.count ?? 0) > 0;
}
