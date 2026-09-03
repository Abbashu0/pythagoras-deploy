import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiBudgetPolicyRevisions,
  aiEvalExecutionConfigRevisions,
  aiEvalExecutionConfigs,
  aiRateLimitPolicyRevisions,
  type AIEvalExecutionConfigRevisionRow,
} from "../../content/schema";
import type {
  AIEvalExecutionConfig,
  AIEvalExecutionConfigContent,
  AIEvalExecutionConfigRepository,
  AIEvalExecutionConfigRevision,
} from "./contracts";
import {
  AI_EVAL_CLEANUP_PROTOCOL_KEY,
  AI_EVAL_CLEANUP_PROTOCOL_REVISION,
  AI_EVAL_TARGET_PROTOCOL_KEY,
  AI_EVAL_TARGET_PROTOCOL_REVISION,
} from "./contracts";
import { AIEvalError } from "./errors";

const KEY_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]{0,79}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export function normalizeAIEvalExecutionConfigContent(value: unknown): AIEvalExecutionConfigContent {
  if (!isRecord(value)) invalid("The Eval Execution Config must be an object.");
  const expected = [
    "key", "subjectKey", "displayName", "enabled", "budgetPolicyId", "budgetPolicyRevision",
    "rateLimitPolicyId", "rateLimitPolicyRevision", "protocolKey", "protocolRevision", "targetTimeoutMs",
    "maxConcurrency", "cleanupProtocolKey", "cleanupProtocolRevision",
  ].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("Eval Execution Config fields are invalid.");
  const content: AIEvalExecutionConfigContent = {
    key: key(value.key, "key", KEY_PATTERN),
    subjectKey: key(value.subjectKey, "subjectKey", SUBJECT_PATTERN),
    displayName: text(value.displayName, "displayName", 200),
    enabled: booleanValue(value.enabled, "enabled"),
    budgetPolicyId: uuid(value.budgetPolicyId, "budgetPolicyId"),
    budgetPolicyRevision: positive(value.budgetPolicyRevision, "budgetPolicyRevision"),
    rateLimitPolicyId: uuid(value.rateLimitPolicyId, "rateLimitPolicyId"),
    rateLimitPolicyRevision: positive(value.rateLimitPolicyRevision, "rateLimitPolicyRevision"),
    protocolKey: value.protocolKey === AI_EVAL_TARGET_PROTOCOL_KEY ? AI_EVAL_TARGET_PROTOCOL_KEY : invalid("protocolKey is not supported."),
    protocolRevision: value.protocolRevision === AI_EVAL_TARGET_PROTOCOL_REVISION ? AI_EVAL_TARGET_PROTOCOL_REVISION : invalid("protocolRevision is not supported."),
    targetTimeoutMs: bounded(value.targetTimeoutMs, 100, 86_400_000, "targetTimeoutMs"),
    maxConcurrency: bounded(value.maxConcurrency, 1, 100, "maxConcurrency"),
    cleanupProtocolKey: value.cleanupProtocolKey === AI_EVAL_CLEANUP_PROTOCOL_KEY ? AI_EVAL_CLEANUP_PROTOCOL_KEY : invalid("cleanupProtocolKey is not supported."),
    cleanupProtocolRevision: value.cleanupProtocolRevision === AI_EVAL_CLEANUP_PROTOCOL_REVISION ? AI_EVAL_CLEANUP_PROTOCOL_REVISION : invalid("cleanupProtocolRevision is not supported."),
  };
  return content;
}

export function fingerprintAIEvalExecutionConfig(config: AIEvalExecutionConfigRevision | AIEvalExecutionConfigContent & { executionConfigId: string; revision: number }): string {
  const canonical = JSON.stringify({
    version: 1,
    executionConfigId: "executionConfigId" in config ? config.executionConfigId : null,
    revision: "revision" in config ? config.revision : null,
    key: config.key,
    subjectKey: config.subjectKey,
    displayName: config.displayName,
    enabled: config.enabled,
    budgetPolicyId: config.budgetPolicyId,
    budgetPolicyRevision: config.budgetPolicyRevision,
    rateLimitPolicyId: config.rateLimitPolicyId,
    rateLimitPolicyRevision: config.rateLimitPolicyRevision,
    protocolKey: config.protocolKey,
    protocolRevision: config.protocolRevision,
    targetTimeoutMs: config.targetTimeoutMs,
    maxConcurrency: config.maxConcurrency,
    cleanupProtocolKey: config.cleanupProtocolKey,
    cleanupProtocolRevision: config.cleanupProtocolRevision,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function toSafeAIEvalExecutionConfigDTO(config: AIEvalExecutionConfig): AIEvalExecutionConfig {
  return structuredClone(config);
}

export class SQLiteAIEvalExecutionConfigRepository implements AIEvalExecutionConfigRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIEvalExecutionConfig | null {
    const row = this.database.db.select().from(aiEvalExecutionConfigs).where(eq(aiEvalExecutionConfigs.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", "The current Eval Execution Config revision is missing.");
    return { ...revision, id: row.id, currentRevision: row.currentRevision, currentRevisionId: revision.revisionId, createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy };
  }

  getByKey(keyValue: string): AIEvalExecutionConfig | null {
    const row = this.database.db.select({ id: aiEvalExecutionConfigs.id }).from(aiEvalExecutionConfigs).where(eq(aiEvalExecutionConfigs.key, keyValue)).get();
    return row ? this.getById(row.id) : null;
  }

  getCurrentRevision(id: string): AIEvalExecutionConfigRevision | null {
    const row = this.database.db.select({ currentRevision: aiEvalExecutionConfigs.currentRevision }).from(aiEvalExecutionConfigs).where(eq(aiEvalExecutionConfigs.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIEvalExecutionConfigRevision | null {
    const row = this.database.db.select().from(aiEvalExecutionConfigRevisions).where(and(eq(aiEvalExecutionConfigRevisions.executionConfigId, id), eq(aiEvalExecutionConfigRevisions.revision, revision))).get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AIEvalExecutionConfig[] {
    return this.database.db.select().from(aiEvalExecutionConfigs).orderBy(asc(aiEvalExecutionConfigs.key)).all().map((row) => this.getById(row.id)).filter((row): row is AIEvalExecutionConfig => row !== null);
  }

  getFingerprint(id: string, revision: number): string | null {
    const value = this.getRevision(id, revision);
    return value ? fingerprintAIEvalExecutionConfig(value) : null;
  }

  create(input: { id: string; content: AIEvalExecutionConfigContent; actor: AdminActor; now: number }): AIEvalExecutionConfigRevision {
    const content = normalizeAIEvalExecutionConfigContent(input.content);
    this.assertTimestamp(input.now);
    this.assertDependencies(content);
    try {
      return this.atomic(() => {
        this.database.db.insert(aiEvalExecutionConfigs).values({ id: input.id, key: content.key, subjectKey: content.subjectKey, currentRevision: 1, createdAt: input.now, updatedAt: input.now, createdBy: input.actor.actorUserId, updatedBy: input.actor.actorUserId }).run();
        this.insertRevision(input.id, 1, content, input.actor, input.now);
        const revision = this.getRevision(input.id, 1);
        if (!revision) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", "The Eval Execution Config revision could not be read after creation.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_CONFLICT", "The Eval Execution Config could not be created.", {}, error);
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalExecutionConfigContent; actor: AdminActor; now: number }): AIEvalExecutionConfigRevision {
    const current = this.database.db.select({ currentRevision: aiEvalExecutionConfigs.currentRevision, key: aiEvalExecutionConfigs.key, subjectKey: aiEvalExecutionConfigs.subjectKey }).from(aiEvalExecutionConfigs).where(eq(aiEvalExecutionConfigs.id, input.id)).get();
    if (!current) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Execution Config was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_CONFLICT", "The Eval Execution Config changed before publication.");
    const content = normalizeAIEvalExecutionConfigContent(input.content);
    if (content.key !== current.key || content.subjectKey !== current.subjectKey) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_CONFLICT", "Eval Execution Config key and subject are immutable after creation.");
    this.assertTimestamp(input.now);
    this.assertDependencies(content);
    const next = input.expectedRevision + 1;
    try {
      return this.atomic(() => {
        this.insertRevision(input.id, next, content, input.actor, input.now);
        const updated = this.database.db.update(aiEvalExecutionConfigs).set({ currentRevision: next, updatedAt: input.now, updatedBy: input.actor.actorUserId }).where(and(eq(aiEvalExecutionConfigs.id, input.id), eq(aiEvalExecutionConfigs.currentRevision, input.expectedRevision))).returning({ currentRevision: aiEvalExecutionConfigs.currentRevision }).get();
        if (!updated) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_CONFLICT", "The Eval Execution Config changed before publication.");
        const revision = this.getRevision(input.id, next);
        if (!revision) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", "The Eval Execution Config revision could not be read after publication.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_CONFLICT", "The Eval Execution Config revision could not be appended.", {}, error);
    }
  }

  private insertRevision(id: string, revision: number, content: AIEvalExecutionConfigContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiEvalExecutionConfigRevisions).values({ id: uuidv7(), executionConfigId: id, revision, displayName: content.displayName, enabled: content.enabled, budgetPolicyId: content.budgetPolicyId, budgetPolicyRevision: content.budgetPolicyRevision, rateLimitPolicyId: content.rateLimitPolicyId, rateLimitPolicyRevision: content.rateLimitPolicyRevision, protocolKey: content.protocolKey, protocolRevision: content.protocolRevision, targetTimeoutMs: content.targetTimeoutMs, maxConcurrency: content.maxConcurrency, cleanupProtocolKey: content.cleanupProtocolKey, cleanupProtocolRevision: content.cleanupProtocolRevision, createdAt: now, createdBy: actor.actorUserId }).run();
  }

  private revisionFromRow(row: AIEvalExecutionConfigRevisionRow): AIEvalExecutionConfigRevision {
    const identity = this.database.db.select({ key: aiEvalExecutionConfigs.key, subjectKey: aiEvalExecutionConfigs.subjectKey }).from(aiEvalExecutionConfigs).where(eq(aiEvalExecutionConfigs.id, row.executionConfigId)).get();
    if (!identity) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", "The Eval Execution Config identity is missing.");
    return { executionConfigId: row.executionConfigId, revisionId: row.id, revision: row.revision, key: identity.key, subjectKey: identity.subjectKey, displayName: row.displayName, enabled: row.enabled, budgetPolicyId: row.budgetPolicyId, budgetPolicyRevision: row.budgetPolicyRevision, rateLimitPolicyId: row.rateLimitPolicyId, rateLimitPolicyRevision: row.rateLimitPolicyRevision, protocolKey: row.protocolKey as AIEvalExecutionConfigRevision["protocolKey"], protocolRevision: row.protocolRevision as AIEvalExecutionConfigRevision["protocolRevision"], targetTimeoutMs: row.targetTimeoutMs, maxConcurrency: row.maxConcurrency, cleanupProtocolKey: row.cleanupProtocolKey as AIEvalExecutionConfigRevision["cleanupProtocolKey"], cleanupProtocolRevision: row.cleanupProtocolRevision as AIEvalExecutionConfigRevision["cleanupProtocolRevision"], createdAt: row.createdAt, createdBy: row.createdBy };
  }

  private assertDependencies(content: AIEvalExecutionConfigContent): void {
    const budget = this.database.db.select({ costCenter: aiBudgetPolicyRevisions.costCenter, enabled: aiBudgetPolicyRevisions.enabled, currency: aiBudgetPolicyRevisions.currency }).from(aiBudgetPolicyRevisions).where(and(eq(aiBudgetPolicyRevisions.budgetPolicyId, content.budgetPolicyId), eq(aiBudgetPolicyRevisions.revision, content.budgetPolicyRevision))).get();
    const rate = this.database.db.select({ enabled: aiRateLimitPolicyRevisions.enabled }).from(aiRateLimitPolicyRevisions).where(and(eq(aiRateLimitPolicyRevisions.rateLimitPolicyId, content.rateLimitPolicyId), eq(aiRateLimitPolicyRevisions.revision, content.rateLimitPolicyRevision))).get();
    if (!budget || !budget.enabled || budget.costCenter !== "EVALS") throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", "The Eval Execution Config must reference an enabled EVALS Budget Policy.");
    if (!rate || !rate.enabled) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", "The Eval Execution Config must reference an enabled Rate Limit Policy.");
  }

  private atomic<T>(operation: () => T): T { return this.database.client.inTransaction ? operation() : this.database.client.transaction(operation).immediate(); }
  private assertTimestamp(value: number): void { if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", "Eval Execution Config timestamp is invalid."); }
}

function key(value: unknown, field: string, pattern: RegExp): string { if (typeof value !== "string" || !pattern.test(value.trim())) invalid(`${field} is invalid.`); return value.trim(); }
function text(value: unknown, field: string, max: number): string { if (typeof value !== "string") invalid(`${field} is invalid.`); const normalized = value.normalize("NFKC").trim(); if (!normalized || normalized.length > max) invalid(`${field} is invalid.`); return normalized; }
function uuid(value: unknown, field: string): string { if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`${field} is invalid.`); return value; }
function positive(value: unknown, field: string): number { if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${field} is invalid.`); return value as number; }
function bounded(value: unknown, min: number, max: number, field: string): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(`${field} is invalid.`); return value as number; }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== "boolean") invalid(`${field} is invalid.`); return value; }
function invalid(message: string): never { throw new AIEvalError("AI_EVAL_EXECUTION_CONFIG_INVALID", message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
