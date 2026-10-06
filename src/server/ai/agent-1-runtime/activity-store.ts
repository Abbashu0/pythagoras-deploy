import type { ContentDatabase } from "../../content/database";
import type { Agent1ActivityInstructions } from "./activity-contracts";
import type { AIProviderAttemptTrace, NormalizedProviderUsage } from "../gateway/contracts";
import { ACTIVITY_WINDOWS, type Agent1ActivityAttempt, type Agent1ActivityOutcome, type Agent1ActivityPhase, type Agent1ActivityPoint, type Agent1ActivityResultFilter, type Agent1ActivitySnapshot, type Agent1ActivityWindow, type Agent1FailureCategory } from "./activity-contracts";

const BUCKET_MS = 5_000;
const RETENTION_MS = 60 * 60_000;
const MAX_REQUEST_AGE_MS = 10 * 60_000;
const TOKEN_KEYS = ["inputTokens", "outputTokens", "reasoningTokens"] as const;
type TokenKey = typeof TOKEN_KEYS[number];
type UsageTotals = Record<TokenKey, number>;
interface ActiveRequest {
  instructions?: Readonly<Agent1ActivityInstructions>;
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
  firstTextAt: number | null;
  chain: Agent1ActivityAttempt[];
}
interface Bucket extends UsageTotals { peak: number; closing: number; reports: number; fields: Set<TokenKey> }
const HISTORY_LIMIT = 10_000;

/** Bounded, process-local operational observation. No prompts, responses,
 * identities, credentials, DB records, or accounting estimates are retained. */
export class Agent1ActivityStore {
  private readonly startedAt: number;
  private readonly active = new Map<string, ActiveRequest>();
  private readonly buckets = new Map<number, Map<string | null, Bucket>>();
  private readonly recent: Agent1ActivitySnapshot["recent"] = [];
  private readonly history: Agent1ActivitySnapshot["recent"] = [];
  private droppedThrough: number | null = null;
  private readonly totals = { completedRequests: 0, failedRequests: 0, cancelledRequests: 0,
    fallbackAttempts: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    usageReports: 0, missingUsageRequests: 0 };
  private successfulDuration = 0;
  private readonly reportedFields = new Set<TokenKey>();

  constructor(private readonly now: () => number = Date.now) { this.startedAt = now(); }

  begin(id: string, instructions?: Readonly<Agent1ActivityInstructions>) {
    this.prune();
    if (this.active.has(id)) return;
    this.active.set(id, { startedAt: this.now(), modelConfigId: null, lastModelConfigId: null, phase: "connecting",
      attemptIndex: -1, attempts: 0, usage: zeroUsage(), totalOutput: 0, hasUsage: false, hasOutputUsage: false,
      firstTextAt: null, chain: [], ...(instructions ? { instructions: Object.freeze({
        generalPolicyId: instructions.generalPolicyId, generalRevision: instructions.generalRevision,
        generalCompiledHash: instructions.generalCompiledHash, frameworkContractVersion: instructions.frameworkContractVersion,
        frameworkHash: instructions.frameworkHash, envelopeHash: instructions.envelopeHash,
        instructionConformanceVersion: instructions.instructionConformanceVersion, instructionConformanceStatus: instructions.instructionConformanceStatus,
        plannedModels: Object.freeze(instructions.plannedModels.map(item => Object.freeze({ modelConfigId: item.modelConfigId, conformanceRecordId: item.conformanceRecordId, assuranceTier: item.assuranceTier, qualification: item.qualification, conformanceStatus: item.conformanceStatus }))),
      }) } : {}) });
    this.bucket();
  }

  observeAttempt(id: string, trace: Readonly<AIProviderAttemptTrace>) {
    const request = this.active.get(id);
    if (!request) return;
    this.bucket();
    if (trace.completedAt === null) {
      if (request.attemptIndex === trace.attemptIndex) return;
      request.attemptIndex = trace.attemptIndex;
      request.attempts += 1;
      request.modelConfigId = trace.modelConfigId;
      request.lastModelConfigId = trace.modelConfigId;
      request.phase = "connecting";
      request.usage = zeroUsage();
      request.chain.push({ modelConfigId: trace.modelConfigId, startedAt: this.now(), endedAt: null,
        status: "running", reason: null, firstTextMs: null });
      if (trace.attemptIndex > 0) this.totals.fallbackAttempts += 1;
    } else {
      const attempt = request.chain.at(-1);
      if (!attempt || request.attemptIndex !== trace.attemptIndex || attempt.endedAt !== null) return;
      attempt.endedAt = this.now();
      attempt.status = trace.status === "SUCCEEDED" ? "succeeded" : trace.status === "CANCELLED" ? "cancelled" : "failed";
      attempt.reason = trace.status === "SUCCEEDED" || trace.status === "CANCELLED" ? null : failureCategory(trace.errorCode);
      if (trace.status !== "SUCCEEDED") {
        request.phase = "connecting";
        request.modelConfigId = null;
      }
    }
    this.bucket();
  }

  phase(id: string, phase: Agent1ActivityPhase) {
    const request = this.active.get(id);
    if (request) request.phase = phase;
  }

  /** Called only for a non-whitespace text delta; no content is retained. */
  firstText(id: string) {
    const request = this.active.get(id);
    if (!request) return;
    request.firstTextAt ??= this.now();
    const attempt = request.chain.at(-1);
    if (attempt && attempt.firstTextMs === null) attempt.firstTextMs = Math.max(0, this.now() - attempt.startedAt);
  }

  usage(id: string, usage: NormalizedProviderUsage) {
    const request = this.active.get(id);
    if (!request) return;
    const bucket = this.bucket();
    const modelBucket = request.modelConfigId ? this.bucketFor(request.modelConfigId) : null;
    let reported = false;
    for (const key of TOKEN_KEYS) {
      const value = usage[key];
      if (value === null || !Number.isSafeInteger(value) || value < 0) continue;
      reported = true;
      this.reportedFields.add(key);
      const delta = Math.max(0, value - request.usage[key]);
      request.usage[key] = Math.max(value, request.usage[key]);
      bucket[key] += delta;
      bucket.fields.add(key);
      if (modelBucket) { modelBucket[key] += delta; modelBucket.fields.add(key); }
      this.totals[key] += delta;
      if (key === "outputTokens") { request.totalOutput += delta; request.hasOutputUsage = true; }
    }
    if (reported) {
      this.totals.usageReports += 1;
      bucket.reports += 1;
      if (modelBucket) modelBucket.reports += 1;
      request.hasUsage = true;
    }
  }

  finish(id: string, outcome: Agent1ActivityOutcome, reason?: Agent1FailureCategory) {
    const request = this.active.get(id);
    if (!request) return;
    const endedAt = this.now();
    this.bucket();
    const latencyMs = Math.max(0, endedAt - request.startedAt);
    const lastAttempt = request.chain.at(-1);
    if (lastAttempt?.status === "running") {
      lastAttempt.endedAt = endedAt;
      lastAttempt.status = outcome === "completed" ? "succeeded" : outcome === "cancelled" ? "cancelled" : "failed";
      lastAttempt.reason = outcome === "failed" ? reason ?? "unknown" : null;
    }
    const item = { modelConfigId: request.lastModelConfigId, outcome, endedAt, latencyMs, ...(request.instructions ? { instructions: request.instructions } : {}),
      outputTokens: request.hasOutputUsage ? request.totalOutput : null, attempts: request.attempts,
      usageReported: request.hasUsage,
      firstTextMs: request.firstTextAt === null ? null : Math.max(0, request.firstTextAt - request.startedAt),
      reason: outcome === "failed" ? reason ?? lastAttempt?.reason ?? "unknown" : null,
      chain: request.chain.map(attempt => ({ ...attempt })) };
    this.recent.unshift(item);
    this.recent.splice(12);
    this.history.unshift(item);
    if (this.history.length > HISTORY_LIMIT) this.droppedThrough = this.history.pop()!.endedAt;
    this.active.delete(id);
    if (outcome === "completed") { this.totals.completedRequests += 1; this.successfulDuration += latencyMs; }
    if (outcome === "failed") this.totals.failedRequests += 1;
    if (outcome === "cancelled") this.totals.cancelledRequests += 1;
    if (!request.hasUsage && outcome !== "expired") this.totals.missingUsageRequests += 1;
    this.bucket();
  }

  snapshot(options?: { window: Agent1ActivityWindow; modelConfigId?: string | null; resultFilter?: Agent1ActivityResultFilter }): Agent1ActivitySnapshot {
    this.prune();
    const capturedAt = this.now();
    this.bucket();
    const modelId = options?.modelConfigId ?? null;
    // Five-second boundary is shared by charts, usage totals and terminal metrics.
    const from = Math.max(this.startedAt, Math.floor(capturedAt / BUCKET_MS) * BUCKET_MS - ACTIVITY_WINDOWS[options?.window ?? "1h"] + BUCKET_MS);
    const history = this.history.filter(item => item.endedAt >= from && (!modelId || item.modelConfigId === modelId));
    const resultFilter = options?.resultFilter ?? "all";
    const recent = history.filter(item => resultFilter === "all" || (resultFilter === "fallback" ? item.attempts > 1
      : resultFilter === "failed" ? item.outcome === "failed" : resultFilter === "cancelled" ? item.outcome === "cancelled"
        : item.reason === resultFilter || item.chain.some(attempt => attempt.reason === resultFilter)));
    const scopedActive = [...this.active.values()].filter(item => !modelId || item.modelConfigId === modelId);
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
    const first = Math.max(Math.floor(from / BUCKET_MS) * BUCKET_MS, last - RETENTION_MS + BUCKET_MS);
    let concurrent = 0;
    const fields = new Set<TokenKey>();
    for (const [timestamp, buckets] of this.buckets) {
      const bucket = buckets.get(modelId);
      if (timestamp < first && bucket) concurrent = bucket.closing;
      if (timestamp >= first && bucket) for (const key of bucket.fields) fields.add(key);
    }
    for (let timestamp = first; timestamp <= last; timestamp += BUCKET_MS) {
      const bucket = this.buckets.get(timestamp)?.get(modelId);
      points.push({ timestamp,
        inputTokens: (options ? fields : this.reportedFields).has("inputTokens") ? (bucket?.inputTokens ?? 0) : null,
        outputTokens: (options ? fields : this.reportedFields).has("outputTokens") ? (bucket?.outputTokens ?? 0) : null,
        reasoningTokens: (options ? fields : this.reportedFields).has("reasoningTokens") ? (bucket?.reasoningTokens ?? 0) : null,
        concurrentRequests: bucket?.peak ?? concurrent });
      if (bucket) concurrent = bucket.closing;
    }
    const allChains = [...this.history.map(item => item.chain), ...[...this.active.values()].map(item => item.chain)];
    const modelPerformance = new Map<string, { attempts: Agent1ActivityAttempt[] }>();
    const transitions: Agent1ActivitySnapshot["transitions"] = [];
    for (const chain of allChains) {
      chain.forEach((attempt, index) => {
        if ((attempt.endedAt ?? capturedAt) >= from) {
          const entry = modelPerformance.get(attempt.modelConfigId) ?? { attempts: [] };
          entry.attempts.push(attempt); modelPerformance.set(attempt.modelConfigId, entry);
        }
        const prior = chain[index - 1];
        if (prior && (attempt.status === "running" || attempt.startedAt >= capturedAt - 10_000)) transitions.push({
          fromModelConfigId: prior.modelConfigId, toModelConfigId: attempt.modelConfigId,
          startedAt: attempt.startedAt, reason: prior.reason, active: attempt.status === "running",
        });
      });
    }
    const successful = history.filter(item => item.outcome === "completed");
    const durations = successful.map(item => item.latencyMs).sort((a, b) => a - b);
    const firstTexts = successful.flatMap(item => item.firstTextMs === null ? [] : [item.firstTextMs]);
    const reports = [...this.buckets].filter(([timestamp]) => timestamp >= first).reduce((sum, [, buckets]) => sum + (buckets.get(modelId)?.reports ?? 0), 0);
    const scopedStats = {
      activeRequests: scopedActive.length,
      completedRequests: successful.length,
      failedRequests: history.filter(item => item.outcome === "failed").length,
      cancelledRequests: history.filter(item => item.outcome === "cancelled").length,
      fallbackAttempts: allChains.reduce((sum, chain) => sum + chain.filter((attempt, index) => index > 0 && attempt.startedAt >= from && (!modelId || attempt.modelConfigId === modelId)).length, 0),
      inputTokens: fields.has("inputTokens") ? points.reduce((sum, point) => sum + (point.inputTokens ?? 0), 0) : null,
      outputTokens: fields.has("outputTokens") ? points.reduce((sum, point) => sum + (point.outputTokens ?? 0), 0) : null,
      reasoningTokens: fields.has("reasoningTokens") ? points.reduce((sum, point) => sum + (point.reasoningTokens ?? 0), 0) : null,
      usageReports: reports,
      missingUsageRequests: history.filter(item => !item.usageReported && item.outcome !== "expired").length,
      averageLatencyMs: mean(durations),
    };
    return { sessionStartedAt: this.startedAt, capturedAt, source: "development-chat", bucketMs: BUCKET_MS,
      scope: { window: options?.window ?? "1h", from, modelConfigId: modelId, resultFilter, historyLimited: this.droppedThrough !== null && this.droppedThrough >= from },
      modelPerformance: [...modelPerformance].map(([modelConfigId, { attempts }]) => ({ modelConfigId,
        attempts: attempts.length, succeeded: attempts.filter(item => item.status === "succeeded").length,
        failed: attempts.filter(item => item.status === "failed").length,
        averageFirstTextMs: mean(attempts.flatMap(item => item.firstTextMs === null ? [] : [item.firstTextMs])),
        averageDurationMs: mean(attempts.flatMap(item => item.status === "succeeded" && item.endedAt !== null ? [Math.max(0, item.endedAt - item.startedAt)] : [])),
      })), transitions: transitions.sort((a, b) => b.startedAt - a.startedAt).slice(0, 12),
      activeModels: [...models.values()], stats: { ...(options ? scopedStats : { ...this.totals, activeRequests: this.active.size,
        inputTokens: this.reportedFields.has("inputTokens") ? this.totals.inputTokens : null,
        outputTokens: this.reportedFields.has("outputTokens") ? this.totals.outputTokens : null,
        reasoningTokens: this.reportedFields.has("reasoningTokens") ? this.totals.reasoningTokens : null,
        averageLatencyMs: this.totals.completedRequests ? this.successfulDuration / this.totals.completedRequests : null }),
        averageFirstTextMs: mean(firstTexts), p95LatencyMs: durations.length >= 20 ? durations[Math.ceil(durations.length * .95) - 1] : null,
        latencySamples: durations.length },
      points, recent: (options ? recent.slice(0, 12) : this.recent).map(item => ({ ...item, chain: item.chain.map(attempt => ({ ...attempt })) })) };
  }

  private bucket() {
    const global = this.bucketFor(null);
    // Update closing counts even for a model whose request just finished/switched.
    const current = this.buckets.get(Math.floor(this.now() / BUCKET_MS) * BUCKET_MS)!;
    for (const request of this.active.values()) if (request.modelConfigId) this.bucketFor(request.modelConfigId);
    for (const modelId of current.keys()) if (modelId !== null) this.bucketFor(modelId);
    return global;
  }

  private bucketFor(modelId: string | null) {
    const timestamp = Math.floor(this.now() / BUCKET_MS) * BUCKET_MS;
    const count = modelId === null ? this.active.size : [...this.active.values()].filter(item => item.modelConfigId === modelId).length;
    let group = this.buckets.get(timestamp);
    if (!group) { group = new Map(); this.buckets.set(timestamp, group); }
    let bucket = group.get(modelId);
    if (!bucket) { bucket = { ...zeroUsage(), peak: count, closing: count, reports: 0, fields: new Set() }; group.set(modelId, bucket); }
    bucket.peak = Math.max(bucket.peak, count);
    bucket.closing = count;
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
    while (this.history.length && this.history.at(-1)!.endedAt < now - RETENTION_MS - BUCKET_MS) this.history.pop();
  }
}

function zeroUsage(): UsageTotals { return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 }; }
function mean(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
export function failureCategory(code: string | undefined): Agent1FailureCategory {
  switch (code) {
    case "TIMEOUT": return "timeout";
    case "RATE_LIMITED": return "rate-limit";
    case "AUTHENTICATION": case "SECRET_UNAVAILABLE": return "authentication";
    case "UNAVAILABLE": case "CIRCUIT_OPEN": return "unavailable";
    case "BAD_RESPONSE": case "EMPTY_RESPONSE": case "RESPONSE_TOO_LARGE": return "bad-response";
    case "CONFIGURATION": case "INVALID_REQUEST": case "CAPABILITY_MISMATCH": return "configuration";
    default: return "unknown";
  }
}

export function getAgent1ActivityStore(database: ContentDatabase) {
  const scope = globalThis as typeof globalThis & { __pythagorasAgent1Activity?: Map<string, Agent1ActivityStore> };
  const stores = scope.__pythagorasAgent1Activity ??= new Map();
  const key = database.paths.databaseFile;
  let store = stores.get(key);
  if (!store) { store = new Agent1ActivityStore(); stores.set(key, store); }
  return store;
}
