import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AdminRole } from "../admin-auth/contracts";
import type { AssetMediaKind } from "../assets/contracts";
import type {
  ChangeConflictState,
  ChangeEventType,
  ChangeOperation,
  ChangeSetStatus,
  ChangeSnapshot,
} from "../change-management/contracts";

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

export const changeSets = sqliteTable(
  "change_sets",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    createdBy: text("created_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
    status: text("status").$type<ChangeSetStatus>().notNull(),
    basePublicationRevision: integer("base_publication_revision").notNull(),
    reviewNote: text("review_note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    submittedAt: integer("submitted_at"),
    reviewedBy: text("reviewed_by").references(() => adminUsers.id, { onDelete: "restrict" }),
    reviewedAt: integer("reviewed_at"),
    approvedAt: integer("approved_at"),
    publishedAt: integer("published_at"),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    index("change_sets_status_index").on(table.status),
    index("change_sets_created_by_index").on(table.createdBy),
    index("change_sets_updated_at_index").on(table.updatedAt),
    check("change_sets_status_valid", sql`${table.status} in ('DRAFT','SUBMITTED','NEEDS_CHANGES','APPROVED','REJECTED','CONFLICTED','PUBLISHED','CANCELLED','SUPERSEDED')`),
    check("change_sets_title_valid", sql`length(trim(${table.title})) between 1 and 160`),
    check("change_sets_description_valid", sql`${table.description} is null or length(${table.description}) <= 2000`),
    check("change_sets_review_note_valid", sql`${table.reviewNote} is null or length(trim(${table.reviewNote})) between 1 and 2000`),
    check("change_sets_base_publication_revision_nonnegative", sql`${table.basePublicationRevision} >= 0`),
    check("change_sets_revision_positive", sql`${table.revision} >= 1`),
    check("change_sets_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const changeSetItems = sqliteTable(
  "change_set_items",
  {
    id: text("id").primaryKey(),
    changeSetId: text("change_set_id").notNull().references(() => changeSets.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    operation: text("operation").$type<ChangeOperation>().notNull(),
    baseResourceRevision: integer("base_resource_revision").notNull(),
    beforeSnapshot: text("before_snapshot", { mode: "json" }).$type<ChangeSnapshot>().notNull(),
    proposedSnapshot: text("proposed_snapshot", { mode: "json" }).$type<ChangeSnapshot>().notNull(),
    changedPaths: text("changed_paths", { mode: "json" }).$type<string[]>().notNull(),
    conflictState: text("conflict_state").$type<ChangeConflictState>().notNull().default("NONE"),
    conflictDetails: text("conflict_details", { mode: "json" }).$type<ChangeSnapshot>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("change_set_items_resource_unique").on(table.changeSetId, table.resourceType, table.resourceId),
    index("change_set_items_change_set_index").on(table.changeSetId),
    index("change_set_items_resource_index").on(table.resourceType, table.resourceId),
    check("change_set_items_operation_valid", sql`${table.operation} = 'UPDATE'`),
    check("change_set_items_resource_type_valid", sql`length(trim(${table.resourceType})) between 1 and 80`),
    check("change_set_items_resource_id_valid", sql`length(trim(${table.resourceId})) > 0`),
    check("change_set_items_base_revision_positive", sql`${table.baseResourceRevision} >= 1`),
    check("change_set_items_changed_paths_array", sql`json_valid(${table.changedPaths}) and json_type(${table.changedPaths}) = 'array'`),
    check("change_set_items_before_snapshot_object", sql`json_valid(${table.beforeSnapshot}) and json_type(${table.beforeSnapshot}) = 'object'`),
    check("change_set_items_proposed_snapshot_object", sql`json_valid(${table.proposedSnapshot}) and json_type(${table.proposedSnapshot}) = 'object'`),
    check("change_set_items_conflict_state_valid", sql`${table.conflictState} in ('NONE','BLOCKING','AUTO_MERGED')`),
    check("change_set_items_revision_positive", sql`${table.revision} >= 1`),
    check("change_set_items_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const changeSetEvents = sqliteTable(
  "change_set_events",
  {
    id: text("id").primaryKey(),
    changeSetId: text("change_set_id").notNull().references(() => changeSets.id, { onDelete: "cascade" }),
    eventType: text("event_type").$type<ChangeEventType>().notNull(),
    actorUserId: text("actor_user_id").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    note: text("note"),
    metadata: text("metadata", { mode: "json" }).$type<ChangeSnapshot>(),
  },
  (table) => [
    index("change_set_events_change_set_time_index").on(table.changeSetId, table.createdAt),
    index("change_set_events_actor_index").on(table.actorUserId),
    check("change_set_events_type_valid", sql`${table.eventType} in ('CREATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','SUBMITTED','REQUESTED_CHANGES','RESUBMITTED','APPROVED','REJECTED','CONFLICT_DETECTED','AUTO_MERGED_DISJOINT_FIELDS','REBASED','PUBLISHED','CANCELLED')`),
    check("change_set_events_note_valid", sql`${table.note} is null or length(trim(${table.note})) between 1 and 2000`),
  ],
);

export const publications = sqliteTable(
  "publications",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull(),
    changeSetId: text("change_set_id").notNull().references(() => changeSets.id, { onDelete: "restrict" }),
    publishedBy: text("published_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
    publishedAt: integer("published_at").notNull(),
    summary: text("summary").notNull(),
  },
  (table) => [
    uniqueIndex("publications_revision_unique").on(table.revision),
    uniqueIndex("publications_change_set_unique").on(table.changeSetId),
    index("publications_published_at_index").on(table.publishedAt),
    check("publications_revision_positive", sql`${table.revision} >= 1`),
    check("publications_summary_valid", sql`length(trim(${table.summary})) between 1 and 500`),
  ],
);

export const publicationItems = sqliteTable(
  "publication_items",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "restrict" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    operation: text("operation").$type<ChangeOperation>().notNull(),
    beforeSnapshot: text("before_snapshot", { mode: "json" }).$type<ChangeSnapshot>().notNull(),
    afterSnapshot: text("after_snapshot", { mode: "json" }).$type<ChangeSnapshot>().notNull(),
    resultingResourceRevision: integer("resulting_resource_revision").notNull(),
  },
  (table) => [
    index("publication_items_publication_index").on(table.publicationId),
    index("publication_items_resource_index").on(table.resourceType, table.resourceId),
    check("publication_items_operation_valid", sql`${table.operation} = 'UPDATE'`),
    check("publication_items_before_snapshot_object", sql`json_valid(${table.beforeSnapshot}) and json_type(${table.beforeSnapshot}) = 'object'`),
    check("publication_items_after_snapshot_object", sql`json_valid(${table.afterSnapshot}) and json_type(${table.afterSnapshot}) = 'object'`),
    check("publication_items_result_revision_positive", sql`${table.resultingResourceRevision} >= 1`),
  ],
);

export const publicationState = sqliteTable(
  "publication_state",
  {
    id: text("id").primaryKey(),
    currentRevision: integer("current_revision").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("publication_state_singleton", sql`${table.id} = 'global'`),
    check("publication_state_revision_nonnegative", sql`${table.currentRevision} >= 0`),
  ],
);

export type ChangeSetRow = typeof changeSets.$inferSelect;
export type ChangeSetItemRow = typeof changeSetItems.$inferSelect;
export type ChangeSetEventRow = typeof changeSetEvents.$inferSelect;
export type PublicationRow = typeof publications.$inferSelect;
export type PublicationItemRow = typeof publicationItems.$inferSelect;
