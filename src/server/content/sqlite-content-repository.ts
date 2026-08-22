import { and, asc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type {
  ContentRecord,
  ContentRepository,
  CreateContentRecord,
  UpdateContentRecord,
} from "./contracts";
import type { ContentDatabase } from "./database";
import {
  ContentConflictError,
  ContentDuplicateError,
  ContentFoundationError,
  ContentNotFoundError,
} from "./errors";
import {
  contentResources,
  type ContentPayload,
  type ContentResourceRow,
} from "./schema";

type Clock = () => number;

function toContentRecord<TPayload extends ContentPayload>(
  row: ContentResourceRow,
): ContentRecord<TPayload> {
  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceKey: row.resourceKey,
    payload: row.payload as TPayload,
    revision: row.revision,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new ContentFoundationError(
      "CONTENT_VALIDATION_FAILED",
      `${field} must not be empty.`,
    );
  }
  return normalized;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = String((error as Error & { code?: unknown }).code);
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

export class SQLiteContentRepository implements ContentRepository {
  constructor(
    private readonly database: ContentDatabase,
    private readonly clock: Clock = Date.now,
  ) {}

  create<TPayload extends ContentPayload>(
    input: CreateContentRecord<TPayload>,
  ): ContentRecord<TPayload> {
    const id = requireNonEmpty(input.id ?? uuidv7(), "id");
    const resourceType = requireNonEmpty(input.resourceType, "resourceType");
    const resourceKey = requireNonEmpty(input.resourceKey, "resourceKey");
    const now = this.clock();

    try {
      return this.database.db.transaction((transaction) => {
        transaction
          .insert(contentResources)
          .values({
            id,
            resourceType,
            resourceKey,
            payload: input.payload,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        const row = transaction
          .select()
          .from(contentResources)
          .where(eq(contentResources.id, id))
          .get();

        if (!row) {
          throw new ContentNotFoundError(id);
        }
        return toContentRecord<TPayload>(row);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ContentDuplicateError(resourceType, resourceKey, error);
      }
      throw error;
    }
  }

  findById<TPayload extends ContentPayload = ContentPayload>(
    id: string,
  ): ContentRecord<TPayload> | null {
    const row = this.database.db
      .select()
      .from(contentResources)
      .where(eq(contentResources.id, id))
      .get();
    return row ? toContentRecord<TPayload>(row) : null;
  }

  findByKey<TPayload extends ContentPayload = ContentPayload>(
    resourceType: string,
    resourceKey: string,
  ): ContentRecord<TPayload> | null {
    const row = this.database.db
      .select()
      .from(contentResources)
      .where(
        and(
          eq(contentResources.resourceType, requireNonEmpty(resourceType, "resourceType")),
          eq(contentResources.resourceKey, requireNonEmpty(resourceKey, "resourceKey")),
        ),
      )
      .get();
    return row ? toContentRecord<TPayload>(row) : null;
  }

  listByType<TPayload extends ContentPayload = ContentPayload>(
    resourceType: string,
  ): ContentRecord<TPayload>[] {
    return this.database.db
      .select()
      .from(contentResources)
      .where(eq(contentResources.resourceType, requireNonEmpty(resourceType, "resourceType")))
      .orderBy(asc(contentResources.createdAt), asc(contentResources.id))
      .all()
      .map((row) => toContentRecord<TPayload>(row));
  }

  update<TPayload extends ContentPayload>(
    input: UpdateContentRecord<TPayload>,
  ): ContentRecord<TPayload> {
    const id = requireNonEmpty(input.id, "id");

    return this.database.db.transaction((transaction) => {
      const result = transaction
        .update(contentResources)
        .set({
          payload: input.payload,
          revision: sql`${contentResources.revision} + 1`,
          updatedAt: this.clock(),
        })
        .where(
          and(
            eq(contentResources.id, id),
            eq(contentResources.revision, input.expectedRevision),
          ),
        )
        .run();

      if (result.changes === 0) {
        const current = transaction
          .select({ revision: contentResources.revision })
          .from(contentResources)
          .where(eq(contentResources.id, id))
          .get();
        if (!current) throw new ContentNotFoundError(id);
        throw new ContentConflictError(input.expectedRevision, current.revision);
      }

      const row = transaction
        .select()
        .from(contentResources)
        .where(eq(contentResources.id, id))
        .get();
      if (!row) throw new ContentNotFoundError(id);
      return toContentRecord<TPayload>(row);
    });
  }

  delete(id: string, expectedRevision: number): void {
    const normalizedId = requireNonEmpty(id, "id");

    this.database.db.transaction((transaction) => {
      const result = transaction
        .delete(contentResources)
        .where(
          and(
            eq(contentResources.id, normalizedId),
            eq(contentResources.revision, expectedRevision),
          ),
        )
        .run();

      if (result.changes === 0) {
        const current = transaction
          .select({ revision: contentResources.revision })
          .from(contentResources)
          .where(eq(contentResources.id, normalizedId))
          .get();
        if (!current) throw new ContentNotFoundError(normalizedId);
        throw new ContentConflictError(expectedRevision, current.revision);
      }
    });
  }
}
