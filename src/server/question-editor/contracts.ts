import type {
  CanonicalRichDocument,
  QuestionBankBrowseMode,
  QuestionBrowseContent,
  QuestionItemContent,
  QuestionPackageContent,
  QuestionTaxonomyContent,
} from "../questions";
import type { ChangeSetStatus } from "../change-management";

export const QUESTION_EDITOR_PAGE_SIZE = 50;
export const QUESTION_EDITOR_RESOURCE_TYPES = [
  "question.package",
  "question.taxonomy",
  "question.browse",
  "question.item",
] as const;
export type QuestionEditorResourceType = (typeof QUESTION_EDITOR_RESOURCE_TYPES)[number];

export interface QuestionEditorDraft {
  id: string;
  title: string;
  status: "DRAFT" | "NEEDS_CHANGES";
  revision: number;
  itemCount: number;
  updatedAt: number;
}

export interface QuestionPackageWorkflow {
  id: string;
  title: string;
  status: ChangeSetStatus;
  revision: number;
  itemCount: number;
  updatedAt: number;
  editable: boolean;
}

export interface QuestionPackageCounts {
  questionCount: number;
  variantCount: number;
  occurrenceCount: number;
  taxonomyCount: number;
  browseCount: number;
}

export interface QuestionPackageWorkspaceSummary extends QuestionPackageCounts {
  id: string;
  packageKey: string;
  title: string;
  subjectKey: string;
  subjectLabel: string;
  language: string;
  contentRevision: number;
  bankBrowseMode: QuestionBankBrowseMode;
  bankBrowseEntryLabel: string;
  bankBrowseEntryOrder: number;
  revision: number;
  updatedAt: number | null;
  published: boolean;
  activeDraft: QuestionEditorDraft | null;
  workflow: QuestionPackageWorkflow | null;
}

export interface EffectiveQuestionPackage {
  id: string;
  content: QuestionPackageContent;
  revision: number;
  updatedAt: number | null;
  published: boolean;
  draft: boolean;
}

export interface EffectiveTaxonomyNode extends QuestionTaxonomyContent {
  id: string;
  revision: number;
  draft: boolean;
  draftOnly: boolean;
  draftItemId: string | null;
}

export interface EffectiveBrowseNode extends QuestionBrowseContent {
  id: string;
  revision: number;
  draft: boolean;
  draftOnly: boolean;
  draftItemId: string | null;
}

export interface QuestionSummary {
  id: string;
  displayOrder: number;
  primaryPreview: string;
  taxonomyBreadcrumb: string;
  variantCount: number;
  occurrenceCount: number;
  hasAnswer: boolean;
  revision: number;
  draft: boolean;
  draftOnly: boolean;
}

export interface EffectiveQuestionDetail {
  id: string;
  content: QuestionItemContent;
  revision: number;
  draft: boolean;
  draftOnly: boolean;
  publishedVariantIds: string[];
  publishedOccurrenceIds: string[];
}

export interface PreparedQuestionEditorIds {
  questionId: string;
  variantId: string;
  blockIds: string[];
  verseIds: string[];
  occurrenceIds: string[];
  taxonomyIds: string[];
  browseIds: string[];
}

export type QuestionEditorProposal =
  | { resourceType: "question.package"; resourceId: string; desired: QuestionPackageContent }
  | { resourceType: "question.taxonomy"; resourceId: string; desired: QuestionTaxonomyContent }
  | { resourceType: "question.browse"; resourceId: string; desired: QuestionBrowseContent }
  | { resourceType: "question.item"; resourceId: string; desired: QuestionItemContent };

export interface RichDocumentEditorState {
  document: CanonicalRichDocument;
}
