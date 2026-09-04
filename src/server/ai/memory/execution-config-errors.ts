export const AI_MEMORY_EXECUTION_CONFIG_ERROR_CODES = [
  "AI_MEMORY_EXECUTION_CONFIG_INVALID",
  "AI_MEMORY_EXECUTION_CONFIG_NOT_FOUND",
  "AI_MEMORY_EXECUTION_CONFIG_CONFLICT",
  "AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID",
  "AI_MEMORY_EXECUTION_CONFIG_SUBJECT_MISMATCH",
] as const;
export type AIMemoryExecutionConfigErrorCode = (typeof AI_MEMORY_EXECUTION_CONFIG_ERROR_CODES)[number];

export class AIMemoryExecutionConfigError extends Error {
  constructor(readonly code: AIMemoryExecutionConfigErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AIMemoryExecutionConfigError";
  }
}
