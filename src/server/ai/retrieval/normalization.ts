import { normalizeArabicSearchText } from "../../question-search/arabic-normalization";
import {
  AI_RETRIEVAL_MAX_QUERY_BYTES,
  AI_RETRIEVAL_MAX_QUERY_TERMS,
  AI_RETRIEVAL_NORMALIZER_KEY,
  AI_RETRIEVAL_NORMALIZER_REVISION,
} from "./contracts";
import { AIRetrievalError } from "./errors";

export { AI_RETRIEVAL_NORMALIZER_KEY, AI_RETRIEVAL_NORMALIZER_REVISION };

export function normalizeRetrievalText(value: string, language?: string): string {
  if (isArabic(language, value)) return normalizeArabicSearchText(value);
  return value.normalize("NFKC").toLocaleLowerCase("und").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function tokenizeRetrievalQuery(value: string): { normalizedQuery: string; tokens: string[] } {
  if (typeof value !== "string") throw new AIRetrievalError("AI_RETRIEVAL_QUERY_INVALID", "Retrieval query must be text.");
  if (Buffer.byteLength(value, "utf8") > AI_RETRIEVAL_MAX_QUERY_BYTES) throw new AIRetrievalError("AI_RETRIEVAL_QUERY_TOO_LARGE", "Retrieval query exceeds the safe limit.");
  const normalizedQuery = normalizeRetrievalText(value);
  const tokens = normalizedQuery ? normalizedQuery.split(" ") : [];
  if (!tokens.length) throw new AIRetrievalError("AI_RETRIEVAL_QUERY_EMPTY", "Retrieval query contains no searchable terms.");
  if (tokens.length > AI_RETRIEVAL_MAX_QUERY_TERMS) throw new AIRetrievalError("AI_RETRIEVAL_QUERY_TOO_LARGE", "Retrieval query contains too many terms.");
  return { normalizedQuery, tokens };
}

export function buildSafeRetrievalMatch(value: string): { normalizedQuery: string; match: string } {
  const { normalizedQuery, tokens } = tokenizeRetrievalQuery(value);
  return {
    normalizedQuery,
    match: tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND "),
  };
}

function isArabic(language: string | undefined, value: string): boolean {
  return language?.toLowerCase().startsWith("ar") === true || /[\u0600-\u06ff]/u.test(value);
}
