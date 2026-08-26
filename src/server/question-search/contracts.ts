import type { SearchProvider } from "../content";
import type { PublicQuestionSourceSummary } from "../questions/public-provenance";

export const QUESTION_SEARCH_INDEX_VERSION = 1;
export const QUESTION_SEARCH_DEFAULT_PAGE_SIZE = 25;
export const QUESTION_SEARCH_MAX_PAGE_SIZE = 100;

export type QuestionSearchMatchContext =
  | "PRIMARY_VARIANT"
  | "ALTERNATE_VARIANT"
  | "ANSWER"
  | "TAXONOMY"
  | "PROVENANCE";

export interface QuestionSearchPlacementScope {
  packageId: string;
  targetMode: "ALL_PACKAGE_QUESTIONS" | "TAXONOMY_FILTER" | null;
  taxonomyNodeIds: readonly string[];
}

export interface QuestionSearchQuery {
  scope: QuestionSearchPlacementScope;
  query: string;
  offset?: number;
  limit?: number;
}

export interface PublicQuestionSearchResult {
  query: string;
  normalizedQuery: string;
  total: number;
  offset: number;
  limit: number;
  items: Array<{
    questionId: string;
    bankOrdinal: number;
    primaryPreview: string;
    taxonomyBreadcrumb: string;
    variantCount: number;
    occurrenceCount: number;
    sourceSummary: PublicQuestionSourceSummary[];
    hasAnswer: boolean;
    matchContext: QuestionSearchMatchContext;
    matchPreview: string;
  }>;
}

export interface QuestionSearchHealth {
  canonicalQuestionCount: number;
  indexedQuestionCount: number;
  indexedSegmentCount: number;
  healthy: boolean;
}

export type QuestionSearchProvider = SearchProvider<QuestionSearchQuery, PublicQuestionSearchResult>;
