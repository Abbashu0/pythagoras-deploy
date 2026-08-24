import type { AdminActor, AdminRole } from "../admin-auth/contracts";
import type { ContentDatabase } from "../content/database";

export const CHANGE_SET_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "NEEDS_CHANGES",
  "APPROVED",
  "REJECTED",
  "CONFLICTED",
  "PUBLISHED",
  "CANCELLED",
  "SUPERSEDED",
] as const;

export type ChangeSetStatus = (typeof CHANGE_SET_STATUSES)[number];

export const CHANGE_OPERATIONS = ["CREATE", "UPDATE"] as const;
export type ChangeOperation = (typeof CHANGE_OPERATIONS)[number];

export const CHANGE_CONFLICT_STATES = ["NONE", "BLOCKING", "AUTO_MERGED"] as const;
export type ChangeConflictState = (typeof CHANGE_CONFLICT_STATES)[number];

export const CHANGE_EVENT_TYPES = [
  "CREATED",
  "ITEM_ADDED",
  "ITEM_UPDATED",
  "ITEM_REMOVED",
  "SUBMITTED",
  "REQUESTED_CHANGES",
  "RESUBMITTED",
  "APPROVED",
  "REJECTED",
  "CONFLICT_DETECTED",
  "AUTO_MERGED_DISJOINT_FIELDS",
  "REBASED",
  "PUBLISHED",
  "CANCELLED",
] as const;

export type ChangeEventType = (typeof CHANGE_EVENT_TYPES)[number];

export type ChangeSnapshotValue = string | number | boolean | null | ChangeSnapshot | ChangeSnapshotValue[];
export interface ChangeSnapshot { [key: string]: ChangeSnapshotValue }

export interface ChangeSet {
  id: string;
  title: string;
  description: string | null;
  createdBy: string;
  status: ChangeSetStatus;
  basePublicationRevision: number;
  reviewNote: string | null;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
  approvedAt: number | null;
  publishedAt: number | null;
  revision: number;
}

export interface ChangeSetItem {
  id: string;
  changeSetId: string;
  resourceType: string;
  resourceId: string;
  operation: ChangeOperation;
  baseResourceRevision: number;
  beforeSnapshot: ChangeSnapshot;
  proposedSnapshot: ChangeSnapshot;
  changedPaths: string[];
  conflictState: ChangeConflictState;
  conflictDetails: ChangeSnapshot | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface ChangeSetEvent {
  id: string;
  changeSetId: string;
  eventType: ChangeEventType;
  actorUserId: string;
  createdAt: number;
  note: string | null;
  metadata: ChangeSnapshot | null;
}

export interface Publication {
  id: string;
  revision: number;
  changeSetId: string;
  publishedBy: string;
  publishedAt: number;
  summary: string;
}

export interface PublicationItem {
  id: string;
  publicationId: string;
  resourceType: string;
  resourceId: string;
  operation: ChangeOperation;
  beforeSnapshot: ChangeSnapshot;
  afterSnapshot: ChangeSnapshot;
  resultingResourceRevision: number;
}

export interface ResourceState {
  resourceId: string;
  revision: number;
  snapshot: ChangeSnapshot;
}

export interface ChangeFieldDiff {
  path: string;
  label: string;
  before: ChangeSnapshotValue | undefined;
  after: ChangeSnapshotValue | undefined;
}

export interface ChangePresentation {
  resourceLabel: string;
  resourceSubtitle: string;
  changeSummary: string;
  areaLabel: string;
  fieldDiffs: ChangeFieldDiff[];
}

export interface ChangeResourceAdapter {
  readonly resourceType: string;
  readonly areaLabel: string;
  readonly mergeStrategy?: "THREE_WAY" | "CONSERVATIVE";
  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState;
  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation?: ChangeOperation): {
    current: ResourceState;
    proposedSnapshot: ChangeSnapshot;
    changedPaths: string[];
  };
  validateSnapshot(snapshot: ChangeSnapshot, operation?: ChangeOperation): void;
  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation?: ChangeOperation): ChangePresentation;
  apply(
    database: ContentDatabase,
    resourceId: string,
    snapshot: ChangeSnapshot,
    expectedRevision: number,
    actor: AdminActor,
    operation?: ChangeOperation,
  ): ResourceState;
  validatePublication?(database: ContentDatabase): void;
}

export type ChangeSetValidationPhase = "SUBMIT" | "APPROVE" | "PUBLISH";

/** Cross-resource invariant and dependency boundary used by one domain family. */
export interface ChangeSetCoordinator {
  validate(
    database: ContentDatabase,
    items: ChangeSetItem[],
    phase: ChangeSetValidationPhase,
  ): void;
  planPublication(database: ContentDatabase, items: ChangeSetItem[]): ChangeSetItem[];
}

export interface ChangeSetAuthor {
  id: string;
  displayName: string;
  role: AdminRole;
}

export interface ChangeSetSummary {
  changeSet: ChangeSet;
  author: ChangeSetAuthor;
  itemCount: number;
  areaLabels: string[];
}

export interface ChangeSetDetails extends ChangeSetSummary {
  items: Array<ChangeSetItem & {
    presentation: ChangePresentation;
    currentSnapshot: ChangeSnapshot;
    currentResourceRevision: number;
  }>;
  events: Array<ChangeSetEvent & { actor: ChangeSetAuthor }>;
}

export interface ChangeSetListOptions {
  status?: ChangeSetStatus;
  limit?: number;
  offset?: number;
  createdBy?: string;
}

export interface ChangeSetPage {
  items: ChangeSetSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ReviewStats {
  currentPublicationRevision: number;
  submitted: number;
  needsChanges: number;
  approved: number;
  conflicted: number;
  published: number;
  actionable: number;
}

export interface CreateChangeSetInput {
  title: string;
  description?: string;
  initialItem?: {
    resourceType: string;
    resourceId: string;
    expectedRevision: number;
    desired: unknown;
    operation?: ChangeOperation;
  };
  initialItems?: Array<{
    resourceType: string;
    resourceId: string;
    expectedRevision: number;
    desired: unknown;
    operation?: ChangeOperation;
  }>;
  submit?: boolean;
}

export interface ChangeSetRepository {
  create(input: { id?: string; title: string; description: string | null; actor: AdminActor; basePublicationRevision: number }): ChangeSet;
  findById(id: string): ChangeSet | null;
  list(options: ChangeSetListOptions): ChangeSetPage;
  updateDetails(id: string, title: string, description: string | null, expectedRevision: number, actor: AdminActor): ChangeSet;
  touch(id: string, expectedRevision: number): ChangeSet;
  transition(input: {
    id: string;
    expectedRevision: number;
    from: ChangeSetStatus[];
    to: ChangeSetStatus;
    actor: AdminActor;
    reviewNote?: string | null;
    reviewedBy?: string | null;
  }): ChangeSet;
  addItem(input: Omit<ChangeSetItem, "revision">): ChangeSetItem;
  updateItem(input: { item: ChangeSetItem; expectedRevision: number }): ChangeSetItem;
  removeItem(changeSetId: string, itemId: string): boolean;
  listItems(changeSetId: string): ChangeSetItem[];
  findItem(changeSetId: string, itemId: string): ChangeSetItem | null;
  countItems(changeSetId: string): number;
  markConflict(changeSetId: string, itemId: string, details: ChangeSnapshot, actor: AdminActor): void;
}

export interface ChangeEventRepository {
  append(input: Omit<ChangeSetEvent, "id"> & { id?: string }): ChangeSetEvent;
  list(changeSetId: string, limit?: number): ChangeSetEvent[];
  listWithActors(changeSetId: string, limit?: number): Array<ChangeSetEvent & { actor: ChangeSetAuthor }>;
}

export interface PublicationRepository {
  getCurrentRevision(): number;
  incrementRevision(now: number): number;
  create(input: Omit<Publication, "id"> & { id?: string }): Publication;
  addItem(input: Omit<PublicationItem, "id"> & { id?: string }): PublicationItem;
  list(limit?: number, offset?: number): { items: Publication[]; total: number };
  listItems(publicationId: string): PublicationItem[];
}
