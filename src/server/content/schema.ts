import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AdminRole } from "../admin-auth/contracts";
import type { AssetMediaKind } from "../assets/contracts";

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

export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    originalFilename: text("original_filename").notNull(),
    displayName: text("display_name").notNull(),
    mimeType: text("mime_type").notNull(),
    mediaKind: text("media_kind").$type<AssetMediaKind>().notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    createdBy: text("created_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("assets_sha256_unique").on(table.sha256),
    uniqueIndex("assets_storage_key_unique").on(table.storageKey),
    index("assets_media_kind_index").on(table.mediaKind),
    index("assets_mime_type_index").on(table.mimeType),
    index("assets_created_by_index").on(table.createdBy),
    index("assets_created_at_index").on(table.createdAt),
    check(
      "assets_media_kind_valid",
      sql`${table.mediaKind} in ('image', 'video', 'audio', 'document', 'json', 'other-safe-file')`,
    ),
    check("assets_byte_size_positive", sql`${table.byteSize} > 0`),
    check(
      "assets_sha256_valid",
      sql`length(${table.sha256}) = 64 and ${table.sha256} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "assets_storage_key_matches_hash",
      sql`${table.storageKey} = substr(${table.sha256}, 1, 2) || '/' || ${table.sha256}`,
    ),
    check(
      "assets_original_filename_valid",
      sql`length(trim(${table.originalFilename})) between 1 and 255`,
    ),
    check(
      "assets_display_name_valid",
      sql`length(trim(${table.displayName})) between 1 and 255`,
    ),
    check(
      "assets_mime_type_valid",
      sql`length(trim(${table.mimeType})) between 1 and 127`,
    ),
    check(
      "assets_image_dimensions_valid",
      sql`((${table.width} is null and ${table.height} is null) or (${table.width} > 0 and ${table.height} > 0))`,
    ),
    check(
      "assets_duration_positive",
      sql`${table.durationMs} is null or ${table.durationMs} > 0`,
    ),
    check("assets_revision_positive", sql`${table.revision} >= 1`),
    check("assets_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
