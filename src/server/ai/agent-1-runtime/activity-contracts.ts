export type Agent1ActivityPhase = "connecting" | "thinking" | "responding";
export type Agent1ActivityOutcome = "completed" | "failed" | "cancelled" | "expired";

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
  };
  points: Agent1ActivityPoint[];
  recent: {
    modelConfigId: string | null;
    outcome: Agent1ActivityOutcome;
    endedAt: number;
    latencyMs: number;
    outputTokens: number | null;
    attempts: number;
  }[];
}
