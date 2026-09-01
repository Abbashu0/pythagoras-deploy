import { and, asc, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import {
  aiBudgetAccounts,
  aiBudgetLedgerEntries,
  aiBudgetReservations,
  type AIBudgetAccountRow,
  type AIBudgetLedgerEntryRow,
  type AIBudgetReservationRow,
} from "../../content/schema";
import type {
  AIBudgetAccount,
  AIBudgetLedgerEntry,
  AIBudgetLedgerEventType,
  AIBudgetReservation,
  AIBudgetReservationStatus,
} from "./contracts";
import { AIAdmissionError } from "../admission/errors";

export class SQLiteAIBudgetRuntimeRepository {
  constructor(private readonly database: ContentDatabase) {}

  getAccount(id: string): AIBudgetAccount | null {
    const row = this.database.db.select().from(aiBudgetAccounts).where(eq(aiBudgetAccounts.id, id)).get();
    return row ? accountFromRow(row) : null;
  }

  getAccountForPolicyPeriod(input: {
    principalRef: string;
    budgetPolicyId: string;
    periodStart: number;
    periodEnd: number;
  }): AIBudgetAccount | null {
    const row = this.database.db.select().from(aiBudgetAccounts).where(and(
      eq(aiBudgetAccounts.principalRef, input.principalRef),
      eq(aiBudgetAccounts.budgetPolicyId, input.budgetPolicyId),
      eq(aiBudgetAccounts.periodStart, input.periodStart),
      eq(aiBudgetAccounts.periodEnd, input.periodEnd),
    )).get();
    return row ? accountFromRow(row) : null;
  }

  createAccount(input: {
    id: string;
    principalRef: string;
    budgetPolicyId: string;
    budgetPolicyRevision: number;
    currency: string;
    costCenter: AIBudgetAccount["costCenter"];
    periodStart: number;
    periodEnd: number;
    hardCapNano: number;
    createdAt: number;
  }): AIBudgetAccount {
    try {
      const row = this.database.db.insert(aiBudgetAccounts).values(input).returning().get();
      return accountFromRow(row);
    } catch (error) {
      throw new AIAdmissionError("AI_BUDGET_ACCOUNT_CONFLICT", "The Budget Account could not be created.", {}, error);
    }
  }

  getReservation(id: string): AIBudgetReservation | null {
    const row = this.database.db.select().from(aiBudgetReservations).where(eq(aiBudgetReservations.id, id)).get();
    return row ? reservationFromRow(row) : null;
  }

  getReservationByIdempotency(principalRef: string, idempotencyKey: string): AIBudgetReservation | null {
    const row = this.database.db.select().from(aiBudgetReservations).where(and(
      eq(aiBudgetReservations.principalRef, principalRef),
      eq(aiBudgetReservations.idempotencyKey, idempotencyKey),
    )).get();
    return row ? reservationFromRow(row) : null;
  }

  listActiveReservations(accountId: string): AIBudgetReservation[] {
    return this.database.db.select().from(aiBudgetReservations).where(and(
      eq(aiBudgetReservations.budgetAccountId, accountId),
      inArray(aiBudgetReservations.status, ["RESERVED", "EXECUTING", "RECONCILIATION_REQUIRED"]),
    )).orderBy(asc(aiBudgetReservations.createdAt), asc(aiBudgetReservations.id)).all().map(reservationFromRow);
  }

  countActiveReservationsForRateScope(input: {
    principalRef: string;
    rateLimitPolicyId: string;
    rateLimitPolicyRevision: number;
  }): number {
    return this.database.db.select({ id: aiBudgetReservations.id }).from(aiBudgetReservations).where(and(
      eq(aiBudgetReservations.principalRef, input.principalRef),
      eq(aiBudgetReservations.rateLimitPolicyId, input.rateLimitPolicyId),
      inArray(aiBudgetReservations.status, ["RESERVED", "EXECUTING", "RECONCILIATION_REQUIRED"]),
    )).all().length;
  }

  createReservation(input: Omit<AIBudgetReservation, "status" | "executionStartedAt" | "finalizedAt" | "overageNano"> & {
    status: "RESERVED";
  }): AIBudgetReservation {
    try {
      const row = this.database.db.insert(aiBudgetReservations).values({
        ...input,
        executionStartedAt: null,
        finalizedAt: null,
        overageNano: null,
      }).returning().get();
      return reservationFromRow(row);
    } catch (error) {
      throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Budget Reservation could not be created.", {}, error);
    }
  }

  transitionReservation(input: {
    id: string;
    expectedStatus: AIBudgetReservationStatus;
    status: AIBudgetReservationStatus;
    executionStartedAt?: number | null;
    finalizedAt?: number | null;
    overageNano?: number | null;
  }): AIBudgetReservation {
    const row = this.database.db.update(aiBudgetReservations).set({
      status: input.status,
      ...(input.executionStartedAt === undefined ? {} : { executionStartedAt: input.executionStartedAt }),
      ...(input.finalizedAt === undefined ? {} : { finalizedAt: input.finalizedAt }),
      ...(input.overageNano === undefined ? {} : { overageNano: input.overageNano }),
    }).where(and(
      eq(aiBudgetReservations.id, input.id),
      eq(aiBudgetReservations.status, input.expectedStatus),
    )).returning().get();
    if (!row) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Budget Reservation changed before its lifecycle transition.");
    return reservationFromRow(row);
  }

  getLedgerEntry(reservationId: string, eventType: AIBudgetLedgerEventType): AIBudgetLedgerEntry | null {
    const row = this.database.db.select().from(aiBudgetLedgerEntries).where(and(
      eq(aiBudgetLedgerEntries.reservationId, reservationId),
      eq(aiBudgetLedgerEntries.eventType, eventType),
    )).get();
    return row ? ledgerFromRow(row) : null;
  }

  appendLedger(input: {
    id?: string;
    budgetAccountId: string;
    reservationId: string;
    operationId: string;
    eventType: AIBudgetLedgerEventType;
    amountNano: number | null;
    currency: string;
    reasonCode: string | null;
    createdAt: number;
  }): AIBudgetLedgerEntry {
    const row = this.database.db.insert(aiBudgetLedgerEntries).values({
      id: input.id ?? uuidv7(),
      budgetAccountId: input.budgetAccountId,
      reservationId: input.reservationId,
      operationId: input.operationId,
      eventType: input.eventType,
      amountNano: input.amountNano,
      currency: input.currency,
      reasonCode: input.reasonCode,
      createdAt: input.createdAt,
    }).returning().get();
    return ledgerFromRow(row);
  }

  appendLedgerOnce(input: Parameters<SQLiteAIBudgetRuntimeRepository["appendLedger"]>[0]): AIBudgetLedgerEntry {
    const existing = this.getLedgerEntry(input.reservationId, input.eventType);
    return existing ?? this.appendLedger(input);
  }

  listLedger(reservationId: string): AIBudgetLedgerEntry[] {
    return this.database.db.select().from(aiBudgetLedgerEntries).where(eq(aiBudgetLedgerEntries.reservationId, reservationId))
      .orderBy(asc(aiBudgetLedgerEntries.createdAt), asc(aiBudgetLedgerEntries.id)).all().map(ledgerFromRow);
  }
}

function accountFromRow(row: AIBudgetAccountRow): AIBudgetAccount {
  return {
    id: row.id,
    principalRef: row.principalRef,
    budgetPolicyId: row.budgetPolicyId,
    budgetPolicyRevision: row.budgetPolicyRevision,
    currency: row.currency,
    costCenter: row.costCenter,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    hardCapNano: row.hardCapNano,
    createdAt: row.createdAt,
  };
}

function reservationFromRow(row: AIBudgetReservationRow): AIBudgetReservation {
  return {
    id: row.id,
    budgetAccountId: row.budgetAccountId,
    operationId: row.operationId,
    principalRef: row.principalRef,
    rateLimitPolicyId: row.rateLimitPolicyId,
    rateLimitPolicyRevision: row.rateLimitPolicyRevision,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    reservedNano: row.reservedNano,
    status: row.status,
    createdAt: row.createdAt,
    executionStartedAt: row.executionStartedAt,
    finalizedAt: row.finalizedAt,
    overageNano: row.overageNano,
  };
}

function ledgerFromRow(row: AIBudgetLedgerEntryRow): AIBudgetLedgerEntry {
  return {
    id: row.id,
    budgetAccountId: row.budgetAccountId,
    reservationId: row.reservationId,
    operationId: row.operationId,
    eventType: row.eventType,
    amountNano: row.amountNano,
    currency: row.currency,
    reasonCode: row.reasonCode,
    createdAt: row.createdAt,
  };
}
