import type { ContentDatabase } from "../../content/database";
import { eq } from "drizzle-orm";
import { aiAgentRuntimeConfigs } from "../../content/schema";
import { SQLiteAIModelConfigRepository } from "../model-registry";
import { SQLiteAIProviderConfigRepository } from "../configuration";
import { createLocalAISecretStore, SQLiteAISecretMetadataRepository, type AISecretStoreAdapter } from "../secrets";
import { createProviderOutboundPolicy, NativeOpenAICompatibleHttpTransport, type AIProviderHttpTransport, type OutboundTargetPolicy } from "../gateway";
import { compileInstructionAuthoring, instructionHash } from "./instruction-compiler";
import type { AIInstructionPolicyRevision } from "./instruction-contracts";
import { compileInstructionSections, instructionBytes } from "@/lib/ai-instruction-sections";

export interface InstructionTokenCount { tokens: number; precision: "exact" | "estimated"; method: "openai-input-tokens" | "anthropic-count-tokens" | "utf8-estimate-v1"; reason: string | null }
export interface InstructionTokenBasis { modelId: string | null; modelName: string | null; modelRevision: number | null; providerId: string | null; providerRevision: number | null; runtimeRevision: number; key: string }
export interface InstructionTokenResult { compiledHash: string; compiledBytes: number; basis: InstructionTokenBasis; total: InstructionTokenCount; sections: Array<InstructionTokenCount & { id: string; contentHash: string }>; scope: "instructions-only-api-input" }
interface TokenOptions { secrets?: AISecretStoreAdapter; transport?: AIProviderHttpTransport; outboundPolicy?: OutboundTargetPolicy; now?: () => number }
/** Bounded, short-lived result cache; contains hashes/counts, never authored text. */
export class InstructionTokenService {
  private readonly cache = new Map<string, { expires: number; count: InstructionTokenCount }>();
  constructor(private readonly database: ContentDatabase, private readonly options: TokenOptions = {}) {}
  countRevision(revision: AIInstructionPolicyRevision, signal?: AbortSignal) {
    return this.count(revision.authoring?.sections ?? [], signal, revision.authoring ? undefined : { id: revision.policyId, text: revision.instructions });
  }
  async count(value: unknown, signal?: AbortSignal, legacy?: { id: string; text: string }): Promise<InstructionTokenResult> {
    const compiled = compileInstructionAuthoring(value, false);
    signal?.throwIfAborted();
    const parts = legacy ? [{ id: legacy.id, text: legacy.text }] : compileInstructionSections(compiled.authoring.sections).parts;
    const executionText = legacy?.text ?? compiled.instructions;
    // Counting reads the saved primary identity only; it never executes the route.
    const runtime = this.database.db.select().from(aiAgentRuntimeConfigs).where(eq(aiAgentRuntimeConfigs.configKey, "agent-1")).get();
    const model = runtime?.primaryModelConfigId ? new SQLiteAIModelConfigRepository(this.database).getById(runtime.primaryModelConfigId) : null;
    const provider = model ? new SQLiteAIProviderConfigRepository(this.database).getById(model.providerConfigId) : null;
    const metadata = provider?.credentialRef ? this.options.secrets ? this.options.secrets.getMetadata(provider.credentialRef) : new SQLiteAISecretMetadataRepository(this.database).get(provider.credentialRef) : null;
    const identity = [model?.id, model?.revision, provider?.id, provider?.revision, metadata?.secretVersion, metadata?.revision, "counter-v1"];
    const basis: InstructionTokenBasis = { modelId: model?.id ?? null, modelName: model?.displayName ?? null, modelRevision: model?.revision ?? null, providerId: provider?.id ?? null, providerRevision: provider?.revision ?? null, runtimeRevision: runtime?.revision ?? 0, key: instructionHash(JSON.stringify(identity)) };
    const nativeKind = officialCounter(provider?.apiFormat, provider?.baseUrl);
    const usable = Boolean(model?.enabled && provider?.enabled && metadata?.status === "ACTIVE");
    let secret: Promise<string> | undefined;
    const countText = async (text: string): Promise<InstructionTokenCount> => {
      signal?.throwIfAborted();
      if (!text) return { tokens: 0, precision: "exact", method: nativeKind === "openai" ? "openai-input-tokens" : "utf8-estimate-v1", reason: null };
      const key = basis.key + ":" + instructionHash(text);
      const now = (this.options.now ?? Date.now)();
      const cached = this.cache.get(key);
      if (cached && cached.expires > now) return cached.count;
      let count = estimateInstructionTokens(text, !model ? "NO_PRIMARY_MODEL" : !nativeKind ? "NO_STANDARD_COUNTER" : "NATIVE_COUNTER_UNAVAILABLE");
      if (nativeKind && usable && model && provider?.credentialRef && metadata) {
        try {
          secret ??= (this.options.secrets ?? createLocalAISecretStore(this.database)).resolveVersion({ credentialRef: provider.credentialRef, expectedSecretVersion: metadata.secretVersion });
          const credential = await secret;
          signal?.throwIfAborted();
          const controllerSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000);
          const target = await (this.options.outboundPolicy ?? createProviderOutboundPolicy()).validate(provider.baseUrl);
          const payload = nativeKind === "openai" ? { model: model.providerModelId, instructions: text, input: [] } : { model: model.providerModelId, system: text, messages: [{ role: "user", content: "." }] };
          const response = await (this.options.transport ?? new NativeOpenAICompatibleHttpTransport()).request(target, {
            method: "POST", pathAndQuery: nativeKind === "openai" ? "responses/input_tokens" : new URL(provider.baseUrl).pathname.replace(/\/$/u, "") === "/v1" ? "messages/count_tokens" : "v1/messages/count_tokens",
            headers: { "content-type": "application/json", ...(nativeKind === "openai" ? { authorization: `Bearer ${credential}` } : { "x-api-key": credential, "anthropic-version": "2023-06-01" }) },
            body: new TextEncoder().encode(JSON.stringify(payload)), signal: controllerSignal, timeoutMs: 8_000,
          });
          let body = "";
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let bytes = 0;
          for await (const chunk of response.body) { controllerSignal.throwIfAborted(); bytes += chunk.byteLength; if (bytes > 8192) throw new Error("COUNT_RESPONSE_LIMIT"); body += decoder.decode(chunk, { stream: true }); }
          body += decoder.decode();
          if (response.status !== 200) throw new Error("COUNT_ENDPOINT_FAILED");
          const result = JSON.parse(body) as { input_tokens?: unknown };
          if (!Number.isSafeInteger(result.input_tokens) || (result.input_tokens as number) < 0) throw new Error("COUNT_RESPONSE_INVALID");
          // OpenAI is exact for this instructions-only framed request, not full chat.
          // Anthropic explicitly documents count_tokens as an estimate (system overhead included).
          count = { tokens: result.input_tokens as number, precision: nativeKind === "openai" ? "exact" : "estimated", method: nativeKind === "openai" ? "openai-input-tokens" : "anthropic-count-tokens", reason: nativeKind === "openai" ? null : "PROVIDER_DOCUMENTED_ESTIMATE" };
        } catch { signal?.throwIfAborted(); }
      }
      if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: now + (count.method === "utf8-estimate-v1" && nativeKind ? 10_000 : 60_000), count });
      return count;
    };
    // At most three section requests in flight; no count call generates a response.
    const sectionCounts: InstructionTokenResult["sections"] = [];
    for (let index = 0; index < parts.length; index += 3) {
      sectionCounts.push(...await Promise.all(parts.slice(index, index + 3).map(async (part) => ({ id: part.id, contentHash: instructionHash(part.text), ...await countText(part.text) }))));
    }
    return { compiledHash: instructionHash(executionText), compiledBytes: instructionBytes(executionText), basis, total: await countText(executionText), sections: sectionCounts, scope: "instructions-only-api-input" };
  }
}
export function estimateInstructionTokens(text: string, reason = "NO_STANDARD_COUNTER"): InstructionTokenCount { return { tokens: Math.ceil(instructionBytes(text) / 3), precision: "estimated", method: "utf8-estimate-v1", reason }; }
export function officialCounter(format?: string, baseUrl?: string): "openai" | "anthropic" | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/$/u, "");
    if (format === "OPENAI_RESPONSES" && url.hostname === "api.openai.com" && path === "/v1") return "openai";
    if (format === "ANTHROPIC_MESSAGES" && url.hostname === "api.anthropic.com" && (path === "/v1" || path === "")) return "anthropic";
  } catch { /* Unknown compatible providers use labelled estimates. */ }
  return null;
}
const services = new WeakMap<ContentDatabase, InstructionTokenService>();
export function getInstructionTokenService(database: ContentDatabase) { let service = services.get(database); if (!service) { service = new InstructionTokenService(database); services.set(database, service); } return service; }
