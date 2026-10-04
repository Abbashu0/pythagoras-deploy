import type { ContentDatabase } from "../../content/database";
import type { AIProviderAttemptTrace, NormalizedProviderUsage } from "../gateway/contracts";
import type { Agent1ActivityOutcome, Agent1ActivityPhase, Agent1ActivityPoint, Agent1ActivitySnapshot } from "./activity-contracts";

const BUCKET_MS = 5_000;
const RETENTION_MS = 60 * 60_000;
const MAX_REQUEST_AGE_MS = 10 * 60_000;
const TOKEN_KEYS = ["inputTokens", "outputTokens", "reasoningTokens"] as const;
type TokenKey = typeof TOKEN_KEYS[number];
type UsageTotals = Record<TokenKey, number>;
interface ActiveRequest {
  startedAt: number;
  modelConfigId: string | null;
  lastModelConfigId: string | null;
  phase: Agent1ActivityPhase;
  attemptIndex: number;
  attempts: number;
  usage: UsageTotals;
  totalOutput: number;
  hasUsage: boolean;
  hasOutputUsage: boolean;
}
interface Bucket extends UsageTotals { peak: number; closing: number }

/** Bounded, process-local operational observation. No prompts, responses,
 * identities, credentials, DB records, or accounting estimates are retained. */
export class Agent1ActivityStore {
  private readonly startedAt: number;
  private readonly active = new Map<string, ActiveRequest>();
  private readonly buckets = new Map<number, Bucket>();
  private readonly recent: Agent1ActivitySnapshot["recent"] = [];
  private readonly totals = { completedRequests: 0, failedRequests: 0, cancelledRequests: 0,
    fallbackAttempts: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    usageReports: 0, missingUsageRequests: 0 };
  private successfulDuration = 0;
  private readonly reportedFields = new Set<TokenKey>();

  constructor(private readonly now: () => number = Date.now) { this.startedAt = now(); }

  begin(id: string) {
    this.prune();
    if (this.active.has(id)) return;
    this.active.set(id, { startedAt: this.now(), modelConfigId: null, lastModelConfigId: null, phase: "connecting",
      attemptIndex: -1, attempts: 0, usage: zeroUsage(), totalOutput: 0, hasUsage: false, hasOutputUsage: false });
    this.bucket();
  }

  observeAttempt(id: string, trace: Readonly<AIProviderAttemptTrace>) {
    const request = this.active.get(id);
    if (!request) return;
    if (trace.completedAt === null) {
      if (request.attemptIndex === trace.attemptIndex) return;
      request.attemptIndex = trace.attemptIndex;
      request.attempts += 1;
      request.modelConfigId = trace.modelConfigId;
      request.lastModelConfigId = trace.modelConfigId;
      request.phase = "connecting";
      request.usage = zeroUsage();
      if (trace.attemptIndex > 0) this.totals.fallbackAttempts += 1;
    } else if (trace.status !== "SUCCEEDED") {
      request.phase = "connecting";
      request.modelConfigId = null;
    }
  }

  phase(id: string, phase: Agent1ActivityPhase) {
    const request = this.active.get(id);
    if (request) request.phase = phase;
  }

  usage(id: string, usage: NormalizedProviderUsage) {
    const request = this.active.get(id);
    if (!request) return;
    const bucket = this.bucket();
    let reported = false;
    for (const key of TOKEN_KEYS) {
      const value = usage[key];
      if (value === null || !Number.isSafeInteger(value) || value < 0) continue;
      reported = true;
      this.reportedFields.add(key);
      const delta = Math.max(0, value - request.usage[key]);
      request.usage[key] = Math.max(value, request.usage[key]);
      bucket[key] += delta;
      this.totals[key] += delta;
      if (key === "outputTokens") { request.totalOutput += delta; request.hasOutputUsage = true; }
    }
    if (reported) {
      this.totals.usageReports += 1;
      request.hasUsage = true;
    }
  }

  finish(id: string, outcome: Agent1ActivityOutcome) {
    const request = this.active.get(id);
    if (!request) return;
    const endedAt = this.now();
    const latencyMs = Math.max(0, endedAt - request.startedAt);
    this.recent.unshift({ modelConfigId: request.lastModelConfigId, outcome, endedAt, latencyMs,
      outputTokens: request.hasOutputUsage ? request.totalOutput : null, attempts: request.attempts });
    this.recent.splice(12);
    this.active.delete(id);
    if (outcome === "completed") { this.totals.completedRequests += 1; this.successfulDuration += latencyMs; }
    if (outcome === "failed") this.totals.failedRequests += 1;
    if (outcome === "cancelled") this.totals.cancelledRequests += 1;
    if (!request.hasUsage && outcome !== "expired") this.totals.missingUsageRequests += 1;
    this.bucket();
  }

  snapshot(): Agent1ActivitySnapshot {
    this.prune();
    const capturedAt = this.now();
    this.bucket();
    const models = new Map<string, Agent1ActivitySnapshot["activeModels"][number]>();
    const phasePriority = { connecting: 0, thinking: 1, responding: 2 };
    for (const request of this.active.values()) {
      if (!request.modelConfigId) continue;
      const current = models.get(request.modelConfigId);
      models.set(request.modelConfigId, { modelConfigId: request.modelConfigId,
        count: (current?.count ?? 0) + 1,
        phase: current && phasePriority[current.phase] > phasePriority[request.phase] ? current.phase : request.phase });
    }
    const points: Agent1ActivityPoint[] = [];
    const last = Math.floor(capturedAt / BUCKET_MS) * BUCKET_MS;
    const first = Math.max(Math.floor(this.startedAt / BUCKET_MS) * BUCKET_MS, last - RETENTION_MS + BUCKET_MS);
    let concurrent = 0;
    for (const [timestamp, bucket] of this.buckets) {
      if (timestamp < first) concurrent = bucket.closing;
    }
    for (let timestamp = first; timestamp <= last; timestamp += BUCKET_MS) {
      const bucket = this.buckets.get(timestamp);
      points.push({ timestamp,
        inputTokens: this.reportedFields.has("inputTokens") ? (bucket?.inputTokens ?? 0) : null,
        outputTokens: this.reportedFields.has("outputTokens") ? (bucket?.outputTokens ?? 0) : null,
        reasoningTokens: this.reportedFields.has("reasoningTokens") ? (bucket?.reasoningTokens ?? 0) : null,
        concurrentRequests: bucket?.peak ?? concurrent });
      if (bucket) concurrent = bucket.closing;
    }
    return { sessionStartedAt: this.startedAt, capturedAt, source: "development-chat", bucketMs: BUCKET_MS,
      activeModels: [...models.values()], stats: { ...this.totals, activeRequests: this.active.size,
        inputTokens: this.reportedFields.has("inputTokens") ? this.totals.inputTokens : null,
        outputTokens: this.reportedFields.has("outputTokens") ? this.totals.outputTokens : null,
        reasoningTokens: this.reportedFields.has("reasoningTokens") ? this.totals.reasoningTokens : null,
        averageLatencyMs: this.totals.completedRequests ? this.successfulDuration / this.totals.completedRequests : null },
      points, recent: this.recent.map(item => ({ ...item })) };
  }

  private bucket() {
    const timestamp = Math.floor(this.now() / BUCKET_MS) * BUCKET_MS;
    let bucket = this.buckets.get(timestamp);
    if (!bucket) { bucket = { ...zeroUsage(), peak: this.active.size, closing: this.active.size }; this.buckets.set(timestamp, bucket); }
    bucket.peak = Math.max(bucket.peak, this.active.size);
    bucket.closing = this.active.size;
    return bucket;
  }

  private prune() {
    const now = this.now();
    for (const [id, request] of this.active) {
      if (now - request.startedAt > MAX_REQUEST_AGE_MS) this.finish(id, "expired");
    }
    for (const timestamp of this.buckets.keys()) {
      if (timestamp < now - RETENTION_MS - BUCKET_MS) this.buckets.delete(timestamp);
    }
  }
}

function zeroUsage(): UsageTotals { return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 }; }

export function getAgent1ActivityStore(database: ContentDatabase) {
  const scope = globalThis as typeof globalThis & { __pythagorasAgent1Activity?: Map<string, Agent1ActivityStore> };
  const stores = scope.__pythagorasAgent1Activity ??= new Map();
  const key = database.paths.databaseFile;
  let store = stores.get(key);
  if (!store) { store = new Agent1ActivityStore(); stores.set(key, store); }
  return store;
}
