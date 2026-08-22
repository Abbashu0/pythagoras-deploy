import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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

export const canonicalContentState = sqliteTable(
  "canonical_content_state",
  {
    id: text("id").primaryKey(),
    bootstrapVersion: integer("bootstrap_version").notNull(),
    bootstrapCompletedAt: integer("bootstrap_completed_at").notNull(),
    runtimeSourceMode: text("runtime_source_mode").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    check("canonical_content_state_singleton", sql`${table.id} = 'global'`),
    check("canonical_content_state_bootstrap_positive", sql`${table.bootstrapVersion} >= 1`),
    check("canonical_content_state_source_valid", sql`${table.runtimeSourceMode} in ('LEGACY','CANONICAL')`),
    check("canonical_content_state_revision_positive", sql`${table.revision} >= 1`),
    check("canonical_content_state_timestamps_ordered", sql`${table.updatedAt} >= ${table.bootstrapCompletedAt}`),
  ],
);

export const canonicalBanners = sqliteTable(
  "canonical_banners",
  {
    id: text("id").primaryKey(),
    bannerType: text("banner_type").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull(),
    iconKey: text("icon_key").notNull(),
    gradient: text("gradient").notNull(),
    assetId: text("asset_id").references(() => assets.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    displayOrder: integer("display_order").notNull(),
    offsetX: real("offset_x").notNull().default(0),
    offsetY: real("offset_y").notNull().default(0),
    scale: real("scale").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    index("canonical_banners_status_order_index").on(table.status, table.displayOrder),
    index("canonical_banners_asset_index").on(table.assetId),
    check("canonical_banners_type_valid", sql`${table.bannerType} in ('FULL','SPLIT')`),
    check("canonical_banners_status_valid", sql`${table.status} in ('ACTIVE','ARCHIVED')`),
    check("canonical_banners_title_valid", sql`length(${table.title}) <= 160`),
    check("canonical_banners_subtitle_valid", sql`length(${table.subtitle}) <= 500`),
    check("canonical_banners_icon_valid", sql`length(trim(${table.iconKey})) between 1 and 80`),
    check("canonical_banners_gradient_valid", sql`length(trim(${table.gradient})) between 1 and 500`),
    check("canonical_banners_order_nonnegative", sql`${table.displayOrder} >= 0`),
    check("canonical_banners_offset_x_valid", sql`${table.offsetX} between -50 and 50`),
    check("canonical_banners_offset_y_valid", sql`${table.offsetY} between -50 and 50`),
    check("canonical_banners_scale_valid", sql`${table.scale} between 0.5 and 3`),
    check("canonical_banners_revision_positive", sql`${table.revision} >= 1`),
    check("canonical_banners_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const canonicalMaterials = sqliteTable(
  "canonical_materials",
  {
    id: text("id").primaryKey(),
    subjectKey: text("subject_key").notNull(),
    label: text("label").notNull(),
    englishTitle: text("english_title").notNull(),
    iconKey: text("icon_key").notNull(),
    available: integer("available", { mode: "boolean" }).notNull(),
    displayOrder: integer("display_order").notNull(),
    assetId: text("asset_id").references(() => assets.id, { onDelete: "restrict" }),
    gradient: text("gradient").notNull(),
    offsetX: real("offset_x").notNull().default(0),
    offsetY: real("offset_y").notNull().default(0),
    scale: real("scale").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("canonical_materials_subject_key_unique").on(table.subjectKey),
    index("canonical_materials_display_order_index").on(table.displayOrder),
    index("canonical_materials_asset_index").on(table.assetId),
    check("canonical_materials_subject_key_valid", sql`length(trim(${table.subjectKey})) between 1 and 80 and ${table.subjectKey} not glob '*[^a-z0-9-]*'`),
    check("canonical_materials_label_valid", sql`length(trim(${table.label})) between 1 and 160`),
    check("canonical_materials_english_title_valid", sql`length(trim(${table.englishTitle})) between 1 and 160`),
    check("canonical_materials_icon_valid", sql`length(trim(${table.iconKey})) between 1 and 80`),
    check("canonical_materials_available_boolean", sql`${table.available} in (0,1)`),
    check("canonical_materials_order_nonnegative", sql`${table.displayOrder} >= 0`),
    check("canonical_materials_gradient_valid", sql`length(trim(${table.gradient})) between 1 and 500`),
    check("canonical_materials_offset_x_valid", sql`${table.offsetX} between -50 and 50`),
    check("canonical_materials_offset_y_valid", sql`${table.offsetY} between -50 and 50`),
    check("canonical_materials_scale_valid", sql`${table.scale} between 0.5 and 3`),
    check("canonical_materials_revision_positive", sql`${table.revision} >= 1`),
    check("canonical_materials_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const canonicalMaterialSettings = sqliteTable(
  "canonical_material_settings",
  {
    id: text("id").primaryKey(),
    fadeIntensity: real("fade_intensity").notNull(),
    textVerticalPosition: real("text_vertical_position").notNull(),
    textScale: real("text_scale").notNull(),
    cardHeight: integer("card_height").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    check("canonical_material_settings_singleton", sql`${table.id} = 'global'`),
    check("canonical_material_settings_fade_valid", sql`${table.fadeIntensity} between 0 and 1`),
    check("canonical_material_settings_position_valid", sql`${table.textVerticalPosition} between -100 and 100`),
    check("canonical_material_settings_scale_valid", sql`${table.textScale} between 0.8 and 1.4`),
    check("canonical_material_settings_height_valid", sql`${table.cardHeight} between 160 and 340`),
    check("canonical_material_settings_revision_positive", sql`${table.revision} >= 1`),
  ],
);

export const canonicalTools = sqliteTable(
  "canonical_tools",
  {
    id: text("id").primaryKey(),
    toolKey: text("tool_key").notNull(),
    label: text("label").notNull(),
    iconKey: text("icon_key").notNull(),
    available: integer("available", { mode: "boolean" }).notNull(),
    displayOrder: integer("display_order").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("canonical_tools_tool_key_unique").on(table.toolKey),
    index("canonical_tools_display_order_index").on(table.displayOrder),
    check("canonical_tools_key_valid", sql`length(trim(${table.toolKey})) between 1 and 80 and ${table.toolKey} not glob '*[^a-z0-9-]*'`),
    check("canonical_tools_label_valid", sql`length(trim(${table.label})) between 1 and 160`),
    check("canonical_tools_icon_valid", sql`length(trim(${table.iconKey})) between 1 and 80`),
    check("canonical_tools_available_boolean", sql`${table.available} in (0,1)`),
    check("canonical_tools_order_nonnegative", sql`${table.displayOrder} >= 0`),
    check("canonical_tools_revision_positive", sql`${table.revision} >= 1`),
    check("canonical_tools_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const canonicalNavigation = sqliteTable(
  "canonical_navigation",
  {
    id: text("id").primaryKey(),
    navKey: text("nav_key").notNull(),
    label: text("label").notNull(),
    iconKey: text("icon_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    displayOrder: integer("display_order").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("canonical_navigation_nav_key_unique").on(table.navKey),
    index("canonical_navigation_display_order_index").on(table.displayOrder),
    check("canonical_navigation_key_valid", sql`length(trim(${table.navKey})) between 1 and 80 and ${table.navKey} not glob '*[^a-z0-9-]*'`),
    check("canonical_navigation_label_valid", sql`length(trim(${table.label})) between 1 and 160`),
    check("canonical_navigation_icon_valid", sql`length(trim(${table.iconKey})) between 1 and 80`),
    check("canonical_navigation_enabled_boolean", sql`${table.enabled} in (0,1)`),
    check("canonical_navigation_order_nonnegative", sql`${table.displayOrder} >= 0`),
    check("canonical_navigation_revision_positive", sql`${table.revision} >= 1`),
    check("canonical_navigation_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const canonicalCarouselSettings = sqliteTable(
  "canonical_carousel_settings",
  {
    id: text("id").primaryKey(),
    autoSlideInterval: integer("auto_slide_interval").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by").references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    check("canonical_carousel_settings_singleton", sql`${table.id} = 'global'`),
    check("canonical_carousel_settings_interval_valid", sql`${table.autoSlideInterval} between 1000 and 120000`),
    check("canonical_carousel_settings_revision_positive", sql`${table.revision} >= 1`),
  ],
);

export type CanonicalContentStateRow = typeof canonicalContentState.$inferSelect;
export type CanonicalBannerRow = typeof canonicalBanners.$inferSelect;
export type CanonicalMaterialRow = typeof canonicalMaterials.$inferSelect;
export type CanonicalMaterialSettingsRow = typeof canonicalMaterialSettings.$inferSelect;
export type CanonicalToolRow = typeof canonicalTools.$inferSelect;
export type CanonicalNavigationRow = typeof canonicalNavigation.$inferSelect;
export type CanonicalCarouselSettingsRow = typeof canonicalCarouselSettings.$inferSelect;

export const legacyMigrationRuns = sqliteTable(
  "legacy_migration_runs",
  {
    id: text("id").primaryKey(),
    createdBy: text("created_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
    sourceOrigin: text("source_origin").notNull(),
    sourceFingerprint: text("source_fingerprint"),
    status: text("status").notNull().default("DRAFT"),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>(),
    snapshotVersion: integer("snapshot_version"),
    bannerCount: integer("banner_count").notNull().default(0),
    materialCount: integer("material_count").notNull().default(0),
    toolCount: integer("tool_count").notNull().default(0),
    navigationCount: integer("navigation_count").notNull().default(0),
    imageReferenceCount: integer("image_reference_count").notNull().default(0),
    imageImportedCount: integer("image_imported_count").notNull().default(0),
    issueCount: integer("issue_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finalizedAt: integer("finalized_at"),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    index("legacy_migration_runs_fingerprint_index").on(table.sourceFingerprint),
    index("legacy_migration_runs_status_index").on(table.status),
    index("legacy_migration_runs_created_by_index").on(table.createdBy),
    check("legacy_migration_runs_status_valid", sql`${table.status} in ('DRAFT','IMPORTING','READY','FAILED','CANCELLED','APPLIED')`),
    check("legacy_migration_runs_revision_positive", sql`${table.revision} >= 1`),
    check("legacy_migration_runs_snapshot_version_valid", sql`${table.snapshotVersion} is null or ${table.snapshotVersion} = 1`),
    check("legacy_migration_runs_snapshot_valid", sql`${table.snapshot} is null or (json_valid(${table.snapshot}) and json_type(${table.snapshot}) = 'object')`),
    check("legacy_migration_runs_counts_nonnegative", sql`${table.bannerCount} >= 0 and ${table.materialCount} >= 0 and ${table.toolCount} >= 0 and ${table.navigationCount} >= 0 and ${table.imageReferenceCount} >= 0 and ${table.imageImportedCount} >= 0 and ${table.issueCount} >= 0`),
    check("legacy_migration_runs_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const legacyMigrationAssets = sqliteTable(
  "legacy_migration_assets",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => legacyMigrationRuns.id, { onDelete: "cascade" }),
    legacyReference: text("legacy_reference").notNull(),
    sourceKind: text("source_kind").notNull(),
    assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
    referenceContexts: text("reference_contexts", { mode: "json" }).$type<string[]>().notNull(),
    reused: integer("reused", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("legacy_migration_assets_run_reference_unique").on(table.runId, table.legacyReference),
    index("legacy_migration_assets_asset_index").on(table.assetId),
    check("legacy_migration_assets_source_kind_valid", sql`${table.sourceKind} in ('INDEXED_DB','INLINE')`),
    check("legacy_migration_assets_contexts_valid", sql`json_valid(${table.referenceContexts}) and json_type(${table.referenceContexts}) = 'array'`),
    check("legacy_migration_assets_reused_boolean", sql`${table.reused} in (0,1)`),
    check("legacy_migration_assets_reference_valid", sql`length(trim(${table.legacyReference})) between 1 and 500`),
  ],
);

export const legacyMigrationIssues = sqliteTable(
  "legacy_migration_issues",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => legacyMigrationRuns.id, { onDelete: "cascade" }),
    severity: text("severity").notNull(),
    code: text("code").notNull(),
    section: text("section"),
    legacyReference: text("legacy_reference"),
    message: text("message").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("legacy_migration_issues_run_severity_index").on(table.runId, table.severity),
    check("legacy_migration_issues_severity_valid", sql`${table.severity} in ('ERROR','WARNING','INFO')`),
    check("legacy_migration_issues_message_valid", sql`length(trim(${table.message})) between 1 and 1000`),
  ],
);

export const legacyMigrationEvents = sqliteTable(
  "legacy_migration_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => legacyMigrationRuns.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    actorUserId: text("actor_user_id").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (table) => [
    index("legacy_migration_events_run_time_index").on(table.runId, table.createdAt),
    check("legacy_migration_events_type_valid", sql`${table.eventType} in ('RUN_CREATED','SNAPSHOT_STORED','IMAGE_IMPORTED','IMAGE_REUSED','ISSUE_RECORDED','FINALIZED_READY','FAILED','CANCELLED')`),
    check("legacy_migration_events_metadata_valid", sql`${table.metadata} is null or (json_valid(${table.metadata}) and json_type(${table.metadata}) = 'object')`),
  ],
);

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
    check("change_set_items_operation_valid", sql`${table.operation} in ('CREATE','UPDATE')`),
    check("change_set_items_resource_type_valid", sql`length(trim(${table.resourceType})) between 1 and 80`),
    check("change_set_items_resource_id_valid", sql`length(trim(${table.resourceId})) > 0`),
    check("change_set_items_base_revision_nonnegative", sql`${table.baseResourceRevision} >= 0`),
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
    check("publication_items_operation_valid", sql`${table.operation} in ('CREATE','UPDATE')`),
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
