import { createHash } from "node:crypto";

import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../../content/database";
import type { AIJobSpec } from "../jobs";
import { AIJobQueueService } from "../jobs";
import type { AIOutboxEvent, AIOutboxEventSpec, AIOutboxOperationalView } from "./contracts";
import { AIOutboxError } from "./errors";
import { AIOutboxRouterRegistry } from "./router-registry";
import { SQLiteAIOutboxRepository } from "./sqlite-repository";
import { normalizeAIOutboxEventSpec, type NormalizedAIOutboxEventSpec } from "./validation";

const MAX_TIMESTAMP = 8_640_000_000_000_000;

interface AIOutboxServiceDependencies {
  repository?: SQLiteAIOutboxRepository;
  jobQueue: AIJobQueueService;
  clock?: () => number;
  idFactory?: () => string;
}

export class AIOutboxService {
  private readonly repository: SQLiteAIOutboxRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: ContentDatabase,
    private readonly routers: AIOutboxRouterRegistry,
    private readonly dependencies: AIOutboxServiceDependencies,
  ) {
    this.repository = dependencies.repository ?? new SQLiteAIOutboxRepository(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  enqueue(spec: AIOutboxEventSpec): AIOutboxEvent {
    const now = this.safeNow();
    const normalized = this.prepare(spec, now);
    return this.database.client.transaction(() => this.enqueuePreparedInTransaction(normalized, now)).immediate();
  }

  /** Enqueue inside an existing SQLite transaction; no nested transaction is started. */
  enqueueInTransaction(spec: AIOutboxEventSpec, now = this.safeNow()): AIOutboxEvent {
    this.assertTimestamp(now);
    return this.enqueuePreparedInTransaction(this.prepare(spec, now), now);
  }

  dispatchOne(input: { now?: number; supportedEventTypes: readonly string[] }): AIOutboxEvent | null {
    const now = input.now ?? this.safeNow();
    this.assertTimestamp(now);
    return this.database.client.transaction(() => {
      const events = this.repository.listDispatchableInTransaction({ now, supportedEventTypes: input.supportedEventTypes });
      const event = events[0];
      if (!event) return null;
      const router = this.routers.get(event.eventType, event.payloadVersion);
      if (!router) return null;
      const payloadHash = createHash("sha256").update(event.payloadJson).digest("hex");
      if (payloadHash !== event.payloadHash) {
        this.repository.markFailedInTransaction({ id: event.id, safeErrorCode: "AI_OUTBOX_INVALID" });
        return this.repository.getById(event.id);
      }
      let jobSpec: AIJobSpec;
      try {
        const payload = JSON.parse(event.payloadJson) as unknown;
        const validated = router.validatePayload(payload);
        jobSpec = router.toJob(validated);
      } catch (error) {
        this.repository.markFailedInTransaction({ id: event.id, safeErrorCode: error instanceof AIOutboxError ? error.code : "AI_OUTBOX_INVALID" });
        return this.repository.getById(event.id);
      }
      try {
        const job = this.dependencies.jobQueue.enqueueInTransaction(jobSpec, now);
        return this.repository.markDispatchedInTransaction({ id: event.id, jobId: job.id, now });
      } catch (error) {
        this.repository.markFailedInTransaction({ id: event.id, safeErrorCode: error instanceof AIOutboxError ? error.code : "AI_OUTBOX_DISPATCH_FAILED" });
        return this.repository.getById(event.id);
      }
    }).immediate();
  }

  listOperationalSummaries() {
    return this.repository.listOperationalSummaries();
  }

  countPending(): number {
    return this.repository.countPending();
  }

  listFailed(limit = 50): AIOutboxOperationalView[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AIOutboxError("AI_OUTBOX_INVALID", "Outbox query limit is invalid.");
    return this.repository.listFailed(limit);
  }

  listRecent(limit = 50): AIOutboxOperationalView[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AIOutboxError("AI_OUTBOX_INVALID", "Outbox query limit is invalid.");
    return this.repository.listRecent(limit);
  }

  private prepare(spec: AIOutboxEventSpec, now: number): NormalizedAIOutboxEventSpec {
    const router = this.routers.get(spec.eventType, spec.payloadVersion);
    if (!router) throw new AIOutboxError("AI_OUTBOX_ROUTER_NOT_FOUND", "No registered router supports this Outbox event type/version.");
    let payload: Record<string, unknown>;
    try {
      payload = router.validatePayload(spec.payload);
    } catch (error) {
      if (error instanceof AIOutboxError) throw error;
      throw new AIOutboxError("AI_OUTBOX_INVALID", "The Outbox payload failed its registered validator.", error);
    }
    try {
      return normalizeAIOutboxEventSpec({ ...spec, payload, scheduledAt: spec.scheduledAt ?? now });
    } catch (error) {
      if (error instanceof AIOutboxError) throw error;
      throw new AIOutboxError("AI_OUTBOX_INVALID", "The Outbox event specification is invalid.", error);
    }
  }

  private enqueuePreparedInTransaction(spec: NormalizedAIOutboxEventSpec, now: number): AIOutboxEvent {
    const existing = this.repository.findByDedupe(spec.eventType, spec.dedupeKey);
    if (existing) {
      if (existing.payloadVersion !== spec.payloadVersion || existing.payloadHash !== spec.payloadHash || existing.scheduledAt !== spec.scheduledAt) {
        throw new AIOutboxError("AI_OUTBOX_DEDUPE_CONFLICT", "The Outbox dedupe identity is bound to different payload or execution meaning.");
      }
      return existing;
    }
    return this.repository.insertInTransaction({ id: spec.id ?? this.idFactory(), spec, now });
  }

  private safeNow(): number {
    const now = this.clock();
    this.assertTimestamp(now);
    return now;
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIOutboxError("AI_OUTBOX_INVALID", "Outbox timestamp is invalid.");
  }
}
