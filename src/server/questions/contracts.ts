import type { AdminActor } from "../admin-auth/contracts";
import type {
  QuestionPackageDiagnostic,
  QuestionPackageValidationResult,
  RichInline,
} from "../question-packages/contracts";

export const QUESTION_BANK_BROWSE_MODES = [
  "ALL_PACKAGE_QUESTIONS",
  "TREE",
] as const;
export type QuestionBankBrowseMode = (typeof QUESTION_BANK_BROWSE_MODES)[number];

export const QUESTION_BROWSE_NODE_TYPES = ["GROUP", "QUESTION_LIST"] as const;
export type QuestionBrowseNodeType = (typeof QUESTION_BROWSE_NODE_TYPES)[number];

export const QUESTION_TAXONOMY_ROLES = ["PRIMARY", "RELATED"] as const;
export type QuestionTaxonomyRole = (typeof QUESTION_TAXONOMY_ROLES)[number];

export const QUESTION_SOURCE_KINDS = [
  "ministerial",
  "discussion-question",
  "educational-tv",
  "end-of-chapter",
  "book-question",
  "book-exercise",
  "enrichment",
  "other",
] as const;
export type QuestionSourceKind = (typeof QUESTION_SOURCE_KINDS)[number];

export type CanonicalRichDocument = {
  type: "doc";
  version: 1;
  blocks: Array<
    | { id: string; type: "paragraph"; spans: RichInline }
    | { id: string; type: "heading"; level: 2 | 3 | 4; spans: RichInline }
    | {
        id: string;
        type: "ordered-list" | "bullet-list";
        items: Array<{ spans: RichInline }>;
      }
    | {
        id: string;
        type: "quran";
        verses: Array<{
          id: string;
          spans: RichInline;
          surah?: string;
          ayah?: number;
        }>;
      }
    | {
        id: string;
        type: "poetry";
        verses: Array<{ id: string; sadr: RichInline; ajuz: RichInline }>;
      }
    | {
        id: string;
        type: "table";
        headerRowCount: number;
        caption?: RichInline;
        columnAlignments?: Array<"start" | "center" | "end">;
        displayMode?: "standard" | "compact";
        rows: Array<{ cells: Array<{ spans: RichInline }> }>;
      }
    | {
        id: string;
        type: "image";
        assetId: string;
        alt: string;
        caption?: RichInline;
      }
    | { id: string; type: "divider" }
  >;
};

export const ELIGIBLE_QUESTION_PACKAGE = Symbol(
  "pythagoras.eligible-question-package",
);

export interface EligibleQuestionPackage {
  readonly validationStatus: "VALID" | "VALID_WITH_WARNINGS";
  readonly diagnostics: readonly QuestionPackageDiagnostic[];
  readonly package: NonNullable<QuestionPackageValidationResult["package"]>;
  readonly [ELIGIBLE_QUESTION_PACKAGE]: true;
}

export interface QuestionPackageEntity {
  id: string;
  packageKey: string;
  title: string;
  subjectKey: string;
  language: string;
  /** Portable educational-content revision; independent from entity revision. */
  contentRevision: number;
  bankBrowseMode: QuestionBankBrowseMode;
  bankBrowseEntryKey: string;
  bankBrowseEntryLabel: string;
  bankBrowseEntryOrder: number;
  sourceAssetId: string | null;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  revision: number;
}

export interface QuestionTaxonomyNodeEntity {
  id: string;
  packageId: string;
  nodeKey: string;
  label: string;
  kind: string;
  parentId: string | null;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  revision: number;
}

export interface QuestionBrowseNodeEntity {
  id: string;
  packageId: string;
  nodeKey: string;
  label: string;
  nodeType: QuestionBrowseNodeType;
  parentId: string | null;
  displayOrder: number;
  taxonomyNodeId: string | null;
  includeDescendants: boolean | null;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  revision: number;
}

export interface QuestionEntity {
  id: string;
  packageId: string;
  /** Canonical package order, not the Student's filtered-list ordinal. */
  displayOrder: number;
  sharedAnswer: CanonicalRichDocument | null;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  revision: number;
}

export interface QuestionVariantEntity {
  id: string;
  questionId: string;
  displayOrder: number;
  content: CanonicalRichDocument;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  revision: number;
}

export interface QuestionOccurrenceEntity {
  id: string;
  variantId: string;
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
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  revision: number;
}

export interface QuestionTaxonomyAssignmentEntity {
  questionId: string;
  taxonomyNodeId: string;
  packageId: string;
  role: QuestionTaxonomyRole;
  position: number;
}

export interface QuestionPackageAssetBindingEntity {
  packageId: string;
  assetRef: string;
  expectedSha256: string;
  assetId: string | null;
  filename: string;
  mimeType: string;
  byteSize: number;
  metadata: Record<string, string | number | boolean | null> | null;
  position: number;
}

export interface QuestionAggregate extends QuestionEntity {
  primaryVariantId: string;
  taxonomyAssignments: QuestionTaxonomyAssignmentEntity[];
  variants: Array<
    QuestionVariantEntity & { occurrences: QuestionOccurrenceEntity[] }
  >;
}

export interface QuestionPackageAggregate {
  package: QuestionPackageEntity;
  taxonomy: QuestionTaxonomyNodeEntity[];
  browseNodes: QuestionBrowseNodeEntity[];
  assetBindings: QuestionPackageAssetBindingEntity[];
  questions: QuestionAggregate[];
}

export interface QuestionMaterializationPlan extends QuestionPackageAggregate {
  actor: AdminActor;
  warnings: readonly QuestionPackageDiagnostic[];
}

export interface UpdateQuestionPackageTitleInput {
  id: string;
  title: string;
  expectedRevision: number;
  actor: AdminActor;
}

export interface QuestionRepository {
  materialize(plan: QuestionMaterializationPlan): QuestionPackageAggregate;
  getPackage(packageId: string): QuestionPackageEntity | null;
  getPackageByKey(packageKey: string): QuestionPackageEntity | null;
  getPackageAggregate(packageId: string): QuestionPackageAggregate | null;
  listPackagesBySubject(subjectKey: string): QuestionPackageEntity[];
  listTaxonomy(packageId: string): QuestionTaxonomyNodeEntity[];
  listBrowseNodes(packageId: string): QuestionBrowseNodeEntity[];
  listQuestions(packageId: string): QuestionAggregate[];
  getQuestion(questionId: string): QuestionAggregate | null;
  updatePackageTitle(input: UpdateQuestionPackageTitleInput): QuestionPackageEntity;
}
