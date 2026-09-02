import type { AdminActor } from "../../admin-auth/contracts";
import type {
  DiagnosticSeverity,
  RichDocument,
} from "../../question-packages/contracts";
import type {
  CanonicalRichDocument,
  QuestionOccurrenceEntity,
  QuestionTaxonomyAssignmentEntity,
} from "../../questions/contracts";

export const AI_KNOWLEDGE_SOURCE_RESOURCE_TYPE = "ai.knowledge-source" as const;
export const AI_KNOWLEDGE_PACKAGE_RESOURCE_TYPE = "ai.knowledge-package" as const;
export const AI_KNOWLEDGE_PACKAGE_FORMAT = "pythagoras.knowledge-package" as const;
export const AI_KNOWLEDGE_PACKAGE_SCHEMA_VERSION = "1.0.0" as const;
export const AI_KNOWLEDGE_PACKAGE_CONTENT_MODE = "knowledge" as const;
export const AI_KNOWLEDGE_PACKAGE_SCHEMA_ID =
  "https://schemas.pythagoras.local/knowledge-package/1.0.0" as const;

export const AI_KNOWLEDGE_SOURCE_TYPES = [
  "OFFICIAL_TEXTBOOK",
  "MINISTERIAL_REFERENCE",
  "PYTHAGORAS_APPROVED",
  "TEACHER_SUPPLEMENT",
  "REFERENCE_TABLE",
  "OTHER_APPROVED",
] as const;
export type AIKnowledgeSourceType = (typeof AI_KNOWLEDGE_SOURCE_TYPES)[number];

export const AI_KNOWLEDGE_TRUST_TIERS = [
  "OFFICIAL",
  "PYTHAGORAS_APPROVED",
  "TEACHER_REVIEWED",
  "OTHER_APPROVED",
] as const;
export type AIKnowledgeTrustTier = (typeof AI_KNOWLEDGE_TRUST_TIERS)[number];

export const AI_KNOWLEDGE_RIGHTS_STATUSES = [
  "CLEARED",
  "RESTRICTED",
  "UNKNOWN",
] as const;
export type AIKnowledgeRightsStatus = (typeof AI_KNOWLEDGE_RIGHTS_STATUSES)[number];

export const AI_KNOWLEDGE_RIGHTS_BASES = [
  "OWNED",
  "LICENSED",
  "PERMISSION",
  "PUBLIC_DOMAIN",
  "OTHER_REVIEWED",
] as const;
export type AIKnowledgeRightsBasis = (typeof AI_KNOWLEDGE_RIGHTS_BASES)[number];

export const AI_KNOWLEDGE_PREPARATION_METHODS = [
  "MANUAL",
  "DETERMINISTIC",
  "AI_ASSISTED",
] as const;
export type AIKnowledgePreparationMethod =
  (typeof AI_KNOWLEDGE_PREPARATION_METHODS)[number];

export interface AIKnowledgeSourceContent {
  key: string;
  subjectKey: string;
  sourceType: AIKnowledgeSourceType;
  displayName: string;
  language: string;
  edition: string | null;
  authorityName: string | null;
  authorityType: string | null;
  trustTier: AIKnowledgeTrustTier;
  rightsStatus: AIKnowledgeRightsStatus;
  rightsBasis: AIKnowledgeRightsBasis | null;
  licenseName: string | null;
  attribution: string | null;
  rightsNotes: string | null;
  sourceUrl: string | null;
  sourceAssetId: string | null;
  enabled: boolean;
  preparationMethod: AIKnowledgePreparationMethod;
  producerKey: string;
  producerRevision: string;
}

export interface AIKnowledgeSourceRevision extends AIKnowledgeSourceContent {
  sourceId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIKnowledgeSource extends AIKnowledgeSourceContent {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIKnowledgeSourceRepository {
  getById(id: string): AIKnowledgeSource | null;
  getByKey(key: string): AIKnowledgeSource | null;
  getRevision(id: string, revision: number): AIKnowledgeSourceRevision | null;
  listRevisions(id: string): AIKnowledgeSourceRevision[];
  getCurrentRevision(id: string): AIKnowledgeSourceRevision | null;
  list(): AIKnowledgeSource[];
  create(input: {
    id: string;
    content: AIKnowledgeSourceContent;
    actor: AdminActor;
    now: number;
  }): AIKnowledgeSourceRevision;
  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AIKnowledgeSourceContent;
    actor: AdminActor;
    now: number;
  }): AIKnowledgeSourceRevision;
}

export interface AIKnowledgePackageV1 {
  $schema: typeof AI_KNOWLEDGE_PACKAGE_SCHEMA_ID;
  format: typeof AI_KNOWLEDGE_PACKAGE_FORMAT;
  schemaVersion: typeof AI_KNOWLEDGE_PACKAGE_SCHEMA_VERSION;
  contentMode: typeof AI_KNOWLEDGE_PACKAGE_CONTENT_MODE;
  package: {
    id: string;
    key: string;
    title: string;
    subjectKey: string;
    language: string;
    contentRevision: number;
  };
  source: {
    id: string;
    revision: number;
  };
  documents: AIKnowledgePackageDocumentV1[];
  assetsManifest: AIKnowledgeAssetManifestEntry[];
}

export interface AIKnowledgePackageDocumentV1 {
  id: string;
  order: number;
  title: string | null;
  provenance: AIKnowledgeDocumentProvenance | null;
  content: RichDocument;
}

export interface AIKnowledgeDocumentProvenance {
  pageStart?: number;
  pageEnd?: number;
  section?: string;
  subsection?: string;
  paragraph?: string;
  sourceLocator?: string;
}

export interface AIKnowledgeAssetManifestEntry {
  ref: string;
  sha256: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export type AIKnowledgePackageDiagnosticSeverity = DiagnosticSeverity;

export interface AIKnowledgePackageDiagnostic {
  severity: AIKnowledgePackageDiagnosticSeverity;
  code: string;
  message: string;
  jsonPointer: string;
  entityId?: string;
  context?: Record<string, string | number | boolean | null>;
}

export const AI_KNOWLEDGE_PACKAGE_INSPECTION_STATUSES = [
  "GENERIC_JSON",
  "VALID",
  "VALID_WITH_WARNINGS",
  "INVALID",
  "UNSUPPORTED_VERSION",
] as const;
export type AIKnowledgePackageInspectionStatus =
  (typeof AI_KNOWLEDGE_PACKAGE_INSPECTION_STATUSES)[number];

export interface AIKnowledgePackageInspection {
  status: AIKnowledgePackageInspectionStatus;
  package: AIKnowledgePackageV1 | null;
  diagnostics: AIKnowledgePackageDiagnostic[];
}

export interface AIKnowledgeSourcePin {
  sourceId: string;
  sourceRevision: number;
}

/** Bounded metadata persisted in Change Set snapshots; package content stays in an artifact. */
export interface AIKnowledgePackageChangeContent {
  key: string;
  subjectKey: string;
  title: string;
  language: string;
  contentRevision: number;
  sourceId: string;
  sourceRevision: number;
  artifactRef: string;
  artifactSha256: string;
  artifactByteSize: number;
}

export interface AIKnowledgePackageRevision extends AIKnowledgePackageChangeContent {
  packageId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIKnowledgePackageDocument {
  packageRevisionId: string;
  documentId: string;
  displayOrder: number;
  title: string | null;
  provenance: AIKnowledgeDocumentProvenance | null;
  content: CanonicalRichDocument;
}

export interface AIKnowledgePackageAsset {
  packageRevisionId: string;
  assetRef: string;
  expectedSha256: string;
  assetId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  metadata: Record<string, string | number | boolean | null> | null;
}

export interface AIKnowledgePackage extends AIKnowledgePackageChangeContent {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIKnowledgePackageAggregate {
  package: AIKnowledgePackage;
  revision: AIKnowledgePackageRevision;
  documents: AIKnowledgePackageDocument[];
  assets: AIKnowledgePackageAsset[];
}

/** Bounded M6 eligibility metadata for downstream rebuildable projections. */
export interface AIKnowledgePackageProjectionMetadata {
  packageId: string;
  subjectKey: string;
  packageRevisionId: string;
  packageRevision: number;
  packageContentRevision: number;
  language: string;
  sourceId: string;
  sourceRevision: number;
  sourceType: AIKnowledgeSourceType;
  trustTier: AIKnowledgeTrustTier;
  artifactSha256: string;
  currentSourceEnabled: boolean;
  currentSourceRightsStatus: AIKnowledgeRightsStatus;
}

export interface AIKnowledgePackageRepository {
  getById(id: string): AIKnowledgePackageAggregate | null;
  getByKey(key: string): AIKnowledgePackageAggregate | null;
  getRevision(id: string, revision: number): AIKnowledgePackageAggregate | null;
  listRevisions(id: string): AIKnowledgePackageRevision[];
  list(): AIKnowledgePackage[];
  create(input: {
    id: string;
    content: AIKnowledgePackageChangeContent;
    documents: AIKnowledgePackageDocument[];
    assets: AIKnowledgePackageAsset[];
    actor: AdminActor;
    now: number;
  }): AIKnowledgePackageRevision;
  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AIKnowledgePackageChangeContent;
    documents: AIKnowledgePackageDocument[];
    assets: AIKnowledgePackageAsset[];
    actor: AdminActor;
    now: number;
  }): AIKnowledgePackageRevision;
  listProjectionEligibleKnowledge(subjectKey: string): AIKnowledgePackageAggregate[];
  getProjectionMetadata(packageId: string, subjectKey: string): AIKnowledgePackageProjectionMetadata | null;
}

export interface AIKnowledgePackageArtifactStore {
  put(value: AIKnowledgePackageV1): {
    artifactRef: string;
    sha256: string;
    byteSize: number;
  };
  read(input: { artifactRef: string; sha256: string }): AIKnowledgePackageV1;
}

export interface AIKnowledgePackageSourceResolver {
  getRevision(sourceId: string, revision: number): AIKnowledgeSourceRevision | null;
}

export interface AIKnowledgePackageAssetResolver {
  findBySha256(sha256: string): {
    id: string;
    filename: string;
    mimeType: string;
    mediaKind: string;
    byteSize: number;
    sha256: string;
  } | null;
}

export interface AIQuestionKnowledgeProjection {
  projectionId: string;
  subjectKey: string;
  questionPackageId: string;
  questionPackageRevision: number;
  questionPackageContentRevision: number;
  questionId: string;
  questionDisplayOrder: number;
  questionRevision: number;
  variantId: string;
  variantDisplayOrder: number;
  variantRevision: number;
  isPrimaryVariant: boolean;
  formulation: CanonicalRichDocument;
  sharedAnswer: CanonicalRichDocument | null;
  occurrences: QuestionOccurrenceEntity[];
  taxonomyAssignments: QuestionTaxonomyAssignmentEntity[];
  projectionRevisionFingerprint: string;
}

export interface QuestionKnowledgeProjector {
  projectPackage(input: {
    packageId: string;
    subjectKey: string;
  }): AIQuestionKnowledgeProjection[];
  projectQuestionById(input: {
    questionId: string;
    subjectKey: string;
  }): AIQuestionKnowledgeProjection[];
}
