import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiBudgetPolicyRevisions,
  aiEvalJudgeConfigRevisions,
  aiEvalJudgeConfigs,
  aiModelConfigs,
  aiProviderConfigs,
  aiRateLimitPolicyRevisions,
  canonicalMaterials,
  type AIEvalJudgeConfigRevisionRow,
} from "../../content/schema";
import {
  AI_EVAL_JUDGE_PROTOCOL_KEY,
  AI_EVAL_JUDGE_PROTOCOL_REVISION,
  type AIEvalJudgeConfig,
  type AIEvalJudgeConfigContent,
  type AIEvalJudgeConfigRepository,
  type AIEvalJudgeConfigRevision,
} from "./contracts";
import { AIEvalError } from "./errors";

const KEY_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]{0,79}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export function normalizeAIEvalJudgeConfigContent(value: unknown): AIEvalJudgeConfigContent {
  if (!isRecord(value)) invalid("The Eval Judge Config must be an object.");
  const expected = [
    "key", "subjectKey", "displayName", "enabled", "modelConfigId", "modelConfigRevision",
    "providerConfigId", "providerConfigRevision", "budgetPolicyId", "budgetPolicyRevision",
    "rateLimitPolicyId", "rateLimitPolicyRevision", "protocolKey", "protocolRevision",
    "timeoutMs", "maxOutputTokens",
  ].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((keyName, index) => keyName !== expected[index])) {
    invalid("Eval Judge Config fields are invalid.");
  }
  const content: AIEvalJudgeConfigContent = {
    key: key(value.key, "key", KEY_PATTERN),
    subjectKey: key(value.subjectKey, "subjectKey", SUBJECT_PATTERN),
    displayName: text(value.displayName, "displayName", 200),
    enabled: booleanValue(value.enabled, "enabled"),
    modelConfigId: uuid(value.modelConfigId, "modelConfigId"),
    modelConfigRevision: positive(value.modelConfigRevision, "modelConfigRevision"),
    providerConfigId: uuid(value.providerConfigId, "providerConfigId"),
    providerConfigRevision: positive(value.providerConfigRevision, "providerConfigRevision"),
    budgetPolicyId: uuid(value.budgetPolicyId, "budgetPolicyId"),
    budgetPolicyRevision: positive(value.budgetPolicyRevision, "budgetPolicyRevision"),
    rateLimitPolicyId: uuid(value.rateLimitPolicyId, "rateLimitPolicyId"),
    rateLimitPolicyRevision: positive(value.rateLimitPolicyRevision, "rateLimitPolicyRevision"),
    protocolKey: value.protocolKey === AI_EVAL_JUDGE_PROTOCOL_KEY ? AI_EVAL_JUDGE_PROTOCOL_KEY : invalid("protocolKey is not supported."),
    protocolRevision: value.protocolRevision === AI_EVAL_JUDGE_PROTOCOL_REVISION ? AI_EVAL_JUDGE_PROTOCOL_REVISION : invalid("protocolRevision is not supported."),
    timeoutMs: bounded(value.timeoutMs, 100, 86_400_000, "timeoutMs"),
    maxOutputTokens: bounded(value.maxOutputTokens, 1, 65_536, "maxOutputTokens"),
  };
  return content;
}

export function fingerprintAIEvalJudgeConfig(
  config: AIEvalJudgeConfigRevision | (AIEvalJudgeConfigContent & { judgeConfigId: string; revision: number }),
): string {
  const canonical = JSON.stringify({
    version: 1,
    judgeConfigId: "judgeConfigId" in config ? config.judgeConfigId : null,
    revision: "revision" in config ? config.revision : null,
    key: config.key,
    subjectKey: config.subjectKey,
    displayName: config.displayName,
    enabled: config.enabled,
    modelConfigId: config.modelConfigId,
    modelConfigRevision: config.modelConfigRevision,
    providerConfigId: config.providerConfigId,
    providerConfigRevision: config.providerConfigRevision,
    budgetPolicyId: config.budgetPolicyId,
    budgetPolicyRevision: config.budgetPolicyRevision,
    rateLimitPolicyId: config.rateLimitPolicyId,
    rateLimitPolicyRevision: config.rateLimitPolicyRevision,
    protocolKey: config.protocolKey,
    protocolRevision: config.protocolRevision,
    timeoutMs: config.timeoutMs,
    maxOutputTokens: config.maxOutputTokens,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function toSafeAIEvalJudgeConfigDTO(config: AIEvalJudgeConfig): AIEvalJudgeConfig {
  return structuredClone(config);
}

export class SQLiteAIEvalJudgeConfigRepository implements AIEvalJudgeConfigRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIEvalJudgeConfig | null {
    const row = this.database.db.select().from(aiEvalJudgeConfigs).where(eq(aiEvalJudgeConfigs.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The current Eval Judge Config revision is missing.");
    return {
      ...revision,
      id: row.id,
      currentRevision: row.currentRevision,
      currentRevisionId: revision.revisionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  getByKey(keyValue: string): AIEvalJudgeConfig | null {
    const row = this.database.db.select({ id: aiEvalJudgeConfigs.id }).from(aiEvalJudgeConfigs).where(eq(aiEvalJudgeConfigs.key, keyValue)).get();
    return row ? this.getById(row.id) : null;
  }

  getCurrentRevision(id: string): AIEvalJudgeConfigRevision | null {
    const row = this.database.db.select({ currentRevision: aiEvalJudgeConfigs.currentRevision }).from(aiEvalJudgeConfigs).where(eq(aiEvalJudgeConfigs.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIEvalJudgeConfigRevision | null {
    const row = this.database.db
      .select()
      .from(aiEvalJudgeConfigRevisions)
      .where(and(eq(aiEvalJudgeConfigRevisions.judgeConfigId, id), eq(aiEvalJudgeConfigRevisions.revision, revision)))
      .get();
    return row ? this.revisionFromRow(row) : null;
  }

  getRevisionByKey(key: string, revision: number): AIEvalJudgeConfigRevision | null {
    const row = this.database.db.select({ id: aiEvalJudgeConfigs.id }).from(aiEvalJudgeConfigs).where(eq(aiEvalJudgeConfigs.key, key)).get();
    return row ? this.getRevision(row.id, revision) : null;
  }

  list(): AIEvalJudgeConfig[] {
    return this.database.db
      .select()
      .from(aiEvalJudgeConfigs)
      .orderBy(asc(aiEvalJudgeConfigs.key))
      .all()
      .map((row) => this.getById(row.id))
      .filter((row): row is AIEvalJudgeConfig => row !== null);
  }

  getFingerprint(id: string, revision: number): string | null {
    const value = this.getRevision(id, revision);
    return value ? fingerprintAIEvalJudgeConfig(value) : null;
  }

  create(input: { id: string; content: AIEvalJudgeConfigContent; actor: AdminActor; now: number }): AIEvalJudgeConfigRevision {
    const content = normalizeAIEvalJudgeConfigContent(input.content);
    this.assertTimestamp(input.now);
    this.assertDependencies(content);
    try {
      return this.atomic(() => {
        this.database.db.insert(aiEvalJudgeConfigs).values({
          id: input.id,
          key: content.key,
          subjectKey: content.subjectKey,
          currentRevision: 1,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actor.actorUserId,
          updatedBy: input.actor.actorUserId,
        }).run();
        this.insertRevision(input.id, 1, content, input.actor, input.now);
        const revision = this.getRevision(input.id, 1);
        if (!revision) throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config revision could not be read after creation.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_CONFLICT", "The Eval Judge Config could not be created.", {}, error);
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalJudgeConfigContent; actor: AdminActor; now: number }): AIEvalJudgeConfigRevision {
    const current = this.database.db
      .select({ currentRevision: aiEvalJudgeConfigs.currentRevision, key: aiEvalJudgeConfigs.key, subjectKey: aiEvalJudgeConfigs.subjectKey })
      .from(aiEvalJudgeConfigs)
      .where(eq(aiEvalJudgeConfigs.id, input.id))
      .get();
    if (!current) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Judge Config was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_CONFLICT", "The Eval Judge Config changed before publication.");
    const content = normalizeAIEvalJudgeConfigContent(input.content);
    if (content.key !== current.key || content.subjectKey !== current.subjectKey) {
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_CONFLICT", "Eval Judge Config key and subject are immutable after creation.");
    }
    this.assertTimestamp(input.now);
    this.assertDependencies(content);
    const next = input.expectedRevision + 1;
    try {
      return this.atomic(() => {
        this.insertRevision(input.id, next, content, input.actor, input.now);
        const updated = this.database.db
          .update(aiEvalJudgeConfigs)
          .set({ currentRevision: next, updatedAt: input.now, updatedBy: input.actor.actorUserId })
          .where(and(eq(aiEvalJudgeConfigs.id, input.id), eq(aiEvalJudgeConfigs.currentRevision, input.expectedRevision)))
          .returning({ currentRevision: aiEvalJudgeConfigs.currentRevision })
          .get();
        if (!updated) throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_CONFLICT", "The Eval Judge Config changed before publication.");
        const revision = this.getRevision(input.id, next);
        if (!revision) throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config revision could not be read after publication.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_CONFLICT", "The Eval Judge Config revision could not be appended.", {}, error);
    }
  }

  private insertRevision(id: string, revision: number, content: AIEvalJudgeConfigContent, actor: AdminActor, now: number): void {
    const fingerprint = fingerprintAIEvalJudgeConfig({ ...content, judgeConfigId: id, revision });
    this.database.db.insert(aiEvalJudgeConfigRevisions).values({
      id: uuidv7(),
      judgeConfigId: id,
      revision,
      displayName: content.displayName,
      enabled: content.enabled,
      modelConfigId: content.modelConfigId,
      modelConfigRevision: content.modelConfigRevision,
      providerConfigId: content.providerConfigId,
      providerConfigRevision: content.providerConfigRevision,
      budgetPolicyId: content.budgetPolicyId,
      budgetPolicyRevision: content.budgetPolicyRevision,
      rateLimitPolicyId: content.rateLimitPolicyId,
      rateLimitPolicyRevision: content.rateLimitPolicyRevision,
      protocolKey: content.protocolKey,
      protocolRevision: content.protocolRevision,
      timeoutMs: content.timeoutMs,
      maxOutputTokens: content.maxOutputTokens,
      fingerprint,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIEvalJudgeConfigRevisionRow): AIEvalJudgeConfigRevision {
    const identity = this.database.db
      .select({ key: aiEvalJudgeConfigs.key, subjectKey: aiEvalJudgeConfigs.subjectKey })
      .from(aiEvalJudgeConfigs)
      .where(eq(aiEvalJudgeConfigs.id, row.judgeConfigId))
      .get();
    if (!identity) throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config identity is missing.");
    return {
      judgeConfigId: row.judgeConfigId,
      revisionId: row.id,
      revision: row.revision,
      key: identity.key,
      subjectKey: identity.subjectKey,
      displayName: row.displayName,
      enabled: row.enabled,
      modelConfigId: row.modelConfigId,
      modelConfigRevision: row.modelConfigRevision,
      providerConfigId: row.providerConfigId,
      providerConfigRevision: row.providerConfigRevision,
      budgetPolicyId: row.budgetPolicyId,
      budgetPolicyRevision: row.budgetPolicyRevision,
      rateLimitPolicyId: row.rateLimitPolicyId,
      rateLimitPolicyRevision: row.rateLimitPolicyRevision,
      protocolKey: row.protocolKey as AIEvalJudgeConfigRevision["protocolKey"],
      protocolRevision: row.protocolRevision as AIEvalJudgeConfigRevision["protocolRevision"],
      timeoutMs: row.timeoutMs,
      maxOutputTokens: row.maxOutputTokens,
      fingerprint: row.fingerprint,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }

  private assertDependencies(content: AIEvalJudgeConfigContent): void {
    if (!this.database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, content.subjectKey)).get()) {
      throw new AIEvalError("AI_EVAL_GOVERNANCE_INVALID", "The Eval Judge Config subject is not canonical.");
    }
    const model = this.database.db
      .select({ id: aiModelConfigs.id, revision: aiModelConfigs.revision, capability: aiModelConfigs.capability, enabled: aiModelConfigs.enabled, providerConfigId: aiModelConfigs.providerConfigId })
      .from(aiModelConfigs)
      .where(and(eq(aiModelConfigs.id, content.modelConfigId), eq(aiModelConfigs.revision, content.modelConfigRevision)))
      .get();
    const provider = this.database.db
      .select({ id: aiProviderConfigs.id, revision: aiProviderConfigs.revision, enabled: aiProviderConfigs.enabled, credentialRef: aiProviderConfigs.credentialRef })
      .from(aiProviderConfigs)
      .where(and(eq(aiProviderConfigs.id, content.providerConfigId), eq(aiProviderConfigs.revision, content.providerConfigRevision)))
      .get();
    const budget = this.database.db
      .select({ costCenter: aiBudgetPolicyRevisions.costCenter, enabled: aiBudgetPolicyRevisions.enabled })
      .from(aiBudgetPolicyRevisions)
      .where(and(eq(aiBudgetPolicyRevisions.budgetPolicyId, content.budgetPolicyId), eq(aiBudgetPolicyRevisions.revision, content.budgetPolicyRevision)))
      .get();
    const rate = this.database.db
      .select({ enabled: aiRateLimitPolicyRevisions.enabled })
      .from(aiRateLimitPolicyRevisions)
      .where(and(eq(aiRateLimitPolicyRevisions.rateLimitPolicyId, content.rateLimitPolicyId), eq(aiRateLimitPolicyRevisions.revision, content.rateLimitPolicyRevision)))
      .get();

    if (!model || !model.enabled || model.capability !== "GENERATION") {
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config must reference an enabled GENERATION Model Config.");
    }
    if (!provider || !provider.enabled || !provider.credentialRef) {
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config must reference an enabled Provider Config with credentials.");
    }
    if (model.providerConfigId !== content.providerConfigId) {
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Judge Model Config does not belong to the specified Provider Config.");
    }
    if (!budget || !budget.enabled || budget.costCenter !== "EVALS") {
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config must reference an enabled EVALS Budget Policy.");
    }
    if (!rate || !rate.enabled) {
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "The Eval Judge Config must reference an enabled Rate Limit Policy.");
    }
  }

  private atomic<T>(operation: () => T): T {
    return this.database.client.inTransaction ? operation() : this.database.client.transaction(operation).immediate();
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) {
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "Eval Judge Config timestamp is invalid.");
    }
  }
}

function key(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value.trim())) invalid(`${field} is invalid.`);
  return value.trim();
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(`${field} is invalid.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max) invalid(`${field} is invalid.`);
  return normalized;
}
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`${field} is invalid.`);
  return value;
}
function positive(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${field} is invalid.`);
  return value as number;
}
function bounded(value: unknown, min: number, max: number, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(`${field} is invalid.`);
  return value as number;
}
function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} is invalid.`);
  return value;
}
function invalid(message: string): never {
  throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", message);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
