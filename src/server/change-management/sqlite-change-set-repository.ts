import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { ContentDatabase } from "../content/database";
import { adminUsers, changeSetItems, changeSets, type ChangeSetItemRow, type ChangeSetRow } from "../content/schema";
import type {
  ChangeSet,
  ChangeSetItem,
  ChangeSetListOptions,
  ChangeSetPage,
  ChangeSetRepository,
  ChangeSnapshot,
} from "./contracts";
import { ChangeManagementError } from "./errors";

type Clock = () => number;

function toChangeSet(row: ChangeSetRow): ChangeSet {
  return { ...row };
}

function toChangeSetItem(row: ChangeSetItemRow): ChangeSetItem {
  return {
    ...row,
    changedPaths: [...row.changedPaths],
    beforeSnapshot: structuredClone(row.beforeSnapshot),
    proposedSnapshot: structuredClone(row.proposedSnapshot),
    conflictDetails: row.conflictDetails ? structuredClone(row.conflictDetails) : null,
  };
}

function normalizePagination(options: ChangeSetListOptions) {
  const limit = options.limit ?? 30;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Change Set list limit must be between 1 and 100.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Change Set list offset is invalid.");
  }
  return { limit, offset };
}

export class SQLiteChangeSetRepository implements ChangeSetRepository {
  constructor(private readonly database: ContentDatabase, private readonly clock: Clock = Date.now) {}

  create(input: Parameters<ChangeSetRepository["create"]>[0]): ChangeSet {
    const now = this.clock();
    const row = this.database.db.insert(changeSets).values({
      id: input.id ?? uuidv7(),
      title: input.title,
      description: input.description,
      createdBy: input.actor.actorUserId,
      status: "DRAFT",
      basePublicationRevision: input.basePublicationRevision,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    }).returning().get();
    return toChangeSet(row);
  }

  findById(id: string): ChangeSet | null {
    const row = this.database.db.select().from(changeSets).where(eq(changeSets.id, id)).get();
    return row ? toChangeSet(row) : null;
  }

  list(options: ChangeSetListOptions): ChangeSetPage {
    const { limit, offset } = normalizePagination(options);
    const conditions: SQL[] = [];
    if (options.status) conditions.push(eq(changeSets.status, options.status));
    if (options.createdBy) conditions.push(eq(changeSets.createdBy, options.createdBy));
    const condition = conditions.length ? and(...conditions) : undefined;
    const total = this.database.db.select({ value: count() }).from(changeSets).where(condition).get();
    const rows = this.database.db
      .select({
        changeSet: changeSets,
        authorId: adminUsers.id,
        authorName: adminUsers.displayName,
        authorRole: adminUsers.role,
        itemCount: count(changeSetItems.id),
        resourceTypes: sql<string>`coalesce(group_concat(distinct ${changeSetItems.resourceType}), '')`,
      })
      .from(changeSets)
      .innerJoin(adminUsers, eq(changeSets.createdBy, adminUsers.id))
      .leftJoin(changeSetItems, eq(changeSets.id, changeSetItems.changeSetId))
      .where(condition)
      .groupBy(changeSets.id, adminUsers.id)
      .orderBy(desc(changeSets.updatedAt), desc(changeSets.id))
      .limit(limit)
      .offset(offset)
      .all();
    return {
      items: rows.map((row) => ({
        changeSet: toChangeSet(row.changeSet),
        author: { id: row.authorId, displayName: row.authorName, role: row.authorRole },
        itemCount: Number(row.itemCount),
        areaLabels: row.resourceTypes ? row.resourceTypes.split(",") : [],
      })),
      total: Number(total?.value ?? 0),
      limit,
      offset,
    };
  }

  updateDetails(id: string, title: string, description: string | null, expectedRevision: number): ChangeSet {
    const row = this.database.db.update(changeSets).set({
      title,
      description,
      updatedAt: this.clock(),
      revision: sql`${changeSets.revision} + 1`,
    }).where(and(eq(changeSets.id, id), eq(changeSets.revision, expectedRevision)))
      .returning().get();
    if (!row) this.throwNotFoundOrConflict(id, expectedRevision);
    return toChangeSet(row!);
  }

  touch(id: string, expectedRevision: number): ChangeSet {
    const row = this.database.db.update(changeSets).set({
      updatedAt: this.clock(),
      revision: sql`${changeSets.revision} + 1`,
    }).where(and(eq(changeSets.id, id), eq(changeSets.revision, expectedRevision))).returning().get();
    if (!row) this.throwNotFoundOrConflict(id, expectedRevision);
    return toChangeSet(row!);
  }

  transition(input: Parameters<ChangeSetRepository["transition"]>[0]): ChangeSet {
    const now = this.clock();
    const timestamps: Partial<ChangeSetRow> = {};
    if (input.to === "SUBMITTED") timestamps.submittedAt = now;
    if (["NEEDS_CHANGES", "APPROVED", "REJECTED"].includes(input.to)) timestamps.reviewedAt = now;
    if (input.to === "APPROVED") timestamps.approvedAt = now;
    if (input.to === "PUBLISHED") timestamps.publishedAt = now;
    const row = this.database.db.update(changeSets).set({
      status: input.to,
      reviewNote: input.reviewNote === undefined ? undefined : input.reviewNote,
      reviewedBy: input.reviewedBy === undefined ? undefined : input.reviewedBy,
      updatedAt: now,
      revision: sql`${changeSets.revision} + 1`,
      ...timestamps,
    }).where(and(
      eq(changeSets.id, input.id),
      eq(changeSets.revision, input.expectedRevision),
      inArray(changeSets.status, input.from),
    )).returning().get();
    if (!row) this.throwNotFoundOrConflict(input.id, input.expectedRevision);
    return toChangeSet(row!);
  }

  addItem(input: Omit<ChangeSetItem, "revision">): ChangeSetItem {
    const row = this.database.db.insert(changeSetItems).values({ ...input, revision: 1 }).returning().get();
    return toChangeSetItem(row);
  }

  updateItem(input: { item: ChangeSetItem; expectedRevision: number }): ChangeSetItem {
    const row = this.database.db.update(changeSetItems).set({
      baseResourceRevision: input.item.baseResourceRevision,
      beforeSnapshot: input.item.beforeSnapshot,
      proposedSnapshot: input.item.proposedSnapshot,
      changedPaths: input.item.changedPaths,
      conflictState: input.item.conflictState,
      conflictDetails: input.item.conflictDetails,
      updatedAt: input.item.updatedAt,
      revision: sql`${changeSetItems.revision} + 1`,
    }).where(and(eq(changeSetItems.id, input.item.id), eq(changeSetItems.revision, input.expectedRevision)))
      .returning().get();
    if (!row) throw new ChangeManagementError("CHANGE_CONFLICT", "The Change Set item changed since it was opened.");
    return toChangeSetItem(row);
  }

  removeItem(changeSetId: string, itemId: string): boolean {
    return this.database.db.delete(changeSetItems).where(and(eq(changeSetItems.changeSetId, changeSetId), eq(changeSetItems.id, itemId))).run().changes === 1;
  }

  listItems(changeSetId: string): ChangeSetItem[] {
    return this.database.db.select().from(changeSetItems).where(eq(changeSetItems.changeSetId, changeSetId)).orderBy(changeSetItems.createdAt, changeSetItems.id).all().map(toChangeSetItem);
  }

  listItemsPage(changeSetId: string, limit: number, offset: number): ChangeSetItem[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
      throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Change Set item pagination is invalid.");
    }
    return this.database.db.select().from(changeSetItems)
      .where(eq(changeSetItems.changeSetId, changeSetId))
      .orderBy(changeSetItems.createdAt, changeSetItems.id)
      .limit(limit).offset(offset).all().map(toChangeSetItem);
  }

  findItem(changeSetId: string, itemId: string): ChangeSetItem | null {
    const row = this.database.db.select().from(changeSetItems).where(and(eq(changeSetItems.changeSetId, changeSetId), eq(changeSetItems.id, itemId))).get();
    return row ? toChangeSetItem(row) : null;
  }

  countItems(changeSetId: string): number {
    return Number(this.database.db.select({ value: count() }).from(changeSetItems).where(eq(changeSetItems.changeSetId, changeSetId)).get()?.value ?? 0);
  }

  markConflict(changeSetId: string, itemId: string, details: ChangeSnapshot): void {
    const now = this.clock();
    this.database.db.update(changeSetItems).set({ conflictState: "BLOCKING", conflictDetails: details, updatedAt: now, revision: sql`${changeSetItems.revision} + 1` }).where(and(eq(changeSetItems.changeSetId, changeSetId), eq(changeSetItems.id, itemId))).run();
    this.database.db.update(changeSets).set({ status: "CONFLICTED", updatedAt: now, revision: sql`${changeSets.revision} + 1` }).where(eq(changeSets.id, changeSetId)).run();
  }

  private throwNotFoundOrConflict(id: string, expectedRevision: number): never {
    const current = this.findById(id);
    if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Change Set was not found.");
    throw new ChangeManagementError("CHANGE_CONFLICT", `Change Set revision conflict: expected ${expectedRevision}, found ${current.revision}.`);
  }
}
