import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import type { ContentDatabase } from "../../../content/database";
import { canonicalMaterials } from "../../../content/schema";
import { assertActiveStudentPrincipal, type AIConversationResponse, type AIStudentPrincipal, SQLiteAIConversationRepository } from "../../conversations";
import { AIConversationError } from "../../conversations/errors";
import { AIContextService, type AIContextTokenEstimator } from "../../context";
import { AIContextError } from "../../context/errors";
import { SQLiteAIContextPolicyRepository } from "../../policy";
import { AIPolicyError } from "../../policy/errors";
import type { AIModelCapability, AIModelConfigRepository } from "../../model-registry";
import { SQLiteAIModelConfigRepository } from "../../model-registry";
import type { AIProviderConfigRepository } from "../../configuration";
import { SQLiteAIProviderConfigRepository } from "../../configuration";
import type { AIRetrievalConfigRepository } from "../../retrieval-config";
import { SQLiteAIRetrievalConfigRepository } from "../../retrieval-config";
import type { AIBudgetPolicyRepository } from "../../budget";
import { SQLiteAIBudgetPolicyRepository } from "../../budget";
import type { AIRateLimitPolicyRepository } from "../../rate-limits";
import { SQLiteAIRateLimitPolicyRepository } from "../../rate-limits";
import type { AIModelSelectionPlan, AIProviderAdapter } from "../../gateway";
import type { AITutorConfigRepository } from "../configuration";
import { SQLiteAITutorConfigRepository } from "../configuration";
import { AITutorConfigError } from "../configuration/errors";
import { AI_TUTOR_CITATION_PROTOCOL_KEY, AI_TUTOR_CITATION_PROTOCOL_REVISION, AI_TUTOR_GROUNDING_PROTOCOL_KEY, AI_TUTOR_GROUNDING_PROTOCOL_REVISION } from "../configuration/contracts";
import type { AITutorCostEstimator } from "./cost-estimator";
import { AIBoundedTutorCostEstimator, AITutorCostEstimationError } from "./cost-estimator";
import type { AITutorPreflightInput, AITutorPreflightPlan } from "./contracts";
import { AITutorPreflightError } from "./errors";
import { AIRateCardResolver, AICostCalculator, SQLiteAIRateCardModelRevisionRepository, SQLiteAIRateCardRepository } from "../../economics";
import { captureEstimator, cloneAndDeepFreeze, deepFreeze } from "../runtime-immutability";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AITutorPreflightDependencies {
  conversations?: SQLiteAIConversationRepository;
  tutorConfigs?: AITutorConfigRepository;
  context?: AIContextService;
  models?: AIModelConfigRepository;
  providers?: AIProviderConfigRepository;
  retrievalConfigs?: AIRetrievalConfigRepository;
  contextPolicies?: SQLiteAIContextPolicyRepository;
  budgetPolicies?: AIBudgetPolicyRepository;
  rateLimitPolicies?: AIRateLimitPolicyRepository;
  costEstimator?: AITutorCostEstimator;
  adapters?: { require(adapterKey: string, capability: AIModelCapability): AIProviderAdapter };
  clock?: () => number;
}

/** M8A server-only deterministic preflight. It never admits or invokes a Provider. */
export class AITutorPreflightService {
  private readonly conversations: SQLiteAIConversationRepository;
  private readonly tutorConfigs: AITutorConfigRepository;
  private readonly context: AIContextService;
  private readonly models: AIModelConfigRepository;
  private readonly providers: AIProviderConfigRepository;
  private readonly retrievalConfigs: AIRetrievalConfigRepository;
  private readonly contextPolicies: SQLiteAIContextPolicyRepository;
  private readonly budgetPolicies: AIBudgetPolicyRepository;
  private readonly rateLimitPolicies: AIRateLimitPolicyRepository;
  private readonly costEstimator: AITutorCostEstimator;
  private readonly adapters: AITutorPreflightDependencies["adapters"];
  private readonly clock: () => number;

  constructor(
    private readonly database: ContentDatabase,
    dependencies: AITutorPreflightDependencies = {},
  ) {
    this.conversations = dependencies.conversations ?? new SQLiteAIConversationRepository(database);
    this.tutorConfigs = dependencies.tutorConfigs ?? new SQLiteAITutorConfigRepository(database);
    this.context = dependencies.context ?? new AIContextService(database);
    this.models = dependencies.models ?? new SQLiteAIModelConfigRepository(database);
    this.providers = dependencies.providers ?? new SQLiteAIProviderConfigRepository(database);
    this.retrievalConfigs = dependencies.retrievalConfigs ?? new SQLiteAIRetrievalConfigRepository(database);
    this.contextPolicies = dependencies.contextPolicies ?? new SQLiteAIContextPolicyRepository(database);
    this.budgetPolicies = dependencies.budgetPolicies ?? new SQLiteAIBudgetPolicyRepository(database);
    this.rateLimitPolicies = dependencies.rateLimitPolicies ?? new SQLiteAIRateLimitPolicyRepository(database);
    this.costEstimator = dependencies.costEstimator ?? new AIBoundedTutorCostEstimator(
      new AIRateCardResolver(new SQLiteAIRateCardRepository(database), new SQLiteAIRateCardModelRevisionRepository(database)),
      this.providers,
      new AICostCalculator(),
    );
    this.adapters = dependencies.adapters;
    this.clock = dependencies.clock ?? Date.now;
  }

  preflight(input: AITutorPreflightInput): AITutorPreflightPlan {
    try {
      const principal = assertActiveStudentPrincipal(input.principal);
      const responseId = normalizeUuid(input.responseId, "responseId");
      const tutorConfigId = normalizeUuid(input.tutorConfigId, "tutorConfigId");
      validateEstimator(input.estimator);
      const estimator = captureEstimator(input.estimator);
      const response = this.requireResponse(principal, responseId);
      const conversation = this.conversations.getConversation(principal.principalRef, response.conversationId, true);
      if (!conversation || conversation.principalRef !== principal.principalRef || conversation.status !== "ACTIVE") {
        throw new AITutorPreflightError("AI_TUTOR_CONVERSATION_INVALID", "The Tutor Conversation is not active for this Student Principal.");
      }
      if (response.conversationId !== conversation.id || response.principalRef !== principal.principalRef || response.status !== "PENDING" || !response.requestMessageId) {
        throw new AITutorPreflightError("AI_TUTOR_RESPONSE_INVALID", "The Tutor Response is not pending and owned by the Student Principal.");
      }
      const currentMessage = this.conversations.getMessageForConversation(principal.principalRef, conversation.id, response.requestMessageId);
      if (!currentMessage || currentMessage.role !== "USER") throw new AITutorPreflightError("AI_TUTOR_RESPONSE_INVALID", "The Tutor Response current request Message is invalid.");

      const tutorConfig = this.tutorConfigs.getById(tutorConfigId);
      if (!tutorConfig) throw new AITutorPreflightError("AI_TUTOR_CONFIG_NOT_FOUND", "The Tutor Config was not found.");
      if (!tutorConfig.enabled) throw new AITutorPreflightError("AI_TUTOR_CONFIG_INVALID", "The Tutor Config is disabled.");
      if (tutorConfig.subjectKey !== conversation.subjectKey) throw new AITutorPreflightError("AI_TUTOR_CONFIG_INVALID", "The Tutor Config subject does not match the Conversation.");
      if (!this.isCanonicalSubject(conversation.subjectKey)) throw new AITutorPreflightError("AI_TUTOR_CONFIG_INVALID", "The Tutor subject is not canonical.");

      const generationModel = this.models.getById(tutorConfig.generationModelConfigId);
      if (!generationModel || generationModel.capability !== "GENERATION" || !generationModel.enabled || !generationModel.supportsStreaming || generationModel.contextWindowTokens === null || generationModel.maxOutputTokens === null || tutorConfig.maxOutputTokens > generationModel.maxOutputTokens) {
        throw new AITutorPreflightError("AI_TUTOR_MODEL_INVALID", "The Tutor Generation Model is not an enabled streaming model with sufficient limits.");
      }
      if (this.adapters) {
        try {
          this.adapters.require(generationModel.adapterKey, "GENERATION");
        } catch (error) {
          throw new AITutorPreflightError("AI_TUTOR_MODEL_INVALID", "The Tutor Generation adapter is not registered.", {}, error);
        }
      }
      const generationProvider = this.providers.getById(generationModel.providerConfigId);
      if (!generationProvider || !generationProvider.enabled || !generationProvider.credentialRef) throw new AITutorPreflightError("AI_TUTOR_PROVIDER_INVALID", "The Tutor Generation Provider is not configured for execution.");

      const retrievalConfig = this.retrievalConfigs.getById(tutorConfig.retrievalConfigId);
      const retrievalRevision = this.retrievalConfigs.getCurrentRevision(tutorConfig.retrievalConfigId);
      if (!retrievalConfig || !retrievalRevision || !retrievalConfig.enabled || retrievalConfig.subjectKey !== conversation.subjectKey) throw new AITutorPreflightError("AI_TUTOR_RETRIEVAL_CONFIG_INVALID", "The Tutor Retrieval Config is not enabled for this subject.");
      const contextPolicy = this.contextPolicies.getById(tutorConfig.contextPolicyId);
      if (!contextPolicy || !contextPolicy.enabled) throw new AITutorPreflightError("AI_TUTOR_CONTEXT_INVALID", "The Tutor Context Policy is not enabled.");
      const budgetPolicy = this.budgetPolicies.getCurrentRevision(tutorConfig.budgetPolicyId);
      if (!budgetPolicy || !budgetPolicy.enabled || budgetPolicy.costCenter !== "STUDENT_GENERATION") throw new AITutorPreflightError("AI_TUTOR_COST_INVALID", "The Tutor Budget Policy is not an enabled Student Generation policy.");
      const rateLimitPolicy = this.rateLimitPolicies.getCurrentRevision(tutorConfig.rateLimitPolicyId);
      if (!rateLimitPolicy || !rateLimitPolicy.enabled) throw new AITutorPreflightError("AI_TUTOR_PLAN_INVALID", "The Tutor Rate Limit Policy is not enabled.");

      const contextPlan = this.context.build(principal, {
        responseId,
        contextPolicyId: tutorConfig.contextPolicyId,
        estimator,
      }).plan;
      const costEstimate = this.costEstimator.estimate({
        currentMessageText: currentMessage.content,
        contextPlan,
        retrievalConfig: retrievalRevision,
        embeddingModel: this.requireOperationalModel(retrievalRevision.embeddingModelConfigId, "EMBEDDING", "The Tutor embedding Model is not operational."),
        rerankModel: retrievalRevision.rerankModelConfigId === null ? null : this.requireOperationalModel(retrievalRevision.rerankModelConfigId, "RERANK", "The Tutor rerank Model is not operational."),
        generationModel,
        maxOutputTokens: tutorConfig.maxOutputTokens,
        at: this.safeNow(),
      });
      if (costEstimate.currency !== budgetPolicy.currency) throw new AITutorPreflightError("AI_TUTOR_COST_CURRENCY_MISMATCH", "The Tutor cost estimate does not match the Budget Policy currency.", { budgetCurrency: budgetPolicy.currency, estimateCurrency: costEstimate.currency });
      const modelSelectionPlan: AIModelSelectionPlan = { capability: "GENERATION", attempts: [generationModel.id] };
      const planFingerprint = createPlanFingerprint({
        responseId,
        currentMessageId: currentMessage.id,
        conversationId: conversation.id,
        principalRef: principal.principalRef,
        subjectKey: conversation.subjectKey,
        tutorConfigId: tutorConfig.id,
        tutorConfigRevision: tutorConfig.currentRevision,
        contextSnapshotFingerprint: contextPlan.snapshot.fingerprint,
        globalPolicyId: contextPlan.snapshot.globalPolicyId,
        globalPolicyRevision: contextPlan.snapshot.globalPolicyRevision,
        subjectPolicyId: contextPlan.snapshot.subjectPolicyId,
        subjectPolicyRevision: contextPlan.snapshot.subjectPolicyRevision,
        contextPolicyId: contextPlan.snapshot.contextPolicyId,
        contextPolicyRevision: contextPlan.snapshot.contextPolicyRevision,
        retrievalConfigId: retrievalRevision.retrievalConfigId,
        retrievalConfigRevision: retrievalRevision.revision,
        generationModelConfigId: generationModel.id,
        generationModelConfigRevision: generationModel.revision,
        generationProviderConfigId: generationProvider.id,
        generationProviderConfigRevision: generationProvider.revision,
        providerModelId: generationModel.providerModelId,
        adapterKey: generationModel.adapterKey,
        contextWindowTokens: generationModel.contextWindowTokens,
        modelMaxOutputTokens: generationModel.maxOutputTokens,
        budgetPolicyId: budgetPolicy.budgetPolicyId,
        budgetPolicyRevision: budgetPolicy.revision,
        rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
        rateLimitPolicyRevision: rateLimitPolicy.revision,
        groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY,
        groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
        citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY,
        citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION,
        estimatorKey: estimator.estimatorKey,
        maxOutputTokens: tutorConfig.maxOutputTokens,
        costEstimate,
      });
      const plan: AITutorPreflightPlan = {
        responseId,
        conversationId: conversation.id,
        principalRef: principal.principalRef,
        subjectKey: conversation.subjectKey,
        currentMessageId: currentMessage.id,
        tutorConfigId: tutorConfig.id,
        tutorConfigRevision: tutorConfig.currentRevision,
        contextSnapshotId: contextPlan.snapshot.id,
        contextSnapshotFingerprint: contextPlan.snapshot.fingerprint,
        globalPolicyId: contextPlan.snapshot.globalPolicyId,
        globalPolicyRevision: contextPlan.snapshot.globalPolicyRevision,
        subjectPolicyId: contextPlan.snapshot.subjectPolicyId,
        subjectPolicyRevision: contextPlan.snapshot.subjectPolicyRevision,
        contextPolicyId: contextPlan.snapshot.contextPolicyId,
        contextPolicyRevision: contextPlan.snapshot.contextPolicyRevision,
        precedenceEnvelopeVersion: contextPlan.snapshot.precedenceEnvelopeVersion,
        estimatorKey: estimator.estimatorKey,
        retrievalConfigId: retrievalRevision.retrievalConfigId,
        retrievalConfigRevision: retrievalRevision.revision,
        generationModelConfigId: generationModel.id,
        generationModelConfigRevision: generationModel.revision,
        generationProviderConfigId: generationProvider.id,
        generationProviderConfigRevision: generationProvider.revision,
        providerModelId: generationModel.providerModelId,
        adapterKey: generationModel.adapterKey,
        contextWindowTokens: generationModel.contextWindowTokens,
        modelMaxOutputTokens: generationModel.maxOutputTokens,
        budgetPolicyId: budgetPolicy.budgetPolicyId,
        budgetPolicyRevision: budgetPolicy.revision,
        rateLimitPolicyId: rateLimitPolicy.rateLimitPolicyId,
        rateLimitPolicyRevision: rateLimitPolicy.revision,
        groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY,
        groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
        citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY,
        citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION,
        maxOutputTokens: tutorConfig.maxOutputTokens,
        costEstimate: cloneAndDeepFreeze(costEstimate),
        planFingerprint,
        modelSelectionPlan: cloneAndDeepFreeze(modelSelectionPlan),
        contextPlan: cloneAndDeepFreeze(contextPlan),
        estimator,
        retrievalConfig: cloneAndDeepFreeze(retrievalRevision),
        generationModel: cloneAndDeepFreeze(generationModel),
        generationProvider: cloneAndDeepFreeze({ id: generationProvider.id, revision: generationProvider.revision }),
        principal: cloneAndDeepFreeze(principal),
      };
      return freezePlan(plan);
    } catch (error) {
      throw mapPreflightError(error);
    }
  }

  build(input: AITutorPreflightInput): AITutorPreflightPlan {
    return this.preflight(input);
  }

  private requireResponse(principal: AIStudentPrincipal, responseId: string): AIConversationResponse {
    const response = this.conversations.getResponse(principal.principalRef, responseId, true);
    if (!response) throw new AITutorPreflightError("AI_TUTOR_RESPONSE_INVALID", "The Tutor Response was not found for this Student Principal.");
    return response;
  }

  private requireOperationalModel(id: string, capability: AIModelCapability, message: string) {
    const model = this.models.getById(id);
    if (!model || model.capability !== capability || !model.enabled) throw new AITutorPreflightError("AI_TUTOR_MODEL_INVALID", message);
    const provider = this.providers.getById(model.providerConfigId);
    if (!provider || !provider.enabled || !provider.credentialRef) throw new AITutorPreflightError("AI_TUTOR_PROVIDER_INVALID", "The Tutor Model Provider is not configured for execution.");
    return model;
  }

  private isCanonicalSubject(subjectKey: string): boolean {
    return Boolean(this.database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, subjectKey)).get());
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new AITutorPreflightError("AI_TUTOR_PLAN_INVALID", "Tutor planning time is invalid.");
    return value;
  }
}

export function createAITutorPreflightService(database: ContentDatabase, dependencies: AITutorPreflightDependencies = {}): AITutorPreflightService {
  return new AITutorPreflightService(database, dependencies);
}

function validateEstimator(value: AIContextTokenEstimator): void {
  if (!value || typeof value !== "object" || typeof value.estimatorKey !== "string" || typeof value.estimate !== "function") throw new AITutorPreflightError("AI_TUTOR_CONTEXT_INVALID", "A valid Context token estimator is required.");
}

function normalizeUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new AITutorPreflightError("AI_TUTOR_PLAN_INVALID", `The Tutor ${field} is invalid.`);
  return value;
}

function createPlanFingerprint(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({ version: 1, ...input }), "utf8").digest("hex");
}

function freezePlan(plan: AITutorPreflightPlan): AITutorPreflightPlan {
  return deepFreeze(plan);
}

function mapPreflightError(error: unknown): AITutorPreflightError {
  if (error instanceof AITutorPreflightError) return error;
  if (error instanceof AIConversationError) {
    return new AITutorPreflightError(error.code === "AI_STUDENT_PRINCIPAL_INACTIVE" ? "AI_TUTOR_PRINCIPAL_INACTIVE" : "AI_TUTOR_RESPONSE_INVALID", "The Tutor request principal or Conversation is not eligible.", {}, error);
  }
  if (error instanceof AIContextError || error instanceof AIPolicyError) return new AITutorPreflightError("AI_TUTOR_CONTEXT_INVALID", error.message, {}, error);
  if (error instanceof AITutorConfigError) return new AITutorPreflightError("AI_TUTOR_CONFIG_INVALID", "The Tutor Config is invalid.", {}, error);
  if (error instanceof AITutorCostEstimationError) {
    return new AITutorPreflightError(error.code === "AI_TUTOR_COST_CURRENCY_MISMATCH" ? "AI_TUTOR_COST_CURRENCY_MISMATCH" : "AI_TUTOR_COST_INVALID", "The Tutor cost estimate could not be resolved safely.", {}, error);
  }
  return new AITutorPreflightError("AI_TUTOR_PLAN_INVALID", "The Tutor preflight plan could not be built safely.", {}, error);
}
