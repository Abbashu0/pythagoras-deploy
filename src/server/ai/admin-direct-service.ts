import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../admin-auth/contracts";
import type {
  AIProviderApiFormat,
  AIProviderConfig,
  SafeAIProviderConfigDTO,
} from "./configuration";
import {
  normalizeAIProviderConfigContent,
  SQLiteAIProviderConfigRepository,
  toSafeAIProviderConfigDTO,
} from "./configuration";
import type {
  AIModelConfig,
  SafeAIModelConfigDTO,
} from "./model-registry";
import {
  normalizeAIModelConfigContent,
  SQLiteAIModelConfigRepository,
  toSafeAIModelConfigDTO,
} from "./model-registry";
import {
  AIProviderGateway,
  AnthropicMessagesGenerationAdapter,
  OpenAIResponsesGenerationAdapter,
  OpenAICompatibleGenerationAdapter,
  ProviderAdapterRegistry,
  adapterKeyForProviderApiFormat,
  createProviderOutboundPolicy,
  type AIProviderHttpTransport,
  type OutboundTargetPolicy,
} from "./gateway";
import { createLocalAISecretStore } from "./secrets";
import type { AISecretStoreAdapter } from "./secrets";
import type { ContentDatabase } from "../content/database";

export const AI_ADMIN_DIRECT_ERROR_CODES = [
  "AI_ADMIN_INVALID",
  "AI_ADMIN_PROVIDER_NOT_FOUND",
  "AI_ADMIN_MODEL_NOT_FOUND",
  "AI_ADMIN_PROVIDER_KEY_CONFLICT",
  "AI_ADMIN_MODEL_ID_CONFLICT",
  "AI_ADMIN_REVISION_CONFLICT",
  "AI_ADMIN_PROVIDER_DELETE_BLOCKED",
  "AI_ADMIN_MODEL_DELETE_BLOCKED",
  "AI_ADMIN_CREDENTIAL_REQUIRED",
  "AI_ADMIN_PROVIDER_NOT_READY",
  "AI_ADMIN_MODEL_TEST_FAILED",
] as const;

export type AIAdminDirectErrorCode =
  (typeof AI_ADMIN_DIRECT_ERROR_CODES)[number];

export class AIAdminDirectError extends Error {
  constructor(
    readonly code: AIAdminDirectErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIAdminDirectError";
  }
}

export function isAIAdminDirectError(
  value: unknown,
): value is AIAdminDirectError {
  return value instanceof AIAdminDirectError;
}

export interface AIAdminProviderView extends SafeAIProviderConfigDTO {
  modelCount: number;
  enabledModelCount: number;
  models: SafeAIModelConfigDTO[];
}

export interface AIModelConnectionTestResult {
  ok: boolean;
  latencyMs: number | null;
  providerLatencyMs: number | null;
  errorCode?: string;
}

export interface AIAdminDirectServiceOptions {
  secrets?: AISecretStoreAdapter;
  outboundPolicy?: OutboundTargetPolicy;
  transport?: AIProviderHttpTransport;
  clock?: () => number;
}

export class AIAdminDirectService {
  private readonly providers: SQLiteAIProviderConfigRepository;
  private readonly models: SQLiteAIModelConfigRepository;
  private readonly secrets: AISecretStoreAdapter;
  private readonly outboundPolicy: OutboundTargetPolicy;
  private readonly transport?: AIProviderHttpTransport;
  private readonly clock: () => number;

  constructor(
    private readonly database: ContentDatabase,
    options: AIAdminDirectServiceOptions = {},
  ) {
    this.providers = new SQLiteAIProviderConfigRepository(database);
    this.models = new SQLiteAIModelConfigRepository(database);
    this.secrets = options.secrets ?? createLocalAISecretStore(database);
    this.outboundPolicy = options.outboundPolicy ?? createProviderOutboundPolicy();
    this.transport = options.transport;
    this.clock = options.clock ?? Date.now;
  }

  static forDatabase(
    database: ContentDatabase,
    options: AIAdminDirectServiceOptions = {},
  ): AIAdminDirectService {
    return new AIAdminDirectService(database, options);
  }

  listProviders(): AIAdminProviderView[] {
    return this.providers.list().map((provider) => this.providerView(provider));
  }

  getProvider(providerId: string): AIAdminProviderView {
    return this.providerView(this.requireProvider(providerId));
  }

  async createProvider(input: {
    displayName: string;
    baseUrl: string;
    apiFormat: unknown;
    apiKey: string;
    actor: AdminActor;
  }): Promise<AIAdminProviderView> {
    const apiFormat = requireApiFormat(input.apiFormat);
    const key = deriveProviderKey(input.displayName);
    if (this.providers.getByKey(key)) {
      throw new AIAdminDirectError(
        "AI_ADMIN_PROVIDER_KEY_CONFLICT",
        "A provider with this name already exists. Choose a distinct name.",
      );
    }
    const apiKey = requireCredential(input.apiKey);
    const candidate = normalizeAIProviderConfigContent({
      key,
      displayName: input.displayName,
      baseUrl: prepareBaseUrl(input.baseUrl, apiFormat),
      apiFormat,
      credentialRef: uuidv7(),
      enabled: true,
      retentionPolicy: "UNKNOWN",
      trainingPolicy: "UNKNOWN",
      zdrSupported: false,
      zdrRequired: false,
    });
    const secret = await this.secrets.create({
      secret: apiKey,
      actor: { type: "ADMIN", actorUserId: input.actor.actorUserId },
    });
    let committed = false;
    try {
      const provider = this.providers.create({
        id: uuidv7(),
        content: { ...candidate, credentialRef: secret.credentialRef },
        actor: input.actor,
        now: this.clock(),
      });
      committed = true;
      return this.providerView(provider, "ACTIVE");
    } finally {
      if (!committed) {
        await this.secrets
          .revoke({
            credentialRef: secret.credentialRef,
            actor: { type: "SYSTEM" },
          })
          .catch(() => undefined);
      }
    }
  }

  updateProvider(input: {
    providerId: string;
    displayName: string;
    baseUrl: string;
    apiFormat: unknown;
    expectedRevision: number;
    actor: AdminActor;
  }): AIAdminProviderView {
    const current = this.requireProvider(input.providerId);
    assertRevision(input.expectedRevision);
    const apiFormat = requireApiFormat(input.apiFormat);
    const candidate = normalizeAIProviderConfigContent({
      key: current.key,
      displayName: input.displayName,
      baseUrl: prepareBaseUrl(input.baseUrl, apiFormat),
      apiFormat,
      credentialRef: current.credentialRef,
      enabled: current.enabled,
      retentionPolicy: current.retentionPolicy,
      trainingPolicy: current.trainingPolicy,
      zdrSupported: current.zdrSupported,
      zdrRequired: current.zdrRequired,
    });
    if (apiFormat === current.apiFormat) {
      const updated = this.providers.update({
        id: current.id,
        content: candidate,
        expectedRevision: input.expectedRevision,
        actor: input.actor,
        now: this.clock(),
      });
      return this.providerView(updated);
    }
    const updated = this.updateProviderAndGenerationAdapters({
      current,
      candidate,
      expectedRevision: input.expectedRevision,
      actor: input.actor,
      now: this.clock(),
    });
    return this.providerView(updated);
  }

  setProviderEnabled(input: {
    providerId: string;
    enabled: boolean;
    expectedRevision: number;
    actor: AdminActor;
  }): AIAdminProviderView {
    const provider = this.requireProvider(input.providerId);
    if (input.enabled) {
      if (!provider.credentialRef) {
        throw new AIAdminDirectError(
          "AI_ADMIN_PROVIDER_NOT_READY",
          "Add an API key before enabling this provider.",
        );
      }
      const metadata = this.secrets.getMetadata(provider.credentialRef);
      if (!metadata || metadata.status !== "ACTIVE") {
        throw new AIAdminDirectError(
          "AI_ADMIN_PROVIDER_NOT_READY",
          "Replace the API key before enabling this provider.",
        );
      }
    }
    return this.updateProvider({
      providerId: provider.id,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat,
      expectedRevision: input.expectedRevision,
      actor: input.actor,
    });
  }

  async replaceCredential(input: {
    providerId: string;
    apiKey: string;
    expectedRevision: number;
    actor: AdminActor;
  }): Promise<AIAdminProviderView> {
    const provider = this.requireProvider(input.providerId);
    assertRevision(input.expectedRevision);
    const apiKey = requireCredential(input.apiKey);
    const actor = { type: "ADMIN" as const, actorUserId: input.actor.actorUserId };
    if (provider.credentialRef) {
      const metadata = this.secrets.getMetadata(provider.credentialRef);
      if (metadata?.status === "ACTIVE") {
        await this.secrets.rotate({
          credentialRef: provider.credentialRef,
          secret: apiKey,
          actor,
        });
        const updated = this.providers.update({
          id: provider.id,
          content: provider,
          expectedRevision: input.expectedRevision,
          actor: input.actor,
          now: this.clock(),
        });
        return this.providerView(updated, "ACTIVE");
      }
    }

    const secret = await this.secrets.create({ secret: apiKey, actor });
    let committed = false;
    try {
      const updated = this.providers.update({
        id: provider.id,
        content: { ...provider, credentialRef: secret.credentialRef },
        expectedRevision: input.expectedRevision,
        actor: input.actor,
        now: this.clock(),
      });
      committed = true;
      if (provider.credentialRef) {
        await this.secrets
          .revoke({ credentialRef: provider.credentialRef, actor })
          .catch(() => undefined);
      }
      return this.providerView(updated, "ACTIVE");
    } finally {
      if (!committed) {
        await this.secrets
          .revoke({ credentialRef: secret.credentialRef, actor: { type: "SYSTEM" } })
          .catch(() => undefined);
      }
    }
  }

  async revokeCredential(input: {
    providerId: string;
    expectedRevision: number;
    actor: AdminActor;
  }): Promise<AIAdminProviderView> {
    const provider = this.requireProvider(input.providerId);
    assertRevision(input.expectedRevision);
    if (!provider.credentialRef) return this.providerView(provider);
    await this.secrets.revoke({
      credentialRef: provider.credentialRef,
      actor: { type: "ADMIN", actorUserId: input.actor.actorUserId },
    });
    const updated = this.providers.update({
      id: provider.id,
      content: {
        ...provider,
        credentialRef: null,
        enabled: false,
      },
      expectedRevision: input.expectedRevision,
      actor: input.actor,
      now: this.clock(),
    });
    return this.providerView(updated);
  }

  async deleteProvider(input: {
    providerId: string;
    expectedRevision: number;
    actor: AdminActor;
  }): Promise<void> {
    const provider = this.requireProvider(input.providerId);
    assertRevision(input.expectedRevision);
    const modelCount = this.models
      .list()
      .filter((model) => model.providerConfigId === provider.id).length;
    if (modelCount > 0) {
      throw new AIAdminDirectError(
        "AI_ADMIN_PROVIDER_DELETE_BLOCKED",
        "Remove the provider's models before deleting the provider.",
        { modelCount },
      );
    }
    if (provider.credentialRef) {
      await this.secrets.revoke({
        credentialRef: provider.credentialRef,
        actor: { type: "ADMIN", actorUserId: input.actor.actorUserId },
      });
    }
    try {
      this.providers.remove({
        id: provider.id,
        expectedRevision: input.expectedRevision,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("changed")) {
        throw new AIAdminDirectError(
          "AI_ADMIN_REVISION_CONFLICT",
          "The provider changed before deletion completed.",
          undefined,
          error,
        );
      }
      throw new AIAdminDirectError(
        "AI_ADMIN_PROVIDER_DELETE_BLOCKED",
        "This provider is still referenced by another AI configuration.",
        undefined,
        error,
      );
    }
  }

  listModels(providerId: string): SafeAIModelConfigDTO[] {
    this.requireProvider(providerId);
    return this.models
      .list()
      .filter(
        (model) =>
          model.providerConfigId === providerId && model.capability === "GENERATION",
      )
      .map(toSafeAIModelConfigDTO);
  }

  getModel(modelId: string): SafeAIModelConfigDTO {
    return toSafeAIModelConfigDTO(this.requireModel(modelId));
  }

  createModel(input: {
    providerId: string;
    providerModelId: string;
    contextWindowTokens: number;
    maxOutputTokens: number;
    inputModalities: unknown;
    actor: AdminActor;
  }): SafeAIModelConfigDTO {
    const provider = this.requireProvider(input.providerId);
    const providerModelId = exactModelId(input.providerModelId);
    if (
      this.models
        .list()
        .some(
          (model) =>
            model.providerConfigId === provider.id &&
            model.providerModelId === providerModelId,
        )
    ) {
      throw new AIAdminDirectError(
        "AI_ADMIN_MODEL_ID_CONFLICT",
        "This model is already registered for the selected provider.",
      );
    }
    const content = this.generationModelContent({
      provider,
      key: uniqueModelKey(provider.key, providerModelId, this.models),
      providerModelId,
      contextWindowTokens: input.contextWindowTokens,
      maxOutputTokens: input.maxOutputTokens,
      inputModalities: input.inputModalities,
    });
    const model = this.models.create({
      id: uuidv7(),
      content,
      actor: input.actor,
      now: this.clock(),
    });
    return toSafeAIModelConfigDTO(model);
  }

  updateModel(input: {
    modelId: string;
    providerModelId: string;
    contextWindowTokens: number;
    maxOutputTokens: number;
    inputModalities: unknown;
    expectedRevision: number;
    actor: AdminActor;
    enabled?: boolean;
  }): SafeAIModelConfigDTO {
    const current = this.requireModel(input.modelId);
    assertRevision(input.expectedRevision);
    if (current.capability !== "GENERATION") {
      throw new AIAdminDirectError(
        "AI_ADMIN_INVALID",
        "Only Generation models can be managed from this page.",
      );
    }
    const provider = this.requireProvider(current.providerConfigId);
    const providerModelId = exactModelId(input.providerModelId);
    const content = this.generationModelContent({
      provider,
      key: current.key,
      providerModelId,
      contextWindowTokens: input.contextWindowTokens,
      maxOutputTokens: input.maxOutputTokens,
      inputModalities: input.inputModalities,
      displayName: providerModelId === current.providerModelId
        ? current.displayName
        : providerModelId,
      enabled: input.enabled ?? current.enabled,
      supportsStreaming: current.supportsStreaming,
      supportsReasoning: current.supportsReasoning,
      supportsStructuredOutput: current.supportsStructuredOutput,
    });
    try {
      return toSafeAIModelConfigDTO(
        this.models.update({
          id: current.id,
          content,
          expectedRevision: input.expectedRevision,
          actor: input.actor,
          now: this.clock(),
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("changed")) {
        throw new AIAdminDirectError(
          "AI_ADMIN_REVISION_CONFLICT",
          "The model changed before saving completed.",
          undefined,
          error,
        );
      }
      throw error;
    }
  }

  setModelEnabled(input: {
    modelId: string;
    enabled: boolean;
    expectedRevision: number;
    actor: AdminActor;
  }): SafeAIModelConfigDTO {
    const current = this.requireModel(input.modelId);
    if (current.capability !== "GENERATION") {
      throw new AIAdminDirectError(
        "AI_ADMIN_INVALID",
        "Only Generation models can be managed from this page.",
      );
    }
    const provider = this.requireProvider(current.providerConfigId);
    assertRevision(input.expectedRevision);
    const content = normalizeAIModelConfigContent({
      key: current.key,
      displayName: current.displayName,
      providerConfigId: provider.id,
      providerModelId: current.providerModelId,
      capability: current.capability,
      adapterKey: adapterKeyForProviderApiFormat(provider.apiFormat),
      enabled: input.enabled,
      contextWindowTokens: current.contextWindowTokens,
      maxOutputTokens: current.maxOutputTokens,
      embeddingDimensions: current.embeddingDimensions,
      supportsStreaming: current.supportsStreaming,
      supportsReasoning: current.supportsReasoning,
      supportsStructuredOutput: current.supportsStructuredOutput,
      inputModalities: current.inputModalities,
      outputModalities: current.outputModalities,
    });
    try {
      return toSafeAIModelConfigDTO(
        this.models.update({
          id: current.id,
          content,
          expectedRevision: input.expectedRevision,
          actor: input.actor,
          now: this.clock(),
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("changed")) {
        throw new AIAdminDirectError(
          "AI_ADMIN_REVISION_CONFLICT",
          "The model changed before its state could be updated.",
          undefined,
          error,
        );
      }
      throw error;
    }
  }

  deleteModel(input: {
    modelId: string;
    expectedRevision: number;
  }): void {
    const model = this.requireModel(input.modelId);
    assertRevision(input.expectedRevision);
    const dependencies = findModelDependencies(this.database, model.id);
    if (dependencies.length > 0) {
      throw new AIAdminDirectError(
        "AI_ADMIN_MODEL_DELETE_BLOCKED",
        "This model is referenced by existing AI configuration or history.",
        { dependencies },
      );
    }
    try {
      this.models.remove({ id: model.id, expectedRevision: input.expectedRevision });
    } catch (error) {
      if (error instanceof Error && error.message.includes("changed")) {
        throw new AIAdminDirectError(
          "AI_ADMIN_REVISION_CONFLICT",
          "The model changed before deletion completed.",
          undefined,
          error,
        );
      }
      throw new AIAdminDirectError(
        "AI_ADMIN_MODEL_DELETE_BLOCKED",
        "This model is still referenced by another AI configuration.",
        undefined,
        error,
      );
    }
  }

  async testModel(modelId: string): Promise<AIModelConnectionTestResult> {
    const model = this.requireModel(modelId);
    if (model.capability !== "GENERATION" || !model.enabled) {
      throw new AIAdminDirectError(
        "AI_ADMIN_MODEL_TEST_FAILED",
        "Enable a Generation model before testing it.",
      );
    }
    const provider = this.requireProvider(model.providerConfigId);
    if (!provider.enabled || !provider.credentialRef) {
      throw new AIAdminDirectError(
        "AI_ADMIN_PROVIDER_NOT_READY",
        "Enable the provider and add an active API key before testing.",
      );
    }
    const maxOutputTokens = Math.min(16, model.maxOutputTokens ?? 16);
    const gateway = new AIProviderGateway({
      providerConfigs: this.providers,
      modelConfigs: this.models,
      secrets: this.secrets,
      adapters: new ProviderAdapterRegistry([
        new OpenAICompatibleGenerationAdapter({
          outboundPolicy: this.outboundPolicy,
          transport: this.transport,
        }),
        new OpenAIResponsesGenerationAdapter({
          outboundPolicy: this.outboundPolicy,
          transport: this.transport,
        }),
        new AnthropicMessagesGenerationAdapter({
          outboundPolicy: this.outboundPolicy,
          transport: this.transport,
        }),
      ]),
    }, { defaultTimeoutMs: 15_000, maxTimeoutMs: 15_000 });
    const startedAt = this.clock();
    const stream = gateway.generate(
      { capability: "GENERATION", attempts: [model.id] },
      {
        requestId: uuidv7(),
        messages: [{ role: "user", content: "Reply with OK." }],
        maxOutputTokens,
        stream: true,
      },
      { timeoutMs: 15_000 },
    );
    try {
      for await (const event of stream.events) {
        // The diagnostic intentionally discards all generated text and does not
        // create a Conversation, Context, Memory, Cost, or Telemetry record.
        void event;
      }
      const trace = await stream.trace;
      const attempt = trace[trace.length - 1];
      return {
        ok: true,
        latencyMs: boundedDuration(this.clock() - startedAt),
        providerLatencyMs: attempt?.latencyMs ?? null,
      };
    } catch (error) {
      const trace = await stream.trace;
      const attempt = trace[trace.length - 1];
      const code = errorCode(error, attempt?.errorCode);
      return {
        ok: false,
        latencyMs: boundedDuration(this.clock() - startedAt),
        providerLatencyMs: attempt?.latencyMs ?? null,
        errorCode: code,
      };
    }
  }

  private generationModelContent(input: {
    provider: AIProviderConfig;
    key: string;
    providerModelId: string;
    contextWindowTokens: number;
    maxOutputTokens: number;
    inputModalities: unknown;
    displayName?: string;
    enabled?: boolean;
    supportsStreaming?: boolean;
    supportsReasoning?: boolean;
    supportsStructuredOutput?: boolean;
  }) {
    const content = normalizeAIModelConfigContent({
      key: input.key,
      displayName: input.displayName ?? input.providerModelId,
      providerConfigId: input.provider.id,
      providerModelId: input.providerModelId,
      capability: "GENERATION",
      adapterKey: adapterKeyForProviderApiFormat(input.provider.apiFormat),
      enabled: input.enabled ?? true,
      contextWindowTokens: input.contextWindowTokens,
      maxOutputTokens: input.maxOutputTokens,
      embeddingDimensions: null,
      supportsStreaming: input.supportsStreaming ?? true,
      supportsReasoning: input.supportsReasoning ?? false,
      supportsStructuredOutput: input.supportsStructuredOutput ?? false,
      inputModalities: input.inputModalities,
      outputModalities: ["TEXT"],
    });
    return content;
  }

  private requireProvider(providerId: string): AIProviderConfig {
    const provider = this.providers.getById(providerId);
    if (!provider) {
      throw new AIAdminDirectError(
        "AI_ADMIN_PROVIDER_NOT_FOUND",
        "The selected AI provider was not found.",
      );
    }
    return provider;
  }

  private requireModel(modelId: string): AIModelConfig {
    const model = this.models.getById(modelId);
    if (!model) {
      throw new AIAdminDirectError(
        "AI_ADMIN_MODEL_NOT_FOUND",
        "The selected AI model was not found.",
      );
    }
    return model;
  }

  private providerView(
    provider: AIProviderConfig,
    credentialStatusOverride?: "ACTIVE" | "REVOKED" | "MISSING",
  ): AIAdminProviderView {
    const credentialStatus = provider.credentialRef
      ? credentialStatusOverride ?? this.secrets.getMetadata(provider.credentialRef)?.status ?? "MISSING"
      : "NOT_CONFIGURED";
    const models = this.models
      .list()
      .filter(
        (model) =>
          model.providerConfigId === provider.id && model.capability === "GENERATION",
      )
      .map(toSafeAIModelConfigDTO);
    return {
      ...toSafeAIProviderConfigDTO(provider, credentialStatus),
      modelCount: models.length,
      enabledModelCount: models.filter((model) => model.enabled).length,
      models,
    };
  }

  private updateProviderAndGenerationAdapters(input: {
    current: AIProviderConfig;
    candidate: ReturnType<typeof normalizeAIProviderConfigContent>;
    expectedRevision: number;
    actor: AdminActor;
    now: number;
  }): AIProviderConfig {
    const nextAdapterKey = adapterKeyForProviderApiFormat(
      input.candidate.apiFormat ?? "OPENAI_CHAT_COMPLETIONS",
    );
    try {
      this.database.client.transaction(() => {
        const updated = this.database.client
          .prepare(
            `update ai_provider_configs
             set display_name = ?, base_url = ?, api_format = ?, credential_ref = ?,
                 enabled = ?, retention_policy = ?, training_policy = ?,
                 zdr_supported = ?, zdr_required = ?, updated_at = ?, updated_by = ?,
                 revision = revision + 1
             where id = ? and revision = ?`,
          )
          .run(
            input.candidate.displayName,
            input.candidate.baseUrl,
            input.candidate.apiFormat ?? "OPENAI_CHAT_COMPLETIONS",
            input.candidate.credentialRef,
            input.candidate.enabled ? 1 : 0,
            input.candidate.retentionPolicy,
            input.candidate.trainingPolicy,
            input.candidate.zdrSupported ? 1 : 0,
            input.candidate.zdrRequired ? 1 : 0,
            input.now,
            input.actor.actorUserId,
            input.current.id,
            input.expectedRevision,
          );
        if (updated.changes !== 1) {
          throw new AIAdminDirectError(
            "AI_ADMIN_REVISION_CONFLICT",
            "The provider changed before saving completed.",
          );
        }
        this.database.client
          .prepare(
            `update ai_model_configs
             set adapter_key = ?, updated_at = ?, updated_by = ?, revision = revision + 1
             where provider_config_id = ? and capability = 'GENERATION'`,
          )
          .run(nextAdapterKey, input.now, input.actor.actorUserId, input.current.id);
      }).immediate();
    } catch (error) {
      if (error instanceof AIAdminDirectError) throw error;
      throw new AIAdminDirectError(
        "AI_ADMIN_REVISION_CONFLICT",
        "The provider could not be updated safely.",
        undefined,
        error,
      );
    }
    return this.requireProvider(input.current.id);
  }
}

function requireApiFormat(value: unknown): AIProviderApiFormat {
  if (
    value !== "OPENAI_CHAT_COMPLETIONS" &&
    value !== "OPENAI_RESPONSES" &&
    value !== "ANTHROPIC_MESSAGES"
  ) {
    throw new AIAdminDirectError("AI_ADMIN_INVALID", "The API format is invalid.");
  }
  return value;
}

function prepareBaseUrl(value: unknown, apiFormat?: AIProviderApiFormat): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AIAdminDirectError("AI_ADMIN_INVALID", "Base URL is required.");
  }
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//iu.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  if (apiFormat !== "ANTHROPIC_MESSAGES") return withScheme;
  try {
    const url = new URL(withScheme);
    const path = url.pathname.replace(/\/+$/u, "");
    if (path.toLowerCase().endsWith("/v1")) url.pathname = path.slice(0, -3) || "/";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return withScheme;
  }
}

function requireCredential(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > 16 * 1024
  ) {
    throw new AIAdminDirectError(
      "AI_ADMIN_CREDENTIAL_REQUIRED",
      "An API key is required and must be within the allowed size.",
    );
  }
  return value;
}

function deriveProviderKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new AIAdminDirectError("AI_ADMIN_INVALID", "Provider name is required.");
  }
  const key = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  if (key) return key;
  throw new AIAdminDirectError(
    "AI_ADMIN_INVALID",
    "Provider name must contain Latin letters or numbers so its technical key can be derived safely.",
  );
}

function uniqueModelKey(
  providerKey: string,
  providerModelId: string,
  models: SQLiteAIModelConfigRepository,
): string {
  const slug = providerModelId
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 88);
  const base = `model-${providerKey}-${slug || "generation"}`.slice(0, 120);
  if (!models.getByKey(base)) return base;
  return `model-${providerKey}-${slug || "generation"}-${uuidv7().slice(-8)}`.slice(
    0,
    120,
  );
}

function exactModelId(value: unknown): string {
  if (typeof value !== "string") {
    throw new AIAdminDirectError("AI_ADMIN_INVALID", "Model ID is required.");
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new AIAdminDirectError("AI_ADMIN_INVALID", "Model ID is invalid.");
  }
  return trimmed;
}

function assertRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AIAdminDirectError("AI_ADMIN_INVALID", "A valid revision is required.");
  }
}

function boundedDuration(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 86_400_000) : 0;
}

function errorCode(error: unknown, traceCode?: string): string {
  if (traceCode) return traceCode;
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z_]+$/u.test(code)) return code;
  }
  return "UNKNOWN";
}

interface Dependency {
  label: string;
  count: number;
}

function findModelDependencies(
  database: ContentDatabase,
  modelId: string,
): Dependency[] {
  const checks: Array<[string, string]> = [
    ["Tutor configurations", "select count(*) as count from ai_tutor_config_revisions where generation_model_config_id = ?"],
    ["Tutor fallback configurations", "select count(*) as count from ai_tutor_config_revisions where json_valid(fallback_generation_model_config_ids) and exists (select 1 from json_each(fallback_generation_model_config_ids) where value = ?)"],
    ["Retrieval configurations", "select count(*) as count from ai_retrieval_config_revisions where embedding_model_config_id = ? or rerank_model_config_id = ?"],
    ["Memory and Compaction configurations", "select count(*) as count from ai_memory_execution_config_revisions where generation_model_config_id = ?"],
    ["Circuit breaker state", "select count(*) as count from ai_circuit_breaker_states where model_config_id = ?"],
    ["Embedding projections", "select count(*) as count from ai_embedding_projection_sets where model_config_id = ?"],
    ["Eval Judge configurations", "select count(*) as count from ai_eval_judge_config_revisions where model_config_id = ?"],
    ["Eval Judge executions", "select count(*) as count from ai_eval_judge_executions where judge_model_config_id = ?"],
    ["Memory executions", "select count(*) as count from ai_memory_executions where generation_model_config_id = ?"],
    ["Tutor response traces", "select count(*) as count from ai_tutor_response_traces where generation_model_config_id = ?"],
    ["Retrieval traces", "select count(*) as count from ai_retrieval_traces where embedding_model_config_id = ? or rerank_model_config_id = ?"],
    ["Usage and cost history", "select count(*) as count from ai_usage_cost_records where model_config_id = ?"],
    ["Telemetry history", "select count(*) as count from ai_telemetry_events where model_config_id = ?"],
  ];
  const dependencies: Dependency[] = [];
  for (const [label, query] of checks) {
    const parameters = (query.match(/\?/gu) ?? []).length === 2
      ? [modelId, modelId]
      : [modelId];
    const row = database.client.prepare(query).get(...parameters) as
      | { count?: number }
      | undefined;
    const count = Number(row?.count ?? 0);
    if (count > 0) dependencies.push({ label, count });
  }
  return dependencies;
}
