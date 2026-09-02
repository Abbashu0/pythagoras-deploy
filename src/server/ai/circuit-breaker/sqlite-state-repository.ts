import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import {
  aiCircuitBreakerEvents,
  aiCircuitBreakerStates,
  type AICircuitBreakerEventRow,
  type AICircuitBreakerStateRow,
} from "../../content/schema";
import type {
  AICircuitBreakerEvent,
  AICircuitEventType,
  AICircuitHealthQuery,
  AICircuitState,
  AICircuitStateName,
  AICircuitStatePatch,
  AICircuitTarget,
} from "./contracts";
import { AICircuitBreakerError } from "./errors";

export class SQLiteAICircuitBreakerStateRepository {
  constructor(private readonly database: ContentDatabase) {}

  getByTargetHash(targetHash: string): AICircuitState | null {
    const row = this.database.db.select().from(aiCircuitBreakerStates)
      .where(eq(aiCircuitBreakerStates.targetHash, targetHash)).get();
    return row ? stateFromRow(row) : null;
  }

  insert(input: {
    id: string;
    target: AICircuitTarget;
    targetHash: string;
    state: AICircuitStateName;
    stateGeneration: number;
    consecutiveFailures: number;
    openedAt: number | null;
    openUntil: number | null;
    probeOwner: string | null;
    probeToken: string | null;
    probeExpiresAt: number | null;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
    lastErrorCode: string | null;
    createdAt: number;
    updatedAt: number;
  }): AICircuitState {
    try {
      const row = this.database.db.insert(aiCircuitBreakerStates).values({
        id: input.id,
        targetHash: input.targetHash,
        policyId: input.target.policyId,
        policyRevision: input.target.policyRevision,
        modelConfigId: input.target.modelConfigId,
        modelConfigRevision: input.target.modelConfigRevision,
        providerConfigId: input.target.providerConfigId,
        providerConfigRevision: input.target.providerConfigRevision,
        capability: input.target.capability,
        adapterKey: input.target.adapterKey,
        secretVersion: input.target.secretVersion,
        state: input.state,
        stateGeneration: input.stateGeneration,
        consecutiveFailures: input.consecutiveFailures,
        openedAt: input.openedAt,
        openUntil: input.openUntil,
        probeOwner: input.probeOwner,
        probeToken: input.probeToken,
        probeExpiresAt: input.probeExpiresAt,
        lastSuccessAt: input.lastSuccessAt,
        lastFailureAt: input.lastFailureAt,
        lastErrorCode: input.lastErrorCode,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      }).returning().get();
      return stateFromRow(row);
    } catch (error) {
      throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "The Circuit Breaker state could not be created.", error);
    }
  }

  updateFenced(input: {
    targetHash: string;
    expectedState: AICircuitStateName;
    expectedGeneration: number;
    expectedProbeOwner?: string | null;
    expectedProbeToken?: string | null;
    patch: AICircuitStatePatch;
  }): AICircuitState | null {
    const predicates = [
      eq(aiCircuitBreakerStates.targetHash, input.targetHash),
      eq(aiCircuitBreakerStates.state, input.expectedState),
      eq(aiCircuitBreakerStates.stateGeneration, input.expectedGeneration),
    ];
    if (input.expectedProbeOwner !== undefined) {
      predicates.push(input.expectedProbeOwner === null
        ? isNull(aiCircuitBreakerStates.probeOwner)
        : eq(aiCircuitBreakerStates.probeOwner, input.expectedProbeOwner));
    }
    if (input.expectedProbeToken !== undefined) {
      predicates.push(input.expectedProbeToken === null
        ? isNull(aiCircuitBreakerStates.probeToken)
        : eq(aiCircuitBreakerStates.probeToken, input.expectedProbeToken));
    }
    const row = this.database.db.update(aiCircuitBreakerStates).set(input.patch)
      .where(and(...predicates)).returning().get();
    return row ? stateFromRow(row) : null;
  }

  appendEvent(input: {
    targetHash: string;
    stateGeneration: number;
    eventType: AICircuitEventType;
    errorCode?: string | null;
    createdAt: number;
  }): AICircuitBreakerEvent {
    try {
      const row = this.database.db.insert(aiCircuitBreakerEvents).values({
        id: uuidv7(),
        targetHash: input.targetHash,
        stateGeneration: input.stateGeneration,
        eventType: input.eventType,
        errorCode: input.errorCode ?? null,
        createdAt: input.createdAt,
      }).returning().get();
      return eventFromRow(row);
    } catch (error) {
      throw new AICircuitBreakerError("AI_CIRCUIT_STATE_INVALID", "The Circuit Breaker event could not be recorded.", error);
    }
  }

  list(query: AICircuitHealthQuery = {}): AICircuitState[] {
    const predicates: SQL[] = [];
    if (query.state) predicates.push(eq(aiCircuitBreakerStates.state, query.state));
    if (query.providerConfigId) predicates.push(eq(aiCircuitBreakerStates.providerConfigId, query.providerConfigId));
    if (query.modelConfigId) predicates.push(eq(aiCircuitBreakerStates.modelConfigId, query.modelConfigId));
    const rows = this.database.db.select().from(aiCircuitBreakerStates)
      .where(predicates.length ? and(...predicates) : undefined)
      .orderBy(asc(aiCircuitBreakerStates.updatedAt), asc(aiCircuitBreakerStates.targetHash))
      .limit(query.limit ?? 50).all();
    return rows.map(stateFromRow);
  }

  listRecentEvents(input: {
    providerConfigId?: string;
    modelConfigId?: string;
    limit: number;
  }): AICircuitBreakerEvent[] {
    const predicates: SQL[] = [];
    if (input.providerConfigId) predicates.push(eq(aiCircuitBreakerStates.providerConfigId, input.providerConfigId));
    if (input.modelConfigId) predicates.push(eq(aiCircuitBreakerStates.modelConfigId, input.modelConfigId));
    const rows = this.database.db.select({ event: aiCircuitBreakerEvents })
      .from(aiCircuitBreakerEvents)
      .innerJoin(aiCircuitBreakerStates, eq(aiCircuitBreakerEvents.targetHash, aiCircuitBreakerStates.targetHash))
      .where(predicates.length ? and(...predicates) : undefined)
      .orderBy(desc(aiCircuitBreakerEvents.createdAt), desc(aiCircuitBreakerEvents.id))
      .limit(input.limit).all();
    return rows.map((row) => eventFromRow(row.event));
  }
}

function stateFromRow(row: AICircuitBreakerStateRow): AICircuitState {
  return {
    id: row.id,
    targetHash: row.targetHash,
    policyId: row.policyId,
    policyRevision: row.policyRevision,
    modelConfigId: row.modelConfigId,
    modelConfigRevision: row.modelConfigRevision,
    providerConfigId: row.providerConfigId,
    providerConfigRevision: row.providerConfigRevision,
    capability: row.capability,
    adapterKey: row.adapterKey,
    secretVersion: row.secretVersion,
    state: row.state,
    stateGeneration: row.stateGeneration,
    consecutiveFailures: row.consecutiveFailures,
    openedAt: row.openedAt,
    openUntil: row.openUntil,
    probeOwner: row.probeOwner,
    probeToken: row.probeToken,
    probeExpiresAt: row.probeExpiresAt,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function eventFromRow(row: AICircuitBreakerEventRow): AICircuitBreakerEvent {
  return {
    id: row.id,
    targetHash: row.targetHash,
    stateGeneration: row.stateGeneration,
    eventType: row.eventType,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
  };
}
