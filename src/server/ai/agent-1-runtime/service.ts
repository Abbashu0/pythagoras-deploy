import { asc, eq } from "drizzle-orm";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiAgentRuntimeConfigs,
  aiAgentRuntimeFallbackModels,
} from "../../content/schema";
import { AIAdminDirectService } from "../admin-direct-service";
import { AI_GENERATION_ADAPTER_KEYS } from "../gateway";
import { SQLiteAIModelConfigRepository } from "../model-registry";
import {
  AIAgent1RuntimeError,
} from "./errors";
import type {
  AIAgent1RuntimeModel,
  AIAgent1RuntimeRouteUpdate,
  AIAgent1RuntimeSnapshot,
  AIAgent1RuntimeEnabledUpdate,
} from "./contracts";
import { Agent1InstructionConformanceService } from "./instruction-conformance-service";
import { canExecuteAgent1Model, type Agent1ExecutionBoundary } from "./instruction-qualification";

const CONFIG_KEY = "agent-1";
const MAX_FALLBACKS = 3;

type StoredRuntimeConfig = typeof aiAgentRuntimeConfigs.$inferSelect;

/** Persistent routing-only control for the future Agent 1 execution boundary. */
export class AIAgent1RuntimeService {
  private readonly models: SQLiteAIModelConfigRepository;
  private readonly directAdmin: AIAdminDirectService;
  private readonly now: () => number;
  private readonly executionBoundary: Agent1ExecutionBoundary;

  constructor(
    private readonly database: ContentDatabase,
    options: { now?: () => number; adminService?: AIAdminDirectService; executionBoundary?: Agent1ExecutionBoundary } = {},
  ) {
    this.models = new SQLiteAIModelConfigRepository(database);
    this.directAdmin = options.adminService ?? AIAdminDirectService.forDatabase(database);
    this.now = options.now ?? Date.now;
    this.executionBoundary = options.executionBoundary ?? "STRICT_AGENT";
  }

  static forDatabase(database: ContentDatabase, options: { executionBoundary?: Agent1ExecutionBoundary } = {}): AIAgent1RuntimeService {
    return new AIAgent1RuntimeService(database, options);
  }

  getSnapshot(): AIAgent1RuntimeSnapshot {
    const stored = this.readStoredConfig();
    const fallbackRows = this.readFallbackRows();
    if (!stored && fallbackRows.length > 0) {
      throw new AIAgent1RuntimeError(
        "AI_AGENT_1_RUNTIME_CORRUPT",
        "Agent 1 runtime fallback rows exist without their parent configuration.",
      );
    }

    const fallbackModelConfigIds = fallbackRows.map((row, index) => {
      if (row.position !== index + 1 || index >= MAX_FALLBACKS) {
        throw new AIAgent1RuntimeError(
          "AI_AGENT_1_RUNTIME_CORRUPT",
          "The Agent 1 fallback order is not contiguous.",
        );
      }
      return row.modelConfigId;
    });
    const registry = this.readModels();
    const modelsById = new Map(registry.map((model) => [model.id, model]));
    const primaryModelConfigId = stored?.primaryModelConfigId ?? null;
    const primary = primaryModelConfigId
      ? modelsById.get(primaryModelConfigId) ?? null
      : null;
    const fallbacks = fallbackModelConfigIds.map((id) => {
      const model = modelsById.get(id);
      if (!model) {
        throw new AIAgent1RuntimeError(
          "AI_AGENT_1_RUNTIME_CORRUPT",
          "A configured Agent 1 fallback model is missing from the Model Registry.",
        );
      }
      return model;
    });
    const enabled = Boolean(stored?.enabled);
    const canEnable = Boolean(primary && canExecuteAgent1Model(primary, this.executionBoundary));

    return {
      config: {
        enabled,
        primaryModelConfigId,
        fallbackModelConfigIds,
        revision: stored?.revision ?? 0,
        createdAt: stored?.createdAt ?? null,
        updatedAt: stored?.updatedAt ?? null,
      },
      primary,
      fallbacks,
      models: registry,
      canEnable,
      state: !enabled
        ? "STOPPED"
        : canEnable
          ? "READY"
          : "NEEDS_ATTENTION",
      execution: {
        connected: false,
        reason: "AGENT_1_STUDENT_EXECUTION_NOT_CONNECTED",
      },
    };
  }

  saveRoute(input: AIAgent1RuntimeRouteUpdate): AIAgent1RuntimeSnapshot {
    const expectedRevision = validateExpectedRevision(input.expectedRevision);
    const primaryModelConfigId = nullableModelId(input.primaryModelConfigId);
    const fallbackModelConfigIds = validateFallbackIds(
      input.fallbackModelConfigIds,
      primaryModelConfigId,
    );

    this.mutate({
      expectedRevision,
      actor: input.actor,
      route: { primaryModelConfigId, fallbackModelConfigIds },
    });
    return this.getSnapshot();
  }

  setEnabled(input: AIAgent1RuntimeEnabledUpdate): AIAgent1RuntimeSnapshot {
    const expectedRevision = validateExpectedRevision(input.expectedRevision);
    if (typeof input.enabled !== "boolean") {
      throw new AIAgent1RuntimeError(
        "AI_AGENT_1_RUNTIME_INVALID",
        "The Agent 1 enabled state must be a boolean.",
      );
    }

    this.mutate({
      expectedRevision,
      actor: input.actor,
      enabled: input.enabled,
    });
    return this.getSnapshot();
  }

  private mutate(input: {
    expectedRevision: number;
    actor: AdminActor;
    enabled?: boolean;
    route?: { primaryModelConfigId: string | null; fallbackModelConfigIds: string[] };
  }): void {
    try {
      this.database.client.transaction(() => {
      const current = this.readStoredConfig();
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new AIAgent1RuntimeError(
          "AI_AGENT_1_RUNTIME_CONFLICT",
          "Agent 1 changed in another session. Reload its current configuration before saving.",
          { expectedRevision: input.expectedRevision, currentRevision },
        );
      }

      const currentFallbacks = this.readFallbackRows().map((row) => row.modelConfigId);
      const primaryModelConfigId = input.route?.primaryModelConfigId ??
        (input.route ? null : current?.primaryModelConfigId ?? null);
      const fallbackModelConfigIds = input.route?.fallbackModelConfigIds ?? currentFallbacks;
      const enabled = input.enabled ?? Boolean(current?.enabled);

      this.assertSelectedModels(primaryModelConfigId, fallbackModelConfigIds);

      if (enabled) {
        if (!primaryModelConfigId) {
          throw new AIAgent1RuntimeError(
            "AI_AGENT_1_RUNTIME_PRIMARY_REQUIRED",
            "Choose a Generation primary model before enabling Agent 1.",
          );
        }
        const primary = this.readModels().find(
          (model) => model.id === primaryModelConfigId,
        );
        if (!primary?.ready) {
          throw new AIAgent1RuntimeError(
            "AI_AGENT_1_RUNTIME_MODEL_NOT_READY",
            primary?.readinessReason ?? "The primary Generation model is not ready.",
            { modelConfigId: primaryModelConfigId, readiness: primary?.readiness ?? "MISSING" },
          );
        }
        if (input.enabled === true && !canExecuteAgent1Model(primary, this.executionBoundary)) {
          throw new AIAgent1RuntimeError("AI_AGENT_1_RUNTIME_MODEL_NOT_READY", primary.instructionAuthority?.explanation ?? "Execution is unavailable for this server boundary.", { modelConfigId: primary.id, instructionAuthority: primary.instructionAuthority?.status ?? null });
        }
      }

      if (
        (!current && !enabled && !primaryModelConfigId && fallbackModelConfigIds.length === 0) ||
        (current &&
          current.enabled === enabled &&
          current.primaryModelConfigId === primaryModelConfigId &&
          sameArray(currentFallbacks, fallbackModelConfigIds))
      ) {
        return;
      }

      const now = this.safeNow(current?.updatedAt ?? null);
      const nextRevision = currentRevision + 1;

      // Rewrite the ordered child rows and parent revision in one SQLite
      // transaction. A failure at any step rolls the entire route back.
      this.database.db
        .delete(aiAgentRuntimeFallbackModels)
        .where(eq(aiAgentRuntimeFallbackModels.configKey, CONFIG_KEY))
        .run();

      if (current) {
        const updated = this.database.db
          .update(aiAgentRuntimeConfigs)
          .set({
            enabled,
            primaryModelConfigId,
            revision: nextRevision,
            updatedAt: now,
            updatedBy: input.actor.actorUserId,
          })
          .where(eq(aiAgentRuntimeConfigs.configKey, CONFIG_KEY))
          .returning({ revision: aiAgentRuntimeConfigs.revision })
          .get();
        if (updated?.revision !== nextRevision) {
          throw new AIAgent1RuntimeError(
            "AI_AGENT_1_RUNTIME_CONFLICT",
            "Agent 1 changed before the update could be applied.",
          );
        }
      } else {
        this.database.db
          .insert(aiAgentRuntimeConfigs)
          .values({
            configKey: CONFIG_KEY,
            enabled,
            primaryModelConfigId,
            revision: nextRevision,
            createdAt: now,
            updatedAt: now,
            createdBy: input.actor.actorUserId,
            updatedBy: input.actor.actorUserId,
          })
          .run();
      }

      if (fallbackModelConfigIds.length > 0) {
        this.database.db
          .insert(aiAgentRuntimeFallbackModels)
          .values(
            fallbackModelConfigIds.map((modelConfigId, index) => ({
              configKey: CONFIG_KEY,
              modelConfigId,
              position: index + 1,
              createdAt: now,
            })),
          )
          .run();
      }
      }).immediate();
    } catch (error) {
      if (error instanceof AIAgent1RuntimeError) throw error;
      throw new AIAgent1RuntimeError(
        "AI_AGENT_1_RUNTIME_CONFLICT",
        "Agent 1 configuration could not be updated atomically.",
        undefined,
        error,
      );
    }
  }

  private assertSelectedModels(
    primaryModelConfigId: string | null,
    fallbackModelConfigIds: readonly string[],
  ): void {
    const ids = [
      ...(primaryModelConfigId ? [primaryModelConfigId] : []),
      ...fallbackModelConfigIds,
    ];
    for (const id of ids) {
      const model = this.models.getById(id);
      if (!model) {
        throw new AIAgent1RuntimeError(
          "AI_AGENT_1_RUNTIME_MODEL_NOT_FOUND",
          "A selected model no longer exists in the Model Registry.",
          { modelConfigId: id },
        );
      }
      if (model.capability !== "GENERATION") {
        throw new AIAgent1RuntimeError(
          "AI_AGENT_1_RUNTIME_INVALID",
          "Agent 1 routing accepts Generation models only.",
          { modelConfigId: id },
        );
      }
    }
  }

  private readStoredConfig(): StoredRuntimeConfig | undefined {
    return this.database.db
      .select()
      .from(aiAgentRuntimeConfigs)
      .where(eq(aiAgentRuntimeConfigs.configKey, CONFIG_KEY))
      .get();
  }

  private readFallbackRows() {
    return this.database.db
      .select()
      .from(aiAgentRuntimeFallbackModels)
      .where(eq(aiAgentRuntimeFallbackModels.configKey, CONFIG_KEY))
      .orderBy(asc(aiAgentRuntimeFallbackModels.position))
      .all();
  }

  private readModels(): AIAgent1RuntimeModel[] {
    const conformance = new Agent1InstructionConformanceService(this.database);
    const providers = new Map(
      this.directAdmin.listProviders().map((provider) => [provider.id, provider]),
    );
    return this.models.list().map((model) => {
      const provider = providers.get(model.providerConfigId);
      if (!provider) {
        throw new AIAgent1RuntimeError(
          "AI_AGENT_1_RUNTIME_CORRUPT",
          "A registered model has no Provider configuration.",
        );
      }
      const expectedAdapter = model.capability === "GENERATION"
        ? AI_GENERATION_ADAPTER_KEYS[provider.apiFormat]
        : null;
      const readiness = resolveReadiness({
        capability: model.capability,
        enabled: model.enabled,
        providerEnabled: provider.enabled,
        credentialStatus: provider.credentialStatus,
        adapterAvailable: expectedAdapter !== null && model.adapterKey === expectedAdapter,
        supportsStreaming: model.supportsStreaming,
      });
      let instructionAuthority: AIAgent1RuntimeModel["instructionAuthority"] = null;
      try { instructionAuthority = conformance.getAuthority(model.id); }
      catch (error) {
        // Diagnostic persistence is not a prerequisite for stateless development execution.
        if (this.executionBoundary !== "DEVELOPMENT_STATELESS_CHAT") throw error;
      }
      return {
        id: model.id,
        displayName: model.displayName,
        providerName: provider.displayName,
        providerModelId: model.providerModelId,
        capability: model.capability,
        contextWindowTokens: model.contextWindowTokens,
        revision: model.revision,
        enabled: model.enabled,
        providerEnabled: provider.enabled,
        credentialStatus: provider.credentialStatus,
        instructionAuthority,
        ...readiness,
      };
    }).sort((left, right) =>
      left.providerName.localeCompare(right.providerName) ||
      left.displayName.localeCompare(right.displayName) ||
      left.id.localeCompare(right.id),
    );
  }

  private safeNow(previous: number | null): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AIAgent1RuntimeError(
        "AI_AGENT_1_RUNTIME_INVALID",
        "The server clock is not valid for an Agent 1 configuration update.",
      );
    }
    return Math.max(value, previous ?? 0);
  }
}

function resolveReadiness(input: {
  capability: AIAgent1RuntimeModel["capability"];
  enabled: boolean;
  providerEnabled: boolean;
  credentialStatus: AIAgent1RuntimeModel["credentialStatus"];
  adapterAvailable: boolean;
  supportsStreaming: boolean;
}): Pick<
  AIAgent1RuntimeModel,
  "readiness" | "readinessLabel" | "readinessReason" | "ready"
> {
  if (input.capability !== "GENERATION") {
    return {
      readiness: "INCOMPATIBLE_CAPABILITY",
      readinessLabel: "قدرة غير متوافقة",
      readinessReason: `هذا النموذج يدعم ${input.capability} ولا يدعم Generation.`,
      ready: false,
    };
  }
  if (!input.enabled) {
    return {
      readiness: "MODEL_DISABLED",
      readinessLabel: "النموذج معطّل",
      readinessReason: "فعّل النموذج من صفحة النماذج والمزوّدين.",
      ready: false,
    };
  }
  if (!input.providerEnabled) {
    return {
      readiness: "PROVIDER_DISABLED",
      readinessLabel: "المزوّد معطّل",
      readinessReason: "فعّل المزوّد قبل تشغيل هذا النموذج.",
      ready: false,
    };
  }
  if (input.credentialStatus !== "ACTIVE") {
    const reason = input.credentialStatus === "REVOKED"
      ? "مفتاح API للمزوّد مُبطَل. استبدله من صفحة النماذج والمزوّدين."
      : input.credentialStatus === "NOT_CONFIGURED"
        ? "لم يُضَف مفتاح API نشط لهذا المزوّد."
        : "بيانات اعتماد المزوّد غير متاحة على الخادم.";
    return {
      readiness: "CREDENTIAL_UNAVAILABLE",
      readinessLabel: "الاعتماد غير متاح",
      readinessReason: reason,
      ready: false,
    };
  }
  if (!input.adapterAvailable) {
    return {
      readiness: "ADAPTER_UNAVAILABLE",
      readinessLabel: "محوّل التشغيل غير متاح",
      readinessReason: "لا يوجد محوّل Generation مسجّل يطابق صيغة هذا المزوّد.",
      ready: false,
    };
  }
  if (!input.supportsStreaming) {
    return { readiness: "STREAMING_UNAVAILABLE", readinessLabel: "البث غير مدعوم", readinessReason: "شات Agent 1 يتطلب نموذج Generation يدعم البث.", ready: false };
  }
  return {
    readiness: "READY",
    readinessLabel: "الإعداد المحلي جاهز",
    readinessReason: null,
    ready: true,
  };
}

function validateExpectedRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AIAgent1RuntimeError(
      "AI_AGENT_1_RUNTIME_INVALID",
      "A valid non-negative Agent 1 revision is required.",
    );
  }
  return value;
}

function nullableModelId(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new AIAgent1RuntimeError(
      "AI_AGENT_1_RUNTIME_INVALID",
      "The primary model identity is invalid.",
    );
  }
  return value.trim();
}

function validateFallbackIds(
  value: readonly string[],
  primaryModelConfigId: string | null,
): string[] {
  if (!Array.isArray(value) || value.length > MAX_FALLBACKS) {
    throw new AIAgent1RuntimeError(
      "AI_AGENT_1_RUNTIME_INVALID",
      "Agent 1 accepts at most three ordered fallback models.",
      { maximumFallbacks: MAX_FALLBACKS },
    );
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !id.trim() || id.trim().length > 120) {
      throw new AIAgent1RuntimeError(
        "AI_AGENT_1_RUNTIME_INVALID",
        "A fallback model identity is invalid.",
      );
    }
    return id.trim();
  });
  if (new Set(ids).size !== ids.length || (primaryModelConfigId && ids.includes(primaryModelConfigId))) {
    throw new AIAgent1RuntimeError(
      "AI_AGENT_1_RUNTIME_INVALID",
      "Primary and fallback model identities must be unique.",
    );
  }
  if (!primaryModelConfigId && ids.length > 0) {
    throw new AIAgent1RuntimeError(
      "AI_AGENT_1_RUNTIME_PRIMARY_REQUIRED",
      "Choose a primary Generation model before adding fallback models.",
    );
  }
  return ids;
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
