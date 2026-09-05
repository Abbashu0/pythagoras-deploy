import type { ContentDatabase } from "../../content/database";
import type {
  AITelemetryBreakdownRow,
  AITelemetryOverview,
  AITelemetryReadRange,
  AITelemetryTimeSeriesPoint,
} from "./contracts";
import { AITelemetryError } from "./errors";
import { SQLiteAIIntelligenceTelemetryRepository } from "./sqlite-repository";
import { validateReadRange } from "./validation";

export type AITelemetryBucket = "day" | "week" | "month";

/** Bounded, de-identified analytics read model. It exposes aggregates only. */
export class AIDeidentifiedAnalyticsReadService {
  private readonly repository: SQLiteAIIntelligenceTelemetryRepository;

  constructor(private readonly database: ContentDatabase, repository?: SQLiteAIIntelligenceTelemetryRepository) {
    this.repository = repository ?? new SQLiteAIIntelligenceTelemetryRepository(database);
  }

  overview(input: AITelemetryReadRange): AITelemetryOverview {
    this.validate(input);
    const extendedFrom = Math.max(0, input.from - 30 * 86_400_000);
    const events = this.studentEvents({ from: input.from, to: input.to, subjectKey: input.subjectKey });
    const extendedEvents = this.studentEvents({ from: extendedFrom, to: input.to, subjectKey: input.subjectKey });
    const feedback = this.repository.listFeedback(input).filter((item) => item.analyticsPrincipalId !== null);
    const started = count(events, "TUTOR_REQUEST_STARTED");
    const completed = count(events, "TUTOR_REQUEST_COMPLETED");
    const failed = count(events, "TUTOR_REQUEST_FAILED");
    const durations = events.filter((event) => event.eventType === "TUTOR_REQUEST_COMPLETED" && event.durationMs !== null).map((event) => event.durationMs!).sort((left, right) => left - right);
    const users = new Set(events.map((event) => event.analyticsPrincipalId).filter((id): id is string => id !== null));
    const dayUsers = distinctUsers(extendedEvents, input.to - 86_400_000);
    const weekUsers = distinctUsers(extendedEvents, input.to - 7 * 86_400_000);
    const monthUsers = distinctUsers(extendedEvents, input.to - 30 * 86_400_000);
    const inputTokens = safeSum(events.filter((event) => event.eventType === "TUTOR_REQUEST_COMPLETED").map((event) => event.inputTokens).filter((value): value is number => value !== null));
    const outputTokens = safeSum(events.filter((event) => event.eventType === "TUTOR_REQUEST_COMPLETED").map((event) => event.outputTokens).filter((value): value is number => value !== null));
    const reasoningTokens = safeSum(events.filter((event) => event.eventType === "TUTOR_REQUEST_COMPLETED").map((event) => event.reasoningTokens).filter((value): value is number => value !== null));
    const knownCosts = events.filter((event) => event.eventType === "TUTOR_REQUEST_COMPLETED").map((event) => event.knownCostNano).filter((value): value is number => value !== null);
    return {
      from: input.from,
      to: input.to,
      tutorRequests: { started, completed, failed, successRateUnits: ratioUnits(completed, started) },
      activeUsers: { dau: dayUsers.size, wau: weekUsers.size, mau: monthUsers.size, requestsPerActiveUser: users.size ? started / users.size : 0 },
      usage: { inputTokens, outputTokens, reasoningTokens, knownCostNano: safeSum(knownCosts), costKnownEventCount: knownCosts.length },
      latency: { count: durations.length, averageMs: durations.length ? Math.floor(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null, p95ReadyValuesMs: durations.slice(0, 1000) },
      retrieval: { sufficient: count(events, "RETRIEVAL_COMPLETED"), insufficient: count(events, "RETRIEVAL_INSUFFICIENT"), failed: count(events, "RETRIEVAL_FAILED"), rerankerUsed: events.filter((event) => event.eventType === "RETRIEVAL_COMPLETED" && event.retrievalRerankerUsed === true).length, selectedEvidenceCount: safeSum(events.map((event) => event.retrievalSelectedEvidenceCount).filter((value): value is number => value !== null)) },
      grounding: { passed: count(events, "GROUNDING_VALIDATION_PASSED"), failed: count(events, "GROUNDING_VALIDATION_FAILED") },
      memory: { applied: count(events, "MEMORY_MUTATION_APPLIED"), rejected: count(events, "MEMORY_MUTATION_REJECTED"), noop: events.filter((event) => event.eventType === "MEMORY_MUTATION_APPLIED" && event.memoryAction === "NOOP").length },
      compaction: { scheduled: count(events, "COMPACTION_SCHEDULED"), completed: count(events, "COMPACTION_COMPLETED"), failed: count(events, "COMPACTION_FAILED") },
      feedback: { positive: feedback.filter((item) => item.feedbackType === "POSITIVE").length, negative: feedback.filter((item) => item.feedbackType === "NEGATIVE").length, reports: feedback.filter((item) => item.feedbackType === "REPORT").length },
    };
  }

  timeSeries(input: AITelemetryReadRange, bucket: AITelemetryBucket = "day"): AITelemetryTimeSeriesPoint[] {
    this.validate(input);
    if (!["day", "week", "month"].includes(bucket)) throw new AITelemetryError("AI_TELEMETRY_RANGE_INVALID", "The telemetry time bucket is invalid.");
    const events = this.studentEvents(input);
    const feedback = this.repository.listFeedback(input).filter((item) => item.analyticsPrincipalId !== null);
    const points = new Map<string, AITelemetryTimeSeriesPoint>();
    const get = (key: string) => {
      const current = points.get(key);
      if (current) return current;
      const created: AITelemetryTimeSeriesPoint = { bucket: key, tutorStarted: 0, tutorCompleted: 0, tutorFailed: 0, retrievalInsufficient: 0, groundingFailed: 0, memoryApplied: 0, compactionCompleted: 0, positiveFeedback: 0, negativeFeedback: 0, reports: 0 };
      points.set(key, created);
      return created;
    };
    for (const event of events) {
      const point = get(bucket === "day" ? event.utcDay : bucket === "week" ? event.utcWeek : event.utcMonth);
      if (event.eventType === "TUTOR_REQUEST_STARTED") point.tutorStarted += 1;
      if (event.eventType === "TUTOR_REQUEST_COMPLETED") point.tutorCompleted += 1;
      if (event.eventType === "TUTOR_REQUEST_FAILED") point.tutorFailed += 1;
      if (event.eventType === "RETRIEVAL_INSUFFICIENT") point.retrievalInsufficient += 1;
      if (event.eventType === "GROUNDING_VALIDATION_FAILED") point.groundingFailed += 1;
      if (event.eventType === "MEMORY_MUTATION_APPLIED") point.memoryApplied += 1;
      if (event.eventType === "COMPACTION_COMPLETED") point.compactionCompleted += 1;
    }
    for (const item of feedback) {
      const date = new Date(item.occurredAt).toISOString().slice(0, 10);
      const key = bucket === "month" ? date.slice(0, 7) : bucket === "week" ? isoWeek(item.occurredAt) : date;
      const point = get(key);
      if (item.feedbackType === "POSITIVE") point.positiveFeedback += 1;
      if (item.feedbackType === "NEGATIVE") point.negativeFeedback += 1;
      if (item.feedbackType === "REPORT") point.reports += 1;
    }
    return [...points.values()].sort((left, right) => left.bucket.localeCompare(right.bucket));
  }

  subjectBreakdown(input: AITelemetryReadRange, limit = 100): AITelemetryBreakdownRow[] {
    return this.breakdown(input, "subject", limit);
  }

  modelProviderBreakdown(input: AITelemetryReadRange, limit = 100): AITelemetryBreakdownRow[] {
    this.validate(input);
    const events = this.studentEvents(input).filter((event) => event.eventType === "TUTOR_REQUEST_COMPLETED" || event.eventType === "TUTOR_REQUEST_FAILED");
    const rows = new Map<string, AITelemetryBreakdownRow>();
    for (const event of events) {
      const dimension = `${event.modelConfigId ?? "unknown"}@${event.modelConfigRevision ?? 0}/${event.providerConfigId ?? "unknown"}@${event.providerConfigRevision ?? 0}`;
      const row = rows.get(dimension) ?? { dimension, count: 0, failed: 0, completed: 0 };
      row.count += 1;
      if (event.eventType === "TUTOR_REQUEST_FAILED") row.failed += 1;
      else row.completed += 1;
      rows.set(dimension, row);
    }
    return [...rows.values()].sort((left, right) => right.count - left.count || left.dimension.localeCompare(right.dimension)).slice(0, boundedLimit(limit));
  }

  failureBreakdown(input: AITelemetryReadRange, limit = 100): Array<{ failureCode: string; count: number }> {
    this.validate(input);
    const counts = new Map<string, number>();
    for (const event of this.studentEvents(input)) if (event.failureCode) counts.set(event.failureCode, (counts.get(event.failureCode) ?? 0) + 1);
    return [...counts.entries()].map(([failureCode, count]) => ({ failureCode, count })).sort((left, right) => right.count - left.count || left.failureCode.localeCompare(right.failureCode)).slice(0, boundedLimit(limit));
  }

  agent2ReadySnapshot(input: AITelemetryReadRange): { overview: AITelemetryOverview; timeSeries: AITelemetryTimeSeriesPoint[]; subjectBreakdown: AITelemetryBreakdownRow[]; modelProviderBreakdown: AITelemetryBreakdownRow[]; failureBreakdown: Array<{ failureCode: string; count: number }> } {
    return { overview: this.overview(input), timeSeries: this.timeSeries(input), subjectBreakdown: this.subjectBreakdown(input), modelProviderBreakdown: this.modelProviderBreakdown(input), failureBreakdown: this.failureBreakdown(input) };
  }

  private breakdown(input: AITelemetryReadRange, dimension: "subject", limit: number): AITelemetryBreakdownRow[] {
    this.validate(input);
    const rows = new Map<string, AITelemetryBreakdownRow>();
    for (const event of this.studentEvents(input)) {
      if (!["TUTOR_REQUEST_STARTED", "TUTOR_REQUEST_COMPLETED", "TUTOR_REQUEST_FAILED"].includes(event.eventType)) continue;
      const key = dimension === "subject" ? event.subjectKey ?? "unknown" : "unknown";
      const row = rows.get(key) ?? { dimension: key, count: 0, failed: 0, completed: 0 };
      row.count += 1;
      if (event.eventType === "TUTOR_REQUEST_FAILED") row.failed += 1;
      if (event.eventType === "TUTOR_REQUEST_COMPLETED") row.completed += 1;
      rows.set(key, row);
    }
    return [...rows.values()].sort((left, right) => right.count - left.count || left.dimension.localeCompare(right.dimension)).slice(0, boundedLimit(limit));
  }

  private studentEvents(input: AITelemetryReadRange) {
    return this.repository.listEvents(input).filter((event) => event.analyticsPrincipalId !== null);
  }

  private validate(input: AITelemetryReadRange): void {
    try { validateReadRange(input); } catch (error) { throw new AITelemetryError("AI_TELEMETRY_RANGE_INVALID", "The telemetry read range is invalid.", {}, error); }
  }
}

function count(events: readonly { eventType: string }[], eventType: string): number {
  return events.filter((event) => event.eventType === eventType).length;
}

function safeSum(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Number.isSafeInteger(sum) && sum >= 0 ? sum : null;
}

function ratioUnits(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.floor((numerator * 1_000_000) / denominator) : 0;
}

function distinctUsers(events: readonly { analyticsPrincipalId: string | null; occurredAt: number }[], from: number): Set<string> {
  return new Set(events.filter((event) => event.occurredAt >= from).map((event) => event.analyticsPrincipalId).filter((id): id is string => id !== null));
}

function boundedLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : 100;
}

function isoWeek(at: number): string {
  const date = new Date(at);
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
