import type { AdminActor } from "../../admin-auth/contracts";
import type { AICostCenter } from "../economics";

export const AI_BUDGET_POLICY_RESOURCE_TYPE = "ai.budget-policy" as const;

export const AI_BUDGET_RESERVATION_STATUSES = [
  "RESERVED",
  "EXECUTING",
  "SETTLED",
  "RELEASED",
  "RECONCILIATION_REQUIRED",
] as const;
export type AIBudgetReservationStatus = (typeof AI_BUDGET_RESERVATION_STATUSES)[number];

export const AI_BUDGET_LEDGER_EVENT_TYPES = [
  "RESERVED",
  "EXECUTION_STARTED",
  "RELEASED",
  "SETTLED",
  "RECONCILIATION_REQUIRED",
] as const;
export type AIBudgetLedgerEventType = (typeof AI_BUDGET_LEDGER_EVENT_TYPES)[number];

export const AI_BUDGET_ACTIVE_RESERVATION_STATUSES = [
  "RESERVED",
  "EXECUTING",
  "RECONCILIATION_REQUIRED",
] as const satisfies readonly AIBudgetReservationStatus[];

export interface AIBudgetPolicyContent {
  key: string;
  displayName: string;
  currency: string;
  costCenter: AICostCenter;
  hardCapNano: number;
  enabled: boolean;
}
export interface AIBudgetPolicy extends AIBudgetPolicyContent {
  id: string;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIBudgetPolicyRevision extends AIBudgetPolicyContent {
  budgetPolicyId: string;
  revision: number;
  revisionId: string;
  createdAt: number;
  createdBy: string;
}

export interface SafeAIBudgetPolicyDTO {
  id: string;
  key: string;
  displayName: string;
  currency: string;
  costCenter: AICostCenter;
  hardCapNano: number;
  enabled: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface AIBudgetPolicyRepository {
  getById(id: string): AIBudgetPolicy | null;
  getCurrentRevision(id: string): AIBudgetPolicyRevision | null;
  getRevision(id: string, revision: number): AIBudgetPolicyRevision | null;
  list(): AIBudgetPolicy[];
  listRevisions(): AIBudgetPolicyRevision[];
  create(input: {
    id: string;
    content: AIBudgetPolicyContent;
    actor: AdminActor;
    now: number;
  }): AIBudgetPolicyRevision;
  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AIBudgetPolicyContent;
    actor: AdminActor;
    now: number;
  }): AIBudgetPolicyRevision;
}

export interface AIBudgetAccount {
  id: string;
  principalRef: string;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  currency: string;
  costCenter: AICostCenter;
  periodStart: number;
  periodEnd: number;
  hardCapNano: number;
  createdAt: number;
}

export interface AIBudgetReservation {
  id: string;
  budgetAccountId: string;
  operationId: string;
  principalRef: string;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  idempotencyKey: string;
  requestFingerprint: string;
  reservedNano: number;
  status: AIBudgetReservationStatus;
  createdAt: number;
  executionStartedAt: number | null;
  finalizedAt: number | null;
  overageNano: number | null;
}

export interface AIBudgetLedgerEntry {
  id: string;
  budgetAccountId: string;
  reservationId: string;
  operationId: string;
  eventType: AIBudgetLedgerEventType;
  amountNano: number | null;
  currency: string;
  reasonCode: string | null;
  createdAt: number;
}

export interface AIBudgetSnapshot {
  budgetAccountId: string;
  currency: string;
  periodStart: number;
  periodEnd: number;
  hardCapNano: number;
  effectiveSpentNano: number;
  activeReservedExposureNano: number;
  totalExposureNano: number;
  remainingNano: number;
  activeReservationCount: number;
  overCap: boolean;
}
