import type { AICostOperation } from "../economics";
import type {
  AIBudgetAccount,
  AIBudgetReservation,
  AIBudgetSnapshot,
} from "../budget";
import type { AIRateLimitPolicyRevision } from "../rate-limits";

export interface AIAdmissionCostEstimate {
  currency: string;
  maxCostNano: number;
  estimateBasis: string;
  modelConfigId?: string | null;
  modelConfigRevision?: number | null;
  rateCardId?: string | null;
  rateCardRevision?: number | null;
}

export interface AIAdmissionPlan {
  principalRef: string;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  budgetPeriod: {
    startAt: number;
    endAt: number;
  };
  costOperationId: string;
  costEstimate: AIAdmissionCostEstimate;
  idempotencyKey: string;
  requestFingerprint: string;
}

export type AIAdmissionRequestFingerprintInput = Omit<AIAdmissionPlan, "requestFingerprint">;

export type AIAdmissionResult = {
  status: "ADMITTED";
  replayed: boolean;
  reservation: AIBudgetReservation;
  account: AIBudgetAccount;
  rateLimitPolicy: AIRateLimitPolicyRevision;
  snapshot: AIBudgetSnapshot;
};

export interface AIAdmissionSettlementResult {
  status: "SETTLED" | "RECONCILIATION_REQUIRED";
  reservation: AIBudgetReservation;
  actualCostNano: number | null;
  overageNano: number | null;
  snapshot: AIBudgetSnapshot;
}

export interface AIOperationCostObservation {
  operationId: string;
  observed: boolean;
  complete: boolean;
  currencies: readonly string[];
  effectiveCosts: ReadonlyMap<string, bigint>;
}

export interface AIBudgetAccountingReader {
  getOperation(operationId: string): AICostOperation | null;
  getOperationCost(operationId: string): AIOperationCostObservation;
  getEffectiveSpend(input: {
    principalRef: string;
    costCenter: string;
    periodStart: number;
    periodEnd: number;
    currency: string;
  }): bigint;
}
