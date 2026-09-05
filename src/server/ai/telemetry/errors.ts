export const AI_TELEMETRY_ERROR_CODES = [
  "AI_TELEMETRY_INVALID",
  "AI_TELEMETRY_CONFLICT",
  "AI_TELEMETRY_NOT_FOUND",
  "AI_TELEMETRY_PRIVACY_INVALID",
  "AI_TELEMETRY_CORRELATION_INVALID",
  "AI_TELEMETRY_FEEDBACK_INVALID",
  "AI_TELEMETRY_RANGE_INVALID",
] as const;
export type AITelemetryErrorCode = (typeof AI_TELEMETRY_ERROR_CODES)[number];

export class AITelemetryError extends Error {
  constructor(
    readonly code: AITelemetryErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AITelemetryError";
  }
}
