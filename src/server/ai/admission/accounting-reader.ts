import { createHash } from "node:crypto";

import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import {
  aiCostCorrections,
  aiCostOperations,
  aiUsageCostRecords,
} from "../../content/schema";
import type { AICostCenter, AICostOperation } from "../economics";
import { SQLiteAIAccountingRepository } from "../economics";
import { AI_EVALS_ADMISSION_PRINCIPAL_REF, type AIBudgetAccountingReader, type AIOperationCostObservation } from "./contracts";

export class SQLiteAIBudgetAccountingReader implements AIBudgetAccountingReader {
  private readonly accounting: SQLiteAIAccountingRepository;

  constructor(private readonly database: ContentDatabase) {
    this.accounting = new SQLiteAIAccountingRepository(database);
  }

  getOperation(operationId: string): AICostOperation | null {
    return this.accounting.getOperation(operationId);
  }

  getOperationCost(operationId: string): AIOperationCostObservation {
    const records = this.database.db.select().from(aiUsageCostRecords)
      .where(eq(aiUsageCostRecords.operationId, operationId))
      .orderBy(asc(aiUsageCostRecords.createdAt), asc(aiUsageCostRecords.id)).all();
    const effectiveCosts = new Map<string, bigint>();
    let complete = records.length > 0;
    const currencies = new Set<string>();
    const correctionIds: string[] = [];
    for (const record of records) {
      currencies.add(record.currency);
      effectiveCosts.set(record.currency, (effectiveCosts.get(record.currency) ?? BigInt(0)) + BigInt(record.knownCostNano));
      if (record.costCompleteness !== "COMPLETE") complete = false;
      const corrections = this.database.db.select().from(aiCostCorrections)
        .where(eq(aiCostCorrections.originalRecordId, record.id))
        .orderBy(asc(aiCostCorrections.createdAt), asc(aiCostCorrections.id)).all();
      for (const correction of corrections) {
        correctionIds.push(correction.id);
        currencies.add(correction.currency);
        effectiveCosts.set(correction.currency, (effectiveCosts.get(correction.currency) ?? BigInt(0)) + BigInt(correction.deltaCostNano));
      }
    }
    const usageRecordIds = records.map((record) => record.id);
    const sortedCurrencies = [...currencies].sort();
    const accountingFingerprint = createHash("sha256").update(JSON.stringify({
      version: 1,
      operationId,
      observed: records.length > 0,
      complete,
      currencies: sortedCurrencies,
      effectiveCosts: [...effectiveCosts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => [currency, amount.toString()]),
      usageRecordIds,
      correctionIds,
    })).digest("hex");
    return {
      operationId,
      observed: records.length > 0,
      complete,
      currencies: sortedCurrencies,
      effectiveCosts,
      usageRecordIds,
      correctionIds,
      accountingFingerprint,
    };
  }

  getEffectiveSpend(input: {
    principalRef: string;
    costCenter: AICostCenter;
    periodStart: number;
    periodEnd: number;
    currency: string;
  }): bigint {
    const principalScope = input.costCenter === "EVALS" && input.principalRef === AI_EVALS_ADMISSION_PRINCIPAL_REF
      ? isNull(aiCostOperations.opaquePrincipalRef)
      : eq(aiCostOperations.opaquePrincipalRef, input.principalRef);
    const operations = this.database.db.select({ id: aiCostOperations.id }).from(aiCostOperations).where(and(
      principalScope,
      eq(aiCostOperations.costCenter, input.costCenter),
      gte(aiCostOperations.startedAt, input.periodStart),
      lt(aiCostOperations.startedAt, input.periodEnd),
    )).all();
    let total = BigInt(0);
    for (const operation of operations) {
      const state = this.getOperationCost(operation.id);
      const effective = state.effectiveCosts.get(input.currency) ?? BigInt(0);
      total += effective > BigInt(0) ? effective : BigInt(0);
    }
    return total;
  }
}
