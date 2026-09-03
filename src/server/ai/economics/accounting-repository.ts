import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { ContentDatabase } from "../../content/database";
import {
  aiCostCorrections,
  aiCostOperations,
  aiRateCardRevisions,
  aiUsageCostRecords,
  type AICostCorrectionRow,
  type AICostOperationRow,
  type AIUsageCostRecordRow,
} from "../../content/schema";
import type {
  AICostCorrection,
  AICostCorrectionContent,
  AICostOperation,
  AICostOperationContent,
  AIOperationCostSummary,
  AIAccountingRepository,
  AIUsageCostRecord,
  AIUsageCostRecordContent,
} from "./contracts";
import { AIAccountingError } from "./errors";
import {
  normalizeAICostCorrectionContent,
  normalizeAICostOperationContent,
  normalizeAIUsageCostRecordContent,
} from "./validation";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

export class SQLiteAIAccountingRepository implements AIAccountingRepository {
  constructor(private readonly database: ContentDatabase) {}

  createOperation(input: {
    id: string;
    content: AICostOperationContent;
  }): AICostOperation {
    const content = normalizeAICostOperationContent(input.content);
    try {
      const row = this.database.db.insert(aiCostOperations).values(contentRow(input.id, content)).returning().get();
      return operationFromRow(row);
    } catch (error) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The AI cost operation could not be created.", error);
    }
  }

  getOperation(id: string): AICostOperation | null {
    const row = this.database.db.select().from(aiCostOperations).where(eq(aiCostOperations.id, id)).get();
    return row ? operationFromRow(row) : null;
  }

  getOperationByResponseId(responseId: string): AICostOperation | null {
    const row = this.database.db.select().from(aiCostOperations).where(eq(aiCostOperations.responseId, responseId)).get();
    return row ? operationFromRow(row) : null;
  }

  getOperationByIdempotencyKey(idempotencyKey: string): AICostOperation | null {
    const row = this.database.db.select().from(aiCostOperations).where(eq(aiCostOperations.idempotencyKey, idempotencyKey)).get();
    return row ? operationFromRow(row) : null;
  }

  updateOperationStatus(input: {
    id: string;
    expectedStatus: AICostOperation["status"];
    status: AICostOperation["status"];
    completedAt: number | null;
  }): AICostOperation {
    if (input.completedAt !== null && (!Number.isSafeInteger(input.completedAt) || input.completedAt < 0)) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The operation completion timestamp is invalid.");
    }
    try {
      const row = this.database.db.update(aiCostOperations).set({
        status: input.status,
        completedAt: input.completedAt,
      }).where(and(eq(aiCostOperations.id, input.id), eq(aiCostOperations.status, input.expectedStatus))).returning().get();
      if (!row) throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The AI cost operation changed before its status update.");
      return operationFromRow(row);
    } catch (error) {
      if (error instanceof AIAccountingError) throw error;
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The AI cost operation status could not be updated.", error);
    }
  }

  appendUsageCostRecord(input: {
    id: string;
    content: AIUsageCostRecordContent;
    createdAt: number;
  }): AIUsageCostRecord {
    const content = normalizeAIUsageCostRecordContent(input.content);
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The usage record timestamp is invalid.");
    }
    const operation = this.getOperation(content.operationId);
    if (!operation) {
      throw new AIAccountingError("AI_ACCOUNTING_NOT_FOUND", "The AI cost operation was not found.");
    }
    if (operation.status !== "OPEN") {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "Usage cost records can only be appended while the AI cost operation is OPEN.");
    }
    const rateRevision = this.database.db.select({
      rateCardId: aiRateCardRevisions.rateCardId,
      revision: aiRateCardRevisions.revision,
    }).from(aiRateCardRevisions).where(eq(aiRateCardRevisions.id, content.rateCardRevisionId)).get();
    if (!rateRevision || rateRevision.rateCardId !== content.rateCardId || rateRevision.revision !== content.rateCardRevision) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The usage record does not reference a matching Rate Card revision.");
    }
    try {
      const row = this.database.db.insert(aiUsageCostRecords).values({
        ...recordRow(input.id, content),
        createdAt: input.createdAt,
      }).returning().get();
      return usageRecordFromRow(row);
    } catch (error) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The usage cost record could not be appended.", error);
    }
  }

  getUsageCostRecord(id: string): AIUsageCostRecord | null {
    const row = this.database.db.select().from(aiUsageCostRecords).where(eq(aiUsageCostRecords.id, id)).get();
    return row ? usageRecordFromRow(row) : null;
  }

  listUsageCostRecords(operationId: string): AIUsageCostRecord[] {
    return this.database.db.select().from(aiUsageCostRecords)
      .where(eq(aiUsageCostRecords.operationId, operationId))
      .orderBy(asc(aiUsageCostRecords.createdAt), asc(aiUsageCostRecords.id))
      .all()
      .map(usageRecordFromRow);
  }

  appendCorrection(input: {
    id: string;
    content: AICostCorrectionContent;
  }): AICostCorrection {
    const content = normalizeAICostCorrectionContent(input.content);
    const original = this.getUsageCostRecord(content.originalRecordId);
    if (!original) throw new AIAccountingError("AI_ACCOUNTING_NOT_FOUND", "The original usage cost record was not found.");
    if (original.currency !== content.currency) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "A cost correction currency must match its original record.");
    }
    try {
      const row = this.database.db.insert(aiCostCorrections).values({
        id: input.id,
        ...content,
      }).returning().get();
      return correctionFromRow(row);
    } catch (error) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The cost correction could not be appended.", error);
    }
  }

  listCorrections(originalRecordId: string): AICostCorrection[] {
    return this.database.db.select().from(aiCostCorrections)
      .where(eq(aiCostCorrections.originalRecordId, originalRecordId))
      .orderBy(asc(aiCostCorrections.createdAt), asc(aiCostCorrections.id))
      .all()
      .map(correctionFromRow);
  }

  getOperationCostSummary(operationId: string): AIOperationCostSummary {
    if (!this.getOperation(operationId)) {
      throw new AIAccountingError("AI_ACCOUNTING_NOT_FOUND", "The AI cost operation was not found.");
    }
    const totals = new Map<string, bigint>();
    for (const record of this.listUsageCostRecords(operationId)) {
      addTotal(totals, record.currency, BigInt(record.knownCostNano));
      for (const correction of this.listCorrections(record.id)) {
        addTotal(totals, correction.currency, BigInt(correction.deltaCostNano));
      }
    }
    return {
      operationId,
      totals: [...totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, total]) => ({ currency, totalNano: safeSignedNumber(total) })),
    };
  }

  listTotalsByPeriod(input: {
    from: number;
    to: number;
    dimension: "costCenter" | "model" | "provider" | "subject";
  }): Array<{ dimensionValue: string | null; currency: string; totalNano: number }> {
    if (!Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from < 0 || input.to < input.from) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The accounting period is invalid.");
    }
    const totals = new Map<string, { dimensionValue: string | null; currency: string; total: bigint }>();
    const records = this.database.db.select({
      record: aiUsageCostRecords,
      operation: aiCostOperations,
    }).from(aiUsageCostRecords)
      .innerJoin(aiCostOperations, eq(aiUsageCostRecords.operationId, aiCostOperations.id))
      .where(and(gte(aiUsageCostRecords.createdAt, input.from), lt(aiUsageCostRecords.createdAt, input.to)))
      .all();
    for (const row of records) {
      addDimensionTotal(totals, input.dimension, row.operation, row.record, row.record.currency, BigInt(row.record.knownCostNano));
    }
    const corrections = this.database.db.select({
      correction: aiCostCorrections,
      record: aiUsageCostRecords,
      operation: aiCostOperations,
    }).from(aiCostCorrections)
      .innerJoin(aiUsageCostRecords, eq(aiCostCorrections.originalRecordId, aiUsageCostRecords.id))
      .innerJoin(aiCostOperations, eq(aiUsageCostRecords.operationId, aiCostOperations.id))
      .where(and(gte(aiCostCorrections.createdAt, input.from), lt(aiCostCorrections.createdAt, input.to)))
      .all();
    for (const row of corrections) {
      addDimensionTotal(totals, input.dimension, row.operation, row.record, row.correction.currency, BigInt(row.correction.deltaCostNano));
    }
    return [...totals.values()]
      .sort((left, right) => (left.dimensionValue ?? "").localeCompare(right.dimensionValue ?? "") || left.currency.localeCompare(right.currency))
      .map((entry) => ({
        dimensionValue: entry.dimensionValue,
        currency: entry.currency,
        totalNano: safeSignedNumber(entry.total),
      }));
  }
}

function contentRow(id: string, content: AICostOperationContent) {
  return { id, ...content };
}

function recordRow(id: string, content: AIUsageCostRecordContent) {
  return { id, ...content };
}

function operationFromRow(row: AICostOperationRow): AICostOperation {
  return {
    id: row.id,
    costCenter: row.costCenter,
    idempotencyKey: row.idempotencyKey,
    opaquePrincipalRef: row.opaquePrincipalRef,
    subjectKey: row.subjectKey,
    conversationId: row.conversationId,
    responseId: row.responseId,
    jobId: row.jobId,
    evalRunId: row.evalRunId,
    knowledgeRevision: row.knowledgeRevision,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function usageRecordFromRow(row: AIUsageCostRecordRow): AIUsageCostRecord {
  return {
    id: row.id,
    operationId: row.operationId,
    gatewayRequestId: row.gatewayRequestId,
    attemptIndex: row.attemptIndex,
    capability: row.capability,
    modelConfigId: row.modelConfigId,
    modelConfigRevision: row.modelConfigRevision,
    providerConfigId: row.providerConfigId,
    providerConfigRevision: row.providerConfigRevision,
    providerRequestId: row.providerRequestId,
    rateCardId: row.rateCardId,
    rateCardRevision: row.rateCardRevision,
    rateCardRevisionId: row.rateCardRevisionId,
    resolvedPricingRule: row.resolvedPricingRule,
    normalizedInputTokens: row.normalizedInputTokens,
    normalizedCacheHitInputTokens: row.normalizedCacheHitInputTokens,
    normalizedCacheMissInputTokens: row.normalizedCacheMissInputTokens,
    normalizedOutputTokens: row.normalizedOutputTokens,
    normalizedReasoningTokens: row.normalizedReasoningTokens,
    billableStandardInputTokens: row.billableStandardInputTokens,
    billableCacheHitInputTokens: row.billableCacheHitInputTokens,
    billableCacheMissInputTokens: row.billableCacheMissInputTokens,
    billableOutputTokens: row.billableOutputTokens,
    billableReasoningTokens: row.billableReasoningTokens,
    requestUnits: row.requestUnits,
    currency: row.currency,
    knownCostNano: row.knownCostNano,
    costCompleteness: row.costCompleteness,
    costBasis: row.costBasis,
    attemptStatus: row.attemptStatus,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt,
  };
}

function correctionFromRow(row: AICostCorrectionRow): AICostCorrection {
  return {
    id: row.id,
    originalRecordId: row.originalRecordId,
    currency: row.currency,
    deltaCostNano: row.deltaCostNano,
    reasonCode: row.reasonCode,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
  };
}

function addTotal(totals: Map<string, bigint>, currency: string, value: bigint): void {
  totals.set(currency, (totals.get(currency) ?? BigInt(0)) + value);
}

function addDimensionTotal(
  totals: Map<string, { dimensionValue: string | null; currency: string; total: bigint }>,
  dimension: "costCenter" | "model" | "provider" | "subject",
  operation: AICostOperationRow,
  record: AIUsageCostRecordRow,
  currency: string,
  value: bigint,
): void {
  const dimensionValue = dimension === "costCenter"
    ? operation.costCenter
    : dimension === "model"
      ? record.modelConfigId
      : dimension === "provider"
        ? record.providerConfigId
        : dimension === "subject"
          ? operation.subjectKey
          : null;
  const key = `${dimension}\u0000${dimensionValue ?? ""}\u0000${currency}`;
  const current = totals.get(key);
  if (current) current.total += value;
  else totals.set(key, { dimensionValue, currency, total: value });
}

function safeSignedNumber(value: bigint): number {
  if (value < MIN_SAFE || value > MAX_SAFE) {
    throw new AIAccountingError("AI_COST_OVERFLOW", "The accounting total exceeds the safe integer range.");
  }
  return Number(value);
}
