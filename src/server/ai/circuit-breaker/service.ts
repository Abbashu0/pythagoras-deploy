import { createHash, randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import type {
  AICircuitAttemptPermit,
  AICircuitBreaker,
  AICircuitBreakerEvent,
  AICircuitBreakerPolicyRepository,
  AICircuitCountedFailureCode,
  AICircuitEventType,
  AICircuitHealthQuery,
  AICircuitHealthSnapshot,
  AICircuitOutcomeResult,
  AICircuitPermitDecision,
  AICircuitState,
  AICircuitStateName,
  AICircuitTarget,
} from "./contracts";
import { AICircuitBreakerError } from "./errors";
import { SQLiteAICircuitBreakerPolicyRepository } from "./sqlite-policy-repository";
import { SQLiteAICircuitBreakerStateRepository } from "./sqlite-state-repository";
import { validateAICircuitTarget, validateCircuitTimestamp } from "./validation";

const TARGET_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const PROBE_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const MAX_QUERY_LIMIT = 500;
const MAX_GENERATION = 1_000_000_000;

export interface AICircuitBreakerServiceDependencies {
  policyRepository?: AICircuitBreakerPolicyRepository;
  stateRepository?: SQLiteAICircuitBreakerStateRepository;
  clock?: () => number;
  idFactory?: () => string;
  probeOwnerFactory?: () => string;
  probeTokenFactory?: () => string;
}

export class AICircuitBreakerService implements AICircuitBreaker {
  private readonly policies: AICircuitBreakerPolicyRepository;
  private readonly states: SQLiteAICircuitBreakerStateRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;
  private readonly probeOwnerFactory: () => string;
  private readonly probeTokenFactory: () => string;

  constructor(
    private readonly database: ContentDatabase,
    dependencies: AICircuitBreakerServiceDependencies = {},
  ) {
    this.policies = dependencies.policyRepository ?? new SQLiteAICircuitBreakerPolicyRepository(database);
    this.states = dependencies.stateRepository ?? new SQLiteAICircuitBreakerStateRepository(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
    this.probeOwnerFactory = dependencies.probeOwnerFactory ?? uuidv7;
    this.probeTokenFactory = dependencies.probeTokenFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  acquirePermit(input: { target: AICircuitTarget; at?: number }): AICircuitPermitDecision {
    validateAICircuitTarget(input.target);
    const now = input.at ?? this.safeNow();
    validateCircuitTimestamp(now);
    const policy = this.policies.getRevision(input.target.policyId, input.target.policyRevision);
    if (!policy) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_NOT_FOUND", "The Circuit Breaker Policy revision was not found.");
    const targetHash = hashTarget(input.target);
    if (!policy.enabled) {
      return {
        kind: "GRANTED",
        permit: { targetHash, stateGeneration: 0, mode: "NORMAL", enforced: false },
      };
    }
    return this.database.client.transaction((): AICircuitPermitDecision => {
      let state = this.states.getByTargetHash(targetHash);
      if (!state) {
        state = this.states.insert({
          id: this.idFactory(),
          target: input.target,
          targetHash,
          state: "CLOSED",
          stateGeneration: 1,
          consecutiveFailures: 0,
          openedAt: null,
          openUntil: null,
          probeOwner: null,
          probeToken: null,
          probeExpiresAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastErrorCode: null,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        assertStateTarget(state, input.target);
      }
      if (state.state === "CLOSED") {
        return { kind: "GRANTED", permit: normalPermit(targetHash, state.stateGeneration) };
      }
      if (state.state === "OPEN") {
        if (state.openUntil === null) throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "An OPEN Circuit Breaker has no cooldown timestamp.");
        if (now < state.openUntil) return denied("OPEN", targetHash, state.stateGeneration);
        return this.grantProbe(state, targetHash, policy.halfOpenProbeLeaseMs, now, "HALF_OPEN_PROBE_GRANTED");
      }
      if (state.probeExpiresAt === null || state.probeOwner === null || state.probeToken === null) {
        throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "A HALF_OPEN Circuit Breaker has no live probe identity.");
      }
      if (state.probeExpiresAt > now) return denied("HALF_OPEN_BUSY", targetHash, state.stateGeneration);
      return this.grantProbe(state, targetHash, policy.halfOpenProbeLeaseMs, now, "HALF_OPEN_PROBE_RECLAIMED");
    }).immediate();
  }

  recordSuccess(permit: AICircuitAttemptPermit, at = this.safeNow()): AICircuitOutcomeResult {
    validateCircuitTimestamp(at);
    validatePermit(permit);
    if (!permit.enforced) return "BYPASSED";
    return this.database.client.transaction(() => {
      const state = this.states.getByTargetHash(permit.targetHash);
      if (!state) return "STALE_OUTCOME_IGNORED";
      const lifecycleAt = monotonicStateTime(state, at);
      if (permit.mode === "NORMAL") {
        if (state.state !== "CLOSED" || state.stateGeneration !== permit.stateGeneration) return "STALE_OUTCOME_IGNORED";
        const updated = this.states.updateFenced({
          targetHash: permit.targetHash,
          expectedState: "CLOSED",
          expectedGeneration: permit.stateGeneration,
          patch: {
            consecutiveFailures: 0,
            lastSuccessAt: lifecycleAt,
            lastErrorCode: null,
            updatedAt: lifecycleAt,
          },
        });
        return updated ? "APPLIED" : "STALE_OUTCOME_IGNORED";
      }
      if (!matchesProbe(state, permit)) return "STALE_OUTCOME_IGNORED";
      const nextGeneration = nextGenerationOf(state.stateGeneration);
      const updated = this.states.updateFenced({
        targetHash: permit.targetHash,
        expectedState: "HALF_OPEN",
        expectedGeneration: permit.stateGeneration,
        expectedProbeOwner: permit.probeOwner,
        expectedProbeToken: permit.probeToken,
        patch: {
          state: "CLOSED",
          stateGeneration: nextGeneration,
          consecutiveFailures: 0,
          openedAt: null,
          openUntil: null,
          probeOwner: null,
          probeToken: null,
          probeExpiresAt: null,
          lastSuccessAt: lifecycleAt,
          lastErrorCode: null,
          updatedAt: lifecycleAt,
        },
      });
      if (!updated) return "STALE_OUTCOME_IGNORED";
      this.appendEvent(permit.targetHash, nextGeneration, "CLOSED", null, lifecycleAt);
      return "APPLIED";
    }).immediate();
  }

  recordFailure(input: {
    permit: AICircuitAttemptPermit;
    errorCode: AICircuitCountedFailureCode;
    at?: number;
  }): AICircuitOutcomeResult {
    const at = input.at ?? this.safeNow();
    validateCircuitTimestamp(at);
    validatePermit(input.permit);
    if (!isCountedFailureCode(input.errorCode)) throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "The Circuit Breaker failure code is invalid.");
    if (!input.permit.enforced) return "BYPASSED";
    return this.database.client.transaction(() => {
      const state = this.states.getByTargetHash(input.permit.targetHash);
      if (!state) return "STALE_OUTCOME_IGNORED";
      const lifecycleAt = monotonicStateTime(state, at);
      const policy = this.policies.getRevision(state.policyId, state.policyRevision);
      if (!policy) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_NOT_FOUND", "The Circuit Breaker Policy revision was not found.");
      if (input.permit.mode === "NORMAL") {
        if (state.state !== "CLOSED" || state.stateGeneration !== input.permit.stateGeneration) return "STALE_OUTCOME_IGNORED";
        const nextFailures = input.errorCode === "AUTHENTICATION" ? 1 : state.consecutiveFailures + 1;
        if (input.errorCode !== "AUTHENTICATION" && nextFailures < policy.failureThreshold) {
          const updated = this.states.updateFenced({
            targetHash: input.permit.targetHash,
            expectedState: "CLOSED",
            expectedGeneration: input.permit.stateGeneration,
            patch: {
              consecutiveFailures: nextFailures,
              lastFailureAt: lifecycleAt,
              lastErrorCode: input.errorCode,
              updatedAt: lifecycleAt,
            },
          });
          if (!updated) return "STALE_OUTCOME_IGNORED";
          this.appendEvent(input.permit.targetHash, input.permit.stateGeneration, "FAILURE_COUNTED", input.errorCode, lifecycleAt);
          return "APPLIED";
        }
        return this.openCircuit(state, input.permit, lifecycleAt, input.errorCode, input.errorCode === "AUTHENTICATION" ? "AUTHENTICATION_OPENED" : "OPENED");
      }
      if (!matchesProbe(state, input.permit)) return "STALE_OUTCOME_IGNORED";
      return this.openCircuit(state, input.permit, lifecycleAt, input.errorCode, input.errorCode === "AUTHENTICATION" ? "AUTHENTICATION_OPENED" : "OPENED");
    }).immediate();
  }

  recordNeutral(permit: AICircuitAttemptPermit, at = this.safeNow()): AICircuitOutcomeResult {
    validateCircuitTimestamp(at);
    validatePermit(permit);
    if (!permit.enforced) return "BYPASSED";
    return this.database.client.transaction(() => {
      const state = this.states.getByTargetHash(permit.targetHash);
      if (!state) return "STALE_OUTCOME_IGNORED";
      const lifecycleAt = monotonicStateTime(state, at);
      if (permit.mode === "NORMAL") {
        return state.state === "CLOSED" && state.stateGeneration === permit.stateGeneration
          ? "APPLIED"
          : "STALE_OUTCOME_IGNORED";
      }
      if (!matchesProbe(state, permit)) return "STALE_OUTCOME_IGNORED";
      const nextGeneration = nextGenerationOf(state.stateGeneration);
      const updated = this.states.updateFenced({
        targetHash: permit.targetHash,
        expectedState: "HALF_OPEN",
        expectedGeneration: permit.stateGeneration,
        expectedProbeOwner: permit.probeOwner,
        expectedProbeToken: permit.probeToken,
        patch: {
          state: "OPEN",
          stateGeneration: nextGeneration,
          openedAt: lifecycleAt,
          openUntil: lifecycleAt,
          probeOwner: null,
          probeToken: null,
          probeExpiresAt: null,
          lastErrorCode: null,
          updatedAt: lifecycleAt,
        },
      });
      if (!updated) return "STALE_OUTCOME_IGNORED";
      this.appendEvent(permit.targetHash, nextGeneration, "HALF_OPEN_PROBE_RELEASED", null, lifecycleAt);
      return "APPLIED";
    }).immediate();
  }

  getSnapshot(target: AICircuitTarget): AICircuitHealthSnapshot | null {
    validateAICircuitTarget(target);
    const state = this.states.getByTargetHash(hashTarget(target));
    if (!state) return null;
    assertStateTarget(state, target);
    return safeSnapshot(state);
  }

  listSnapshots(query: AICircuitHealthQuery = {}): AICircuitHealthSnapshot[] {
    validateHealthQuery(query);
    return this.states.list(query).map(safeSnapshot);
  }

  listOpenCircuits(query: Omit<AICircuitHealthQuery, "state"> = {}): AICircuitHealthSnapshot[] {
    return this.listSnapshots({ ...query, state: "OPEN" });
  }

  listHalfOpenCircuits(query: Omit<AICircuitHealthQuery, "state"> = {}): AICircuitHealthSnapshot[] {
    return this.listSnapshots({ ...query, state: "HALF_OPEN" });
  }

  listRecentEvents(input: { providerConfigId?: string; modelConfigId?: string; limit?: number } = {}): AICircuitBreakerEvent[] {
    if (input.providerConfigId !== undefined) validateUuidFilter(input.providerConfigId);
    if (input.modelConfigId !== undefined) validateUuidFilter(input.modelConfigId);
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) throw new AICircuitBreakerError("AI_CIRCUIT_TARGET_INVALID", "Circuit event query limit is invalid.");
    return this.states.listRecentEvents({ ...input, limit });
  }

  private grantProbe(
    state: AICircuitState,
    targetHash: string,
    probeLeaseMs: number,
    now: number,
    eventType: Extract<AICircuitEventType, "HALF_OPEN_PROBE_GRANTED" | "HALF_OPEN_PROBE_RECLAIMED">,
  ): AICircuitPermitDecision {
    const nextGeneration = nextGenerationOf(state.stateGeneration);
    const probeOwner = this.probeOwnerFactory();
    const probeToken = this.probeTokenFactory();
    if (!PROBE_VALUE_PATTERN.test(probeOwner) || !PROBE_VALUE_PATTERN.test(probeToken)) throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "The Circuit Breaker probe identity is invalid.");
    const probeExpiresAt = addDuration(now, probeLeaseMs);
    const updated = this.states.updateFenced({
      targetHash,
      expectedState: state.state,
      expectedGeneration: state.stateGeneration,
      ...(state.state === "HALF_OPEN" ? { expectedProbeOwner: state.probeOwner, expectedProbeToken: state.probeToken } : {}),
      patch: {
        state: "HALF_OPEN",
        stateGeneration: nextGeneration,
        openUntil: null,
        probeOwner,
        probeToken,
        probeExpiresAt,
        updatedAt: now,
      },
    });
    if (!updated) throw new AICircuitBreakerError("AI_CIRCUIT_STALE_PERMIT", "The Circuit Breaker changed before the probe could be acquired.");
    this.appendEvent(targetHash, nextGeneration, eventType, null, now);
    return {
      kind: "GRANTED",
      permit: { targetHash, stateGeneration: nextGeneration, mode: "PROBE", enforced: true, probeOwner, probeToken },
    };
  }

  private openCircuit(
    state: AICircuitState,
    permit: AICircuitAttemptPermit,
    at: number,
    errorCode: AICircuitCountedFailureCode,
    eventType: Extract<AICircuitEventType, "OPENED" | "AUTHENTICATION_OPENED">,
  ): AICircuitOutcomeResult {
    const nextGeneration = nextGenerationOf(state.stateGeneration);
    const updated = this.states.updateFenced({
      targetHash: permit.targetHash,
      expectedState: state.state,
      expectedGeneration: permit.stateGeneration,
      ...(permit.mode === "PROBE" ? { expectedProbeOwner: permit.probeOwner, expectedProbeToken: permit.probeToken } : {}),
      patch: {
        state: "OPEN",
        stateGeneration: nextGeneration,
        consecutiveFailures: Math.max(1, state.consecutiveFailures + 1),
        openedAt: at,
        openUntil: addDuration(at, this.policyFor(state).openDurationMs),
        probeOwner: null,
        probeToken: null,
        probeExpiresAt: null,
        lastFailureAt: at,
        lastErrorCode: errorCode,
        updatedAt: at,
      },
    });
    if (!updated) return "STALE_OUTCOME_IGNORED";
    this.appendEvent(permit.targetHash, nextGeneration, eventType, errorCode, at);
    return "APPLIED";
  }

  private policyFor(state: AICircuitState) {
    const policy = this.policies.getRevision(state.policyId, state.policyRevision);
    if (!policy) throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_NOT_FOUND", "The Circuit Breaker Policy revision was not found.");
    return policy;
  }

  private appendEvent(targetHash: string, stateGeneration: number, eventType: AICircuitEventType, errorCode: string | null, createdAt: number): void {
    this.states.appendEvent({ targetHash, stateGeneration, eventType, errorCode, createdAt });
  }

  private safeNow(): number {
    const now = this.clock();
    validateCircuitTimestamp(now);
    return now;
  }
}

function normalPermit(targetHash: string, stateGeneration: number): AICircuitAttemptPermit {
  return { targetHash, stateGeneration, mode: "NORMAL", enforced: true };
}

function denied(
  reason: "OPEN" | "HALF_OPEN_BUSY",
  targetHash: string,
  stateGeneration: number,
): AICircuitPermitDecision {
  return { kind: "DENIED", reason, targetHash, stateGeneration };
}

function matchesProbe(state: AICircuitState, permit: AICircuitAttemptPermit): boolean {
  return permit.mode === "PROBE" &&
    state.state === "HALF_OPEN" &&
    state.stateGeneration === permit.stateGeneration &&
    state.probeOwner === permit.probeOwner &&
    state.probeToken === permit.probeToken;
}

function nextGenerationOf(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value >= MAX_GENERATION) throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "Circuit state generation overflowed.");
  return value + 1;
}

function addDuration(now: number, durationMs: number): number {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || now > 8_640_000_000_000_000 - durationMs) throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "Circuit timestamp overflowed.");
  return now + durationMs;
}

function monotonicStateTime(state: AICircuitState, requested: number): number {
  return Math.max(requested, state.createdAt, state.updatedAt, state.openedAt ?? 0, state.lastSuccessAt ?? 0, state.lastFailureAt ?? 0);
}

function validatePermit(permit: AICircuitAttemptPermit): void {
  if (!permit || !TARGET_HASH_PATTERN.test(permit.targetHash) || !Number.isSafeInteger(permit.stateGeneration) || permit.stateGeneration < 0 || permit.stateGeneration > MAX_GENERATION || !["NORMAL", "PROBE"].includes(permit.mode) || typeof permit.enforced !== "boolean") {
    throw new AICircuitBreakerError("AI_CIRCUIT_STALE_PERMIT", "The Circuit Breaker permit is invalid.");
  }
  if (permit.mode === "PROBE" && (!permit.enforced || typeof permit.probeOwner !== "string" || !PROBE_VALUE_PATTERN.test(permit.probeOwner) || typeof permit.probeToken !== "string" || !PROBE_VALUE_PATTERN.test(permit.probeToken))) {
    throw new AICircuitBreakerError("AI_CIRCUIT_STALE_PERMIT", "The Circuit Breaker probe permit is invalid.");
  }
}

function isCountedFailureCode(value: string): value is AICircuitCountedFailureCode {
  return ["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE", "BAD_RESPONSE", "UNKNOWN", "AUTHENTICATION"].includes(value);
}

function hashTarget(target: AICircuitTarget): string {
  validateAICircuitTarget(target);
  return createHash("sha256").update(JSON.stringify({
    policyId: target.policyId,
    policyRevision: target.policyRevision,
    modelConfigId: target.modelConfigId,
    modelConfigRevision: target.modelConfigRevision,
    providerConfigId: target.providerConfigId,
    providerConfigRevision: target.providerConfigRevision,
    capability: target.capability,
    adapterKey: target.adapterKey,
    secretVersion: target.secretVersion,
  })).digest("hex");
}

function assertStateTarget(state: AICircuitState, target: AICircuitTarget): void {
  if (state.policyId !== target.policyId ||
    state.policyRevision !== target.policyRevision ||
    state.modelConfigId !== target.modelConfigId ||
    state.modelConfigRevision !== target.modelConfigRevision ||
    state.providerConfigId !== target.providerConfigId ||
    state.providerConfigRevision !== target.providerConfigRevision ||
    state.capability !== target.capability ||
    state.adapterKey !== target.adapterKey ||
    state.secretVersion !== target.secretVersion) {
    throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "The persisted Circuit Breaker target is inconsistent.");
  }
}

function safeSnapshot(state: AICircuitState): AICircuitHealthSnapshot {
  return {
    id: state.id,
    targetHash: state.targetHash,
    policyId: state.policyId,
    policyRevision: state.policyRevision,
    modelConfigId: state.modelConfigId,
    modelConfigRevision: state.modelConfigRevision,
    providerConfigId: state.providerConfigId,
    providerConfigRevision: state.providerConfigRevision,
    capability: state.capability,
    adapterKey: state.adapterKey,
    secretVersion: state.secretVersion,
    state: state.state,
    stateGeneration: state.stateGeneration,
    consecutiveFailures: state.consecutiveFailures,
    openedAt: state.openedAt,
    openUntil: state.openUntil,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastErrorCode: state.lastErrorCode,
    probeActive: state.state === "HALF_OPEN" && state.probeToken !== null,
    probeExpiresAt: state.probeExpiresAt,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function validateHealthQuery(query: AICircuitHealthQuery): void {
  if (query.state !== undefined && !["CLOSED", "OPEN", "HALF_OPEN"].includes(query.state)) throw new AICircuitBreakerError("AI_CIRCUIT_TARGET_INVALID", "Circuit state filter is invalid.");
  if (query.providerConfigId !== undefined) validateUuidFilter(query.providerConfigId);
  if (query.modelConfigId !== undefined) validateUuidFilter(query.modelConfigId);
  const limit = query.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) throw new AICircuitBreakerError("AI_CIRCUIT_TARGET_INVALID", "Circuit snapshot query limit is invalid.");
}

function validateUuidFilter(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new AICircuitBreakerError("AI_CIRCUIT_TARGET_INVALID", "Circuit filter identity is invalid.");
}
