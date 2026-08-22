import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AdminRole } from "../admin-auth/contracts";

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

export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<AdminRole>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastLoginAt: integer("last_login_at"),
    passwordChangedAt: integer("password_changed_at").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("admin_users_email_unique").on(table.email),
    uniqueIndex("admin_users_single_owner")
      .on(table.role)
      .where(sql`${table.role} = 'OWNER'`),
    index("admin_users_role_index").on(table.role),
    check("admin_users_role_valid", sql`${table.role} in ('OWNER', 'ADMIN')`),
    check("admin_users_enabled_boolean", sql`${table.enabled} in (0, 1)`),
    check("admin_users_revision_positive", sql`${table.revision} >= 1`),
    check("admin_users_email_not_empty", sql`length(trim(${table.email})) > 0`),
    check(
      "admin_users_display_name_not_empty",
      sql`length(trim(${table.displayName})) > 0`,
    ),
    check(
      "admin_users_password_hash_not_empty",
      sql`length(${table.passwordHash}) > 0`,
    ),
  ],
);

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_hash_unique").on(table.tokenHash),
    index("admin_sessions_user_index").on(table.userId),
    index("admin_sessions_expires_index").on(table.expiresAt),
    check(
      "admin_sessions_token_hash_sha256",
      sql`length(${table.tokenHash}) = 64 and ${table.tokenHash} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "admin_sessions_expiration_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "admin_sessions_last_seen_not_before_creation",
      sql`${table.lastSeenAt} >= ${table.createdAt}`,
    ),
  ],
);

export type AdminUserRow = typeof adminUsers.$inferSelect;
export type NewAdminUserRow = typeof adminUsers.$inferInsert;
export type AdminSessionRow = typeof adminSessions.$inferSelect;
export type NewAdminSessionRow = typeof adminSessions.$inferInsert;
