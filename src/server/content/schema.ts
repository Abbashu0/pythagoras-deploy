import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type ContentPayload = Record<string, unknown>;

export const contentResources = sqliteTable(
  "content_resources",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    resourceKey: text("resource_key").notNull(),
    payload: text("payload", { mode: "json" }).$type<ContentPayload>().notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("content_resources_type_key_unique").on(
      table.resourceType,
      table.resourceKey,
    ),
    index("content_resources_type_index").on(table.resourceType),
    check("content_resources_revision_positive", sql`${table.revision} >= 1`),
    check("content_resources_type_not_empty", sql`length(${table.resourceType}) > 0`),
    check("content_resources_key_not_empty", sql`length(${table.resourceKey}) > 0`),
  ],
);

export type ContentResourceRow = typeof contentResources.$inferSelect;
export type NewContentResourceRow = typeof contentResources.$inferInsert;
