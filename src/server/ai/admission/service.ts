import type { ContentDatabase } from "../../content/database";
import { randomUUID } from "node:crypto";

import type {
  AIBudgetAccount,
  AIBudgetPolicyRepository,
  AIBudgetPolicyRevision,
  AIBudgetReservation,
  AIBudgetSnapshot,
} from "../budget";
import { SQLiteAIBudgetPolicyRepository } from "../budget";
import { AIAdmissionError, type AIAdmissionErrorDetails } from "./errors";
import type {
  AIAdmissionPlan,
  AIAdmissionResult,
  AIAdmissionSettlementResult,
  AIBudgetAccountingReader,
  AIOperationCostObservation,
} from "./contracts";
import { normalizeAIAdmissionPlan } from "./validation";
import type { AIBudgetLedgerEventType } from "../budget";
import { SQLiteAIBudgetRuntimeRepository } from "../budget/sqlite-runtime-repository";
import type { AIRateLimitPolicyRepository, AIRateLimitPolicyRevision } from "../rate-limits";
import { SQLiteAIRateLimitPolicyRepository } from "../rate-limits";
import { SQLiteAIRateLimitRuntimeRepository } from "../rate-limits/sqlite-runtime-repository";
import { SQLiteAIBudgetAccountingReader } from "./accounting-reader";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const ADMISSION_TIMESTAMP_MAX = 8_640_000_000_000_000;

interface AIAdmissionServiceDependencies {
  budgetPolicies?: AIBudgetPolicyRepository;
  rateLimitPolicies?: AIRateLimitPolicyRepository;
  accounting?: AIBudgetAccountingReader;
  budgetRuntime?: SQLiteAIBudgetRuntimeRepository;
  rateLimitRuntime?: SQLiteAIRateLimitRuntimeRepository;
  clock?: () => number;
  idFactory?: () => string;
}

type AdmissionTransactionOutcome =
  | { kind: "ADMITTED"; result: AIAdmissionResult }
  | {
      kind: "REJECTED";
      code: "AI_BUDGET_EXCEEDED" | "AI_RATE_LIMITED" | "AI_ADMISSION_CONCURRENCY_LIMITED";
      message: string;
      details: AIAdmissionErrorDetails;
    };

export class AIBudgetAdmissionService {
  private readonly budgetPolicies: AIBudgetPolicyRepository;
  private readonly rateLimitPolicies: AIRateLimitPolicyRepository;
  private readonly accounting: AIBudgetAccountingReader;
  private readonly budgetRuntime: SQLiteAIBudgetRuntimeRepository;
  private readonly rateLimitRuntime: SQLiteAIRateLimitRuntimeRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: ContentDatabase,
    dependencies: AIAdmissionServiceDependencies = {},
  ) {
    this.budgetPolicies = dependencies.budgetPolicies ?? new SQLiteAIBudgetPolicyRepository(database);
    this.rateLimitPolicies = dependencies.rateLimitPolicies ?? new SQLiteAIRateLimitPolicyRepository(database);
    this.accounting = dependencies.accounting ?? new SQLiteAIBudgetAccountingReader(database);
    this.budgetRuntime = dependencies.budgetRuntime ?? new SQLiteAIBudgetRuntimeRepository(database);
    this.rateLimitRuntime = dependencies.rateLimitRuntime ?? new SQLiteAIRateLimitRuntimeRepository(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? randomUUID;
  }

  admit(value: unknown): AIAdmissionResult {
    const plan = normalizeAIAdmissionPlan(value);
    const now = this.safeNow();
    const outcome = this.database.client.transaction(() => this.admitInTransaction(plan, now)).immediate();
    if (outcome.kind === "REJECTED") throw new AIAdmissionError(outcome.code, outcome.message, outcome.details);
    return outcome.result;
  }

  getBudgetSnapshot(accountId: string): AIBudgetSnapshot {
    return this.database.client.transaction(() => {
      const account = this.budgetRuntime.getAccount(accountId);
      if (!account) throw new AIAdmissionError("AI_BUDGET_ACCOUNT_CONFLICT", "The Budget Account was not found.");
      return this.snapshotForAccount(account);
    })();
  }

  getReservation(reservationId: string): AIBudgetReservation | null {
    return this.budgetRuntime.getReservation(reservationId);
  }

  listLedger(reservationId: string) {
    return this.budgetRuntime.listLedger(reservationId);
  }

  startExecution(reservationId: string, at = this.safeNow()): AIBudgetReservation {
    this.assertTimestamp(at);
    return this.database.client.transaction(() => {
      const reservation = this.requireReservation(reservationId);
      if (reservation.status === "EXECUTING") return reservation;
      if (reservation.status !== "RESERVED") {
        throw new AIAdmissionError("AI_ADMISSION_INVALID", "Only a RESERVED admission can start execution.");
      }
      const updated = this.budgetRuntime.transitionReservation({
        id: reservation.id,
        expectedStatus: "RESERVED",
        status: "EXECUTING",
        executionStartedAt: at,
      });
      this.appendLifecycleLedger(updated, "EXECUTION_STARTED", null, "EXECUTION_STARTED", at);
      return updated;
    }).immediate();
  }

  releaseBeforeExecution(
    reservationId: string,
    at = this.safeNow(),
    reasonCode: "PRE_EXECUTION_RELEASE" | "STALE_PRE_EXECUTION_RECOVERY" = "PRE_EXECUTION_RELEASE",
  ): AIBudgetReservation {
    this.assertTimestamp(at);
    return this.database.client.transaction(() => {
      const reservation = this.requireReservation(reservationId);
      if (reservation.status === "RELEASED") return reservation;
      if (reservation.status !== "RESERVED") {
        throw new AIAdmissionError("AI_ADMISSION_INVALID", "Only a RESERVED admission can be released before execution.");
      }
      const updated = this.budgetRuntime.transitionReservation({
        id: reservation.id,
        expectedStatus: "RESERVED",
        status: "RELEASED",
        finalizedAt: at,
      });
      this.appendLifecycleLedger(updated, "RELEASED", updated.reservedNano, reasonCode, at);
      return updated;
    }).immediate();
  }

  settle(reservationId: string, at = this.safeNow()): AIAdmissionSettlementResult {
    this.assertTimestamp(at);
    return this.database.client.transaction(() => {
      const reservation = this.requireReservation(reservationId);
      const account = this.requireAccount(reservation.budgetAccountId);
      if (reservation.status === "RELEASED") throw new AIAdmissionError("AI_ADMISSION_INVALID", "A RELEASED reservation cannot be settled.");
      if (reservation.status === "RESERVED") throw new AIAdmissionError("AI_ADMISSION_INVALID", "Execution must start before settlement.");
      const cost = this.accounting.getOperationCost(reservation.operationId);
      if (reservation.status === "SETTLED") {
        const actualCostNano = this.knownCostNumber(cost, account.currency);
        const currentOverage = actualCostNano === null
          ? reservation.overageNano
          : Math.max(0, actualCostNano - reservation.reservedNano);
        const settledReservation = actualCostNano !== null && reservation.overageNano !== currentOverage
          ? this.budgetRuntime.transitionReservation({
              id: reservation.id,
              expectedStatus: "SETTLED",
              status: "SETTLED",
              overageNano: currentOverage,
            })
          : reservation;
        return this.settlementResult("SETTLED", settledReservation, account, cost);
      }
      if (!this.canSettle(cost, account.currency)) {
        const updated = reservation.status === "EXECUTING"
          ? this.budgetRuntime.transitionReservation({
              id: reservation.id,
              expectedStatus: "EXECUTING",
              status: "RECONCILIATION_REQUIRED",
            })
          : reservation;
        if (reservation.status === "EXECUTING") {
          this.appendLifecycleLedger(updated, "RECONCILIATION_REQUIRED", this.knownCostNumber(cost, account.currency), "ACCOUNTING_INCOMPLETE", at);
        }
        return this.settlementResult("RECONCILIATION_REQUIRED", updated, account, cost);
      }
      const actualCost = nonNegative(cost.effectiveCosts.get(account.currency) ?? BigInt(0));
      const overage = actualCost > BigInt(reservation.reservedNano)
        ? actualCost - BigInt(reservation.reservedNano)
        : BigInt(0);
      const updated = this.budgetRuntime.transitionReservation({
        id: reservation.id,
        expectedStatus: reservation.status,
        status: "SETTLED",
        finalizedAt: at,
        overageNano: safeNumber(overage),
      });
      this.appendLifecycleLedger(updated, "SETTLED", safeNumber(actualCost), overage > BigInt(0) ? "SETTLED_WITH_OVERAGE" : "SETTLED", at);
      return this.settlementResult("SETTLED", updated, account, cost);
    }).immediate();
  }

  private admitInTransaction(plan: AIAdmissionPlan, now: number): AdmissionTransactionOutcome {
    const budgetPolicy = this.requireEnabledBudgetPolicy(plan.budgetPolicyId, plan.budgetPolicyRevision);
    const rateLimitPolicy = this.requireEnabledRateLimitPolicy(plan.rateLimitPolicyId, plan.rateLimitPolicyRevision);
    if (plan.costEstimate.currency !== budgetPolicy.currency) {
      throw new AIAdmissionError("AI_BUDGET_CURRENCY_MISMATCH", "The admission estimate currency does not match the Budget Policy currency.", {
        budgetCurrency: budgetPolicy.currency,
        estimateCurrency: plan.costEstimate.currency,
      });
    }

    const existingEvent = this.rateLimitRuntime.getEventByIdempotency(plan.principalRef, plan.idempotencyKey);
    if (existingEvent) return this.replayExisting(plan, existingEvent, budgetPolicy, rateLimitPolicy);

    const operation = this.accounting.getOperation(plan.costOperationId);
    if (!operation) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Cost Operation was not found.");
    this.validateOperation(plan, operation, budgetPolicy.costCenter);

    const activeEvents = this.rateLimitRuntime.listActiveEvents({
      principalRef: plan.principalRef,
      rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
      rateLimitPolicyRevision: rateLimitPolicy.revision,
      now,
      windowMs: rateLimitPolicy.windowMs,
    });
    if (activeEvents.length >= rateLimitPolicy.maxRequests) {
      const oldest = activeEvents[0]?.occurredAt;
      return {
        kind: "REJECTED",
        code: "AI_RATE_LIMITED",
        message: "The admission rate limit has been reached.",
        details: {
          retryAfterMs: oldest === undefined ? rateLimitPolicy.windowMs : Math.max(0, oldest + rateLimitPolicy.windowMs - now),
          windowMs: rateLimitPolicy.windowMs,
          maxRequests: rateLimitPolicy.maxRequests,
          replayed: false,
        },
      };
    }

    const activeConcurrency = this.budgetRuntime.countActiveReservationsForRateScope({
      principalRef: plan.principalRef,
      rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
      rateLimitPolicyRevision: rateLimitPolicy.revision,
    });
    if (activeConcurrency >= rateLimitPolicy.maxConcurrentRequests) {
      this.rateLimitRuntime.createEvent({
        principalRef: plan.principalRef,
        rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
        rateLimitPolicyRevision: rateLimitPolicy.revision,
        idempotencyKey: plan.idempotencyKey,
        requestFingerprint: plan.requestFingerprint,
        operationId: plan.costOperationId,
        reservationId: null,
        outcome: "CONCURRENCY_LIMITED",
        occurredAt: now,
      });
      return {
        kind: "REJECTED",
        code: "AI_ADMISSION_CONCURRENCY_LIMITED",
        message: "The admission concurrency limit has been reached.",
        details: { maxConcurrentRequests: rateLimitPolicy.maxConcurrentRequests, activeReservations: activeConcurrency, replayed: false },
      };
    }

    const account = this.getOrCreateAccount(plan, budgetPolicy, now);
    const before = this.snapshotForAccount(account);
    const requested = BigInt(plan.costEstimate.maxCostNano);
    if (BigInt(before.totalExposureNano) + requested > BigInt(account.hardCapNano)) {
      this.rateLimitRuntime.createEvent({
        principalRef: plan.principalRef,
        rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
        rateLimitPolicyRevision: rateLimitPolicy.revision,
        idempotencyKey: plan.idempotencyKey,
        requestFingerprint: plan.requestFingerprint,
        operationId: plan.costOperationId,
        reservationId: null,
        outcome: "BUDGET_EXCEEDED",
        occurredAt: now,
      });
      return {
        kind: "REJECTED",
        code: "AI_BUDGET_EXCEEDED",
        message: "The Budget Account cannot reserve the requested exposure.",
        details: {
          currency: account.currency,
          hardCapNano: account.hardCapNano,
          remainingNano: before.remainingNano,
          requestedReservationNano: plan.costEstimate.maxCostNano,
          replayed: false,
        },
      };
    }

    const reservation = this.budgetRuntime.createReservation({
      id: this.idFactory(),
      budgetAccountId: account.id,
      operationId: plan.costOperationId,
      principalRef: plan.principalRef,
      rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
      rateLimitPolicyRevision: rateLimitPolicy.revision,
      idempotencyKey: plan.idempotencyKey,
      requestFingerprint: plan.requestFingerprint,
      reservedNano: plan.costEstimate.maxCostNano,
      status: "RESERVED",
      createdAt: now,
    });
    this.appendLifecycleLedger(reservation, "RESERVED", reservation.reservedNano, "ADMITTED", now);
    this.rateLimitRuntime.createEvent({
      principalRef: plan.principalRef,
      rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
      rateLimitPolicyRevision: rateLimitPolicy.revision,
      idempotencyKey: plan.idempotencyKey,
      requestFingerprint: plan.requestFingerprint,
      operationId: plan.costOperationId,
      reservationId: reservation.id,
      outcome: "ADMITTED",
      occurredAt: now,
    });
    return {
      kind: "ADMITTED",
      result: {
        status: "ADMITTED",
        replayed: false,
        reservation,
        account,
        rateLimitPolicy,
        snapshot: this.snapshotForAccount(account),
      },
    };
  }

  private replayExisting(
    plan: AIAdmissionPlan,
    event: { requestFingerprint: string; operationId: string; outcome: string; reservationId: string | null },
    budgetPolicy: AIBudgetPolicyRevision,
    rateLimitPolicy: AIRateLimitPolicyRevision,
  ): AdmissionTransactionOutcome {
    if (event.requestFingerprint !== plan.requestFingerprint || event.operationId !== plan.costOperationId) {
      throw new AIAdmissionError("AI_ADMISSION_IDEMPOTENCY_CONFLICT", "The idempotency key is already bound to a different admission request.");
    }
    if (event.outcome === "ADMITTED") {
      if (!event.reservationId) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The admitted request is missing its reservation.");
      const reservation = this.requireReservation(event.reservationId);
      const account = this.requireAccount(reservation.budgetAccountId);
      return {
        kind: "ADMITTED",
        result: {
          status: "ADMITTED",
          replayed: true,
          reservation,
          account,
          rateLimitPolicy,
          snapshot: this.snapshotForAccount(account),
        },
      };
    }
    if (event.outcome === "BUDGET_EXCEEDED") {
      const account = this.budgetRuntime.getAccountForPolicyPeriod({
        principalRef: plan.principalRef,
        budgetPolicyId: budgetPolicy.budgetPolicyId,
        periodStart: plan.budgetPeriod.startAt,
        periodEnd: plan.budgetPeriod.endAt,
      });
      if (!account) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The replayed budget denial has no Budget Account.");
      const snapshot = this.snapshotForAccount(account);
      return {
        kind: "REJECTED",
        code: "AI_BUDGET_EXCEEDED",
        message: "The original idempotent admission was budget-denied.",
        details: {
          currency: account.currency,
          hardCapNano: account.hardCapNano,
          remainingNano: snapshot.remainingNano,
          requestedReservationNano: plan.costEstimate.maxCostNano,
          replayed: true,
        },
      };
    }
    const active = this.budgetRuntime.countActiveReservationsForRateScope({
      principalRef: plan.principalRef,
      rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
      rateLimitPolicyRevision: rateLimitPolicy.revision,
    });
    return {
      kind: "REJECTED",
      code: "AI_ADMISSION_CONCURRENCY_LIMITED",
      message: "The original idempotent admission was concurrency-denied.",
      details: { maxConcurrentRequests: rateLimitPolicy.maxConcurrentRequests, activeReservations: active, replayed: true },
    };
  }

  private getOrCreateAccount(plan: AIAdmissionPlan, policy: AIBudgetPolicyRevision, now: number): AIBudgetAccount {
    const existing = this.budgetRuntime.getAccountForPolicyPeriod({
      principalRef: plan.principalRef,
      budgetPolicyId: policy.budgetPolicyId,
      periodStart: plan.budgetPeriod.startAt,
      periodEnd: plan.budgetPeriod.endAt,
    });
    if (existing) {
      if (existing.budgetPolicyRevision !== policy.revision) {
        throw new AIAdmissionError(
          "AI_BUDGET_ACCOUNT_POLICY_REVISION_CONFLICT",
          "The Budget period is already pinned to a different Policy revision.",
          {
            budgetAccountId: existing.id,
            budgetPolicyId: policy.budgetPolicyId,
            pinnedBudgetPolicyRevision: existing.budgetPolicyRevision,
            requestedBudgetPolicyRevision: policy.revision,
            periodStart: existing.periodStart,
            periodEnd: existing.periodEnd,
          },
        );
      }
      if (existing.currency !== policy.currency || existing.costCenter !== policy.costCenter || existing.hardCapNano !== policy.hardCapNano) {
        throw new AIAdmissionError("AI_BUDGET_ACCOUNT_CONFLICT", "The Budget Account policy snapshot is inconsistent.");
      }
      return existing;
    }
    try {
      return this.budgetRuntime.createAccount({
        id: this.idFactory(),
        principalRef: plan.principalRef,
        budgetPolicyId: policy.budgetPolicyId,
        budgetPolicyRevision: policy.revision,
        currency: policy.currency,
        costCenter: policy.costCenter,
        periodStart: plan.budgetPeriod.startAt,
        periodEnd: plan.budgetPeriod.endAt,
        hardCapNano: policy.hardCapNano,
        createdAt: now,
      });
    } catch (error) {
      if (!(error instanceof AIAdmissionError) || error.code !== "AI_BUDGET_ACCOUNT_CONFLICT") throw error;
      const raced = this.budgetRuntime.getAccountForPolicyPeriod({
        principalRef: plan.principalRef,
        budgetPolicyId: policy.budgetPolicyId,
        periodStart: plan.budgetPeriod.startAt,
        periodEnd: plan.budgetPeriod.endAt,
      });
      if (!raced) throw error;
      if (raced.budgetPolicyRevision !== policy.revision) {
        throw new AIAdmissionError(
          "AI_BUDGET_ACCOUNT_POLICY_REVISION_CONFLICT",
          "The Budget period is already pinned to a different Policy revision.",
          {
            budgetAccountId: raced.id,
            budgetPolicyId: policy.budgetPolicyId,
            pinnedBudgetPolicyRevision: raced.budgetPolicyRevision,
            requestedBudgetPolicyRevision: policy.revision,
            periodStart: raced.periodStart,
            periodEnd: raced.periodEnd,
          },
        );
      }
      return raced;
    }
  }

  private snapshotForAccount(account: AIBudgetAccount): AIBudgetSnapshot {
    const effectiveSpent = this.accounting.getEffectiveSpend({
      principalRef: account.principalRef,
      costCenter: account.costCenter,
      periodStart: account.periodStart,
      periodEnd: account.periodEnd,
      currency: account.currency,
    });
    const active = this.budgetRuntime.listActiveReservations(account.id);
    let additionalReserved = BigInt(0);
    for (const reservation of active) {
      const state = this.accounting.getOperationCost(reservation.operationId);
      const known = nonNegative(state.effectiveCosts.get(account.currency) ?? BigInt(0));
      const remaining = BigInt(reservation.reservedNano) > known
        ? BigInt(reservation.reservedNano) - known
        : BigInt(0);
      additionalReserved += remaining;
    }
    const totalExposure = effectiveSpent + additionalReserved;
    const cap = BigInt(account.hardCapNano);
    const remaining = totalExposure < cap ? cap - totalExposure : BigInt(0);
    return {
      budgetAccountId: account.id,
      currency: account.currency,
      periodStart: account.periodStart,
      periodEnd: account.periodEnd,
      hardCapNano: account.hardCapNano,
      effectiveSpentNano: safeNumber(effectiveSpent),
      activeReservedExposureNano: safeNumber(additionalReserved),
      totalExposureNano: safeNumber(totalExposure),
      remainingNano: safeNumber(remaining),
      activeReservationCount: active.length,
      overCap: totalExposure > cap,
    };
  }

  private settlementResult(
    status: "SETTLED" | "RECONCILIATION_REQUIRED",
    reservation: AIBudgetReservation,
    account: AIBudgetAccount,
    cost: AIOperationCostObservation,
  ): AIAdmissionSettlementResult {
    const actualCostNano = this.knownCostNumber(cost, account.currency);
    const overageNano = status === "SETTLED" && actualCostNano !== null
      ? Math.max(0, actualCostNano - reservation.reservedNano)
      : null;
    return {
      status,
      reservation,
      actualCostNano,
      overageNano,
      snapshot: this.snapshotForAccount(account),
    };
  }

  private appendLifecycleLedger(
    reservation: AIBudgetReservation,
    eventType: AIBudgetLedgerEventType,
    amountNano: number | null,
    reasonCode: string,
    createdAt: number,
  ): void {
    const account = this.requireAccount(reservation.budgetAccountId);
    this.budgetRuntime.appendLedgerOnce({
      budgetAccountId: account.id,
      reservationId: reservation.id,
      operationId: reservation.operationId,
      eventType,
      amountNano,
      currency: account.currency,
      reasonCode,
      createdAt,
    });
  }

  private requireEnabledBudgetPolicy(id: string, revision: number): AIBudgetPolicyRevision {
    const policy = this.budgetPolicies.getRevision(id, revision);
    if (!policy || !policy.enabled) throw new AIAdmissionError("AI_BUDGET_POLICY_NOT_FOUND", "The requested Budget Policy revision is not enabled.");
    return policy;
  }

  private requireEnabledRateLimitPolicy(id: string, revision: number): AIRateLimitPolicyRevision {
    const policy = this.rateLimitPolicies.getRevision(id, revision);
    if (!policy || !policy.enabled) throw new AIAdmissionError("AI_RATE_LIMIT_POLICY_NOT_FOUND", "The requested Rate Limit Policy revision is not enabled.");
    return policy;
  }

  private validateOperation(plan: AIAdmissionPlan, operation: ReturnType<AIBudgetAccountingReader["getOperation"]>, costCenter: string): asserts operation is NonNullable<typeof operation> {
    if (!operation) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Cost Operation was not found.");
    if (operation.opaquePrincipalRef !== plan.principalRef) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Cost Operation principal does not match the Admission Plan.");
    if (operation.costCenter !== costCenter) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Cost Operation cost center does not match the Budget Policy.");
    if (operation.startedAt < plan.budgetPeriod.startAt || operation.startedAt >= plan.budgetPeriod.endAt) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Cost Operation is outside the supplied Budget period.");
    if (operation.status !== "OPEN") throw new AIAdmissionError("AI_ADMISSION_INVALID", "Only an OPEN Cost Operation can be admitted.");
    if (operation.idempotencyKey !== null && operation.idempotencyKey !== plan.idempotencyKey) throw new AIAdmissionError("AI_ADMISSION_IDEMPOTENCY_CONFLICT", "The Cost Operation idempotency key does not match the Admission Plan.");
  }

  private requireReservation(id: string): AIBudgetReservation {
    const reservation = this.budgetRuntime.getReservation(id);
    if (!reservation) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Budget Reservation was not found.");
    return reservation;
  }

  private requireAccount(id: string): AIBudgetAccount {
    const account = this.budgetRuntime.getAccount(id);
    if (!account) throw new AIAdmissionError("AI_BUDGET_ACCOUNT_CONFLICT", "The Budget Account was not found.");
    return account;
  }

  private canSettle(cost: AIOperationCostObservation, currency: string): boolean {
    return cost.observed && cost.complete && cost.currencies.length === 1 && cost.currencies[0] === currency;
  }

  private knownCostNumber(cost: AIOperationCostObservation, currency: string): number | null {
    if (!cost.observed) return null;
    const value = cost.effectiveCosts.get(currency);
    return value === undefined ? null : safeNumber(nonNegative(value));
  }

  private safeNow(): number {
    const value = this.clock();
    this.assertTimestamp(value);
    return value;
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > ADMISSION_TIMESTAMP_MAX) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The admission timestamp is invalid.");
  }
}

function nonNegative(value: bigint): bigint {
  return value > BigInt(0) ? value : BigInt(0);
}

function safeNumber(value: bigint): number {
  if (value < BigInt(0) || value > MAX_SAFE) throw new AIAdmissionError("AI_ADMISSION_INVALID", "The Budget amount exceeds the safe integer range.");
  return Number(value);
}
