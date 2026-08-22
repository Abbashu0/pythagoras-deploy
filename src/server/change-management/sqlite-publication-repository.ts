import { count, desc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { ContentDatabase } from "../content/database";
import { publicationItems, publications, publicationState } from "../content/schema";
import type { Publication, PublicationItem, PublicationRepository } from "./contracts";
import { ChangeManagementError } from "./errors";

export class SQLitePublicationRepository implements PublicationRepository {
  constructor(private readonly database: ContentDatabase) {}

  getCurrentRevision(): number {
    const row = this.database.db.select({ revision: publicationState.currentRevision }).from(publicationState).where(eq(publicationState.id, "global")).get();
    if (!row) throw new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "Publication state is unavailable.");
    return row.revision;
  }

  incrementRevision(now: number): number {
    const row = this.database.db.update(publicationState).set({ currentRevision: sql`${publicationState.currentRevision} + 1`, updatedAt: now }).where(eq(publicationState.id, "global")).returning({ revision: publicationState.currentRevision }).get();
    if (!row) throw new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "Publication revision could not be incremented.");
    return row.revision;
  }

  create(input: Omit<Publication, "id"> & { id?: string }): Publication {
    return this.database.db.insert(publications).values({ ...input, id: input.id ?? uuidv7() }).returning().get();
  }

  addItem(input: Omit<PublicationItem, "id"> & { id?: string }): PublicationItem {
    return this.database.db.insert(publicationItems).values({ ...input, id: input.id ?? uuidv7() }).returning().get();
  }

  list(limit = 30, offset = 0): { items: Publication[]; total: number } {
    const items = this.database.db.select().from(publications).orderBy(desc(publications.revision)).limit(limit).offset(offset).all();
    const total = this.database.db.select({ value: count() }).from(publications).get();
    return { items, total: Number(total?.value ?? 0) };
  }

  listItems(publicationId: string): PublicationItem[] {
    return this.database.db.select().from(publicationItems).where(eq(publicationItems.publicationId, publicationId)).all();
  }
}
