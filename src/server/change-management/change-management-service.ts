import { count, desc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../admin-auth/contracts";
import type { ContentDatabase } from "../content/database";
import { adminUsers, changeSetItems, changeSets, publicationItems, publications } from "../content/schema";
import { ChangeResourceAdapterRegistry } from "./adapter-registry";
import type {
  ChangeEventRepository,
  ChangeSet,
  ChangeSetDetails,
  ChangeSetItem,
  ChangeSetListOptions,
  ChangeSetPage,
  ChangeSetRepository,
  ChangeSetStatus,
  ChangeSnapshot,
  ChangeOperation,
  CreateChangeSetInput,
  PublicationRepository,
  ReviewStats,
} from "./contracts";
import { ChangeManagementError } from "./errors";
import { threeWayMerge } from "./snapshot";
import { ContentUnitOfWork } from "./unit-of-work";

type Clock = () => number;

interface ConflictCandidate {
  item: ChangeSetItem;
  details: ChangeSnapshot;
}

class PublicationConflict extends Error {
  constructor(readonly conflict: ConflictCandidate) {
    super("Publication conflict");
  }
}

function requireActor(actor: AdminActor): void {
  if (!actor.actorUserId?.trim() || !["OWNER", "ADMIN"].includes(actor.actorRole)) {
    throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "An authenticated Admin actor is required.");
  }
}

function requireOwner(actor: AdminActor): void {
  requireActor(actor);
  if (actor.actorRole !== "OWNER") {
    throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may review or publish changes.");
  }
}

function normalizeTitle(value: string): string {
  const title = value.normalize("NFKC").trim();
  if (!title || title.length > 160) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Change Set title must be between 1 and 160 characters.");
  return title;
}

function normalizeDescription(value?: string | null): string | null {
  const description = value?.normalize("NFKC").trim() || null;
  if (description && description.length > 2000) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Change Set description is too long.");
  return description;
}

function normalizeReviewNote(value: string): string {
  const note = value.normalize("NFKC").trim();
  if (!note || note.length > 2000) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A review reason between 1 and 2000 characters is required.");
  return note;
}

function requireExpectedRevision(value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Expected revision is invalid.");
}

function requireResourceExpectedRevision(value: number, operation: ChangeOperation): void {
  if (!Number.isInteger(value) || value < (operation === "CREATE" ? 0 : 1)) {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Expected resource revision is invalid.");
  }
}

export class ChangeManagementService {
  private readonly unitOfWork: ContentUnitOfWork;

  constructor(
    private readonly database: ContentDatabase,
    private readonly changeSets: ChangeSetRepository,
    private readonly events: ChangeEventRepository,
    private readonly publications: PublicationRepository,
    private readonly registry: ChangeResourceAdapterRegistry,
    private readonly clock: Clock = Date.now,
  ) {
    this.unitOfWork = new ContentUnitOfWork(database);
  }

  createChangeSet(input: CreateChangeSetInput, actor: AdminActor): ChangeSetDetails {
    requireActor(actor);
    const title = normalizeTitle(input.title);
    const description = normalizeDescription(input.description);
    return this.unitOfWork.run(() => {
      let changeSet = this.changeSets.create({
        title,
        description,
        actor,
        basePublicationRevision: this.publications.getCurrentRevision(),
      });
      this.appendEvent(changeSet.id, "CREATED", actor);
      const initialItems = [...(input.initialItem ? [input.initialItem] : []), ...(input.initialItems ?? [])];
      for (const initialItem of initialItems) changeSet = this.addItemInternal(changeSet, initialItem, actor);
      if (input.submit) changeSet = this.submitInternal(changeSet, actor);
      return this.getDetailsInternal(changeSet.id);
    });
  }

  updateDetails(id: string, title: string, description: string | undefined, expectedRevision: number, actor: AdminActor): ChangeSetDetails {
    requireExpectedRevision(expectedRevision);
    const current = this.requireOwnedEditable(id, actor);
    if (current.revision !== expectedRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The Change Set changed since it was opened.");
    this.changeSets.updateDetails(id, normalizeTitle(title), normalizeDescription(description), expectedRevision, actor);
    return this.getDetails(id, actor);
  }

  addItem(
    changeSetId: string,
    input: { resourceType: string; resourceId: string; expectedRevision: number; desired: unknown; operation?: ChangeOperation; expectedChangeSetRevision: number },
    actor: AdminActor,
  ): ChangeSetDetails {
    requireExpectedRevision(input.expectedChangeSetRevision);
    return this.unitOfWork.run(() => {
      const changeSet = this.requireOwnedEditable(changeSetId, actor);
      if (changeSet.revision !== input.expectedChangeSetRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The Change Set changed since it was opened.");
      this.addItemInternal(changeSet, input, actor);
      return this.getDetailsInternal(changeSetId);
    });
  }

  updateItem(
    changeSetId: string,
    itemId: string,
    input: { desired: unknown; expectedItemRevision: number; expectedChangeSetRevision: number },
    actor: AdminActor,
  ): ChangeSetDetails {
    requireExpectedRevision(input.expectedItemRevision);
    requireExpectedRevision(input.expectedChangeSetRevision);
    return this.unitOfWork.run(() => {
      const changeSet = this.requireOwnedEditable(changeSetId, actor);
      if (changeSet.revision !== input.expectedChangeSetRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The Change Set changed since it was opened.");
      const item = this.changeSets.findItem(changeSetId, itemId);
      if (!item) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Change Set item was not found.");
      const adapter = this.registry.require(item.resourceType);
      const captured = adapter.captureProposal(this.database, item.resourceId, input.desired, item.operation);
      if (captured.current.revision !== item.baseResourceRevision) {
        throw new ChangeManagementError("CHANGE_CONFLICT", "The resource changed; rebase the proposal before editing it.");
      }
      this.changeSets.updateItem({
        item: {
          ...item,
          proposedSnapshot: captured.proposedSnapshot,
          changedPaths: captured.changedPaths,
          conflictState: "NONE",
          conflictDetails: null,
          updatedAt: this.clock(),
        },
        expectedRevision: input.expectedItemRevision,
      });
      this.changeSets.touch(changeSetId, input.expectedChangeSetRevision);
      this.appendEvent(changeSetId, "ITEM_UPDATED", actor, null, { itemId, resourceType: item.resourceType });
      return this.getDetailsInternal(changeSetId);
    });
  }

  removeItem(changeSetId: string, itemId: string, expectedChangeSetRevision: number, actor: AdminActor): ChangeSetDetails {
    return this.unitOfWork.run(() => {
      const changeSet = this.requireOwnedEditable(changeSetId, actor);
      if (changeSet.revision !== expectedChangeSetRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The Change Set changed since it was opened.");
      if (!this.changeSets.removeItem(changeSetId, itemId)) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Change Set item was not found.");
      this.changeSets.touch(changeSetId, expectedChangeSetRevision);
      this.appendEvent(changeSetId, "ITEM_REMOVED", actor, null, { itemId });
      return this.getDetailsInternal(changeSetId);
    });
  }

  submit(id: string, expectedRevision: number, actor: AdminActor): ChangeSetDetails {
    return this.unitOfWork.run(() => {
      const changeSet = this.requireOwnedEditable(id, actor);
      if (changeSet.revision !== expectedRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The Change Set changed since it was opened.");
      this.submitInternal(changeSet, actor);
      return this.getDetailsInternal(id);
    });
  }

  requestChanges(id: string, expectedRevision: number, note: string, actor: AdminActor): ChangeSetDetails {
    requireOwner(actor);
    return this.transitionReview(id, expectedRevision, "NEEDS_CHANGES", "REQUESTED_CHANGES", normalizeReviewNote(note), actor);
  }

  reject(id: string, expectedRevision: number, reason: string, actor: AdminActor): ChangeSetDetails {
    requireOwner(actor);
    return this.transitionReview(id, expectedRevision, "REJECTED", "REJECTED", normalizeReviewNote(reason), actor);
  }

  approve(id: string, expectedRevision: number, actor: AdminActor): ChangeSetDetails {
    requireOwner(actor);
    requireExpectedRevision(expectedRevision);
    const current = this.requireStatus(id, ["SUBMITTED"]);
    if (current.revision !== expectedRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The Change Set changed since review opened.");
    const conflict = this.findBlockingConflict(current);
    if (conflict) {
      this.persistConflict(current.id, conflict, actor);
      throw new ChangeManagementError("CHANGE_CONFLICT", "A resource changed after this proposal was created.");
    }
    return this.unitOfWork.run(() => {
      const reloaded = this.requireStatus(id, ["SUBMITTED"]);
      const approved = this.changeSets.transition({ id, expectedRevision: reloaded.revision, from: ["SUBMITTED"], to: "APPROVED", actor, reviewedBy: actor.actorUserId, reviewNote: null });
      this.appendEvent(id, "APPROVED", actor);
      return this.getDetailsInternal(approved.id);
    });
  }

  publish(id: string, expectedRevision: number, actor: AdminActor): { changeSet: ChangeSetDetails; publicationRevision: number } {
    requireOwner(actor);
    requireExpectedRevision(expectedRevision);
    try {
      return this.unitOfWork.run(() => {
        const changeSet = this.requireStatus(id, ["APPROVED"]);
        if (changeSet.revision !== expectedRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The approved Change Set changed before publication.");
        const items = this.changeSets.listItems(id);
        if (!items.length) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "An empty Change Set cannot be published.");
        const applied: Array<{ item: ChangeSetItem; before: ChangeSnapshot; after: ChangeSnapshot; revision: number; autoMerged: boolean }> = [];

        for (const item of items) {
          const adapter = this.registry.require(item.resourceType);
          adapter.validateSnapshot(item.proposedSnapshot, item.operation);
          const current = item.operation === "CREATE"
            ? (this.tryLoadCurrent(adapter, item.resourceId) ?? { resourceId: item.resourceId, revision: 0, snapshot: {} })
            : adapter.loadCurrent(this.database, item.resourceId);
          const merge = current.revision === item.baseResourceRevision
            ? { kind: "clean" as const, finalSnapshot: item.proposedSnapshot }
            : threeWayMerge(item.beforeSnapshot, current.snapshot, item.proposedSnapshot, item.changedPaths);
          if (merge.kind === "conflict" || !merge.finalSnapshot) {
            throw new PublicationConflict({ item, details: { base: item.beforeSnapshot, current: current.snapshot, proposed: item.proposedSnapshot } });
          }
          const result = adapter.apply(this.database, item.resourceId, merge.finalSnapshot, current.revision, actor, item.operation);
          applied.push({ item, before: current.snapshot, after: result.snapshot, revision: result.revision, autoMerged: merge.kind === "auto-merged" });
        }

        this.registry.validatePublication(this.database, items.map((item) => item.resourceType));
        const now = this.clock();
        const revision = this.publications.incrementRevision(now);
        const publication = this.publications.create({
          revision,
          changeSetId: id,
          publishedBy: actor.actorUserId,
          publishedAt: now,
          summary: this.publicationSummary(applied.length),
        });
        for (const result of applied) {
          this.publications.addItem({
            publicationId: publication.id,
            resourceType: result.item.resourceType,
            resourceId: result.item.resourceId,
            operation: result.item.operation,
            beforeSnapshot: result.before,
            afterSnapshot: result.after,
            resultingResourceRevision: result.revision,
          });
          if (result.autoMerged) this.appendEvent(id, "AUTO_MERGED_DISJOINT_FIELDS", actor, null, { itemId: result.item.id });
        }
        this.changeSets.transition({ id, expectedRevision: changeSet.revision, from: ["APPROVED"], to: "PUBLISHED", actor });
        this.appendEvent(id, "PUBLISHED", actor, null, { publicationRevision: revision });
        return { changeSet: this.getDetailsInternal(id), publicationRevision: revision };
      });
    } catch (error) {
      if (error instanceof PublicationConflict) {
        this.persistConflict(id, error.conflict, actor);
        throw new ChangeManagementError("CHANGE_CONFLICT", "Publication stopped because the resource changed.");
      }
      if (error instanceof ChangeManagementError) throw error;
      throw new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "Publication failed; no changes were applied.", error);
    }
  }

  cancel(id: string, expectedRevision: number, actor: AdminActor): ChangeSetDetails {
    const current = this.requireOwnedEditable(id, actor);
    return this.unitOfWork.run(() => {
      this.changeSets.transition({ id, expectedRevision, from: [current.status], to: "CANCELLED", actor });
      this.appendEvent(id, "CANCELLED", actor);
      return this.getDetailsInternal(id);
    });
  }

  rebase(id: string, expectedRevision: number, actor: AdminActor): ChangeSetDetails {
    requireActor(actor);
    return this.unitOfWork.run(() => {
      const changeSet = this.requireStatus(id, ["CONFLICTED"]);
      if (changeSet.createdBy !== actor.actorUserId) throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only the proposal author can rebase it.");
      if (changeSet.revision !== expectedRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The Change Set changed since it was opened.");
      for (const item of this.changeSets.listItems(id)) {
        const adapter = this.registry.require(item.resourceType);
        const current = item.operation === "CREATE"
          ? (this.tryLoadCurrent(adapter, item.resourceId) ?? { resourceId: item.resourceId, revision: 0, snapshot: {} })
          : adapter.loadCurrent(this.database, item.resourceId);
        if (item.operation === "CREATE" && current.revision !== 0) throw new ChangeManagementError("CHANGE_CONFLICT", "The proposed resource identifier is already in use.");
        adapter.validateSnapshot(item.proposedSnapshot, item.operation);
        const captured = adapter.captureProposal(this.database, item.resourceId, item.proposedSnapshot, item.operation);
        this.changeSets.updateItem({ item: { ...item, baseResourceRevision: current.revision, beforeSnapshot: current.snapshot, proposedSnapshot: captured.proposedSnapshot, changedPaths: captured.changedPaths, conflictState: "NONE", conflictDetails: null, updatedAt: this.clock() }, expectedRevision: item.revision });
      }
      this.changeSets.transition({ id, expectedRevision, from: ["CONFLICTED"], to: "NEEDS_CHANGES", actor });
      this.appendEvent(id, "REBASED", actor);
      return this.getDetailsInternal(id);
    });
  }

  getDetails(id: string, actor: AdminActor): ChangeSetDetails {
    requireActor(actor);
    const changeSet = this.changeSets.findById(id);
    if (!changeSet) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Change Set was not found.");
    if (actor.actorRole !== "OWNER" && changeSet.createdBy !== actor.actorUserId) {
      throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "This Change Set belongs to another Admin.");
    }
    return this.getDetailsInternal(id);
  }

  list(options: ChangeSetListOptions, actor: AdminActor): ChangeSetPage {
    requireActor(actor);
    const page = this.changeSets.list({ ...options, createdBy: actor.actorRole === "OWNER" ? options.createdBy : actor.actorUserId });
    return {
      ...page,
      items: page.items.map((summary) => ({ ...summary, areaLabels: summary.areaLabels.map((type) => this.registry.require(type).areaLabel) })),
    };
  }

  getReviewStats(actor: AdminActor): ReviewStats {
    requireActor(actor);
    const owner = actor.actorRole === "OWNER";
    const ownerCondition = owner ? undefined : eq(changeSets.createdBy, actor.actorUserId);
    const row = this.database.db.select({
      submitted: sql<number>`sum(case when ${changeSets.status} = 'SUBMITTED' then 1 else 0 end)`,
      needsChanges: sql<number>`sum(case when ${changeSets.status} = 'NEEDS_CHANGES' then 1 else 0 end)`,
      approved: sql<number>`sum(case when ${changeSets.status} = 'APPROVED' then 1 else 0 end)`,
      conflicted: sql<number>`sum(case when ${changeSets.status} = 'CONFLICTED' then 1 else 0 end)`,
      published: sql<number>`sum(case when ${changeSets.status} = 'PUBLISHED' then 1 else 0 end)`,
    }).from(changeSets).where(ownerCondition).get();
    const submitted = Number(row?.submitted ?? 0);
    const needsChanges = Number(row?.needsChanges ?? 0);
    const conflicted = Number(row?.conflicted ?? 0);
    return {
      currentPublicationRevision: this.publications.getCurrentRevision(),
      submitted,
      needsChanges,
      approved: Number(row?.approved ?? 0),
      conflicted,
      published: Number(row?.published ?? 0),
      actionable: owner ? submitted + conflicted : needsChanges,
    };
  }

  listPublications(limit: number, offset: number, actor: AdminActor) {
    requireActor(actor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Publication pagination is invalid.");
    }
    const rows = this.database.db.select({
      publication: publications,
      publisherId: adminUsers.id,
      publisherName: adminUsers.displayName,
      publisherRole: adminUsers.role,
      itemCount: count(publicationItems.id),
    }).from(publications)
      .innerJoin(adminUsers, eq(publications.publishedBy, adminUsers.id))
      .leftJoin(publicationItems, eq(publications.id, publicationItems.publicationId))
      .groupBy(publications.id, adminUsers.id)
      .orderBy(desc(publications.revision))
      .limit(limit).offset(offset).all();
    const total = Number(this.database.db.select({ value: count() }).from(publications).get()?.value ?? 0);
    return { items: rows.map((row) => ({ publication: row.publication, publisher: { id: row.publisherId, displayName: row.publisherName, role: row.publisherRole }, itemCount: Number(row.itemCount) })), total, limit, offset };
  }

  private addItemInternal(
    changeSet: ChangeSet,
    input: { resourceType: string; resourceId: string; expectedRevision: number; desired: unknown; operation?: ChangeOperation },
    actor: AdminActor,
  ): ChangeSet {
    const operation = input.operation ?? "UPDATE";
    requireResourceExpectedRevision(input.expectedRevision, operation);
    const adapter = this.registry.require(input.resourceType);
    const captured = adapter.captureProposal(this.database, input.resourceId, input.desired, operation);
    if (captured.current.revision !== input.expectedRevision) throw new ChangeManagementError("CHANGE_CONFLICT", "The resource changed before the proposal was captured.");
    const now = this.clock();
    const existing = this.changeSets.listItems(changeSet.id).find((item) => item.resourceType === input.resourceType && item.resourceId === input.resourceId);
    if (existing) {
      if (existing.baseResourceRevision !== captured.current.revision) throw new ChangeManagementError("CHANGE_CONFLICT", "The existing proposal must be rebased first.");
      this.changeSets.updateItem({ item: { ...existing, proposedSnapshot: captured.proposedSnapshot, changedPaths: captured.changedPaths, conflictState: "NONE", conflictDetails: null, updatedAt: now }, expectedRevision: existing.revision });
      this.appendEvent(changeSet.id, "ITEM_UPDATED", actor, null, { itemId: existing.id, resourceType: input.resourceType });
    } else {
      const itemId = uuidv7();
      this.changeSets.addItem({ id: itemId, changeSetId: changeSet.id, resourceType: input.resourceType, resourceId: input.resourceId, operation, baseResourceRevision: captured.current.revision, beforeSnapshot: captured.current.snapshot, proposedSnapshot: captured.proposedSnapshot, changedPaths: captured.changedPaths, conflictState: "NONE", conflictDetails: null, createdAt: now, updatedAt: now });
      this.appendEvent(changeSet.id, "ITEM_ADDED", actor, null, { itemId, resourceType: input.resourceType });
    }
    return this.changeSets.touch(changeSet.id, changeSet.revision);
  }

  private submitInternal(changeSet: ChangeSet, actor: AdminActor): ChangeSet {
    if (!["DRAFT", "NEEDS_CHANGES"].includes(changeSet.status)) throw new ChangeManagementError("CHANGE_INVALID_STATE", "Only an editable Change Set can be submitted.");
    const items = this.changeSets.listItems(changeSet.id);
    if (!items.length) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "An empty Change Set cannot be submitted.");
    for (const item of items) {
      const adapter = this.registry.require(item.resourceType);
      if (item.operation !== "CREATE") adapter.validateSnapshot(item.beforeSnapshot, item.operation);
      adapter.validateSnapshot(item.proposedSnapshot, item.operation);
      if (item.operation === "CREATE") {
        if (this.tryLoadCurrent(adapter, item.resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The proposed resource identifier is already in use.");
      } else adapter.loadCurrent(this.database, item.resourceId);
    }
    const resubmission = changeSet.status === "NEEDS_CHANGES";
    const submitted = this.changeSets.transition({ id: changeSet.id, expectedRevision: changeSet.revision, from: [changeSet.status], to: "SUBMITTED", actor });
    this.appendEvent(changeSet.id, resubmission ? "RESUBMITTED" : "SUBMITTED", actor);
    return submitted;
  }

  private transitionReview(id: string, expectedRevision: number, to: "NEEDS_CHANGES" | "REJECTED", event: "REQUESTED_CHANGES" | "REJECTED", note: string, actor: AdminActor): ChangeSetDetails {
    return this.unitOfWork.run(() => {
      const current = this.requireStatus(id, ["SUBMITTED"]);
      const result = this.changeSets.transition({ id, expectedRevision, from: ["SUBMITTED"], to, actor, reviewedBy: actor.actorUserId, reviewNote: note });
      this.appendEvent(id, event, actor, note);
      return this.getDetailsInternal(result.id);
    });
  }

  private findBlockingConflict(changeSet: ChangeSet): ConflictCandidate | null {
    for (const item of this.changeSets.listItems(changeSet.id)) {
      const adapter = this.registry.require(item.resourceType);
      const current = item.operation === "CREATE"
        ? (this.tryLoadCurrent(adapter, item.resourceId) ?? { resourceId: item.resourceId, revision: 0, snapshot: {} })
        : adapter.loadCurrent(this.database, item.resourceId);
      if (item.operation === "CREATE" && current.revision !== 0) return { item, details: { base: item.beforeSnapshot, current: current.snapshot, proposed: item.proposedSnapshot } };
      if (current.revision === item.baseResourceRevision) continue;
      const merge = threeWayMerge(item.beforeSnapshot, current.snapshot, item.proposedSnapshot, item.changedPaths);
      if (merge.kind === "conflict") return { item, details: { base: item.beforeSnapshot, current: current.snapshot, proposed: item.proposedSnapshot } };
    }
    return null;
  }

  private persistConflict(changeSetId: string, conflict: ConflictCandidate, actor: AdminActor): void {
    this.unitOfWork.run(() => {
      this.changeSets.markConflict(changeSetId, conflict.item.id, conflict.details, actor);
      this.appendEvent(changeSetId, "CONFLICT_DETECTED", actor, null, { itemId: conflict.item.id });
    });
  }

  private requireOwnedEditable(id: string, actor: AdminActor): ChangeSet {
    requireActor(actor);
    const changeSet = this.requireStatus(id, ["DRAFT", "NEEDS_CHANGES"]);
    if (changeSet.createdBy !== actor.actorUserId) throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only the proposal author can edit it.");
    return changeSet;
  }

  private requireStatus(id: string, statuses: ChangeSetStatus[]): ChangeSet {
    const changeSet = this.changeSets.findById(id);
    if (!changeSet) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Change Set was not found.");
    if (!statuses.includes(changeSet.status)) throw new ChangeManagementError("CHANGE_INVALID_STATE", `Change Set state ${changeSet.status} does not allow this action.`);
    return changeSet;
  }

  private getDetailsInternal(id: string): ChangeSetDetails {
    const row = this.database.db.select({ changeSet: changeSets, authorId: adminUsers.id, authorName: adminUsers.displayName, authorRole: adminUsers.role })
      .from(changeSets).innerJoin(adminUsers, eq(changeSets.createdBy, adminUsers.id)).where(eq(changeSets.id, id)).get();
    if (!row) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Change Set was not found.");
    const items = this.changeSets.listItems(id).map((item) => {
      const adapter = this.registry.require(item.resourceType);
      let current;
      try { current = adapter.loadCurrent(this.database, item.resourceId); }
      catch { current = { snapshot: item.beforeSnapshot, revision: item.baseResourceRevision }; }
      return { ...item, presentation: adapter.describe(item.resourceId, item.beforeSnapshot, item.proposedSnapshot, item.operation), currentSnapshot: current.snapshot, currentResourceRevision: current.revision };
    });
    return {
      changeSet: row.changeSet,
      author: { id: row.authorId, displayName: row.authorName, role: row.authorRole },
      itemCount: items.length,
      areaLabels: [...new Set(items.map((item) => item.presentation.areaLabel))],
      items,
      events: this.events.listWithActors(id),
    };
  }

  private appendEvent(changeSetId: string, eventType: Parameters<ChangeEventRepository["append"]>[0]["eventType"], actor: AdminActor, note: string | null = null, metadata: ChangeSnapshot | null = null): void {
    this.events.append({ changeSetId, eventType, actorUserId: actor.actorUserId, createdAt: this.clock(), note, metadata });
  }

  private publicationSummary(itemCount: number): string {
    return `${itemCount} ${itemCount === 1 ? "تغيير منشور" : "تغييرات منشورة"} · مكتبة المحتوى`;
  }

  private tryLoadCurrent(adapter: ReturnType<ChangeResourceAdapterRegistry["require"]>, resourceId: string) {
    try { return adapter.loadCurrent(this.database, resourceId); }
    catch (error) {
      if (error instanceof ChangeManagementError && error.code === "CHANGE_NOT_FOUND") return null;
      throw error;
    }
  }
}
