import type {
  AIProviderAttemptTrace,
  AIProviderErrorCode,
} from "./contracts";

export const AI_PROVIDER_ADAPTER_ERROR_CODES = [
  "AI_PROVIDER_ADAPTER_INVALID",
  "AI_PROVIDER_ADAPTER_DUPLICATE",
  "AI_PROVIDER_ADAPTER_NOT_FOUND",
  "AI_PROVIDER_ADAPTER_CAPABILITY_MISMATCH",
] as const;

export type AIProviderAdapterErrorCode =
  (typeof AI_PROVIDER_ADAPTER_ERROR_CODES)[number];

export class AIProviderAdapterRegistryError extends Error {
  constructor(
    readonly code: AIProviderAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AIProviderAdapterRegistryError";
  }
}

export function isAIProviderAdapterRegistryError(
  value: unknown,
): value is AIProviderAdapterRegistryError {
  return value instanceof AIProviderAdapterRegistryError;
}

/** Safe error an adapter may return to the Gateway without exposing provider payloads. */
export class AIProviderAdapterError extends Error {
  constructor(
    readonly code: AIProviderErrorCode,
    options: {
      retryable?: boolean;
      fallbackEligible?: boolean;
      providerRequestId?: string;
    } = {},
  ) {
    super("The provider adapter could not complete the operation.");
    this.name = "AIProviderAdapterError";
    this.retryable = options.retryable ?? defaultRetryability(code);
    this.fallbackEligible =
      options.fallbackEligible ?? defaultFallbackEligibility(code);
    this.providerRequestId = options.providerRequestId;
  }

  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  readonly providerRequestId: string | undefined;
}

export function isAIProviderAdapterError(
  value: unknown,
): value is AIProviderAdapterError {
  return value instanceof AIProviderAdapterError;
}

export class AIProviderGatewayError extends Error {
  constructor(
    readonly code: AIProviderErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      fallbackEligible?: boolean;
      attempts?: readonly AIProviderAttemptTrace[];
      providerRequestId?: string;
    } = {},
  ) {
    super(message);
    this.name = "AIProviderGatewayError";
    this.retryable = options.retryable ?? defaultRetryability(code);
    this.fallbackEligible =
      options.fallbackEligible ?? defaultFallbackEligibility(code);
    this.attempts = options.attempts ?? [];
    this.providerRequestId = options.providerRequestId;
  }

  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  readonly attempts: readonly AIProviderAttemptTrace[];
  readonly providerRequestId: string | undefined;
}

export function isAIProviderGatewayError(
  value: unknown,
): value is AIProviderGatewayError {
  return value instanceof AIProviderGatewayError;
}

export function defaultRetryability(code: AIProviderErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "TIMEOUT" || code === "UNAVAILABLE";
}

export function defaultFallbackEligibility(code: AIProviderErrorCode): boolean {
  return (
    code === "RATE_LIMITED" ||
    code === "TIMEOUT" ||
    code === "UNAVAILABLE" ||
    code === "BAD_RESPONSE"
  );
}

export function safeProviderErrorMessage(code: AIProviderErrorCode): string {
  switch (code) {
    case "CONFIGURATION":
      return "The AI Provider configuration is unavailable.";
    case "AUTHENTICATION":
      return "The AI Provider rejected authentication.";
    case "INVALID_REQUEST":
      return "The AI Provider request is invalid.";
    case "CAPABILITY_MISMATCH":
      return "The configured AI adapter does not support this capability.";
    case "RATE_LIMITED":
      return "The AI Provider rate limit was reached.";
    case "TIMEOUT":
      return "The AI Provider operation timed out.";
    case "UNAVAILABLE":
      return "The AI Provider is temporarily unavailable.";
    case "BAD_RESPONSE":
      return "The AI Provider returned an invalid response.";
    case "CANCELLED":
      return "The AI Provider operation was cancelled.";
    case "SECRET_UNAVAILABLE":
      return "The AI Provider credential is unavailable.";
    case "UNKNOWN":
      return "The AI Provider operation failed.";
  }
}
