import type { AIConversationFinishReason } from "../../conversations";
import type { AITutorCitationMapItem } from "../preflight/contracts";

export const AI_TUTOR_OUTPUT_VALIDATION_STATUSES = ["VALID", "INVALID"] as const;
export type AITutorOutputValidationStatus = (typeof AI_TUTOR_OUTPUT_VALIDATION_STATUSES)[number];

export const AI_TUTOR_OUTPUT_VALIDATION_REASONS = [
  "VALID",
  "UNSUPPORTED_PROTOCOL",
  "INVALID_OUTPUT",
  "EMPTY_OUTPUT",
  "MISSING_CITATION",
  "MALFORMED_CITATION",
  "UNKNOWN_CITATION",
  "INVALID_CITATION_MAP",
] as const;
export type AITutorOutputValidationReason = (typeof AI_TUTOR_OUTPUT_VALIDATION_REASONS)[number];

export type AITutorOutputValidationFinishReason = Exclude<AIConversationFinishReason, "FAILED" | "CANCELLED">;

export interface AITutorOutputValidationInput {
  outputText: string;
  citationMap: readonly AITutorCitationMapItem[];
  finishReason: AIConversationFinishReason;
  groundingProtocolKey: string;
  groundingProtocolRevision: number;
  citationProtocolKey: string;
  citationProtocolRevision: number;
}

export interface AITutorOutputValidationResult {
  status: AITutorOutputValidationStatus;
  safeReason: AITutorOutputValidationReason;
  citationCount: number;
  uniqueCitationCount: number;
  citedLabels: readonly string[];
}
