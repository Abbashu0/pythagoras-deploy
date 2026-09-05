import type { ContentDatabase } from "../../../content/database";
import type {
  AIAdmissionResult,
  AIAdmissionSettlementResult,
  AIBudgetAdmissionService,
} from "../../admission";
import type {
  AIConversationFinishReason,
  AIConversationResponse,
  AIConversationStatus,
  AIConversationService,
  AIStudentPrincipal,
} from "../../conversations";
import type {
  AICostAccountingService,
  AICostOperation,
} from "../../economics";
import type {
  AIProviderGateway,
  AIProviderGatewayStream,
  AIProviderAttemptIdentity,
} from "../../gateway";
import type { AIModelConfigRepository } from "../../model-registry";
import type { AIProviderConfigRepository } from "../../configuration";
import type { AIRetrievalConfigRepository } from "../../retrieval-config";
import type { AIContextService } from "../../context";
import type { SQLiteAIContextPolicyRepository, SQLiteAIInstructionPolicyRepository } from "../../policy";
import type { AIBudgetPolicyRepository } from "../../budget";
import type { AIRateLimitPolicyRepository } from "../../rate-limits";
import type { AITutorConfigRepository } from "../configuration";
import type { AITutorGenerationPlanner } from "../planner";
import type { AITutorPreflightPlan, AITutorCostEstimate } from "../preflight/contracts";
import type { AITutorPreflightService } from "../preflight";
import type { AITutorResponseTrace, AITutorResponseTraceService } from "../trace";
import type { AITutorOutputValidator } from "../validation";
import type { AIEvidencePack, HybridRetrievalService } from "../../retrieval";
import type { AIContextTokenEstimator } from "../../context";
import type { AIMemoryService } from "../../memory";
import type { AIIntelligenceTelemetryService } from "../../telemetry";

export interface AITutorExecutionInput {
  principal: AIStudentPrincipal;
  responseId: string;
  tutorConfigId: string;
  signal?: AbortSignal;
}

export interface AITutorBudgetPeriod {
  startAt: number;
  endAt: number;
}

/** Product-owned billing-period boundary; no calendar policy is invented here. */
export interface AITutorBudgetPeriodResolver {
  resolve(input: {
    principalRef: string;
    budgetPolicyId: string;
    budgetPolicyRevision: number;
    at: number;
  }): AITutorBudgetPeriod | Promise<AITutorBudgetPeriod>;
}

export type AITutorExecutionStatus = "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELLED";
export type AITutorExecutionSettlementStatus = "SETTLED" | "RECONCILIATION_REQUIRED" | "RELEASED";

export interface AITutorExecutionResult {
  responseId: string;
  status: AITutorExecutionStatus;
  conversationStatus: AIConversationStatus;
  finishReason: AIConversationFinishReason | null;
  traceId: string | null;
  costOperationId: string;
  budgetReservationId: string | null;
  settlementStatus: AITutorExecutionSettlementStatus | null;
}

export type AITutorExecutionAccounting = Pick<
  AICostAccountingService,
  "getOperation" | "getOperationByResponseId" | "getOperationByIdempotencyKey" | "createOperation" | "completeOperation" | "recordAttempt"
>;

export type AITutorExecutionAdmission = Pick<
  AIBudgetAdmissionService,
  "admit" | "getReservation" | "getReservationByOperationId" | "startExecution" | "releaseBeforeExecution" | "settle"
>;

export type AITutorExecutionGateway = Pick<AIProviderGateway, "generate">;

export type AITutorExecutionConversation = Pick<
  AIConversationService,
  "getResponse" | "getConversation" | "listResponseChunks" | "startResponse" | "appendResponseChunk" | "completeResponse" | "failResponse" | "cancelResponse"
>;

export type AITutorExecutionTraceService = Pick<
  AITutorResponseTraceService,
  "create" | "getByResponse" | "transition"
>;

export type AITutorExecutionRetrieval = Pick<HybridRetrievalService, "retrieve" | "assertEvidencePackCurrent">;

export interface AITutorExecutionDependencies {
  database: ContentDatabase;
  preflight: Pick<AITutorPreflightService, "preflight">;
  conversations: AITutorExecutionConversation;
  context: Pick<AIContextService, "getSnapshot">;
  tutorConfigs: AITutorConfigRepository;
  instructionPolicies: SQLiteAIInstructionPolicyRepository;
  contextPolicies: SQLiteAIContextPolicyRepository;
  retrievalConfigs: AIRetrievalConfigRepository;
  budgetPolicies: AIBudgetPolicyRepository;
  rateLimitPolicies: AIRateLimitPolicyRepository;
  models: AIModelConfigRepository;
  providers: AIProviderConfigRepository;
  accounting: AITutorExecutionAccounting;
  admission: AITutorExecutionAdmission;
  retrieval: AITutorExecutionRetrieval;
  planner: Pick<AITutorGenerationPlanner, "plan">;
  outputValidator?: Pick<AITutorOutputValidator, "validate">;
  memory?: AIMemoryService;
  telemetry?: AIIntelligenceTelemetryService;
  traces: AITutorExecutionTraceService;
  gateway: AITutorExecutionGateway;
  estimator: AIContextTokenEstimator;
  budgetPeriodResolver: AITutorBudgetPeriodResolver;
  clock?: () => number;
}

export interface AITutorExecutionAdmissionContext {
  operation: AICostOperation;
  admission: AIAdmissionResult;
  period: AITutorBudgetPeriod;
  requestFingerprint: string;
}

export interface AITutorExecutionGenerationContext {
  stream: AIProviderGatewayStream;
  attempts: readonly import("../../gateway").AIProviderAttemptTrace[];
  usage: import("../../gateway").NormalizedProviderUsage;
  finishReason: AIConversationFinishReason;
  providerInvoked: boolean;
}

export type AITutorExecutionProviderIdentity = Readonly<AIProviderAttemptIdentity>;

export type AITutorExecutionSettlement = AIAdmissionSettlementResult | null;

export type AITutorExecutionSafeResponse = Pick<AIConversationResponse, "id" | "conversationId" | "status" | "principalRef">;

export type AITutorExecutionCostEstimate = Readonly<AITutorCostEstimate>;
