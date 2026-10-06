import type { Agent1InstructionCaptureMetadata } from "./instruction-envelope";
import type { Agent1AssuranceTier, Agent1Qualification } from "./instruction-qualification";
import type { Agent1ConformanceStatus } from "./instruction-conformance-contracts";
export interface Agent1ActivityInstructions extends Agent1InstructionCaptureMetadata {
  instructionConformanceVersion: number | null;
  instructionConformanceStatus: Agent1Qualification | null;
  plannedModels: readonly { modelConfigId: string; conformanceRecordId: string | null; assuranceTier: Agent1AssuranceTier; qualification: Agent1Qualification | null; conformanceStatus: Agent1ConformanceStatus | null }[];
}
export type Agent1ActivityPhase = "connecting" | "thinking" | "responding";
export type Agent1ActivityOutcome = "completed" | "failed" | "cancelled" | "expired";
export const ACTIVITY_WINDOWS = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000 } as const;
export type Agent1ActivityWindow = keyof typeof ACTIVITY_WINDOWS;
export type Agent1FailureCategory = "timeout" | "rate-limit" | "authentication" | "unavailable" | "bad-response" | "configuration" | "unknown";
export const ACTIVITY_RESULT_FILTERS = ["all", "failed", "cancelled", "fallback", "timeout", "rate-limit", "authentication", "unavailable", "bad-response", "configuration", "unknown"] as const;
export type Agent1ActivityResultFilter = typeof ACTIVITY_RESULT_FILTERS[number];
export interface Agent1ActivityAttempt {
  modelConfigId: string;
  startedAt: number;
  endedAt: number | null;
  status: "running" | "succeeded" | "failed" | "cancelled";
  reason: Agent1FailureCategory | null;
  firstTextMs: number | null;
}
export interface Agent1ModelPerformance {
  modelConfigId: string;
  attempts: number;
  succeeded: number;
  failed: number;
  averageFirstTextMs: number | null;
  averageDurationMs: number | null;
}

export interface Agent1ActivityPoint {
  timestamp: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  concurrentRequests: number;
}

export interface Agent1ActivitySnapshot {
  sessionStartedAt: number;
  capturedAt: number;
  source: "development-chat";
  bucketMs: number;
  scope: { window: Agent1ActivityWindow; from: number; modelConfigId: string | null; resultFilter: Agent1ActivityResultFilter; historyLimited: boolean };
  modelPerformance: Agent1ModelPerformance[];
  transitions: { fromModelConfigId: string; toModelConfigId: string; startedAt: number; reason: Agent1FailureCategory | null; active: boolean }[];
  activeModels: { modelConfigId: string; count: number; phase: Agent1ActivityPhase }[];
  stats: {
    activeRequests: number;
    completedRequests: number;
    failedRequests: number;
    cancelledRequests: number;
    fallbackAttempts: number;
    inputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    usageReports: number;
    missingUsageRequests: number;
    averageLatencyMs: number | null;
    averageFirstTextMs: number | null;
    p95LatencyMs: number | null;
    latencySamples: number;
  };
  points: Agent1ActivityPoint[];
  recent: {
    instructions?: Readonly<Agent1ActivityInstructions>;
    modelConfigId: string | null;
    outcome: Agent1ActivityOutcome;
    endedAt: number;
    latencyMs: number;
    outputTokens: number | null;
    attempts: number;
    usageReported: boolean;
    firstTextMs: number | null;
    reason: Agent1FailureCategory | null;
    chain: Agent1ActivityAttempt[];
  }[];
}
