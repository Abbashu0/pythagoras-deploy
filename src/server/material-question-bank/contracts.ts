import type { PublicRichDocument } from "@/lib/rich-content";
import type { ChangeSetStatus } from "../change-management";
import type {
  MaterialQuestionBankGroupPresentation,
  MaterialQuestionBankNodeType,
  MaterialQuestionBankRootPresentation,
  MaterialQuestionBankTargetMode,
} from "../content/schema";
import type { QuestionSourceKind, QuestionTaxonomyRole } from "../questions";
import type { PublicQuestionSourceSummary } from "../questions/public-provenance";
import type { MaterialQuestionBankProductPresetKey } from "./product-presets";

export const MATERIAL_QUESTION_BANK_RESOURCE_TYPE = "material.question-bank-layout" as const;
export const MATERIAL_QUESTION_BANK_PAGE_SIZE = 50;
export const MATERIAL_QUESTION_BANK_MAX_PAGE_SIZE = 100;

export interface MaterialQuestionBankNodeContent {
  id: string;
  nodeKey: string;
  label: string;
  nodeType: MaterialQuestionBankNodeType;
  parentId: string | null;
  displayOrder: number;
  groupPresentation: MaterialQuestionBankGroupPresentation | null;
  packageId: string | null;
  targetMode: MaterialQuestionBankTargetMode | null;
  taxonomyNodeId: string | null;
  includeDescendants: boolean | null;
  enabled: boolean;
}

/** One coherent human-reviewed Product composition aggregate. */
export interface MaterialQuestionBankLayoutContent {
  materialId: string;
  rootPresentation: MaterialQuestionBankRootPresentation;
  nodes: MaterialQuestionBankNodeContent[];
}

export interface MaterialQuestionBankLayoutEntity extends MaterialQuestionBankLayoutContent {
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  revision: number;
}

export interface MaterialQuestionBankWorkflow {
  id: string;
  status: ChangeSetStatus;
  revision: number;
  itemCount: number;
  editable: boolean;
  updatedAt: number;
}

export interface MaterialQuestionBankPackageOption {
  id: string;
  packageKey: string;
  title: string;
  subjectKey: string;
  subjectLabel: string;
  questionCount: number;
  taxonomyCount: number;
  published: boolean;
  workflow: MaterialQuestionBankWorkflow | null;
}

export interface MaterialQuestionBankTaxonomyOption {
  id: string;
  packageId: string;
  label: string;
  breadcrumb: string;
}

export interface MaterialQuestionBankAdminWorkspace {
  material: { id: string; subjectKey: string; label: string; available: boolean };
  layout: MaterialQuestionBankLayoutContent;
  canonicalRevision: number;
  published: boolean;
  publishedNodeIds: string[];
  workflow: MaterialQuestionBankWorkflow | null;
  packages: MaterialQuestionBankPackageOption[];
  taxonomy: MaterialQuestionBankTaxonomyOption[];
  productPreset: MaterialQuestionBankProductPresetKey | null;
  warnings: Array<{ code: "CROSS_SUBJECT_PLACEMENT"; nodeId: string; message: string }>;
}

export interface PublicMaterialQuestionBankNode {
  id: string;
  nodeKey: string;
  label: string;
  nodeType: MaterialQuestionBankNodeType;
  parentId: string | null;
  displayOrder: number;
  groupPresentation: MaterialQuestionBankGroupPresentation | null;
  available: boolean;
}

export interface PublicMaterialQuestionBankLayout {
  material: { id: string; subjectKey: string; label: string };
  rootPresentation: MaterialQuestionBankRootPresentation;
  nodes: PublicMaterialQuestionBankNode[];
}

export interface PublicQuestionSummary {
  questionId: string;
  ordinal: number;
  primaryPreview: string;
  primaryPreviewRich: PublicRichDocument;
  taxonomyBreadcrumb: string;
  variantCount: number;
  occurrenceCount: number;
  sourceSummary: PublicQuestionSourceSummary[];
  hasAnswer: boolean;
}

export interface PublicQuestionPage {
  total: number;
  offset: number;
  limit: number;
  items: PublicQuestionSummary[];
}

export interface PublicQuestionSearchPage extends PublicQuestionPage {
  query: string;
  normalizedQuery: string;
  items: Array<PublicQuestionSummary & {
    bankOrdinal: number;
    matchContext: "PRIMARY_VARIANT" | "ALTERNATE_VARIANT" | "ANSWER" | "TAXONOMY" | "PROVENANCE";
    matchPreview: string;
  }>;
}

export interface PublicQuestionOccurrence {
  id: string;
  displayOrder: number;
  sourceKind: QuestionSourceKind;
  year: number | null;
  roundCode: string | null;
  session: string | null;
  sourceName: string | null;
  notes: string | null;
  rawLabel: string;
  branches: string[];
  qualifiers: string[];
}

export interface PublicQuestionDetail {
  questionId: string;
  canonicalOrder: number;
  primaryVariantId: string;
  variants: Array<{ id: string; displayOrder: number; content: PublicRichDocument; occurrences: PublicQuestionOccurrence[] }>;
  sharedAnswer: PublicRichDocument | null;
  taxonomy: Array<{ id: string; role: QuestionTaxonomyRole; position: number; breadcrumb: string }>;
}
