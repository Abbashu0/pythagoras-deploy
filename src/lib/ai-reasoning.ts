import {
  AI_PROVIDER_API_FORMATS,
  type AIProviderApiFormat,
} from "./ai-provider-format";

/** Provider-neutral values accepted by the temporary Model diagnostic chat. */
export const AI_REASONING_EFFORTS = [
  "AUTO",
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
] as const;

export type AIReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];

export const AI_REASONING_CONTROL_KINDS = [
  "NONE",
  "AUTO_ONLY",
  "EFFORT_LEVELS",
] as const;

export type AIReasoningControlKind =
  (typeof AI_REASONING_CONTROL_KINDS)[number];

export interface AIReasoningControl {
  kind: AIReasoningControlKind;
  options: readonly AIReasoningEffort[];
}

/**
 * Describes only capabilities that the selected model and wire adapter can
 * safely expose. This is shared by the Admin display and the server-side
 * request validator; it is not a Provider-specific React decision.
 */
export function describeAIReasoningControl(input: {
  supportsReasoning: boolean;
  apiFormat: AIProviderApiFormat;
}): AIReasoningControl {
  if (!input.supportsReasoning) {
    return { kind: "NONE", options: [] };
  }

  switch (input.apiFormat) {
    case "OPENAI_CHAT_COMPLETIONS":
      return {
        kind: "EFFORT_LEVELS",
        options: AI_REASONING_EFFORTS,
      };
    case "OPENAI_RESPONSES":
      // Responses supports automatic selection and bounded effort levels; it
      // does not have a provider-neutral "none" effort value.
      return {
        kind: "EFFORT_LEVELS",
        options: ["AUTO", "LOW", "MEDIUM", "HIGH"],
      };
    case "ANTHROPIC_MESSAGES":
      // Anthropic extended thinking requires a provider-specific token budget,
      // so this generic contract exposes only the safe automatic mode.
      return { kind: "AUTO_ONLY", options: ["AUTO"] };
    default: {
      const exhaustive: never = input.apiFormat;
      return exhaustive;
    }
  }
}

export function isAIReasoningEffort(
  value: unknown,
): value is AIReasoningEffort {
  return (
    typeof value === "string" &&
    (AI_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

export function isAIProviderApiFormat(value: unknown): value is AIProviderApiFormat {
  return (
    typeof value === "string" &&
    (AI_PROVIDER_API_FORMATS as readonly string[]).includes(value)
  );
}
