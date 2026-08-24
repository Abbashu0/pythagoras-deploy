export const QUESTION_PACKAGE_FORMAT = "pythagoras.question-package" as const;
export const QUESTION_PACKAGE_SCHEMA_VERSION = "1.0.0" as const;
export const QUESTION_PACKAGE_CONTENT_MODE = "question-bank" as const;
export const QUESTION_PACKAGE_SCHEMA_ID =
  "https://schemas.pythagoras.local/question-package/1.0.0" as const;

export const QUESTION_PACKAGE_RECOGNITION_STATUSES = [
  "GENERIC_JSON",
  "VALID",
  "VALID_WITH_WARNINGS",
  "INVALID",
  "UNSUPPORTED_VERSION",
] as const;

export type QuestionPackageRecognitionStatus =
  (typeof QUESTION_PACKAGE_RECOGNITION_STATUSES)[number];

export type DiagnosticSeverity = "ERROR" | "WARNING" | "INFO";

export interface QuestionPackageDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  jsonPointer: string;
  entityId?: string;
  context?: Record<string, string | number | boolean | null>;
}

export interface RichTextSpan {
  text: string;
  marks?: Array<"bold" | "italic" | "underline">;
}

export type RichInline = RichTextSpan[];

export type TableColumnAlignment = "start" | "center" | "end";

export interface RichDocument {
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
        columnAlignments?: TableColumnAlignment[];
        displayMode?: "standard" | "compact";
        rows: Array<{ cells: Array<{ spans: RichInline }> }>;
      }
    | {
        id: string;
        type: "image";
        assetRef: string;
        alt: string;
        caption?: RichInline;
      }
    | { id: string; type: "divider" }
  >;
}

export interface QuestionTaxonomyNode {
  id: string;
  key: string;
  label: string;
  kind: string;
  parentId: string | null;
  order: number;
}

export interface QuestionBankBrowseNode {
  id: string;
  key: string;
  label: string;
  type: "GROUP" | "QUESTION_LIST";
  parentId: string | null;
  order: number;
  filter?: {
    taxonomyNodeId: string;
    includeDescendants: boolean;
  };
}

export interface QuestionOccurrence {
  id: string;
  sourceKind:
    | "ministerial"
    | "discussion-question"
    | "educational-tv"
    | "end-of-chapter"
    | "book-question"
    | "book-exercise"
    | "enrichment"
    | "other";
  year?: number;
  roundCode?: string;
  branches: string[];
  qualifiers: string[];
  session?: string;
  sourceName?: string;
  notes?: string;
  rawLabel: string;
}

export interface QuestionPackageV1 {
  $schema: typeof QUESTION_PACKAGE_SCHEMA_ID;
  format: typeof QUESTION_PACKAGE_FORMAT;
  schemaVersion: typeof QUESTION_PACKAGE_SCHEMA_VERSION;
  contentMode: typeof QUESTION_PACKAGE_CONTENT_MODE;
  package: {
    id: string;
    key: string;
    title: string;
    subjectKey: string;
    language: string;
    contentRevision: number;
  };
  taxonomy: QuestionTaxonomyNode[];
  bankBrowse:
    | {
        mode: "ALL_PACKAGE_QUESTIONS";
        entry: { key: string; label: string; order: number };
        nodes: [];
      }
    | {
        mode: "TREE";
        entry: { key: string; label: string; order: number };
        nodes: QuestionBankBrowseNode[];
      };
  assetsManifest: Array<{
    ref: string;
    sha256: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    metadata?: Record<string, string | number | boolean | null>;
  }>;
  questions: Array<{
    id: string;
    order: number;
    primaryVariantId: string;
    taxonomyAssignments: Array<{
      taxonomyNodeId: string;
      role: "PRIMARY" | "RELATED";
    }>;
    variants: Array<{
      id: string;
      order: number;
      content: RichDocument;
      occurrences: QuestionOccurrence[];
    }>;
    sharedAnswer?: RichDocument;
  }>;
}

export interface QuestionPackageInspectionSummary {
  status: QuestionPackageRecognitionStatus;
  format: string | null;
  schemaVersion: string | null;
  packageId: string | null;
  packageKey: string | null;
  title: string | null;
  subjectKey: string | null;
  questionCount: number;
  variantCount: number;
  errorCount: number;
  warningCount: number;
  inspectedAt: number;
}

export interface QuestionPackageInspection extends QuestionPackageInspectionSummary {
  diagnostics: QuestionPackageDiagnostic[];
}

export interface QuestionPackageValidationResult {
  status: QuestionPackageRecognitionStatus;
  package: QuestionPackageV1 | null;
  diagnostics: QuestionPackageDiagnostic[];
}

export interface AssetQuestionPackageInspectionEnvelope {
  questionPackageInspection: QuestionPackageInspection | null;
}
