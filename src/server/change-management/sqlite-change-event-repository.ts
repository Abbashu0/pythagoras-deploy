import { asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { ContentDatabase } from "../content/database";
import { adminUsers, changeSetEvents } from "../content/schema";
import type { ChangeEventRepository, ChangeSetEvent } from "./contracts";

export class SQLiteChangeEventRepository implements ChangeEventRepository {
  constructor(private readonly database: ContentDatabase) {}

  append(input: Omit<ChangeSetEvent, "id"> & { id?: string }): ChangeSetEvent {
    return this.database.db.insert(changeSetEvents).values({ ...input, id: input.id ?? uuidv7() }).returning().get();
  }

  list(changeSetId: string, limit = 200): ChangeSetEvent[] {
    return this.database.db.select().from(changeSetEvents).where(eq(changeSetEvents.changeSetId, changeSetId)).orderBy(asc(changeSetEvents.createdAt), asc(changeSetEvents.id)).limit(limit).all();
  }

  listWithActors(changeSetId: string, limit = 200) {
    return this.database.db
      .select({ event: changeSetEvents, actorId: adminUsers.id, actorName: adminUsers.displayName, actorRole: adminUsers.role })
      .from(changeSetEvents)
      .innerJoin(adminUsers, eq(changeSetEvents.actorUserId, adminUsers.id))
      .where(eq(changeSetEvents.changeSetId, changeSetId))
      .orderBy(asc(changeSetEvents.createdAt), asc(changeSetEvents.id))
      .limit(limit)
      .all()
      .map((row) => ({ ...row.event, actor: { id: row.actorId, displayName: row.actorName, role: row.actorRole } }));
  }
}
