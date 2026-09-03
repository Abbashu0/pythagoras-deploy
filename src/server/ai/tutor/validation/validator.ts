import {
  AI_TUTOR_CITATION_PROTOCOL_KEY,
  AI_TUTOR_CITATION_PROTOCOL_REVISION,
  AI_TUTOR_GROUNDING_PROTOCOL_KEY,
  AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
} from "../configuration";
import type {
  AITutorOutputValidationInput,
  AITutorOutputValidationResult,
  AITutorOutputValidationReason,
} from "./contracts";

const CANONICAL_CITATION_PATTERN = /^\[E[1-9][0-9]*\]$/u;
const CITATION_LIKE_BODY_PATTERN = /[Ee][0-9]+/u;
const BOUNDED_CITATION_SCAN_BYTES = 256;

/** Pure M8C output-integrity validation; it never rewrites or persists output text. */
export class AITutorOutputValidator {
  validate(input: AITutorOutputValidationInput): AITutorOutputValidationResult {
    if (!isSupportedProtocol(input)) return invalid("UNSUPPORTED_PROTOCOL");
    if (typeof input.outputText !== "string" || Buffer.byteLength(input.outputText, "utf8") > BOUNDED_CITATION_SCAN_BYTES * 4_096) return invalid("INVALID_OUTPUT");
    if (!isValidCitationMap(input.citationMap)) return invalid("INVALID_CITATION_MAP");
    if (!["STOP", "LENGTH", "CONTENT_FILTER", "OTHER"].includes(input.finishReason)) return invalid("INVALID_OUTPUT");

    const candidates = findCitationCandidates(input.outputText);
    const citationMap = new Set(input.citationMap.map((item) => item.label));
    const citedLabels: string[] = [];
    const seenLabels = new Set<string>();
    for (const candidate of candidates) {
      if (!CANONICAL_CITATION_PATTERN.test(candidate)) return invalid("MALFORMED_CITATION", candidates.length, citedLabels);
      if (!citationMap.has(candidate)) return invalid("UNKNOWN_CITATION", candidates.length, citedLabels);
      if (!seenLabels.has(candidate)) {
        seenLabels.add(candidate);
        citedLabels.push(candidate);
      }
    }

    if (input.finishReason !== "CONTENT_FILTER") {
      if (!input.outputText.trim()) return invalid("EMPTY_OUTPUT", candidates.length, citedLabels);
      if (candidates.length === 0) return invalid("MISSING_CITATION", 0, citedLabels);
    }

    return valid(candidates.length, citedLabels);
  }
}

function isSupportedProtocol(input: AITutorOutputValidationInput): boolean {
  return !!input
    && input.groundingProtocolKey === AI_TUTOR_GROUNDING_PROTOCOL_KEY
    && input.groundingProtocolRevision === AI_TUTOR_GROUNDING_PROTOCOL_REVISION
    && input.citationProtocolKey === AI_TUTOR_CITATION_PROTOCOL_KEY
    && input.citationProtocolRevision === AI_TUTOR_CITATION_PROTOCOL_REVISION;
}

function isValidCitationMap(value: unknown): value is AITutorOutputValidationInput["citationMap"] {
  if (!Array.isArray(value) || value.length > 50) return false;
  const labels = new Set<string>();
  for (const item of value) {
    if (!item || typeof item.label !== "string" || !CANONICAL_CITATION_PATTERN.test(item.label) || labels.has(item.label)) return false;
    labels.add(item.label);
  }
  return true;
}

function findCitationCandidates(text: string): string[] {
  const candidates: Array<{ index: number; token: string }> = [];
  const bracketRanges: Array<{ start: number; end: number }> = [];
  const bracketPattern = new RegExp(`\\[[^\\]\\r\\n]{0,${BOUNDED_CITATION_SCAN_BYTES}}\\]?`, "gu");
  for (const match of text.matchAll(bracketPattern)) {
    const token = match[0];
    const body = token.slice(1, token.endsWith("]") ? -1 : undefined);
    if (!CITATION_LIKE_BODY_PATTERN.test(body)) continue;
    const index = match.index ?? 0;
    candidates.push({ index, token });
    bracketRanges.push({ start: index, end: index + token.length });
  }
  const barePattern = /\b[Ee][0-9]+\]/gu;
  for (const match of text.matchAll(barePattern)) {
    const index = match.index ?? 0;
    if (bracketRanges.some((range) => index >= range.start && index < range.end)) continue;
    candidates.push({ index, token: match[0] });
  }
  return candidates.sort((left, right) => left.index - right.index).map((candidate) => candidate.token);
}

function valid(citationCount: number, citedLabels: readonly string[]): AITutorOutputValidationResult {
  return Object.freeze({
    status: "VALID" as const,
    safeReason: "VALID" as const,
    citationCount,
    uniqueCitationCount: citedLabels.length,
    citedLabels: Object.freeze([...citedLabels]),
  });
}

function invalid(
  safeReason: AITutorOutputValidationReason,
  citationCount = 0,
  citedLabels: readonly string[] = [],
): AITutorOutputValidationResult {
  return Object.freeze({
    status: "INVALID" as const,
    safeReason,
    citationCount,
    uniqueCitationCount: new Set(citedLabels).size,
    citedLabels: Object.freeze([...citedLabels]),
  });
}
