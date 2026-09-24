export const AI_AGENT_1_RUNTIME_ERROR_CODES = [
  "AI_AGENT_1_RUNTIME_INVALID",
  "AI_AGENT_1_RUNTIME_CONFLICT",
  "AI_AGENT_1_RUNTIME_MODEL_NOT_FOUND",
  "AI_AGENT_1_RUNTIME_MODEL_NOT_READY",
  "AI_AGENT_1_RUNTIME_PRIMARY_REQUIRED",
  "AI_AGENT_1_RUNTIME_CORRUPT",
] as const;

export type AIAgent1RuntimeErrorCode =
  (typeof AI_AGENT_1_RUNTIME_ERROR_CODES)[number];

export class AIAgent1RuntimeError extends Error {
  constructor(
    readonly code: AIAgent1RuntimeErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIAgent1RuntimeError";
  }
}

export function isAIAgent1RuntimeError(
  value: unknown,
): value is AIAgent1RuntimeError {
  return value instanceof AIAgent1RuntimeError;
}
