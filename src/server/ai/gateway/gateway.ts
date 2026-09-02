import { v7 as uuidv7 } from "uuid";

import {
  isAIProviderAdapterError,
  isAIProviderAdapterRegistryError,
  isAIProviderGatewayError,
  AIProviderAdapterError,
  AIProviderGatewayError,
  safeProviderErrorMessage,
} from "./errors";
import type {
  AIProviderAdapter,
  AIProviderAttemptTrace,
  AIProviderGatewayDependencies,
  AIProviderGatewayOperationOptions,
  AIProviderGatewayOptions,
  AIProviderGatewayStream,
  AIProviderGatewayUnaryResult,
  AIModelSelectionPlan,
  EmbeddingGatewayRequest,
  EmbeddingProviderResult,
  GatewayGenerationStreamEvent,
  GenerationGatewayRequest,
  GenerationProviderRequest,
  NormalizedProviderUsage,
  ProviderGenerationStreamEvent,
  RerankGatewayRequest,
  RerankProviderResult,
} from "./contracts";
import {
  AI_GATEWAY_MAX_GENERATION_INSTRUCTIONS_BYTES,
  AI_GATEWAY_MAX_GENERATION_MESSAGE_BYTES,
  AI_GATEWAY_MAX_GENERATION_MESSAGES,
  AI_PROVIDER_ERROR_CODES,
  GENERATION_FINISH_REASONS,
} from "./contracts";
import type { AIModelCapability, AIModelConfig } from "../model-registry";
import type { AIProviderConfig } from "../configuration";
import { isAISecretStoreError } from "../secrets";
import {
  classifyAICircuitProviderOutcome,
} from "../circuit-breaker/contracts";
import { isAICircuitBreakerError } from "../circuit-breaker/errors";
import type {
  AICircuitAttemptPermit,
  AICircuitPermitDecision,
  AICircuitTarget,
} from "../circuit-breaker/contracts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_SELECTION_ATTEMPTS = 5;
const MAX_TEXT_BYTES = 256 * 1_024;
const MAX_EMBEDDING_BATCH = 128;
const MAX_RERANK_CANDIDATES = 128;
const MAX_GENERATION_DELTA_BYTES = 256 * 1_024;
const MAX_PROVIDER_REQUEST_ID_LENGTH = 200;
const MAX_SECRET_HANDSHAKE_RETRIES = 3;

interface PreparedAttempt {
  model: AIModelConfig;
  provider: AIProviderConfig;
  adapter: AIProviderAdapter;
  secretVersion: number;
}

interface ExecutionControl {
  signal: AbortSignal;
  timedOut(): boolean;
  cleanup(): void;
}

interface FailureDescriptor {
  code: (typeof AI_PROVIDER_ERROR_CODES)[number];
  retryable: boolean;
  fallbackEligible: boolean;
  providerRequestId?: string;
}

type AttemptHandshake =
  | { kind: "DENIED" }
  | {
      kind: "GRANTED";
      prepared: PreparedAttempt;
      credential: string;
      control: ExecutionControl;
      circuitPermit?: AICircuitAttemptPermit;
    };

class GatewayAbortError extends Error {
  constructor() {
    super("The provider operation was interrupted.");
    this.name = "GatewayAbortError";
  }
}

class GatewayProtocolError extends Error {
  constructor() {
    super("The provider returned an invalid response shape.");
    this.name = "GatewayProtocolError";
  }
}

export class AIProviderGateway {
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly clock: () => number;
  private readonly gatewayRequestIdFactory: () => string;

  constructor(
    private readonly dependencies: AIProviderGatewayDependencies,
    options: AIProviderGatewayOptions = {},
  ) {
    this.maxTimeoutMs = positiveBoundedInteger(
      options.maxTimeoutMs ?? MAX_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
      "maxTimeoutMs",
    );
    this.defaultTimeoutMs = positiveBoundedInteger(
      options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      this.maxTimeoutMs,
      "defaultTimeoutMs",
    );
    this.clock = options.clock ?? Date.now;
    this.gatewayRequestIdFactory = options.gatewayRequestIdFactory ?? uuidv7;
  }

  generate(
    plan: AIModelSelectionPlan,
    request: GenerationGatewayRequest,
    options: AIProviderGatewayOperationOptions = {},
  ): AIProviderGatewayStream {
    let resolveTrace!: (value: readonly AIProviderAttemptTrace[]) => void;
    const trace = new Promise<readonly AIProviderAttemptTrace[]>((resolve) => {
      resolveTrace = resolve;
    });
    return {
      events: this.runGeneration(plan, request, options, resolveTrace),
      trace,
    };
  }

  embed(
    plan: AIModelSelectionPlan,
    request: EmbeddingGatewayRequest,
    options: AIProviderGatewayOperationOptions = {},
  ): Promise<AIProviderGatewayUnaryResult<EmbeddingProviderResult>> {
    return this.runUnary(
      plan,
      request,
      options,
      "EMBEDDING",
      () => validateEmbeddingRequest(request),
      (prepared, context) => {
        if (prepared.adapter.capability !== "EMBEDDING") {
          throw new AIProviderAdapterError("CAPABILITY_MISMATCH");
        }
        return prepared.adapter.embed(
          {
            requestId: request.requestId,
            providerModelId: prepared.model.providerModelId,
            inputs: request.inputs,
            inputType: request.inputType,
          },
          context,
        );
      },
      (value, prepared) => validateEmbeddingResult(value, request, prepared.model),
    );
  }

  rerank(
    plan: AIModelSelectionPlan,
    request: RerankGatewayRequest,
    options: AIProviderGatewayOperationOptions = {},
  ): Promise<AIProviderGatewayUnaryResult<RerankProviderResult>> {
    return this.runUnary(
      plan,
      request,
      options,
      "RERANK",
      () => validateRerankRequest(request),
      (prepared, context) => {
        if (prepared.adapter.capability !== "RERANK") {
          throw new AIProviderAdapterError("CAPABILITY_MISMATCH");
        }
        return prepared.adapter.rerank(
          {
            requestId: request.requestId,
            providerModelId: prepared.model.providerModelId,
            query: request.query,
            candidates: request.candidates,
            topK: request.topK,
          },
          context,
        );
      },
      (value, prepared) => validateRerankResult(value, request),
    );
  }

  private async *runGeneration(
    plan: AIModelSelectionPlan,
    request: GenerationGatewayRequest,
    options: AIProviderGatewayOperationOptions,
    resolveTrace: (value: readonly AIProviderAttemptTrace[]) => void,
  ): AsyncGenerator<GatewayGenerationStreamEvent> {
    const attempts: AIProviderAttemptTrace[] = [];
    const gatewayRequestId = this.newGatewayRequestId();
    const parentSignal = options.signal ?? new AbortController().signal;
    try {
      validateSelectionPlan(plan, "GENERATION");
      validateGenerationRequest(request);
      const timeoutMs = this.resolveTimeout(options.timeoutMs);
      const deadlineAt = this.clock() + timeoutMs;
      if (parentSignal.aborted) throw new GatewayAbortError();

      let lastError: AIProviderGatewayError | null = null;
      let gatewayStarted = false;
      for (let attemptIndex = 0; attemptIndex < plan.attempts.length; attemptIndex += 1) {
        const trace = this.createAttemptTrace(
          gatewayRequestId,
          plan.capability,
          attemptIndex,
          plan.attempts[attemptIndex],
        );
        let control: ExecutionControl | undefined;
        let partialOutput = false;
        let attemptHadUsage = false;
        let circuitPermit: AICircuitAttemptPermit | undefined;
        let circuitOutcomeRecorded = false;
        let circuitDenied = false;
        try {
          const handshake = await this.resolveAttemptHandshake(
            plan,
            plan.attempts[attemptIndex],
            trace,
            options,
            parentSignal,
            deadlineAt,
            (prepared) => {
              if (!prepared.model.supportsStreaming) throw this.gatewayError("CONFIGURATION");
              if (
                request.maxOutputTokens !== undefined &&
                prepared.model.maxOutputTokens !== null &&
                request.maxOutputTokens > prepared.model.maxOutputTokens
              ) throw this.gatewayError("INVALID_REQUEST");
            },
          );
          if (handshake.kind === "DENIED") {
            circuitDenied = true;
            finishTrace(trace, "SKIPPED", this.clock, "CIRCUIT_OPEN");
            attempts.push(trace);
            lastError = this.gatewayError("CIRCUIT_OPEN", {
              retryable: true,
              fallbackEligible: true,
              attempts,
            });
            if (attemptIndex === plan.attempts.length - 1 || this.clock() >= deadlineAt) throw lastError;
            continue;
          }
          const { prepared, credential } = handshake;
          control = handshake.control;
          circuitPermit = handshake.circuitPermit;
          const attemptTimeoutMs = deadlineAt - this.clock();
          const providerRequest: GenerationProviderRequest = {
            requestId: request.requestId,
            providerModelId: prepared.model.providerModelId,
            instructions: request.instructions,
            messages: request.messages,
            maxOutputTokens: request.maxOutputTokens,
            reasoningEffort: request.reasoningEffort,
            temperature: request.temperature,
            stream: true,
          };
          trace.providerInvoked = true;
          const iterator = prepared.adapter.capability === "GENERATION"
            ? prepared.adapter
                .generate(providerRequest, {
                  signal: control.signal,
                  credential,
                  timeoutMs: attemptTimeoutMs,
                })
                [Symbol.asyncIterator]()
            : (() => {
                throw new AIProviderAdapterError("CAPABILITY_MISMATCH");
              })();
          let started = false;
          let terminal = false;
          try {
            while (true) {
              const next = await nextWithAbort(iterator, control.signal);
              if (next.done) break;
              const providerEvent = validateProviderGenerationEvent(next.value, {
                started,
                terminal,
              });
              if (providerEvent.type === "STARTED") {
                started = true;
                if (providerEvent.providerRequestId) {
                  trace.providerRequestId = providerEvent.providerRequestId;
                }
              } else if (providerEvent.type === "TEXT_DELTA") {
                partialOutput = true;
              } else if (providerEvent.type === "COMPLETED") {
                terminal = true;
                if (providerEvent.providerRequestId) {
                  trace.providerRequestId = providerEvent.providerRequestId;
                }
              } else if (providerEvent.type === "USAGE") {
                attemptHadUsage = true;
              }
              if (providerEvent.type === "STARTED") {
                if (!gatewayStarted) {
                  gatewayStarted = true;
                  yield { type: "STARTED" };
                }
              } else {
                yield toGatewayGenerationEvent(providerEvent);
              }
              if (providerEvent.type === "COMPLETED") {
                const trailing = await nextWithAbort(iterator, control.signal);
                if (!trailing.done) throw new GatewayProtocolError();
                break;
              }
            }
          } finally {
            await returnIterator(iterator);
          }
          if (!started || !terminal) throw new GatewayProtocolError();
          if (circuitPermit) {
            this.recordCircuitSuccess(circuitPermit);
            circuitOutcomeRecorded = true;
          }
          finishTrace(trace, "SUCCEEDED", this.clock);
          attempts.push(trace);
          return;
        } catch (error) {
          if (circuitDenied) throw error;
          const failure = normalizeFailure(error, control, parentSignal);
          if (circuitPermit && !circuitOutcomeRecorded) {
            if (trace.providerInvoked) this.recordCircuitFailure(circuitPermit, failure.code);
            else this.recordCircuitNeutral(circuitPermit);
            circuitOutcomeRecorded = true;
          }
          if (failure.providerRequestId) trace.providerRequestId = failure.providerRequestId;
          finishTrace(
            trace,
            failure.code === "TIMEOUT"
              ? "TIMEOUT"
              : failure.code === "CANCELLED"
                ? "CANCELLED"
                : "FAILED",
            this.clock,
            failure.code,
          );
          attempts.push(trace);
          lastError = this.gatewayError(failure.code, {
            retryable: failure.retryable,
            fallbackEligible: failure.fallbackEligible,
            attempts,
            providerRequestId: failure.providerRequestId,
          });
          if (
            !failure.fallbackEligible ||
            partialOutput ||
            attemptHadUsage ||
            attemptIndex === plan.attempts.length - 1 ||
            this.clock() >= deadlineAt
          ) {
            throw lastError;
          }
        } finally {
          control?.cleanup();
        }
      }
      if (lastError) throw lastError;
      throw this.gatewayError("UNKNOWN", { attempts });
    } catch (error) {
      if (error instanceof AIProviderGatewayError) {
        if (error.attempts.length === attempts.length) throw error;
        throw this.gatewayError(error.code, {
          retryable: error.retryable,
          fallbackEligible: error.fallbackEligible,
          attempts,
          providerRequestId: error.providerRequestId,
        });
      }
      const failure = normalizeFailure(error, undefined, parentSignal);
      throw this.gatewayError(failure.code, {
        retryable: failure.retryable,
        fallbackEligible: failure.fallbackEligible,
        attempts,
        providerRequestId: failure.providerRequestId,
      });
    } finally {
      resolveTrace(Object.freeze([...attempts]));
    }
  }

  private async runUnary<T>(
    plan: AIModelSelectionPlan,
    request: { requestId: string },
    options: AIProviderGatewayOperationOptions,
    capability: AIModelCapability,
    validateRequest: () => void,
    execute: (
      prepared: PreparedAttempt,
      context: { signal: AbortSignal; credential: string; timeoutMs: number },
    ) => Promise<T>,
    validateResult: (value: T, prepared: PreparedAttempt) => T,
  ): Promise<AIProviderGatewayUnaryResult<T>> {
    const attempts: AIProviderAttemptTrace[] = [];
    const gatewayRequestId = this.newGatewayRequestId();
    const parentSignal = options.signal ?? new AbortController().signal;
    validateSelectionPlan(plan, capability);
    validateRequest();
    const timeoutMs = this.resolveTimeout(options.timeoutMs);
    const deadlineAt = this.clock() + timeoutMs;
    if (parentSignal.aborted) {
      throw this.gatewayError("CANCELLED", { attempts });
    }

    let lastError: AIProviderGatewayError | null = null;
    for (let attemptIndex = 0; attemptIndex < plan.attempts.length; attemptIndex += 1) {
      const trace = this.createAttemptTrace(
        gatewayRequestId,
        capability,
        attemptIndex,
        plan.attempts[attemptIndex],
      );
      let control: ExecutionControl | undefined;
      let circuitPermit: AICircuitAttemptPermit | undefined;
      let circuitOutcomeRecorded = false;
      let circuitDenied = false;
      try {
        const handshake = await this.resolveAttemptHandshake(
          plan,
          plan.attempts[attemptIndex],
          trace,
          options,
          parentSignal,
          deadlineAt,
        );
        if (handshake.kind === "DENIED") {
          circuitDenied = true;
          finishTrace(trace, "SKIPPED", this.clock, "CIRCUIT_OPEN");
          attempts.push(trace);
          lastError = this.gatewayError("CIRCUIT_OPEN", {
            retryable: true,
            fallbackEligible: true,
            attempts,
          });
          if (attemptIndex === plan.attempts.length - 1 || this.clock() >= deadlineAt) throw lastError;
          continue;
        }
        const { prepared, credential } = handshake;
        control = handshake.control;
        circuitPermit = handshake.circuitPermit;
        const attemptTimeoutMs = deadlineAt - this.clock();
        trace.providerInvoked = true;
        const rawValue = await awaitWithAbort(
          execute(prepared, {
            signal: control.signal,
            credential,
            timeoutMs: attemptTimeoutMs,
          }),
          control.signal,
        );
        const value = validateResult(rawValue, prepared);
        const providerRequestId = getProviderRequestId(value);
        if (providerRequestId) trace.providerRequestId = providerRequestId;
        if (circuitPermit) {
          this.recordCircuitSuccess(circuitPermit);
          circuitOutcomeRecorded = true;
        }
        finishTrace(trace, "SUCCEEDED", this.clock);
        attempts.push(trace);
        return { value, attempts: Object.freeze([...attempts]) };
      } catch (error) {
        if (circuitDenied) throw error;
        const failure = normalizeFailure(error, control, parentSignal);
        if (circuitPermit && !circuitOutcomeRecorded) {
          if (trace.providerInvoked) this.recordCircuitFailure(circuitPermit, failure.code);
          else this.recordCircuitNeutral(circuitPermit);
          circuitOutcomeRecorded = true;
        }
        if (failure.providerRequestId) trace.providerRequestId = failure.providerRequestId;
        finishTrace(
          trace,
          failure.code === "TIMEOUT"
            ? "TIMEOUT"
            : failure.code === "CANCELLED"
              ? "CANCELLED"
              : "FAILED",
          this.clock,
          failure.code,
        );
        attempts.push(trace);
        lastError = this.gatewayError(failure.code, {
          retryable: failure.retryable,
          fallbackEligible: failure.fallbackEligible,
          attempts,
          providerRequestId: failure.providerRequestId,
        });
        if (
          !failure.fallbackEligible ||
          attemptIndex === plan.attempts.length - 1 ||
          this.clock() >= deadlineAt
        ) {
          throw lastError;
        }
      } finally {
        control?.cleanup();
      }
    }
    if (lastError) throw lastError;
    throw this.gatewayError("UNKNOWN", { attempts });
  }

  private prepareAttempt(
    plan: AIModelSelectionPlan,
    modelConfigId: string,
    trace: AIProviderAttemptTrace,
  ): PreparedAttempt {
    const model = this.dependencies.modelConfigs.getById(modelConfigId);
    if (!model) throw this.gatewayError("CONFIGURATION");
    trace.modelConfigRevision = model.revision;
    trace.providerConfigId = model.providerConfigId;
    trace.adapterKey = model.adapterKey;
    trace.providerModelId = model.providerModelId;
    if (model.capability !== plan.capability) {
      throw this.gatewayError("CAPABILITY_MISMATCH");
    }
    if (!model.enabled) throw this.gatewayError("CONFIGURATION");
    const provider = this.dependencies.providerConfigs.getById(model.providerConfigId);
    if (!provider) throw this.gatewayError("CONFIGURATION");
    trace.providerConfigRevision = provider.revision;
    if (!provider.enabled) throw this.gatewayError("CONFIGURATION");
    if (!provider.credentialRef) throw this.gatewayError("SECRET_UNAVAILABLE");
    const metadata = this.dependencies.secrets.getMetadata(provider.credentialRef);
    if (!metadata || metadata.status !== "ACTIVE") {
      throw this.gatewayError("SECRET_UNAVAILABLE");
    }
    const adapter = this.dependencies.adapters.require(model.adapterKey, plan.capability);
    return { model, provider, adapter, secretVersion: metadata.secretVersion };
  }

  private async resolveAttemptHandshake(
    plan: AIModelSelectionPlan,
    modelConfigId: string,
    trace: AIProviderAttemptTrace,
    options: AIProviderGatewayOperationOptions,
    parentSignal: AbortSignal,
    deadlineAt: number,
    validatePrepared?: (prepared: PreparedAttempt) => void,
  ): Promise<AttemptHandshake> {
    for (let handshakeIndex = 0; handshakeIndex < MAX_SECRET_HANDSHAKE_RETRIES; handshakeIndex += 1) {
      const prepared = this.prepareAttempt(plan, modelConfigId, trace);
      validatePrepared?.(prepared);
      const circuitDecision = this.acquireCircuitPermit(prepared, options);
      if (circuitDecision?.kind === "DENIED") {
        const metadata = this.dependencies.secrets.getMetadata(prepared.provider.credentialRef!);
        if (!metadata || metadata.status !== "ACTIVE" || metadata.secretVersion !== prepared.secretVersion) continue;
        return { kind: "DENIED" };
      }
      const circuitPermit = circuitDecision?.permit;
      const attemptTimeoutMs = deadlineAt - this.clock();
      if (attemptTimeoutMs <= 0) {
        if (circuitPermit) this.recordCircuitNeutral(circuitPermit);
        throw this.gatewayError("TIMEOUT");
      }
      const control = createExecutionControl(parentSignal, attemptTimeoutMs);
      try {
        const credential = await awaitWithAbort(
          this.dependencies.secrets.resolveVersion({
            credentialRef: prepared.provider.credentialRef!,
            expectedSecretVersion: prepared.secretVersion,
          }),
          control.signal,
        );
        if (control.signal.aborted) throw new GatewayAbortError();
        return { kind: "GRANTED", prepared, credential, control, circuitPermit };
      } catch (error) {
        control.cleanup();
        if (circuitPermit) this.recordCircuitNeutral(circuitPermit);
        if (isAISecretVersionChanged(error)) {
          if (handshakeIndex + 1 < MAX_SECRET_HANDSHAKE_RETRIES) continue;
          throw this.gatewayError("SECRET_UNAVAILABLE");
        }
        throw error;
      }
    }
    throw this.gatewayError("SECRET_UNAVAILABLE");
  }

  private acquireCircuitPermit(
    prepared: PreparedAttempt,
    options: AIProviderGatewayOperationOptions,
  ): AICircuitPermitDecision | null {
    const breaker = this.dependencies.circuitBreaker;
    const policy = options.circuitPolicy;
    if (!policy) return null;
    if (!breaker) throw this.gatewayError("CONFIGURATION");
    const target: AICircuitTarget = {
      policyId: policy.policyId,
      policyRevision: policy.policyRevision,
      modelConfigId: prepared.model.id,
      modelConfigRevision: prepared.model.revision,
      providerConfigId: prepared.provider.id,
      providerConfigRevision: prepared.provider.revision,
      capability: prepared.model.capability,
      adapterKey: prepared.model.adapterKey,
      secretVersion: prepared.secretVersion,
    };
    try {
      return breaker.acquirePermit({ target, at: this.clock() });
    } catch (error) {
      if (isAICircuitBreakerError(error)) throw this.gatewayError("CONFIGURATION");
      throw error;
    }
  }

  private recordCircuitSuccess(permit: AICircuitAttemptPermit): void {
    try {
      this.dependencies.circuitBreaker?.recordSuccess(permit, this.clock());
    } catch (error) {
      if (isAICircuitBreakerError(error) && error.code === "AI_CIRCUIT_STALE_PERMIT") return;
      throw error;
    }
  }

  private recordCircuitFailure(permit: AICircuitAttemptPermit, errorCode: FailureDescriptor["code"]): void {
    const classification = classifyAICircuitProviderOutcome(errorCode);
    try {
      if (classification === "COUNTED" || classification === "AUTHENTICATION") {
        this.dependencies.circuitBreaker?.recordFailure({
          permit,
          errorCode: errorCode as "RATE_LIMITED" | "TIMEOUT" | "UNAVAILABLE" | "BAD_RESPONSE" | "UNKNOWN" | "AUTHENTICATION",
          at: this.clock(),
        });
      } else {
        this.dependencies.circuitBreaker?.recordNeutral(permit, this.clock());
      }
    } catch (error) {
      if (isAICircuitBreakerError(error) && error.code === "AI_CIRCUIT_STALE_PERMIT") return;
      throw error;
    }
  }

  private recordCircuitNeutral(permit: AICircuitAttemptPermit): void {
    try {
      this.dependencies.circuitBreaker?.recordNeutral(permit, this.clock());
    } catch (error) {
      if (isAICircuitBreakerError(error) && error.code === "AI_CIRCUIT_STALE_PERMIT") return;
      throw error;
    }
  }

  private createAttemptTrace(
    gatewayRequestId: string,
    capability: AIModelCapability,
    attemptIndex: number,
    modelConfigId: string,
  ): AIProviderAttemptTrace {
    return {
      gatewayRequestId,
      capability,
      attemptIndex,
      modelConfigId,
      modelConfigRevision: null,
      providerConfigId: null,
      providerConfigRevision: null,
      adapterKey: null,
      providerModelId: null,
      startedAt: this.clock(),
      completedAt: null,
      latencyMs: null,
      status: "FAILED",
      providerInvoked: false,
    };
  }

  private resolveTimeout(timeoutMs: number | undefined): number {
    return positiveBoundedInteger(
      timeoutMs ?? this.defaultTimeoutMs,
      this.maxTimeoutMs,
      "timeoutMs",
    );
  }

  private newGatewayRequestId(): string {
    const value = this.gatewayRequestIdFactory();
    if (typeof value !== "string" || value.length < 1 || value.length > 120) {
      throw this.gatewayError("CONFIGURATION");
    }
    return value;
  }

  private gatewayError(
    code: FailureDescriptor["code"],
    options: {
      retryable?: boolean;
      fallbackEligible?: boolean;
      attempts?: readonly AIProviderAttemptTrace[];
      providerRequestId?: string;
    } = {},
  ): AIProviderGatewayError {
    return new AIProviderGatewayError(code, safeProviderErrorMessage(code), options);
  }
}

function validateSelectionPlan(
  plan: AIModelSelectionPlan,
  expectedCapability: AIModelCapability,
): void {
  if (!isPlainObject(plan) || plan.capability !== expectedCapability) {
    throw new AIProviderGatewayError(
      "INVALID_REQUEST",
      safeProviderErrorMessage("INVALID_REQUEST"),
    );
  }
  if (
    !Array.isArray(plan.attempts) ||
    plan.attempts.length < 1 ||
    plan.attempts.length > MAX_SELECTION_ATTEMPTS
  ) {
    throw new AIProviderGatewayError(
      "INVALID_REQUEST",
      safeProviderErrorMessage("INVALID_REQUEST"),
    );
  }
  const seen = new Set<string>();
  for (const modelId of plan.attempts) {
    if (
      typeof modelId !== "string" ||
      modelId.trim().length < 1 ||
      modelId.length > 120 ||
      seen.has(modelId)
    ) {
      throw new AIProviderGatewayError(
        "INVALID_REQUEST",
        safeProviderErrorMessage("INVALID_REQUEST"),
      );
    }
    seen.add(modelId);
  }
}

function validateGenerationRequest(request: GenerationGatewayRequest): void {
  if (!isPlainObject(request) || !boundedText(request.requestId, 120, false)) {
    throw invalidRequestError();
  }
  if (!Array.isArray(request.messages) || request.messages.length < 1 || request.messages.length > AI_GATEWAY_MAX_GENERATION_MESSAGES) {
    throw invalidRequestError();
  }
  if (request.stream !== true) throw invalidRequestError();
  for (const message of request.messages) {
    if (
      !isPlainObject(message) ||
      !["system", "user", "assistant"].includes(String(message.role)) ||
      !boundedText(message.content, AI_GATEWAY_MAX_GENERATION_MESSAGE_BYTES, true)
    ) {
      throw invalidRequestError();
    }
  }
  if (request.instructions !== undefined && !boundedText(request.instructions, AI_GATEWAY_MAX_GENERATION_INSTRUCTIONS_BYTES, false)) {
    throw invalidRequestError();
  }
  if (
    request.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1)
  ) {
    throw invalidRequestError();
  }
  if (
    request.reasoningEffort !== undefined &&
    !boundedText(request.reasoningEffort, 80, false)
  ) {
    throw invalidRequestError();
  }
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)
  ) {
    throw invalidRequestError();
  }
}

function validateEmbeddingRequest(request: EmbeddingGatewayRequest): void {
  if (!isPlainObject(request) || !boundedText(request.requestId, 120, false)) {
    throw invalidRequestError();
  }
  if (
    !Array.isArray(request.inputs) ||
    request.inputs.length < 1 ||
    request.inputs.length > MAX_EMBEDDING_BATCH ||
    !["QUERY", "DOCUMENT"].includes(String(request.inputType))
  ) {
    throw invalidRequestError();
  }
  for (const input of request.inputs) {
    if (!boundedText(input, MAX_TEXT_BYTES, true)) throw invalidRequestError();
  }
}

function validateRerankRequest(request: RerankGatewayRequest): void {
  if (!isPlainObject(request) || !boundedText(request.requestId, 120, false) || !boundedText(request.query, MAX_TEXT_BYTES, true)) {
    throw invalidRequestError();
  }
  if (
    !Array.isArray(request.candidates) ||
    request.candidates.length < 1 ||
    request.candidates.length > MAX_RERANK_CANDIDATES ||
    !Number.isSafeInteger(request.topK) ||
    request.topK < 1 ||
    request.topK > request.candidates.length
  ) {
    throw invalidRequestError();
  }
  const ids = new Set<string>();
  for (const candidate of request.candidates) {
    if (
      !isPlainObject(candidate) ||
      !boundedText(candidate.id, 200, false) ||
      !boundedText(candidate.text, MAX_TEXT_BYTES, true) ||
      ids.has(candidate.id)
    ) {
      throw invalidRequestError();
    }
    ids.add(candidate.id);
  }
}

function validateProviderGenerationEvent(
  value: unknown,
  state: { started: boolean; terminal: boolean },
): ProviderGenerationStreamEvent {
  if (!isPlainObject(value) || typeof value.type !== "string") {
    throw new GatewayProtocolError();
  }
  if (value.type === "STARTED") {
    if (state.started || state.terminal) throw new GatewayProtocolError();
    return {
      type: "STARTED",
      ...(value.providerRequestId === undefined
        ? {}
        : { providerRequestId: safeProviderRequestId(value.providerRequestId) }),
    };
  }
  if (value.type === "TEXT_DELTA") {
    if (!state.started || state.terminal || !boundedText(value.text, MAX_GENERATION_DELTA_BYTES, true)) {
      throw new GatewayProtocolError();
    }
    return { type: "TEXT_DELTA", text: value.text };
  }
  if (value.type === "USAGE") {
    if (!state.started || state.terminal) throw new GatewayProtocolError();
    return { type: "USAGE", usage: normalizeUsage(value.usage) };
  }
  if (value.type === "COMPLETED") {
    if (
      !state.started ||
      state.terminal ||
      typeof value.finishReason !== "string" ||
      !GENERATION_FINISH_REASONS.includes(value.finishReason as (typeof GENERATION_FINISH_REASONS)[number])
    ) {
      throw new GatewayProtocolError();
    }
    return {
      type: "COMPLETED",
      finishReason: value.finishReason as (typeof GENERATION_FINISH_REASONS)[number],
      usage: normalizeUsage(value.usage),
      ...(value.providerRequestId === undefined
        ? {}
        : { providerRequestId: safeProviderRequestId(value.providerRequestId) }),
    };
  }
  throw new GatewayProtocolError();
}

function toGatewayGenerationEvent(
  event: Exclude<ProviderGenerationStreamEvent, { type: "STARTED" }>,
): Exclude<GatewayGenerationStreamEvent, { type: "STARTED" }> {
  switch (event.type) {
    case "TEXT_DELTA":
      return { type: "TEXT_DELTA", text: event.text };
    case "USAGE":
      return { type: "USAGE", usage: event.usage };
    case "COMPLETED":
      return {
        type: "COMPLETED",
        finishReason: event.finishReason,
        usage: event.usage,
      };
  }
}

function validateEmbeddingResult(
  value: EmbeddingProviderResult,
  request: EmbeddingGatewayRequest,
  model: AIModelConfig,
): EmbeddingProviderResult {
  if (!isPlainObject(value) || !Array.isArray(value.vectors)) throw new GatewayProtocolError();
  if (
    value.vectors.length !== request.inputs.length ||
    !Number.isSafeInteger(value.dimensions) ||
    value.dimensions < 1 ||
    value.dimensions > 1_000_000
  ) {
    throw new GatewayProtocolError();
  }
  if (model.embeddingDimensions !== null && value.dimensions !== model.embeddingDimensions) {
    throw new GatewayProtocolError();
  }
  const vectors = value.vectors.map((vector) => {
    if (!Array.isArray(vector) || vector.length !== value.dimensions || vector.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      throw new GatewayProtocolError();
    }
    return [...vector];
  });
  return {
    vectors,
    dimensions: value.dimensions,
    usage: normalizeUsage(value.usage),
    ...(value.providerRequestId === undefined
      ? {}
      : { providerRequestId: safeProviderRequestId(value.providerRequestId) }),
  };
}

function validateRerankResult(
  value: RerankProviderResult,
  request: RerankGatewayRequest,
): RerankProviderResult {
  if (!isPlainObject(value) || !Array.isArray(value.results) || value.results.length > request.topK) {
    throw new GatewayProtocolError();
  }
  const candidateIds = new Set(request.candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  const results = value.results.map((item, index) => {
    if (
      !isPlainObject(item) ||
      !boundedText(item.candidateId, 200, false) ||
      !candidateIds.has(item.candidateId) ||
      seen.has(item.candidateId) ||
      item.rank !== index + 1 ||
      typeof item.score !== "number" ||
      !Number.isFinite(item.score)
    ) {
      throw new GatewayProtocolError();
    }
    seen.add(item.candidateId);
    return { candidateId: item.candidateId, score: item.score as number, rank: item.rank as number };
  });
  return {
    results,
    usage: normalizeUsage(value.usage),
    ...(value.providerRequestId === undefined
      ? {}
      : { providerRequestId: safeProviderRequestId(value.providerRequestId) }),
  };
}

function normalizeUsage(value: unknown): NormalizedProviderUsage {
  if (!isPlainObject(value)) throw new GatewayProtocolError();
  return {
    inputTokens: nullableNonNegativeInteger(value.inputTokens),
    outputTokens: nullableNonNegativeInteger(value.outputTokens),
    reasoningTokens: nullableNonNegativeInteger(value.reasoningTokens),
    cacheHitInputTokens: nullableNonNegativeInteger(value.cacheHitInputTokens),
    cacheMissInputTokens: nullableNonNegativeInteger(value.cacheMissInputTokens),
  };
}

function nullableNonNegativeInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new GatewayProtocolError();
  return value as number;
}

function normalizeFailure(
  error: unknown,
  control: ExecutionControl | undefined,
  parentSignal: AbortSignal,
): FailureDescriptor {
  if (control?.timedOut()) {
    return {
      code: "TIMEOUT",
      retryable: true,
      fallbackEligible: true,
    };
  }
  if (parentSignal.aborted || control?.signal.aborted || error instanceof GatewayAbortError) {
    return {
      code: "CANCELLED",
      retryable: false,
      fallbackEligible: false,
    };
  }
  if (isAIProviderAdapterError(error)) {
    return {
      code: error.code,
      retryable: safeRetryable(error.code, error.retryable),
      fallbackEligible: safeFallbackEligible(error.code, error.fallbackEligible),
      providerRequestId: safeOptionalProviderRequestId(error.providerRequestId),
    };
  }
  if (isAIProviderAdapterRegistryError(error)) {
    return {
      code: error.code === "AI_PROVIDER_ADAPTER_CAPABILITY_MISMATCH"
        ? "CAPABILITY_MISMATCH"
        : "CONFIGURATION",
      retryable: false,
      fallbackEligible: false,
    };
  }
  if (isAISecretStoreError(error)) {
    return {
      code: "SECRET_UNAVAILABLE",
      retryable: false,
      fallbackEligible: false,
    };
  }
  if (isAIProviderGatewayError(error)) {
    return {
      code: error.code,
      retryable: safeRetryable(error.code, error.retryable),
      fallbackEligible: safeFallbackEligible(error.code, error.fallbackEligible),
      providerRequestId: safeOptionalProviderRequestId(error.providerRequestId),
    };
  }
  if (error instanceof GatewayProtocolError) {
    return {
      code: "BAD_RESPONSE",
      retryable: false,
      fallbackEligible: true,
    };
  }
  return {
    code: "UNKNOWN",
    retryable: false,
    fallbackEligible: false,
  };
}

function isAISecretVersionChanged(error: unknown): boolean {
  return isAISecretStoreError(error) && error.code === "AI_SECRET_VERSION_CHANGED";
}

function safeRetryable(
  code: FailureDescriptor["code"],
  requested: boolean,
): boolean {
  return requested && ["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE"].includes(code);
}

function safeFallbackEligible(
  code: FailureDescriptor["code"],
  requested: boolean,
): boolean {
  return requested && ["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE", "BAD_RESPONSE"].includes(code);
}

function createExecutionControl(
  parentSignal: AbortSignal,
  timeoutMs: number,
): ExecutionControl {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onAbort);
    },
  };
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new GatewayAbortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(new GatewayAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(new GatewayAbortError());
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(new GatewayAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(iterator.next()).then(
      (result) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function returnIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (typeof iterator.return !== "function") return;
  try {
    await iterator.return();
  } catch {
    // The primary operation's normalized outcome is more important than cleanup noise.
  }
}

function finishTrace(
  trace: AIProviderAttemptTrace,
  status: AIProviderAttemptTrace["status"],
  clock: () => number,
  errorCode?: FailureDescriptor["code"],
): void {
  trace.completedAt = clock();
  trace.latencyMs = Math.max(0, trace.completedAt - trace.startedAt);
  trace.status = status;
  if (errorCode) trace.errorCode = errorCode;
}

function getProviderRequestId(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  return safeOptionalProviderRequestId(value.providerRequestId);
}

function safeProviderRequestId(value: unknown): string {
  const result = safeOptionalProviderRequestId(value);
  if (!result) throw new GatewayProtocolError();
  return result;
}

function safeOptionalProviderRequestId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_PROVIDER_REQUEST_ID_LENGTH) {
    return undefined;
  }
  return value;
}

function boundedText(value: unknown, maxBytes: number, requireNonEmpty: boolean): value is string {
  if (typeof value !== "string") return false;
  if (requireNonEmpty && value.trim().length < 1) return false;
  return Buffer.byteLength(value, "utf8") <= maxBytes;
}

function positiveBoundedInteger(value: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new AIProviderGatewayError(
      "INVALID_REQUEST",
      safeProviderErrorMessage("INVALID_REQUEST"),
    );
  }
  return value;
}

function invalidRequestError(): AIProviderGatewayError {
  return new AIProviderGatewayError(
    "INVALID_REQUEST",
    safeProviderErrorMessage("INVALID_REQUEST"),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
