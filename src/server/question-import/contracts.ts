import type {
  QuestionPackageDiagnostic,
  QuestionPackageRecognitionStatus,
} from "../question-packages";

export interface QuestionPackageImportCounts {
  taxonomy: number;
  browseNodes: number;
  questions: number;
  variants: number;
  occurrences: number;
  manifestAssets: number;
  usedAssets: number;
  resolvedAssets: number;
  unresolvedAssets: number;
  estimatedChangeItems: number;
}

export interface QuestionPackageImportPreflight {
  assetId: string;
  status: QuestionPackageRecognitionStatus;
  eligible: boolean;
  acknowledgementRequired: boolean;
  alreadyImported: boolean;
  existingChangeSetId: string | null;
  package: null | {
    id: string;
    key: string;
    title: string;
    subjectKey: string;
    language: string;
    schemaVersion: string;
    contentRevision: number;
    bankBrowseMode: "ALL_PACKAGE_QUESTIONS" | "TREE";
    bankBrowseEntry: { key: string; label: string; order: number };
  };
  counts: QuestionPackageImportCounts;
  warnings: QuestionPackageDiagnostic[];
  blockers: Array<{
    code: string;
    message: string;
    entityId?: string;
    resourceType?: string;
    byteSize?: number;
    maximumBytes?: number;
  }>;
}

export interface CompactQuestionPackageStageResult {
  outcome: "STAGED" | "EXISTING_DRAFT" | "ALREADY_IMPORTED";
  packageId: string;
  changeSetId: string | null;
  changeSetRevision: number | null;
  itemCount: number;
}

export interface ManualQuestionPackageInput {
  title: string;
  packageKey: string;
  subjectKey: string;
  language: string;
  bankBrowseMode: "ALL_PACKAGE_QUESTIONS" | "TREE";
  bankBrowseEntryKey: string;
  bankBrowseEntryLabel: string;
  bankBrowseEntryOrder: number;
}
