export const AI_MEMORY_EXECUTION_ERROR_CODES = [
  "AI_MEMORY_EXECUTION_CONFIG_INVALID",
  "AI_MEMORY_EXECUTION_CONFIG_NOT_FOUND",
  "AI_MEMORY_EXECUTION_CONFIG_CONFLICT",
  "AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID",
  "AI_MEMORY_EXECUTION_CONFIG_SUBJECT_MISMATCH",
  "AI_MEMORY_EXECUTION_INVALID",
  "AI_MEMORY_EXECUTION_NOT_FOUND",
  "AI_MEMORY_EXECUTION_SOURCE_INVALID",
  "AI_MEMORY_EXECUTION_PROTOCOL_INVALID",
  "AI_MEMORY_EXECUTION_ADMISSION_RETRYABLE",
  "AI_MEMORY_EXECUTION_ADMISSION_DENIED",
  "AI_MEMORY_EXECUTION_INPUT_LOST",
  "AI_MEMORY_EXECUTION_PROVIDER_AMBIGUOUS",
  "AI_MEMORY_EXECUTION_RESULT_INVALID",
] as const;
export type AIMemoryExecutionErrorCode = (typeof AI_MEMORY_EXECUTION_ERROR_CODES)[number];

export class AIMemoryExecutionError extends Error {
  constructor(
    readonly code: AIMemoryExecutionErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIMemoryExecutionError";
  }
}
