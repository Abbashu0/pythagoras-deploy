import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AdminRole } from "../admin-auth/contracts";
import type { AssetMediaKind } from "../assets/contracts";
import type {
  QuestionPackageDiagnostic,
  QuestionPackageRecognitionStatus,
} from "../question-packages/contracts";
import type {
  CanonicalRichDocument,
  QuestionBankBrowseMode,
  QuestionBrowseNodeType,
  QuestionSourceKind,
  QuestionTaxonomyRole,
} from "../questions/contracts";
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

export const questionPackageInspections = sqliteTable(
  "question_package_inspections",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => assets.id, { onDelete: "cascade" }),
    sourceSha256: text("source_sha256").notNull(),
    status: text("status").$type<QuestionPackageRecognitionStatus>().notNull(),
    format: text("format"),
    schemaVersion: text("schema_version"),
    packageId: text("package_id"),
    packageKey: text("package_key"),
    title: text("title"),
    subjectKey: text("subject_key"),
    questionCount: integer("question_count").notNull(),
    variantCount: integer("variant_count").notNull(),
    errorCount: integer("error_count").notNull(),
    warningCount: integer("warning_count").notNull(),
    diagnostics: text("diagnostics", { mode: "json" })
      .$type<QuestionPackageDiagnostic[]>()
      .notNull(),
    inspectorVersion: integer("inspector_version").notNull(),
    inspectedAt: integer("inspected_at").notNull(),
  },
  (table) => [
    index("question_package_inspections_status_index").on(table.status),
    index("question_package_inspections_subject_index").on(table.subjectKey),
    index("question_package_inspections_package_id_index").on(table.packageId),
    check(
      "question_package_inspections_status_valid",
      sql`${table.status} in ('GENERIC_JSON','VALID','VALID_WITH_WARNINGS','INVALID','UNSUPPORTED_VERSION')`,
    ),
    check(
      "question_package_inspections_source_sha256_valid",
      sql`length(${table.sourceSha256}) = 64 and ${table.sourceSha256} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "question_package_inspections_counts_nonnegative",
      sql`${table.questionCount} >= 0 and ${table.variantCount} >= 0 and ${table.errorCount} >= 0 and ${table.warningCount} >= 0`,
    ),
    check(
      "question_package_inspections_diagnostics_array",
      sql`json_valid(${table.diagnostics}) and json_type(${table.diagnostics}) = 'array'`,
    ),
    check(
      "question_package_inspections_version_positive",
      sql`${table.inspectorVersion} >= 1`,
    ),
  ],
);

export const questionPackages = sqliteTable(
  "question_packages",
  {
    id: text("id").primaryKey(),
    packageKey: text("package_key").notNull(),
    title: text("title").notNull(),
    subjectKey: text("subject_key")
      .notNull()
      .references(() => canonicalMaterials.subjectKey, { onDelete: "restrict" }),
    language: text("language").notNull(),
    contentRevision: integer("content_revision").notNull(),
    bankBrowseMode: text("bank_browse_mode")
      .$type<QuestionBankBrowseMode>()
      .notNull(),
    bankBrowseEntryKey: text("bank_browse_entry_key").notNull(),
    bankBrowseEntryLabel: text("bank_browse_entry_label").notNull(),
    bankBrowseEntryOrder: integer("bank_browse_entry_order").notNull(),
    sourceAssetId: text("source_asset_id").references(() => assets.id, {
      onDelete: "restrict",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("question_packages_key_unique").on(table.packageKey),
    uniqueIndex("question_packages_subject_entry_key_unique").on(
      table.subjectKey,
      table.bankBrowseEntryKey,
    ),
    uniqueIndex("question_packages_subject_entry_order_unique").on(
      table.subjectKey,
      table.bankBrowseEntryOrder,
    ),
    index("question_packages_subject_order_index").on(
      table.subjectKey,
      table.bankBrowseEntryOrder,
    ),
    index("question_packages_source_asset_index").on(table.sourceAssetId),
    check("question_packages_key_valid", sql`length(trim(${table.packageKey})) between 1 and 120`),
    check("question_packages_title_valid", sql`length(trim(${table.title})) between 1 and 1000`),
    check("question_packages_language_valid", sql`length(trim(${table.language})) between 2 and 35`),
    check("question_packages_content_revision_positive", sql`${table.contentRevision} >= 1`),
    check("question_packages_browse_mode_valid", sql`${table.bankBrowseMode} in ('ALL_PACKAGE_QUESTIONS','TREE')`),
    check("question_packages_entry_key_valid", sql`length(trim(${table.bankBrowseEntryKey})) between 1 and 120`),
    check("question_packages_entry_label_valid", sql`length(trim(${table.bankBrowseEntryLabel})) between 1 and 1000`),
    check("question_packages_entry_order_positive", sql`${table.bankBrowseEntryOrder} >= 1`),
    check("question_packages_revision_positive", sql`${table.revision} >= 1`),
    check("question_packages_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const questionTaxonomyNodes = sqliteTable(
  "question_taxonomy_nodes",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => questionPackages.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    label: text("label").notNull(),
    kind: text("kind").notNull(),
    parentId: text("parent_id"),
    displayOrder: integer("display_order").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("question_taxonomy_package_id_unique").on(table.packageId, table.id),
    uniqueIndex("question_taxonomy_package_key_unique").on(table.packageId, table.nodeKey),
    uniqueIndex("question_taxonomy_root_order_unique")
      .on(table.packageId, table.displayOrder)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("question_taxonomy_sibling_order_unique")
      .on(table.packageId, table.parentId, table.displayOrder)
      .where(sql`${table.parentId} is not null`),
    index("question_taxonomy_parent_order_index").on(table.packageId, table.parentId, table.displayOrder),
    foreignKey({
      columns: [table.packageId, table.parentId],
      foreignColumns: [table.packageId, table.id],
      name: "question_taxonomy_parent_same_package_fk",
    }).onDelete("restrict"),
    check("question_taxonomy_key_valid", sql`length(trim(${table.nodeKey})) between 1 and 120`),
    check("question_taxonomy_label_valid", sql`length(trim(${table.label})) between 1 and 1000`),
    check("question_taxonomy_kind_valid", sql`length(trim(${table.kind})) between 1 and 120`),
    check("question_taxonomy_order_positive", sql`${table.displayOrder} >= 1`),
    check("question_taxonomy_not_self_parent", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
    check("question_taxonomy_revision_positive", sql`${table.revision} >= 1`),
    check("question_taxonomy_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const questionBankBrowseNodes = sqliteTable(
  "question_bank_browse_nodes",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => questionPackages.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    label: text("label").notNull(),
    nodeType: text("node_type").$type<QuestionBrowseNodeType>().notNull(),
    parentId: text("parent_id"),
    displayOrder: integer("display_order").notNull(),
    taxonomyNodeId: text("taxonomy_node_id"),
    includeDescendants: integer("include_descendants", { mode: "boolean" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("question_browse_package_id_unique").on(table.packageId, table.id),
    uniqueIndex("question_browse_package_key_unique").on(table.packageId, table.nodeKey),
    uniqueIndex("question_browse_root_order_unique")
      .on(table.packageId, table.displayOrder)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("question_browse_sibling_order_unique")
      .on(table.packageId, table.parentId, table.displayOrder)
      .where(sql`${table.parentId} is not null`),
    index("question_browse_parent_order_index").on(table.packageId, table.parentId, table.displayOrder),
    index("question_browse_taxonomy_index").on(table.packageId, table.taxonomyNodeId),
    foreignKey({
      columns: [table.packageId, table.parentId],
      foreignColumns: [table.packageId, table.id],
      name: "question_browse_parent_same_package_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.packageId, table.taxonomyNodeId],
      foreignColumns: [questionTaxonomyNodes.packageId, questionTaxonomyNodes.id],
      name: "question_browse_taxonomy_same_package_fk",
    }).onDelete("restrict"),
    check("question_browse_key_valid", sql`length(trim(${table.nodeKey})) between 1 and 120`),
    check("question_browse_label_valid", sql`length(trim(${table.label})) between 1 and 1000`),
    check("question_browse_type_valid", sql`${table.nodeType} in ('GROUP','QUESTION_LIST')`),
    check("question_browse_order_positive", sql`${table.displayOrder} >= 1`),
    check("question_browse_not_self_parent", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
    check("question_browse_filter_shape_valid", sql`(${table.nodeType} = 'GROUP' and ${table.taxonomyNodeId} is null and ${table.includeDescendants} is null) or (${table.nodeType} = 'QUESTION_LIST' and ${table.taxonomyNodeId} is not null and ${table.includeDescendants} in (0,1))`),
    check("question_browse_revision_positive", sql`${table.revision} >= 1`),
    check("question_browse_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => questionPackages.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull(),
    sharedAnswer: text("shared_answer", { mode: "json" }).$type<CanonicalRichDocument>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("questions_package_id_unique").on(table.packageId, table.id),
    uniqueIndex("questions_package_order_unique").on(table.packageId, table.displayOrder),
    index("questions_package_order_index").on(table.packageId, table.displayOrder),
    check("questions_order_positive", sql`${table.displayOrder} >= 1`),
    check("questions_shared_answer_valid_json", sql`${table.sharedAnswer} is null or (json_valid(${table.sharedAnswer}) and json_type(${table.sharedAnswer}) = 'object')`),
    check("questions_revision_positive", sql`${table.revision} >= 1`),
    check("questions_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const questionVariants = sqliteTable(
  "question_variants",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull(),
    content: text("content", { mode: "json" }).$type<CanonicalRichDocument>().notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("question_variants_question_id_unique").on(table.questionId, table.id),
    uniqueIndex("question_variants_question_order_unique").on(table.questionId, table.displayOrder),
    index("question_variants_question_order_index").on(table.questionId, table.displayOrder),
    check("question_variants_order_positive", sql`${table.displayOrder} >= 1`),
    check("question_variants_content_valid_json", sql`json_valid(${table.content}) and json_type(${table.content}) = 'object'`),
    check("question_variants_revision_positive", sql`${table.revision} >= 1`),
    check("question_variants_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const questionPrimaryVariants = sqliteTable(
  "question_primary_variants",
  {
    questionId: text("question_id")
      .primaryKey()
      .references(() => questions.id, { onDelete: "cascade" }),
    variantId: text("variant_id").notNull(),
  },
  (table) => [
    uniqueIndex("question_primary_variants_variant_unique").on(table.variantId),
    foreignKey({
      columns: [table.questionId, table.variantId],
      foreignColumns: [questionVariants.questionId, questionVariants.id],
      name: "question_primary_variant_same_question_fk",
    }).onDelete("cascade"),
  ],
);

export const questionOccurrences = sqliteTable(
  "question_occurrences",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => questionVariants.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull(),
    sourceKind: text("source_kind").$type<QuestionSourceKind>().notNull(),
    year: integer("year"),
    roundCode: text("round_code"),
    session: text("session"),
    sourceName: text("source_name"),
    notes: text("notes"),
    rawLabel: text("raw_label").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("question_occurrences_variant_order_unique").on(table.variantId, table.displayOrder),
    index("question_occurrences_variant_order_index").on(table.variantId, table.displayOrder),
    index("question_occurrences_source_year_index").on(table.sourceKind, table.year),
    check("question_occurrences_order_positive", sql`${table.displayOrder} >= 1`),
    check("question_occurrences_source_kind_valid", sql`${table.sourceKind} in ('ministerial','discussion-question','educational-tv','end-of-chapter','book-question','book-exercise','enrichment','other')`),
    check("question_occurrences_year_valid", sql`${table.year} is null or ${table.year} between 1900 and 2200`),
    check("question_occurrences_raw_label_valid", sql`length(trim(${table.rawLabel})) between 1 and 1000`),
    check("question_occurrences_revision_positive", sql`${table.revision} >= 1`),
    check("question_occurrences_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const questionOccurrenceBranches = sqliteTable(
  "question_occurrence_branches",
  {
    occurrenceId: text("occurrence_id")
      .notNull()
      .references(() => questionOccurrences.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.occurrenceId, table.position] }),
    index("question_occurrence_branches_value_index").on(table.value),
    check("question_occurrence_branches_position_nonnegative", sql`${table.position} >= 0`),
    check("question_occurrence_branches_value_valid", sql`length(trim(${table.value})) between 1 and 160`),
  ],
);

export const questionOccurrenceQualifiers = sqliteTable(
  "question_occurrence_qualifiers",
  {
    occurrenceId: text("occurrence_id")
      .notNull()
      .references(() => questionOccurrences.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.occurrenceId, table.position] }),
    index("question_occurrence_qualifiers_value_index").on(table.value),
    check("question_occurrence_qualifiers_position_nonnegative", sql`${table.position} >= 0`),
    check("question_occurrence_qualifiers_value_valid", sql`length(trim(${table.value})) between 1 and 160`),
  ],
);

export const questionTaxonomyAssignments = sqliteTable(
  "question_taxonomy_assignments",
  {
    packageId: text("package_id").notNull(),
    questionId: text("question_id").notNull(),
    taxonomyNodeId: text("taxonomy_node_id").notNull(),
    role: text("role").$type<QuestionTaxonomyRole>().notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.questionId, table.taxonomyNodeId] }),
    uniqueIndex("question_taxonomy_assignments_question_position_unique").on(table.questionId, table.position),
    uniqueIndex("question_taxonomy_assignments_one_primary")
      .on(table.questionId)
      .where(sql`${table.role} = 'PRIMARY'`),
    index("question_taxonomy_assignments_taxonomy_index").on(table.taxonomyNodeId, table.questionId),
    foreignKey({
      columns: [table.packageId, table.questionId],
      foreignColumns: [questions.packageId, questions.id],
      name: "question_assignment_question_same_package_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.packageId, table.taxonomyNodeId],
      foreignColumns: [questionTaxonomyNodes.packageId, questionTaxonomyNodes.id],
      name: "question_assignment_taxonomy_same_package_fk",
    }).onDelete("restrict"),
    check("question_taxonomy_assignments_role_valid", sql`${table.role} in ('PRIMARY','RELATED')`),
    check("question_taxonomy_assignments_position_nonnegative", sql`${table.position} >= 0`),
  ],
);

export const questionPackageAssetBindings = sqliteTable(
  "question_package_asset_bindings",
  {
    packageId: text("package_id")
      .notNull()
      .references(() => questionPackages.id, { onDelete: "cascade" }),
    assetRef: text("asset_ref").notNull(),
    expectedSha256: text("expected_sha256").notNull(),
    assetId: text("asset_id").references(() => assets.id, { onDelete: "restrict" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, string | number | boolean | null>>(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.packageId, table.assetRef] }),
    uniqueIndex("question_package_asset_bindings_position_unique").on(table.packageId, table.position),
    index("question_package_asset_bindings_asset_index").on(table.assetId),
    check("question_package_asset_bindings_ref_valid", sql`length(trim(${table.assetRef})) between 1 and 120`),
    check("question_package_asset_bindings_sha256_valid", sql`length(${table.expectedSha256}) = 64 and ${table.expectedSha256} not glob '*[^0-9a-f]*'`),
    check("question_package_asset_bindings_filename_valid", sql`length(trim(${table.filename})) between 1 and 1000`),
    check("question_package_asset_bindings_mime_valid", sql`length(trim(${table.mimeType})) between 1 and 127`),
    check("question_package_asset_bindings_size_positive", sql`${table.byteSize} > 0`),
    check("question_package_asset_bindings_metadata_valid", sql`${table.metadata} is null or (json_valid(${table.metadata}) and json_type(${table.metadata}) = 'object')`),
    check("question_package_asset_bindings_position_nonnegative", sql`${table.position} >= 0`),
  ],
);

export type MaterialQuestionBankRootPresentation = "DIRECT" | "CARDS";
export type MaterialQuestionBankNodeType = "GROUP" | "BANK";
export type MaterialQuestionBankGroupPresentation = "CARDS" | "SWITCHER";
export type MaterialQuestionBankTargetMode = "ALL_PACKAGE_QUESTIONS" | "TAXONOMY_FILTER";

export const materialQuestionBankLayouts = sqliteTable(
  "material_question_bank_layouts",
  {
    materialId: text("material_id")
      .primaryKey()
      .references(() => canonicalMaterials.id, { onDelete: "cascade" }),
    rootPresentation: text("root_presentation")
      .$type<MaterialQuestionBankRootPresentation>()
      .notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    check("material_question_bank_layouts_root_valid", sql`${table.rootPresentation} in ('DIRECT','CARDS')`),
    check("material_question_bank_layouts_revision_positive", sql`${table.revision} >= 1`),
    check("material_question_bank_layouts_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const materialQuestionBankNodes = sqliteTable(
  "material_question_bank_nodes",
  {
    id: text("id").primaryKey(),
    materialId: text("material_id")
      .notNull()
      .references(() => materialQuestionBankLayouts.materialId, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    label: text("label").notNull(),
    nodeType: text("node_type").$type<MaterialQuestionBankNodeType>().notNull(),
    parentId: text("parent_id"),
    displayOrder: integer("display_order").notNull(),
    groupPresentation: text("group_presentation").$type<MaterialQuestionBankGroupPresentation>(),
    packageId: text("package_id").references(() => questionPackages.id, { onDelete: "restrict" }),
    targetMode: text("target_mode").$type<MaterialQuestionBankTargetMode>(),
    taxonomyNodeId: text("taxonomy_node_id"),
    includeDescendants: integer("include_descendants", { mode: "boolean" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    uniqueIndex("material_question_bank_nodes_material_id_unique").on(table.materialId, table.id),
    uniqueIndex("material_question_bank_nodes_key_unique").on(table.materialId, table.nodeKey),
    uniqueIndex("material_question_bank_nodes_root_order_unique")
      .on(table.materialId, table.displayOrder)
      .where(sql`${table.parentId} is null`),
    uniqueIndex("material_question_bank_nodes_sibling_order_unique")
      .on(table.materialId, table.parentId, table.displayOrder)
      .where(sql`${table.parentId} is not null`),
    index("material_question_bank_nodes_parent_order_index").on(table.materialId, table.parentId, table.displayOrder),
    index("material_question_bank_nodes_package_index").on(table.packageId),
    index("material_question_bank_nodes_taxonomy_index").on(table.packageId, table.taxonomyNodeId),
    foreignKey({
      columns: [table.materialId, table.parentId],
      foreignColumns: [table.materialId, table.id],
      name: "material_question_bank_nodes_parent_same_material_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.packageId, table.taxonomyNodeId],
      foreignColumns: [questionTaxonomyNodes.packageId, questionTaxonomyNodes.id],
      name: "material_question_bank_nodes_taxonomy_same_package_fk",
    }).onDelete("restrict"),
    check("material_question_bank_nodes_key_valid", sql`length(trim(${table.nodeKey})) between 1 and 120`),
    check("material_question_bank_nodes_label_valid", sql`length(trim(${table.label})) between 1 and 500`),
    check("material_question_bank_nodes_type_valid", sql`${table.nodeType} in ('GROUP','BANK')`),
    check("material_question_bank_nodes_order_positive", sql`${table.displayOrder} >= 1`),
    check("material_question_bank_nodes_not_self_parent", sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`),
    check("material_question_bank_nodes_enabled_boolean", sql`${table.enabled} in (0,1)`),
    check("material_question_bank_nodes_shape_valid", sql`(
      ${table.nodeType} = 'GROUP'
      and ${table.groupPresentation} in ('CARDS','SWITCHER')
      and ${table.packageId} is null
      and ${table.targetMode} is null
      and ${table.taxonomyNodeId} is null
      and ${table.includeDescendants} is null
    ) or (
      ${table.nodeType} = 'BANK'
      and ${table.groupPresentation} is null
      and (
        (${table.targetMode} = 'ALL_PACKAGE_QUESTIONS' and ${table.taxonomyNodeId} is null and ${table.includeDescendants} is null)
        or
        (${table.targetMode} = 'TAXONOMY_FILTER' and ${table.packageId} is not null and ${table.taxonomyNodeId} is not null and ${table.includeDescendants} in (0,1))
      )
    )`),
  ],
);

export type ChangeSetRow = typeof changeSets.$inferSelect;
export type ChangeSetItemRow = typeof changeSetItems.$inferSelect;
export type ChangeSetEventRow = typeof changeSetEvents.$inferSelect;
export type PublicationRow = typeof publications.$inferSelect;
export type PublicationItemRow = typeof publicationItems.$inferSelect;
export type QuestionPackageInspectionRow =
  typeof questionPackageInspections.$inferSelect;
export type QuestionPackageRow = typeof questionPackages.$inferSelect;
export type QuestionTaxonomyNodeRow = typeof questionTaxonomyNodes.$inferSelect;
export type QuestionBankBrowseNodeRow = typeof questionBankBrowseNodes.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type QuestionVariantRow = typeof questionVariants.$inferSelect;
export type QuestionOccurrenceRow = typeof questionOccurrences.$inferSelect;
export type QuestionTaxonomyAssignmentRow =
  typeof questionTaxonomyAssignments.$inferSelect;
export type QuestionPackageAssetBindingRow =
  typeof questionPackageAssetBindings.$inferSelect;
export type MaterialQuestionBankLayoutRow =
  typeof materialQuestionBankLayouts.$inferSelect;
export type MaterialQuestionBankNodeRow =
  typeof materialQuestionBankNodes.$inferSelect;
