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
import type {
  AIProviderRetentionPolicy,
  AIProviderTrainingPolicy,
} from "../ai/configuration/contracts";
import type {
  AIConversationFinishReason,
  AIConversationMessageRole,
  AIConversationResponseStatus,
  AIConversationSafeErrorCode,
  AIConversationStatus,
} from "../ai/conversations/contracts";
import type { AIModelCapability } from "../ai/model-registry/contracts";
import type {
  AICircuitEventType,
  AICircuitStateName,
} from "../ai/circuit-breaker/contracts";
import type {
  AIAccountingActorType,
  AICostBasis,
  AICostCenter,
  AICostCompleteness,
  AICostOperationStatus,
  AIRateCardPriceComponent,
  AIRateCardPriceUnit,
} from "../ai/economics/contracts";
import type {
  AIBudgetLedgerEventType,
  AIBudgetReservationStatus,
} from "../ai/budget/contracts";
import type {
  AIJobAttemptOutcome,
  AIJobPriority,
  AIJobStatus,
} from "../ai/operations/jobs/contracts";
import type { AIOutboxStatus } from "../ai/operations/outbox/contracts";
import type { AIProviderAttemptStatus } from "../ai/gateway/contracts";
import type { AIRateLimitEventOutcome } from "../ai/rate-limits/contracts";
import type {
  AISecretAuditActorType,
  AISecretAuditEventType,
  AISecretAuditOutcome,
  AISecretStatus,
} from "../ai/secrets/contracts";

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

/** Private Student conversation tombstone; authentication truth remains outside this domain. */
export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: text("id").primaryKey(),
    principalRef: text("principal_ref").notNull(),
    subjectKey: text("subject_key").notNull().references(() => canonicalMaterials.subjectKey, { onDelete: "restrict" }),
    status: text("status").$type<AIConversationStatus>().notNull().default("ACTIVE"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastActivityAt: integer("last_activity_at").notNull(),
    deletedAt: integer("deleted_at"),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("ai_conversations_identity_unique").on(table.id, table.principalRef),
    index("ai_conversations_principal_activity_index").on(table.principalRef, table.status, table.lastActivityAt, table.id),
    index("ai_conversations_subject_index").on(table.subjectKey, table.status, table.lastActivityAt),
    check("ai_conversations_principal_valid", sql`length(trim(${table.principalRef})) between 1 and 200 and ${table.principalRef} not glob '*[^A-Za-z0-9_-]*'`),
    check("ai_conversations_subject_valid", sql`length(trim(${table.subjectKey})) between 1 and 80 and ${table.subjectKey} not glob '*[^a-z0-9-]*'`),
    check("ai_conversations_status_valid", sql`${table.status} in ('ACTIVE','DELETED')`),
    check("ai_conversations_revision_positive", sql`${table.revision} >= 1`),
    check("ai_conversations_created_nonnegative", sql`${table.createdAt} >= 0`),
    check("ai_conversations_updated_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
    check("ai_conversations_activity_ordered", sql`${table.lastActivityAt} >= ${table.createdAt}`),
    check("ai_conversations_deleted_consistent", sql`(${table.status} = 'ACTIVE' and ${table.deletedAt} is null) or (${table.status} = 'DELETED' and ${table.deletedAt} is not null and ${table.deletedAt} >= ${table.createdAt})`),
  ],
);

/** Immutable private Conversation messages; raw C4 text is intentionally isolated here. */
export const aiConversationMessages = sqliteTable(
  "ai_conversation_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    role: text("role").$type<AIConversationMessageRole>().notNull(),
    content: text("content").notNull(),
    isPartial: integer("is_partial", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_conversation_messages_ordinal_unique").on(table.conversationId, table.ordinal),
    index("ai_conversation_messages_conversation_index").on(table.conversationId, table.ordinal),
    check("ai_conversation_messages_ordinal_positive", sql`${table.ordinal} >= 1`),
    check("ai_conversation_messages_role_valid", sql`${table.role} in ('USER','ASSISTANT')`),
    check("ai_conversation_messages_content_valid", sql`length(cast(${table.content} as blob)) between 1 and 524288`),
    check("ai_conversation_messages_partial_boolean", sql`${table.isPartial} in (0,1)`),
    check("ai_conversation_messages_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** Product-level response identity and durable streaming lifecycle. */
export const aiConversationResponses = sqliteTable(
  "ai_conversation_responses",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    principalRef: text("principal_ref").notNull(),
    idempotencyKey: text("idempotency_key"),
    requestFingerprint: text("request_fingerprint"),
    requestMessageId: text("request_message_id").references(() => aiConversationMessages.id, { onDelete: "restrict" }),
    assistantMessageId: text("assistant_message_id").references(() => aiConversationMessages.id, { onDelete: "restrict" }),
    status: text("status").$type<AIConversationResponseStatus>().notNull(),
    nextChunkSequence: integer("next_chunk_sequence").notNull().default(0),
    outputBytes: integer("output_bytes").notNull().default(0),
    finishReason: text("finish_reason").$type<AIConversationFinishReason>(),
    safeErrorCode: text("safe_error_code").$type<AIConversationSafeErrorCode>(),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_conversation_responses_principal_idempotency_unique").on(table.principalRef, table.idempotencyKey),
    uniqueIndex("ai_conversation_responses_one_active_unique").on(table.conversationId).where(sql`${table.status} in ('PENDING','STREAMING')`),
    index("ai_conversation_responses_conversation_index").on(table.conversationId, table.createdAt),
    index("ai_conversation_responses_principal_index").on(table.principalRef, table.createdAt),
    foreignKey({
      columns: [table.conversationId, table.principalRef],
      foreignColumns: [aiConversations.id, aiConversations.principalRef],
      name: "ai_conversation_responses_owner_conversation_fk",
    }).onDelete("restrict"),
    check("ai_conversation_responses_principal_valid", sql`length(trim(${table.principalRef})) between 1 and 200 and ${table.principalRef} not glob '*[^A-Za-z0-9_-]*'`),
    check("ai_conversation_responses_idempotency_valid", sql`${table.idempotencyKey} is null or length(trim(${table.idempotencyKey})) between 1 and 200`),
    check("ai_conversation_responses_fingerprint_valid", sql`${table.requestFingerprint} is null or (length(${table.requestFingerprint}) = 64 and ${table.requestFingerprint} not glob '*[^0-9a-f]*')`),
    check("ai_conversation_responses_status_valid", sql`${table.status} in ('PENDING','STREAMING','COMPLETED','FAILED','CANCELLED')`),
    check("ai_conversation_responses_sequence_valid", sql`${table.nextChunkSequence} between 0 and 100000000`),
    check("ai_conversation_responses_output_bytes_valid", sql`${table.outputBytes} between 0 and 524288`),
    check("ai_conversation_responses_finish_reason_valid", sql`${table.finishReason} is null or ${table.finishReason} in ('STOP','LENGTH','CONTENT_FILTER','OTHER','FAILED','CANCELLED')`),
    check("ai_conversation_responses_error_code_valid", sql`${table.safeErrorCode} is null or ${table.safeErrorCode} in ('AI_CONVERSATION_RESPONSE_INVALID','AI_CONVERSATION_STREAM_CONFLICT','AI_CONVERSATION_CANCELLED','AI_CONVERSATION_DELETED','AI_CONVERSATION_INTERNAL')`),
    check("ai_conversation_responses_created_nonnegative", sql`${table.createdAt} >= 0`),
    check("ai_conversation_responses_updated_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
    check("ai_conversation_responses_started_ordered", sql`${table.startedAt} is null or ${table.startedAt} >= ${table.createdAt}`),
    check("ai_conversation_responses_completed_ordered", sql`${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt}`),
  ],
);

/** Temporary private response chunks; successful terminalization removes these rows. */
export const aiConversationResponseChunks = sqliteTable(
  "ai_conversation_response_chunks",
  {
    responseId: text("response_id").notNull().references(() => aiConversationResponses.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.responseId, table.sequence] }),
    index("ai_conversation_response_chunks_response_index").on(table.responseId, table.sequence),
    check("ai_conversation_response_chunks_sequence_valid", sql`${table.sequence} between 0 and 100000000`),
    check("ai_conversation_response_chunks_text_valid", sql`length(cast(${table.text} as blob)) between 1 and 16384`),
    check("ai_conversation_response_chunks_hash_valid", sql`length(${table.textHash}) = 64 and ${table.textHash} not glob '*[^0-9a-f]*'`),
    check("ai_conversation_response_chunks_byte_length_valid", sql`${table.byteLength} = length(cast(${table.text} as blob)) and ${table.byteLength} between 1 and 16384`),
    check("ai_conversation_response_chunks_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

export type CanonicalContentStateRow = typeof canonicalContentState.$inferSelect;
export type CanonicalBannerRow = typeof canonicalBanners.$inferSelect;
export type CanonicalMaterialRow = typeof canonicalMaterials.$inferSelect;
export type CanonicalMaterialSettingsRow = typeof canonicalMaterialSettings.$inferSelect;
export type CanonicalToolRow = typeof canonicalTools.$inferSelect;
export type CanonicalNavigationRow = typeof canonicalNavigation.$inferSelect;
export type CanonicalCarouselSettingsRow = typeof canonicalCarouselSettings.$inferSelect;
export type AIConversationRow = typeof aiConversations.$inferSelect;
export type AIConversationMessageRow = typeof aiConversationMessages.$inferSelect;
export type AIConversationResponseRow = typeof aiConversationResponses.$inferSelect;
export type AIConversationResponseChunkRow = typeof aiConversationResponseChunks.$inferSelect;

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
export type QuestionSearchSegmentType = "PRIMARY_VARIANT" | "ALTERNATE_VARIANT" | "ANSWER" | "TAXONOMY" | "PROVENANCE";

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

/**
 * Rebuildable, non-canonical search projection metadata. The matching text is
 * deliberately stored separately from educational Question/Variant records.
 * FTS5 rows are created by migration 0009 and are kept in sync by the search
 * projection service, never by application startup.
 */
export const questionSearchDocuments = sqliteTable(
  "question_search_documents",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    packageId: text("package_id")
      .notNull()
      .references(() => questionPackages.id, { onDelete: "cascade" }),
    segmentType: text("segment_type").$type<QuestionSearchSegmentType>().notNull(),
    variantId: text("variant_id").references(() => questionVariants.id, { onDelete: "cascade" }),
    occurrenceId: text("occurrence_id").references(() => questionOccurrences.id, { onDelete: "cascade" }),
    /** Stable taxonomy-node identity or another internal segment source identity. */
    sourceRefId: text("source_ref_id"),
    normalizedText: text("normalized_text").notNull(),
    displayText: text("display_text").notNull(),
    indexVersion: integer("index_version").notNull(),
  },
  (table) => [
    index("question_search_documents_question_index").on(table.questionId, table.indexVersion),
    index("question_search_documents_package_index").on(table.packageId, table.indexVersion),
    index("question_search_documents_segment_index").on(table.segmentType, table.variantId, table.occurrenceId),
    check("question_search_documents_segment_valid", sql`${table.segmentType} in ('PRIMARY_VARIANT','ALTERNATE_VARIANT','ANSWER','TAXONOMY','PROVENANCE')`),
    check("question_search_documents_version_positive", sql`${table.indexVersion} >= 1`),
  ],
);

/** Safe operational pointer to encrypted material stored outside SQLite. */
export const aiSecretRefs = sqliteTable(
  "ai_secret_refs",
  {
    credentialRef: text("credential_ref").primaryKey(),
    status: text("status").$type<AISecretStatus>().notNull().default("ACTIVE"),
    secretVersion: integer("secret_version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    rotatedAt: integer("rotated_at"),
    revokedAt: integer("revoked_at"),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    index("ai_secret_refs_status_index").on(table.status),
    check(
      "ai_secret_refs_credential_ref_valid",
      sql`length(${table.credentialRef}) = 36 and ${table.credentialRef} not glob '*[^0-9a-f-]*'`,
    ),
    check("ai_secret_refs_status_valid", sql`${table.status} in ('ACTIVE','REVOKED')`),
    check("ai_secret_refs_version_positive", sql`${table.secretVersion} >= 1`),
    check("ai_secret_refs_revision_positive", sql`${table.revision} >= 1`),
    check(
      "ai_secret_refs_rotated_at_valid",
      sql`${table.rotatedAt} is null or ${table.rotatedAt} >= ${table.createdAt}`,
    ),
    check(
      "ai_secret_refs_revoked_at_valid",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
    check("ai_secret_refs_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

/** Safe, governed AI Provider configuration. Secret material is never stored here. */
export const aiProviderConfigs = sqliteTable(
  "ai_provider_configs",
  {
    id: text("id").primaryKey(),
    key: text("provider_key").notNull(),
    displayName: text("display_name").notNull(),
    baseUrl: text("base_url").notNull(),
    credentialRef: text("credential_ref").references(() => aiSecretRefs.credentialRef, {
      onDelete: "restrict",
    }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    retentionPolicy: text("retention_policy")
      .$type<AIProviderRetentionPolicy>()
      .notNull(),
    trainingPolicy: text("training_policy")
      .$type<AIProviderTrainingPolicy>()
      .notNull(),
    zdrSupported: integer("zdr_supported", { mode: "boolean" }).notNull().default(false),
    zdrRequired: integer("zdr_required", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("ai_provider_configs_key_unique").on(table.key),
    index("ai_provider_configs_enabled_index").on(table.enabled),
    index("ai_provider_configs_credential_ref_index").on(table.credentialRef),
    check(
      "ai_provider_configs_key_valid",
      sql`length(trim(${table.key})) between 1 and 120 and ${table.key} not glob '*[^a-z0-9-]*'`,
    ),
    check(
      "ai_provider_configs_display_name_valid",
      sql`length(trim(${table.displayName})) between 1 and 200`,
    ),
    check(
      "ai_provider_configs_base_url_valid",
      sql`length(trim(${table.baseUrl})) between 1 and 2048`,
    ),
    check(
      "ai_provider_configs_credential_ref_valid",
      sql`${table.credentialRef} is null or (length(${table.credentialRef}) = 36 and ${table.credentialRef} not glob '*[^0-9a-f-]*')`,
    ),
    check("ai_provider_configs_enabled_boolean", sql`${table.enabled} in (0,1)`),
    check(
      "ai_provider_configs_retention_policy_valid",
      sql`${table.retentionPolicy} in ('UNKNOWN','ZERO_RETENTION','BOUNDED_RETENTION','PROVIDER_DEFINED')`,
    ),
    check(
      "ai_provider_configs_training_policy_valid",
      sql`${table.trainingPolicy} in ('UNKNOWN','NOT_USED_FOR_TRAINING','MAY_BE_USED','PROVIDER_DEFINED')`,
    ),
    check("ai_provider_configs_zdr_supported_boolean", sql`${table.zdrSupported} in (0,1)`),
    check("ai_provider_configs_zdr_required_boolean", sql`${table.zdrRequired} in (0,1)`),
    check("ai_provider_configs_revision_positive", sql`${table.revision} >= 1`),
    check(
      "ai_provider_configs_timestamps_ordered",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/** Safe, governed AI Model registry entry; provider credentials remain elsewhere. */
export const aiModelConfigs = sqliteTable(
  "ai_model_configs",
  {
    id: text("id").primaryKey(),
    key: text("model_key").notNull(),
    displayName: text("display_name").notNull(),
    providerConfigId: text("provider_config_id")
      .notNull()
      .references(() => aiProviderConfigs.id, { onDelete: "restrict" }),
    providerModelId: text("provider_model_id").notNull(),
    capability: text("capability").$type<AIModelCapability>().notNull(),
    adapterKey: text("adapter_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    contextWindowTokens: integer("context_window_tokens"),
    maxOutputTokens: integer("max_output_tokens"),
    embeddingDimensions: integer("embedding_dimensions"),
    supportsStreaming: integer("supports_streaming", { mode: "boolean" })
      .notNull()
      .default(false),
    supportsReasoning: integer("supports_reasoning", { mode: "boolean" })
      .notNull()
      .default(false),
    supportsStructuredOutput: integer("supports_structured_output", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    uniqueIndex("ai_model_configs_key_unique").on(table.key),
    index("ai_model_configs_provider_index").on(table.providerConfigId),
    index("ai_model_configs_capability_index").on(table.capability),
    index("ai_model_configs_enabled_index").on(table.enabled),
    index("ai_model_configs_adapter_index").on(table.adapterKey),
    check(
      "ai_model_configs_key_valid",
      sql`length(trim(${table.key})) between 1 and 120 and ${table.key} not glob '*[^a-z0-9-]*'`,
    ),
    check(
      "ai_model_configs_display_name_valid",
      sql`length(trim(${table.displayName})) between 1 and 200`,
    ),
    check(
      "ai_model_configs_provider_model_id_valid",
      sql`length(trim(${table.providerModelId})) between 1 and 200`,
    ),
    check(
      "ai_model_configs_capability_valid",
      sql`${table.capability} in ('GENERATION','EMBEDDING','RERANK')`,
    ),
    check(
      "ai_model_configs_adapter_key_valid",
      sql`length(trim(${table.adapterKey})) between 1 and 120 and ${table.adapterKey} not glob '*[^a-z0-9.-]*'`,
    ),
    check("ai_model_configs_enabled_boolean", sql`${table.enabled} in (0,1)`),
    check(
      "ai_model_configs_context_window_positive",
      sql`${table.contextWindowTokens} is null or ${table.contextWindowTokens} >= 1`,
    ),
    check(
      "ai_model_configs_max_output_positive",
      sql`${table.maxOutputTokens} is null or ${table.maxOutputTokens} >= 1`,
    ),
    check(
      "ai_model_configs_embedding_dimensions_positive",
      sql`${table.embeddingDimensions} is null or ${table.embeddingDimensions} >= 1`,
    ),
    check(
      "ai_model_configs_generation_limits_ordered",
      sql`${table.contextWindowTokens} is null or ${table.maxOutputTokens} is null or ${table.maxOutputTokens} <= ${table.contextWindowTokens}`,
    ),
    check(
      "ai_model_configs_capability_fields_valid",
      sql`(
        (${table.capability} = 'GENERATION') or
        (${table.contextWindowTokens} is null and ${table.maxOutputTokens} is null and ${table.supportsStreaming} = 0 and ${table.supportsReasoning} = 0 and ${table.supportsStructuredOutput} = 0)
      ) and (
        (${table.capability} = 'EMBEDDING') or ${table.embeddingDimensions} is null
      )`,
    ),
    check("ai_model_configs_streaming_boolean", sql`${table.supportsStreaming} in (0,1)`),
    check("ai_model_configs_reasoning_boolean", sql`${table.supportsReasoning} in (0,1)`),
    check(
      "ai_model_configs_structured_output_boolean",
      sql`${table.supportsStructuredOutput} in (0,1)`,
    ),
    check("ai_model_configs_revision_positive", sql`${table.revision} >= 1`),
    check(
      "ai_model_configs_timestamps_ordered",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/** Governed Circuit Breaker policy identity; behavior lives in immutable revisions. */
export const aiCircuitBreakerPolicies = sqliteTable(
  "ai_circuit_breaker_policies",
  {
    id: text("id").primaryKey(),
    key: text("policy_key").notNull(),
    currentRevision: integer("current_revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("ai_circuit_breaker_policies_key_unique").on(table.key),
    check("ai_circuit_breaker_policies_key_valid", sql`length(trim(${table.key})) between 1 and 120 and ${table.key} not glob '*[^a-z0-9.-]*'`),
    check("ai_circuit_breaker_policies_revision_positive", sql`${table.currentRevision} >= 1`),
    check("ai_circuit_breaker_policies_created_nonnegative", sql`${table.createdAt} >= 0`),
    check("ai_circuit_breaker_policies_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

/** Immutable Circuit Breaker behavior revision. */
export const aiCircuitBreakerPolicyRevisions = sqliteTable(
  "ai_circuit_breaker_policy_revisions",
  {
    id: text("id").primaryKey(),
    circuitPolicyId: text("circuit_policy_id").notNull().references(() => aiCircuitBreakerPolicies.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    displayName: text("display_name").notNull(),
    failureThreshold: integer("failure_threshold").notNull(),
    openDurationMs: integer("open_duration_ms").notNull(),
    halfOpenProbeLeaseMs: integer("half_open_probe_lease_ms").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
    createdBy: text("created_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("ai_circuit_breaker_policy_revisions_identity_unique").on(table.circuitPolicyId, table.revision),
    index("ai_circuit_breaker_policy_revisions_policy_index").on(table.circuitPolicyId, table.createdAt),
    check("ai_circuit_breaker_policy_revisions_revision_positive", sql`${table.revision} >= 1`),
    check("ai_circuit_breaker_policy_revisions_display_name_valid", sql`length(trim(${table.displayName})) between 1 and 200`),
    check("ai_circuit_breaker_policy_revisions_threshold_valid", sql`${table.failureThreshold} between 1 and 100`),
    check("ai_circuit_breaker_policy_revisions_open_duration_valid", sql`${table.openDurationMs} between 1000 and 86400000`),
    check("ai_circuit_breaker_policy_revisions_probe_lease_valid", sql`${table.halfOpenProbeLeaseMs} between 100 and 86400000`),
    check("ai_circuit_breaker_policy_revisions_enabled_boolean", sql`${table.enabled} in (0,1)`),
    check("ai_circuit_breaker_policy_revisions_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** Persistent state for one exact policy/model/provider/credential operational target. */
export const aiCircuitBreakerStates = sqliteTable(
  "ai_circuit_breaker_states",
  {
    id: text("id").primaryKey(),
    targetHash: text("target_hash").notNull(),
    policyId: text("policy_id").notNull().references(() => aiCircuitBreakerPolicies.id, { onDelete: "restrict" }),
    policyRevision: integer("policy_revision").notNull(),
    modelConfigId: text("model_config_id").notNull().references(() => aiModelConfigs.id, { onDelete: "restrict" }),
    modelConfigRevision: integer("model_config_revision").notNull(),
    providerConfigId: text("provider_config_id").notNull().references(() => aiProviderConfigs.id, { onDelete: "restrict" }),
    providerConfigRevision: integer("provider_config_revision").notNull(),
    capability: text("capability").$type<AIModelCapability>().notNull(),
    adapterKey: text("adapter_key").notNull(),
    secretVersion: integer("secret_version").notNull(),
    state: text("state").$type<AICircuitStateName>().notNull(),
    stateGeneration: integer("state_generation").notNull(),
    consecutiveFailures: integer("consecutive_failures").notNull(),
    openedAt: integer("opened_at"),
    openUntil: integer("open_until"),
    probeOwner: text("probe_owner"),
    probeToken: text("probe_token"),
    probeExpiresAt: integer("probe_expires_at"),
    lastSuccessAt: integer("last_success_at"),
    lastFailureAt: integer("last_failure_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_circuit_breaker_states_target_hash_unique").on(table.targetHash),
    index("ai_circuit_breaker_states_provider_state_index").on(table.providerConfigId, table.state, table.updatedAt),
    index("ai_circuit_breaker_states_model_state_index").on(table.modelConfigId, table.state, table.updatedAt),
    index("ai_circuit_breaker_states_policy_index").on(table.policyId, table.policyRevision),
    check("ai_circuit_breaker_states_target_hash_valid", sql`length(${table.targetHash}) = 64 and ${table.targetHash} not glob '*[^0-9a-f]*'`),
    check("ai_circuit_breaker_states_policy_revision_positive", sql`${table.policyRevision} >= 1`),
    check("ai_circuit_breaker_states_model_revision_positive", sql`${table.modelConfigRevision} >= 1`),
    check("ai_circuit_breaker_states_provider_revision_positive", sql`${table.providerConfigRevision} >= 1`),
    check("ai_circuit_breaker_states_capability_valid", sql`${table.capability} in ('GENERATION','EMBEDDING','RERANK')`),
    check("ai_circuit_breaker_states_adapter_key_valid", sql`length(trim(${table.adapterKey})) between 1 and 120 and ${table.adapterKey} not glob '*[^a-z0-9.-]*'`),
    check("ai_circuit_breaker_states_secret_version_positive", sql`${table.secretVersion} >= 1`),
    check("ai_circuit_breaker_states_state_valid", sql`${table.state} in ('CLOSED','OPEN','HALF_OPEN')`),
    check("ai_circuit_breaker_states_generation_valid", sql`${table.stateGeneration} between 1 and 1000000000`),
    check("ai_circuit_breaker_states_failure_count_valid", sql`${table.consecutiveFailures} between 0 and 1000000`),
    check("ai_circuit_breaker_states_created_nonnegative", sql`${table.createdAt} >= 0`),
    check("ai_circuit_breaker_states_updated_nonnegative", sql`${table.updatedAt} >= ${table.createdAt}`),
    check("ai_circuit_breaker_states_opened_nonnegative", sql`${table.openedAt} is null or ${table.openedAt} >= 0`),
    check("ai_circuit_breaker_states_open_until_nonnegative", sql`${table.openUntil} is null or ${table.openUntil} >= 0`),
    check("ai_circuit_breaker_states_probe_expires_nonnegative", sql`${table.probeExpiresAt} is null or ${table.probeExpiresAt} >= 0`),
    check("ai_circuit_breaker_states_last_success_nonnegative", sql`${table.lastSuccessAt} is null or ${table.lastSuccessAt} >= 0`),
    check("ai_circuit_breaker_states_last_failure_nonnegative", sql`${table.lastFailureAt} is null or ${table.lastFailureAt} >= 0`),
    check("ai_circuit_breaker_states_probe_owner_valid", sql`${table.probeOwner} is null or length(trim(${table.probeOwner})) between 1 and 200`),
    check("ai_circuit_breaker_states_probe_token_valid", sql`${table.probeToken} is null or length(trim(${table.probeToken})) between 1 and 200`),
    check("ai_circuit_breaker_states_error_valid", sql`${table.lastErrorCode} is null or ${table.lastErrorCode} in ('RATE_LIMITED','TIMEOUT','UNAVAILABLE','BAD_RESPONSE','UNKNOWN','AUTHENTICATION')`),
    check("ai_circuit_breaker_states_fields_valid", sql`
      (${table.state} = 'CLOSED' and ${table.openedAt} is null and ${table.openUntil} is null and ${table.probeOwner} is null and ${table.probeToken} is null and ${table.probeExpiresAt} is null) or
      (${table.state} = 'OPEN' and ${table.openedAt} is not null and ${table.openUntil} is not null and ${table.openUntil} >= ${table.openedAt} and ${table.probeOwner} is null and ${table.probeToken} is null and ${table.probeExpiresAt} is null) or
      (${table.state} = 'HALF_OPEN' and ${table.openedAt} is not null and ${table.openUntil} is null and ${table.probeOwner} is not null and ${table.probeToken} is not null and ${table.probeExpiresAt} is not null)
    `),
  ],
);

/** Append-only safe passive-health transition history; probe tokens are never stored here. */
export const aiCircuitBreakerEvents = sqliteTable(
  "ai_circuit_breaker_events",
  {
    id: text("id").primaryKey(),
    targetHash: text("target_hash").notNull().references(() => aiCircuitBreakerStates.targetHash, { onDelete: "restrict" }),
    stateGeneration: integer("state_generation").notNull(),
    eventType: text("event_type").$type<AICircuitEventType>().notNull(),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("ai_circuit_breaker_events_target_time_index").on(table.targetHash, table.createdAt),
    index("ai_circuit_breaker_events_time_index").on(table.createdAt),
    check("ai_circuit_breaker_events_target_hash_valid", sql`length(${table.targetHash}) = 64 and ${table.targetHash} not glob '*[^0-9a-f]*'`),
    check("ai_circuit_breaker_events_generation_valid", sql`${table.stateGeneration} >= 1`),
    check("ai_circuit_breaker_events_type_valid", sql`${table.eventType} in ('FAILURE_COUNTED','OPENED','AUTHENTICATION_OPENED','HALF_OPEN_PROBE_GRANTED','HALF_OPEN_PROBE_RECLAIMED','HALF_OPEN_PROBE_RELEASED','CLOSED')`),
    check("ai_circuit_breaker_events_error_valid", sql`${table.errorCode} is null or ${table.errorCode} in ('RATE_LIMITED','TIMEOUT','UNAVAILABLE','BAD_RESPONSE','UNKNOWN','AUTHENTICATION')`),
    check("ai_circuit_breaker_events_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** Append-only safe audit metadata; no ciphertext or secret payload is stored. */
export const aiSecretAuditEvents = sqliteTable(
  "ai_secret_audit_events",
  {
    id: text("id").primaryKey(),
    credentialRef: text("credential_ref")
      .notNull()
      .references(() => aiSecretRefs.credentialRef, { onDelete: "restrict" }),
    eventType: text("event_type").$type<AISecretAuditEventType>().notNull(),
    secretVersion: integer("secret_version"),
    actorType: text("actor_type").$type<AISecretAuditActorType>().notNull(),
    actorUserId: text("actor_user_id").references(() => adminUsers.id, {
      onDelete: "restrict",
    }),
    outcome: text("outcome").$type<AISecretAuditOutcome>().notNull(),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("ai_secret_audit_events_credential_time_index").on(
      table.credentialRef,
      table.createdAt,
    ),
    index("ai_secret_audit_events_actor_index").on(table.actorUserId),
    check(
      "ai_secret_audit_events_type_valid",
      sql`${table.eventType} in ('CREATED','RESOLVED','ROTATED','REVOKED','RESOLVE_FAILED')`,
    ),
    check(
      "ai_secret_audit_events_version_valid",
      sql`${table.secretVersion} is null or ${table.secretVersion} >= 1`,
    ),
    check(
      "ai_secret_audit_events_actor_type_valid",
      sql`${table.actorType} in ('ADMIN','SYSTEM')`,
    ),
    check(
      "ai_secret_audit_events_outcome_valid",
      sql`${table.outcome} in ('SUCCESS','FAILURE')`,
    ),
    check(
      "ai_secret_audit_events_error_code_valid",
      sql`${table.errorCode} is null or length(trim(${table.errorCode})) between 1 and 120`,
    ),
  ],
);

/** Stable Rate Card identity; its pricing lives in immutable revision rows. */
export const aiRateCards = sqliteTable(
  "ai_rate_cards",
  {
    id: text("id").primaryKey(),
    key: text("rate_card_key").notNull(),
    currentRevision: integer("current_revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("ai_rate_cards_key_unique").on(table.key),
    index("ai_rate_cards_updated_at_index").on(table.updatedAt),
    check(
      "ai_rate_cards_key_valid",
      sql`length(trim(${table.key})) between 1 and 120 and ${table.key} not glob '*[^a-z0-9.-]*'`,
    ),
    check("ai_rate_cards_revision_positive", sql`${table.currentRevision} >= 1`),
    check(
      "ai_rate_cards_timestamps_ordered",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/** Immutable pricing definition for one Rate Card revision. */
export const aiRateCardRevisions = sqliteTable(
  "ai_rate_card_revisions",
  {
    id: text("id").primaryKey(),
    rateCardId: text("rate_card_id")
      .notNull()
      .references(() => aiRateCards.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    displayName: text("display_name").notNull(),
    modelConfigId: text("model_config_id")
      .notNull()
      .references(() => aiModelConfigs.id, { onDelete: "restrict" }),
    modelConfigRevision: integer("model_config_revision").notNull(),
    currency: text("currency").notNull(),
    billingUsageNormalizerKey: text("billing_usage_normalizer_key").notNull(),
    effectiveFrom: integer("effective_from").notNull(),
    effectiveTo: integer("effective_to"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("ai_rate_card_revisions_identity_unique").on(table.rateCardId, table.revision),
    index("ai_rate_card_revisions_target_index").on(
      table.modelConfigId,
      table.modelConfigRevision,
      table.currency,
      table.effectiveFrom,
    ),
    index("ai_rate_card_revisions_enabled_index").on(table.enabled),
    check("ai_rate_card_revisions_revision_positive", sql`${table.revision} >= 1`),
    check("ai_rate_card_revisions_model_revision_positive", sql`${table.modelConfigRevision} >= 1`),
    check(
      "ai_rate_card_revisions_currency_valid",
      sql`length(${table.currency}) = 3 and ${table.currency} not glob '*[^A-Z]*'`,
    ),
    check(
      "ai_rate_card_revisions_normalizer_key_valid",
      sql`length(trim(${table.billingUsageNormalizerKey})) between 1 and 120 and ${table.billingUsageNormalizerKey} not glob '*[^a-z0-9.-]*'`,
    ),
    check("ai_rate_card_revisions_effective_from_valid", sql`${table.effectiveFrom} >= 0`),
    check(
      "ai_rate_card_revisions_effective_window_valid",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
    check("ai_rate_card_revisions_enabled_boolean", sql`${table.enabled} in (0,1)`),
    check(
      "ai_rate_card_revisions_display_name_valid",
      sql`length(trim(${table.displayName})) between 1 and 200`,
    ),
  ],
);

/** Recurring local-time pricing bands; cross-midnight ranges are not representable. */
export const aiRateCardTimeBands = sqliteTable(
  "ai_rate_card_time_bands",
  {
    id: text("id").primaryKey(),
    rateCardRevisionId: text("rate_card_revision_id")
      .notNull()
      .references(() => aiRateCardRevisions.id, { onDelete: "restrict" }),
    timeZone: text("time_zone").notNull(),
    daysOfWeekMask: integer("days_of_week_mask").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
  },
  (table) => [
    index("ai_rate_card_time_bands_revision_index").on(table.rateCardRevisionId),
    check("ai_rate_card_time_bands_timezone_valid", sql`length(trim(${table.timeZone})) between 1 and 120`),
    check("ai_rate_card_time_bands_days_valid", sql`${table.daysOfWeekMask} between 1 and 127`),
    check("ai_rate_card_time_bands_start_valid", sql`${table.startMinute} between 0 and 1439`),
    check("ai_rate_card_time_bands_end_valid", sql`${table.endMinute} between 1 and 1440`),
    check("ai_rate_card_time_bands_ordered", sql`${table.startMinute} < ${table.endMinute}`),
  ],
);

/** Default and time-band price lines; the nullable band identity distinguishes their scope. */
export const aiRateCardPriceLines = sqliteTable(
  "ai_rate_card_price_lines",
  {
    id: text("id").primaryKey(),
    rateCardRevisionId: text("rate_card_revision_id")
      .notNull()
      .references(() => aiRateCardRevisions.id, { onDelete: "restrict" }),
    timeBandId: text("time_band_id").references(() => aiRateCardTimeBands.id, {
      onDelete: "restrict",
    }),
    component: text("component").$type<AIRateCardPriceComponent>().notNull(),
    unit: text("unit").$type<AIRateCardPriceUnit>().notNull(),
    amountNano: integer("amount_nano").notNull(),
  },
  (table) => [
    index("ai_rate_card_price_lines_revision_index").on(table.rateCardRevisionId),
    index("ai_rate_card_price_lines_band_index").on(table.timeBandId),
    check(
      "ai_rate_card_price_lines_component_valid",
      sql`${table.component} in ('STANDARD_INPUT','CACHE_HIT_INPUT','CACHE_MISS_INPUT','OUTPUT','REASONING','REQUEST')`,
    ),
    check(
      "ai_rate_card_price_lines_unit_valid",
      sql`${table.unit} in ('PER_MILLION_TOKENS','PER_REQUEST')`,
    ),
    check("ai_rate_card_price_lines_amount_valid", sql`${table.amountNano} between 0 and 9007199254740991`),
  ],
);

/** Higher-level accounting identity; it contains metadata only, never raw prompts or answers. */
export const aiCostOperations = sqliteTable(
  "ai_cost_operations",
  {
    id: text("id").primaryKey(),
    costCenter: text("cost_center").$type<AICostCenter>().notNull(),
    idempotencyKey: text("idempotency_key"),
    opaquePrincipalRef: text("opaque_principal_ref"),
    subjectKey: text("subject_key"),
    conversationId: text("conversation_id"),
    responseId: text("response_id"),
    jobId: text("job_id"),
    evalRunId: text("eval_run_id"),
    knowledgeRevision: integer("knowledge_revision"),
    status: text("status").$type<AICostOperationStatus>().notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("ai_cost_operations_cost_center_index").on(table.costCenter, table.startedAt),
    index("ai_cost_operations_status_index").on(table.status, table.startedAt),
    index("ai_cost_operations_subject_index").on(table.subjectKey, table.startedAt),
    index("ai_cost_operations_idempotency_index").on(table.idempotencyKey),
    check(
      "ai_cost_operations_cost_center_valid",
      sql`${table.costCenter} in ('STUDENT_GENERATION','KNOWLEDGE_INDEXING','AGENT_2','EVALS','EXPERIMENTS')`,
    ),
    check(
      "ai_cost_operations_status_valid",
      sql`${table.status} in ('OPEN','COMPLETED','FAILED','CANCELLED')`,
    ),
    check("ai_cost_operations_knowledge_revision_valid", sql`${table.knowledgeRevision} is null or ${table.knowledgeRevision} >= 1`),
    check("ai_cost_operations_started_nonnegative", sql`${table.startedAt} >= 0`),
    check(
      "ai_cost_operations_timestamps_ordered",
      sql`${table.completedAt} is null or ${table.completedAt} >= ${table.startedAt}`,
    ),
    check("ai_cost_operations_idempotency_length", sql`${table.idempotencyKey} is null or length(trim(${table.idempotencyKey})) between 1 and 200`),
    check("ai_cost_operations_principal_length", sql`${table.opaquePrincipalRef} is null or length(trim(${table.opaquePrincipalRef})) between 1 and 200`),
    check("ai_cost_operations_subject_length", sql`${table.subjectKey} is null or length(trim(${table.subjectKey})) between 1 and 120`),
    check("ai_cost_operations_conversation_length", sql`${table.conversationId} is null or length(trim(${table.conversationId})) between 1 and 120`),
    check("ai_cost_operations_response_length", sql`${table.responseId} is null or length(trim(${table.responseId})) between 1 and 120`),
    check("ai_cost_operations_job_length", sql`${table.jobId} is null or length(trim(${table.jobId})) between 1 and 120`),
    check("ai_cost_operations_eval_length", sql`${table.evalRunId} is null or length(trim(${table.evalRunId})) between 1 and 120`),
  ],
);

/** Immutable usage/cost observation for one provider attempt. */
export const aiUsageCostRecords = sqliteTable(
  "ai_usage_cost_records",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => aiCostOperations.id, { onDelete: "restrict" }),
    gatewayRequestId: text("gateway_request_id"),
    attemptIndex: integer("attempt_index"),
    capability: text("capability").$type<AIModelCapability>().notNull(),
    modelConfigId: text("model_config_id")
      .notNull()
      .references(() => aiModelConfigs.id, { onDelete: "restrict" }),
    modelConfigRevision: integer("model_config_revision").notNull(),
    providerConfigId: text("provider_config_id")
      .notNull()
      .references(() => aiProviderConfigs.id, { onDelete: "restrict" }),
    providerConfigRevision: integer("provider_config_revision").notNull(),
    providerRequestId: text("provider_request_id"),
    rateCardId: text("rate_card_id")
      .notNull()
      .references(() => aiRateCards.id, { onDelete: "restrict" }),
    rateCardRevision: integer("rate_card_revision").notNull(),
    rateCardRevisionId: text("rate_card_revision_id")
      .notNull()
      .references(() => aiRateCardRevisions.id, { onDelete: "restrict" }),
    resolvedPricingRule: text("resolved_pricing_rule").notNull(),
    normalizedInputTokens: integer("normalized_input_tokens"),
    normalizedCacheHitInputTokens: integer("normalized_cache_hit_input_tokens"),
    normalizedCacheMissInputTokens: integer("normalized_cache_miss_input_tokens"),
    normalizedOutputTokens: integer("normalized_output_tokens"),
    normalizedReasoningTokens: integer("normalized_reasoning_tokens"),
    billableStandardInputTokens: integer("billable_standard_input_tokens"),
    billableCacheHitInputTokens: integer("billable_cache_hit_input_tokens"),
    billableCacheMissInputTokens: integer("billable_cache_miss_input_tokens"),
    billableOutputTokens: integer("billable_output_tokens"),
    billableReasoningTokens: integer("billable_reasoning_tokens"),
    requestUnits: integer("request_units").notNull(),
    currency: text("currency").notNull(),
    knownCostNano: integer("known_cost_nano").notNull(),
    costCompleteness: text("cost_completeness").$type<AICostCompleteness>().notNull(),
    costBasis: text("cost_basis").$type<AICostBasis>().notNull(),
    attemptStatus: text("attempt_status").$type<AIProviderAttemptStatus>().notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    latencyMs: integer("latency_ms"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("ai_usage_cost_records_operation_index").on(table.operationId, table.createdAt),
    index("ai_usage_cost_records_gateway_index").on(table.gatewayRequestId),
    index("ai_usage_cost_records_model_index").on(table.modelConfigId, table.modelConfigRevision, table.createdAt),
    index("ai_usage_cost_records_provider_index").on(table.providerConfigId, table.createdAt),
    index("ai_usage_cost_records_currency_index").on(table.currency, table.createdAt),
    check("ai_usage_cost_records_attempt_index_valid", sql`${table.attemptIndex} is null or ${table.attemptIndex} >= 0`),
    check("ai_usage_cost_records_capability_valid", sql`${table.capability} in ('GENERATION','EMBEDDING','RERANK')`),
    check("ai_usage_cost_records_model_revision_positive", sql`${table.modelConfigRevision} >= 1`),
    check("ai_usage_cost_records_provider_revision_positive", sql`${table.providerConfigRevision} >= 1`),
    check("ai_usage_cost_records_rate_card_revision_positive", sql`${table.rateCardRevision} >= 1`),
    check("ai_usage_cost_records_gateway_length", sql`${table.gatewayRequestId} is null or length(trim(${table.gatewayRequestId})) between 1 and 120`),
    check("ai_usage_cost_records_provider_request_length", sql`${table.providerRequestId} is null or length(trim(${table.providerRequestId})) between 1 and 200`),
    check("ai_usage_cost_records_pricing_rule_length", sql`length(trim(${table.resolvedPricingRule})) between 1 and 200`),
    check("ai_usage_cost_records_currency_valid", sql`length(${table.currency}) = 3 and ${table.currency} not glob '*[^A-Z]*'`),
    check("ai_usage_cost_records_nonnegative_usage", sql`
      (${table.normalizedInputTokens} is null or ${table.normalizedInputTokens} >= 0) and
      (${table.normalizedCacheHitInputTokens} is null or ${table.normalizedCacheHitInputTokens} >= 0) and
      (${table.normalizedCacheMissInputTokens} is null or ${table.normalizedCacheMissInputTokens} >= 0) and
      (${table.normalizedOutputTokens} is null or ${table.normalizedOutputTokens} >= 0) and
      (${table.normalizedReasoningTokens} is null or ${table.normalizedReasoningTokens} >= 0) and
      (${table.billableStandardInputTokens} is null or ${table.billableStandardInputTokens} >= 0) and
      (${table.billableCacheHitInputTokens} is null or ${table.billableCacheHitInputTokens} >= 0) and
      (${table.billableCacheMissInputTokens} is null or ${table.billableCacheMissInputTokens} >= 0)
    `),
    check("ai_usage_cost_records_billable_output_nonnegative", sql`${table.billableOutputTokens} is null or ${table.billableOutputTokens} >= 0`),
    check("ai_usage_cost_records_billable_reasoning_nonnegative", sql`${table.billableReasoningTokens} is null or ${table.billableReasoningTokens} >= 0`),
    check("ai_usage_cost_records_request_units_valid", sql`${table.requestUnits} >= 0`),
    check("ai_usage_cost_records_known_cost_valid", sql`${table.knownCostNano} between 0 and 9007199254740991`),
    check("ai_usage_cost_records_completeness_valid", sql`${table.costCompleteness} in ('COMPLETE','PARTIAL')`),
    check("ai_usage_cost_records_basis_valid", sql`${table.costBasis} in ('RATE_CARD','PROVIDER_REPORTED')`),
    check("ai_usage_cost_records_status_valid", sql`${table.attemptStatus} in ('SUCCEEDED','FAILED','CANCELLED','TIMEOUT','SKIPPED')`),
    check("ai_usage_cost_records_started_nonnegative", sql`${table.startedAt} >= 0`),
    check("ai_usage_cost_records_completed_ordered", sql`${table.completedAt} is null or ${table.completedAt} >= ${table.startedAt}`),
    check("ai_usage_cost_records_latency_valid", sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`),
    check("ai_usage_cost_records_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** Append-only compensating correction; original usage/cost rows are never rewritten. */
export const aiCostCorrections = sqliteTable(
  "ai_cost_corrections",
  {
    id: text("id").primaryKey(),
    originalRecordId: text("original_record_id")
      .notNull()
      .references(() => aiUsageCostRecords.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    deltaCostNano: integer("delta_cost_nano").notNull(),
    reasonCode: text("reason_code").notNull(),
    actorType: text("actor_type").$type<AIAccountingActorType>().notNull(),
    actorUserId: text("actor_user_id").references(() => adminUsers.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("ai_cost_corrections_original_index").on(table.originalRecordId, table.createdAt),
    index("ai_cost_corrections_currency_index").on(table.currency, table.createdAt),
    check("ai_cost_corrections_currency_valid", sql`length(${table.currency}) = 3 and ${table.currency} not glob '*[^A-Z]*'`),
    check("ai_cost_corrections_delta_valid", sql`${table.deltaCostNano} between -9007199254740991 and 9007199254740991`),
    check("ai_cost_corrections_reason_valid", sql`length(trim(${table.reasonCode})) between 1 and 120 and ${table.reasonCode} not glob '*[^A-Z0-9_.-]*'`),
    check("ai_cost_corrections_actor_valid", sql`(${table.actorType} = 'SYSTEM' and ${table.actorUserId} is null) or (${table.actorType} = 'ADMIN' and ${table.actorUserId} is not null)`),
    check("ai_cost_corrections_actor_type_valid", sql`${table.actorType} in ('ADMIN','SYSTEM')`),
    check("ai_cost_corrections_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** Governed monetary allowance identity; its values live in immutable revisions. */
export const aiBudgetPolicies = sqliteTable(
  "ai_budget_policies",
  {
    id: text("id").primaryKey(),
    key: text("budget_policy_key").notNull(),
    currentRevision: integer("current_revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("ai_budget_policies_key_unique").on(table.key),
    index("ai_budget_policies_updated_at_index").on(table.updatedAt),
    check("ai_budget_policies_key_valid", sql`length(trim(${table.key})) between 1 and 120 and ${table.key} not glob '*[^a-z0-9.-]*'`),
    check("ai_budget_policies_revision_positive", sql`${table.currentRevision} >= 1`),
    check("ai_budget_policies_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

/** Immutable budget allowance revision; accounts pin one exact revision. */
export const aiBudgetPolicyRevisions = sqliteTable(
  "ai_budget_policy_revisions",
  {
    id: text("id").primaryKey(),
    budgetPolicyId: text("budget_policy_id").notNull().references(() => aiBudgetPolicies.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    displayName: text("display_name").notNull(),
    currency: text("currency").notNull(),
    costCenter: text("cost_center").$type<AICostCenter>().notNull(),
    hardCapNano: integer("hard_cap_nano").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    createdBy: text("created_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("ai_budget_policy_revisions_identity_unique").on(table.budgetPolicyId, table.revision),
    index("ai_budget_policy_revisions_enabled_index").on(table.enabled),
    check("ai_budget_policy_revisions_revision_positive", sql`${table.revision} >= 1`),
    check("ai_budget_policy_revisions_currency_valid", sql`length(${table.currency}) = 3 and ${table.currency} not glob '*[^A-Z]*'`),
    check("ai_budget_policy_revisions_cost_center_valid", sql`${table.costCenter} in ('STUDENT_GENERATION','KNOWLEDGE_INDEXING','AGENT_2','EVALS','EXPERIMENTS')`),
    check("ai_budget_policy_revisions_hard_cap_valid", sql`${table.hardCapNano} between 0 and 9007199254740991`),
    check("ai_budget_policy_revisions_enabled_boolean", sql`${table.enabled} in (0,1)`),
    check("ai_budget_policy_revisions_display_name_valid", sql`length(trim(${table.displayName})) between 1 and 200`),
    check("ai_budget_policy_revisions_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** Governed request-frequency policy identity; values live in immutable revisions. */
export const aiRateLimitPolicies = sqliteTable(
  "ai_rate_limit_policies",
  {
    id: text("id").primaryKey(),
    key: text("rate_limit_policy_key").notNull(),
    currentRevision: integer("current_revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("ai_rate_limit_policies_key_unique").on(table.key),
    index("ai_rate_limit_policies_updated_at_index").on(table.updatedAt),
    check("ai_rate_limit_policies_key_valid", sql`length(trim(${table.key})) between 1 and 120 and ${table.key} not glob '*[^a-z0-9.-]*'`),
    check("ai_rate_limit_policies_revision_positive", sql`${table.currentRevision} >= 1`),
    check("ai_rate_limit_policies_timestamps_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

/** Immutable request-frequency policy revision. */
export const aiRateLimitPolicyRevisions = sqliteTable(
  "ai_rate_limit_policy_revisions",
  {
    id: text("id").primaryKey(),
    rateLimitPolicyId: text("rate_limit_policy_id").notNull().references(() => aiRateLimitPolicies.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    displayName: text("display_name").notNull(),
    windowMs: integer("window_ms").notNull(),
    maxRequests: integer("max_requests").notNull(),
    maxConcurrentRequests: integer("max_concurrent_requests").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    createdBy: text("created_by").notNull().references(() => adminUsers.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("ai_rate_limit_policy_revisions_identity_unique").on(table.rateLimitPolicyId, table.revision),
    index("ai_rate_limit_policy_revisions_enabled_index").on(table.enabled),
    check("ai_rate_limit_policy_revisions_revision_positive", sql`${table.revision} >= 1`),
    check("ai_rate_limit_policy_revisions_window_positive", sql`${table.windowMs} >= 1`),
    check("ai_rate_limit_policy_revisions_requests_nonnegative", sql`${table.maxRequests} >= 0 and ${table.maxConcurrentRequests} >= 0`),
    check("ai_rate_limit_policy_revisions_enabled_boolean", sql`${table.enabled} in (0,1)`),
    check("ai_rate_limit_policy_revisions_display_name_valid", sql`length(trim(${table.displayName})) between 1 and 200`),
    check("ai_rate_limit_policy_revisions_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** Principal/period account with an immutable policy and hard-cap snapshot. */
export const aiBudgetAccounts = sqliteTable(
  "ai_budget_accounts",
  {
    id: text("id").primaryKey(),
    principalRef: text("principal_ref").notNull(),
    budgetPolicyId: text("budget_policy_id").notNull().references(() => aiBudgetPolicies.id, { onDelete: "restrict" }),
    budgetPolicyRevision: integer("budget_policy_revision").notNull(),
    currency: text("currency").notNull(),
    costCenter: text("cost_center").$type<AICostCenter>().notNull(),
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end").notNull(),
    hardCapNano: integer("hard_cap_nano").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_budget_accounts_identity_unique").on(table.principalRef, table.budgetPolicyId, table.budgetPolicyRevision, table.periodStart, table.periodEnd),
    uniqueIndex("ai_budget_accounts_stable_period_unique").on(table.principalRef, table.budgetPolicyId, table.periodStart, table.periodEnd),
    index("ai_budget_accounts_principal_period_index").on(table.principalRef, table.periodStart, table.periodEnd),
    index("ai_budget_accounts_policy_index").on(table.budgetPolicyId, table.budgetPolicyRevision),
    foreignKey({
      columns: [table.budgetPolicyId, table.budgetPolicyRevision],
      foreignColumns: [aiBudgetPolicyRevisions.budgetPolicyId, aiBudgetPolicyRevisions.revision],
      name: "ai_budget_accounts_policy_revision_fk",
    }),
    check("ai_budget_accounts_principal_valid", sql`length(trim(${table.principalRef})) between 1 and 200`),
    check("ai_budget_accounts_revision_positive", sql`${table.budgetPolicyRevision} >= 1`),
    check("ai_budget_accounts_currency_valid", sql`length(${table.currency}) = 3 and ${table.currency} not glob '*[^A-Z]*'`),
    check("ai_budget_accounts_cost_center_valid", sql`${table.costCenter} in ('STUDENT_GENERATION','KNOWLEDGE_INDEXING','AGENT_2','EVALS','EXPERIMENTS')`),
    check("ai_budget_accounts_period_valid", sql`${table.periodStart} >= 0 and ${table.periodEnd} > ${table.periodStart}`),
    check("ai_budget_accounts_hard_cap_valid", sql`${table.hardCapNano} between 0 and 9007199254740991`),
    check("ai_budget_accounts_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** One pre-execution financial reservation for one M3A cost operation. */
export const aiBudgetReservations = sqliteTable(
  "ai_budget_reservations",
  {
    id: text("id").primaryKey(),
    budgetAccountId: text("budget_account_id").notNull().references(() => aiBudgetAccounts.id, { onDelete: "restrict" }),
    operationId: text("operation_id").notNull().references(() => aiCostOperations.id, { onDelete: "restrict" }),
    principalRef: text("principal_ref").notNull(),
    rateLimitPolicyId: text("rate_limit_policy_id").notNull().references(() => aiRateLimitPolicies.id, { onDelete: "restrict" }),
    rateLimitPolicyRevision: integer("rate_limit_policy_revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    reservedNano: integer("reserved_nano").notNull(),
    status: text("status").$type<AIBudgetReservationStatus>().notNull(),
    createdAt: integer("created_at").notNull(),
    executionStartedAt: integer("execution_started_at"),
    finalizedAt: integer("finalized_at"),
    overageNano: integer("overage_nano"),
  },
  (table) => [
    uniqueIndex("ai_budget_reservations_operation_unique").on(table.operationId),
    uniqueIndex("ai_budget_reservations_principal_idempotency_unique").on(table.principalRef, table.idempotencyKey),
    index("ai_budget_reservations_account_status_index").on(table.budgetAccountId, table.status),
    index("ai_budget_reservations_concurrency_index").on(table.principalRef, table.rateLimitPolicyId, table.rateLimitPolicyRevision, table.status),
    foreignKey({
      columns: [table.rateLimitPolicyId, table.rateLimitPolicyRevision],
      foreignColumns: [aiRateLimitPolicyRevisions.rateLimitPolicyId, aiRateLimitPolicyRevisions.revision],
      name: "ai_budget_reservations_rate_limit_policy_revision_fk",
    }),
    check("ai_budget_reservations_principal_valid", sql`length(trim(${table.principalRef})) between 1 and 200`),
    check("ai_budget_reservations_policy_revision_positive", sql`${table.rateLimitPolicyRevision} >= 1`),
    check("ai_budget_reservations_idempotency_valid", sql`length(trim(${table.idempotencyKey})) between 1 and 200`),
    check("ai_budget_reservations_fingerprint_valid", sql`length(${table.requestFingerprint}) = 64 and ${table.requestFingerprint} not glob '*[^0-9a-f]*'`),
    check("ai_budget_reservations_amount_valid", sql`${table.reservedNano} between 0 and 9007199254740991`),
    check("ai_budget_reservations_status_valid", sql`${table.status} in ('RESERVED','EXECUTING','SETTLED','RELEASED','RECONCILIATION_REQUIRED')`),
    check("ai_budget_reservations_created_nonnegative", sql`${table.createdAt} >= 0`),
    check("ai_budget_reservations_execution_started_valid", sql`${table.executionStartedAt} is null or ${table.executionStartedAt} >= ${table.createdAt}`),
    check("ai_budget_reservations_finalized_valid", sql`${table.finalizedAt} is null or ${table.finalizedAt} >= ${table.createdAt}`),
    check("ai_budget_reservations_overage_valid", sql`${table.overageNano} is null or ${table.overageNano} between 0 and 9007199254740991`),
  ],
);

/** Durable top-level admission/rate-limit events, including budget denials. */
export const aiRateLimitEvents = sqliteTable(
  "ai_rate_limit_events",
  {
    id: text("id").primaryKey(),
    principalRef: text("principal_ref").notNull(),
    rateLimitPolicyId: text("rate_limit_policy_id").notNull().references(() => aiRateLimitPolicies.id, { onDelete: "restrict" }),
    rateLimitPolicyRevision: integer("rate_limit_policy_revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    operationId: text("operation_id").notNull().references(() => aiCostOperations.id, { onDelete: "restrict" }),
    reservationId: text("reservation_id").references(() => aiBudgetReservations.id, { onDelete: "restrict" }),
    outcome: text("outcome").$type<AIRateLimitEventOutcome>().notNull(),
    occurredAt: integer("occurred_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_rate_limit_events_principal_idempotency_unique").on(table.principalRef, table.idempotencyKey),
    index("ai_rate_limit_events_window_index").on(table.principalRef, table.rateLimitPolicyId, table.rateLimitPolicyRevision, table.occurredAt),
    index("ai_rate_limit_events_operation_index").on(table.operationId),
    foreignKey({
      columns: [table.rateLimitPolicyId, table.rateLimitPolicyRevision],
      foreignColumns: [aiRateLimitPolicyRevisions.rateLimitPolicyId, aiRateLimitPolicyRevisions.revision],
      name: "ai_rate_limit_events_policy_revision_fk",
    }),
    check("ai_rate_limit_events_principal_valid", sql`length(trim(${table.principalRef})) between 1 and 200`),
    check("ai_rate_limit_events_policy_revision_positive", sql`${table.rateLimitPolicyRevision} >= 1`),
    check("ai_rate_limit_events_idempotency_valid", sql`length(trim(${table.idempotencyKey})) between 1 and 200`),
    check("ai_rate_limit_events_fingerprint_valid", sql`length(${table.requestFingerprint}) = 64 and ${table.requestFingerprint} not glob '*[^0-9a-f]*'`),
    check("ai_rate_limit_events_outcome_valid", sql`${table.outcome} in ('ADMITTED','BUDGET_EXCEEDED','CONCURRENCY_LIMITED')`),
    check("ai_rate_limit_events_occurred_nonnegative", sql`${table.occurredAt} >= 0`),
  ],
);

/** Append-only lifecycle ledger; current spend remains derived from M3A plus active reservations. */
export const aiBudgetLedgerEntries = sqliteTable(
  "ai_budget_ledger_entries",
  {
    id: text("id").primaryKey(),
    budgetAccountId: text("budget_account_id").notNull().references(() => aiBudgetAccounts.id, { onDelete: "restrict" }),
    reservationId: text("reservation_id").notNull().references(() => aiBudgetReservations.id, { onDelete: "restrict" }),
    operationId: text("operation_id").notNull().references(() => aiCostOperations.id, { onDelete: "restrict" }),
    eventType: text("event_type").$type<AIBudgetLedgerEventType>().notNull(),
    amountNano: integer("amount_nano"),
    currency: text("currency").notNull(),
    reasonCode: text("reason_code"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("ai_budget_ledger_reservation_event_unique").on(table.reservationId, table.eventType),
    index("ai_budget_ledger_account_time_index").on(table.budgetAccountId, table.createdAt),
    index("ai_budget_ledger_operation_index").on(table.operationId, table.createdAt),
    check("ai_budget_ledger_event_type_valid", sql`${table.eventType} in ('RESERVED','EXECUTION_STARTED','RELEASED','SETTLED','RECONCILIATION_REQUIRED')`),
    check("ai_budget_ledger_amount_valid", sql`${table.amountNano} is null or ${table.amountNano} between 0 and 9007199254740991`),
    check("ai_budget_ledger_currency_valid", sql`length(${table.currency}) = 3 and ${table.currency} not glob '*[^A-Z]*'`),
    check("ai_budget_ledger_reason_valid", sql`${table.reasonCode} is null or (length(trim(${table.reasonCode})) between 1 and 120 and ${table.reasonCode} not glob '*[^A-Z0-9_.-]*')`),
    check("ai_budget_ledger_created_nonnegative", sql`${table.createdAt} >= 0`),
  ],
);

/** Durable, reference-only AI work item. Handler code is never selected from database data. */
export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payloadVersion: integer("payload_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    costCenter: text("cost_center").$type<AICostCenter>().notNull(),
    costOperationId: text("cost_operation_id").references(() => aiCostOperations.id, { onDelete: "restrict" }),
    priority: text("priority").$type<AIJobPriority>().notNull(),
    status: text("status").$type<AIJobStatus>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    leaseDurationMs: integer("lease_duration_ms").notNull(),
    backoffBaseMs: integer("backoff_base_ms").notNull(),
    backoffMaxMs: integer("backoff_max_ms").notNull(),
    scheduledAt: integer("scheduled_at").notNull(),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseGeneration: integer("lease_generation").notNull().default(0),
    leaseExpiresAt: integer("lease_expires_at"),
    lastHeartbeatAt: integer("last_heartbeat_at"),
    lastErrorCode: text("last_error_code"),
    cancellationRequestedAt: integer("cancellation_requested_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    uniqueIndex("ai_jobs_kind_dedupe_unique").on(table.kind, table.dedupeKey),
    index("ai_jobs_claim_index").on(table.status, table.scheduledAt, table.priority, table.createdAt),
    index("ai_jobs_lease_index").on(table.status, table.leaseExpiresAt),
    index("ai_jobs_cost_operation_index").on(table.costOperationId),
    check("ai_jobs_kind_valid", sql`length(trim(${table.kind})) between 1 and 120 and ${table.kind} not glob '*[^a-z0-9.-]*'`),
    check("ai_jobs_payload_version_valid", sql`${table.payloadVersion} between 1 and 100`),
    check("ai_jobs_payload_json_valid", sql`length(${table.payloadJson}) between 2 and 32768 and json_valid(${table.payloadJson}) and json_type(${table.payloadJson}) = 'object'`),
    check("ai_jobs_payload_hash_valid", sql`length(${table.payloadHash}) = 64 and ${table.payloadHash} not glob '*[^0-9a-f]*'`),
    check("ai_jobs_dedupe_key_valid", sql`length(trim(${table.dedupeKey})) between 1 and 240`),
    check("ai_jobs_cost_center_valid", sql`${table.costCenter} in ('STUDENT_GENERATION','KNOWLEDGE_INDEXING','AGENT_2','EVALS','EXPERIMENTS')`),
    check("ai_jobs_priority_valid", sql`${table.priority} in ('LOW','NORMAL','HIGH','CRITICAL')`),
    check("ai_jobs_status_valid", sql`${table.status} in ('PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','DEAD_LETTER','CANCELLED')`),
    check("ai_jobs_attempt_count_valid", sql`${table.attemptCount} between 0 and 100`),
    check("ai_jobs_max_attempts_valid", sql`${table.maxAttempts} between 1 and 100`),
    check("ai_jobs_timeout_valid", sql`${table.timeoutMs} between 1 and 86400000`),
    check("ai_jobs_lease_duration_valid", sql`${table.leaseDurationMs} between 100 and 86400000`),
    check("ai_jobs_backoff_valid", sql`${table.backoffBaseMs} between 0 and 86400000 and ${table.backoffMaxMs} between ${table.backoffBaseMs} and 86400000`),
    check("ai_jobs_scheduled_nonnegative", sql`${table.scheduledAt} >= 0`),
    check("ai_jobs_lease_generation_valid", sql`${table.leaseGeneration} >= 0`),
    check("ai_jobs_lease_owner_valid", sql`${table.leaseOwner} is null or length(trim(${table.leaseOwner})) between 1 and 200`),
    check("ai_jobs_lease_token_valid", sql`${table.leaseToken} is null or length(trim(${table.leaseToken})) between 1 and 200`),
    check("ai_jobs_last_error_valid", sql`${table.lastErrorCode} is null or length(trim(${table.lastErrorCode})) between 1 and 120`),
    check("ai_jobs_created_nonnegative", sql`${table.createdAt} >= 0`),
    check("ai_jobs_updated_ordered", sql`${table.updatedAt} >= ${table.createdAt}`),
    check("ai_jobs_completed_valid", sql`${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt}`),
    check("ai_jobs_lease_fields_valid", sql`(${table.status} = 'RUNNING' and ${table.leaseOwner} is not null and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null and ${table.lastHeartbeatAt} is not null and ${table.leaseGeneration} >= 1) or (${table.status} <> 'RUNNING' and ${table.leaseOwner} is null and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null and ${table.lastHeartbeatAt} is null)`),
  ],
);

/** Immutable execution history for a durable Job attempt. */
export const aiJobAttempts = sqliteTable(
  "ai_job_attempts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => aiJobs.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    workerId: text("worker_id").notNull(),
    leaseGeneration: integer("lease_generation").notNull(),
    startedAt: integer("started_at").notNull(),
    lastHeartbeatAt: integer("last_heartbeat_at"),
    completedAt: integer("completed_at"),
    outcome: text("outcome").$type<AIJobAttemptOutcome>().notNull(),
    safeErrorCode: text("safe_error_code"),
    retryScheduledAt: integer("retry_scheduled_at"),
  },
  (table) => [
    uniqueIndex("ai_job_attempts_job_number_unique").on(table.jobId, table.attemptNumber),
    index("ai_job_attempts_job_index").on(table.jobId, table.startedAt),
    check("ai_job_attempts_number_valid", sql`${table.attemptNumber} between 1 and 100`),
    check("ai_job_attempts_worker_valid", sql`length(trim(${table.workerId})) between 1 and 200`),
    check("ai_job_attempts_generation_valid", sql`${table.leaseGeneration} >= 1`),
    check("ai_job_attempts_started_nonnegative", sql`${table.startedAt} >= 0`),
    check("ai_job_attempts_heartbeat_valid", sql`${table.lastHeartbeatAt} is null or ${table.lastHeartbeatAt} >= ${table.startedAt}`),
    check("ai_job_attempts_completed_valid", sql`${table.completedAt} is null or ${table.completedAt} >= ${table.startedAt}`),
    check("ai_job_attempts_outcome_valid", sql`${table.outcome} in ('RUNNING','SUCCEEDED','RETRYABLE_FAILURE','NON_RETRYABLE_FAILURE','TIMED_OUT','LEASE_EXPIRED','CANCELLED')`),
    check("ai_job_attempts_error_valid", sql`${table.safeErrorCode} is null or length(trim(${table.safeErrorCode})) between 1 and 120`),
    check("ai_job_attempts_retry_time_valid", sql`${table.retryScheduledAt} is null or ${table.retryScheduledAt} >= ${table.startedAt}`),
  ],
);

/** Transactional durable dispatch intent; successful dispatch rows remain operational history. */
export const aiOutboxEvents = sqliteTable(
  "ai_outbox_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    payloadVersion: integer("payload_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").$type<AIOutboxStatus>().notNull(),
    scheduledAt: integer("scheduled_at").notNull(),
    dispatchedJobId: text("dispatched_job_id").references(() => aiJobs.id, { onDelete: "restrict" }),
    safeErrorCode: text("safe_error_code"),
    createdAt: integer("created_at").notNull(),
    dispatchedAt: integer("dispatched_at"),
  },
  (table) => [
    uniqueIndex("ai_outbox_events_type_dedupe_unique").on(table.eventType, table.dedupeKey),
    index("ai_outbox_events_dispatch_index").on(table.status, table.scheduledAt, table.createdAt),
    check("ai_outbox_events_type_valid", sql`length(trim(${table.eventType})) between 1 and 120 and ${table.eventType} not glob '*[^a-z0-9.-]*'`),
    check("ai_outbox_events_payload_version_valid", sql`${table.payloadVersion} between 1 and 100`),
    check("ai_outbox_events_payload_json_valid", sql`length(${table.payloadJson}) between 2 and 32768 and json_valid(${table.payloadJson}) and json_type(${table.payloadJson}) = 'object'`),
    check("ai_outbox_events_payload_hash_valid", sql`length(${table.payloadHash}) = 64 and ${table.payloadHash} not glob '*[^0-9a-f]*'`),
    check("ai_outbox_events_dedupe_key_valid", sql`length(trim(${table.dedupeKey})) between 1 and 240`),
    check("ai_outbox_events_status_valid", sql`${table.status} in ('PENDING','DISPATCHED','FAILED','CANCELLED')`),
    check("ai_outbox_events_scheduled_nonnegative", sql`${table.scheduledAt} >= 0`),
    check("ai_outbox_events_error_valid", sql`${table.safeErrorCode} is null or length(trim(${table.safeErrorCode})) between 1 and 120`),
    check("ai_outbox_events_created_nonnegative", sql`${table.createdAt} >= 0`),
    check("ai_outbox_events_dispatched_valid", sql`(${table.status} = 'DISPATCHED' and ${table.dispatchedJobId} is not null and ${table.dispatchedAt} is not null) or (${table.status} <> 'DISPATCHED' and ${table.dispatchedJobId} is null and ${table.dispatchedAt} is null)`),
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
export type QuestionSearchDocumentRow =
  typeof questionSearchDocuments.$inferSelect;
export type AIProviderConfigRow = typeof aiProviderConfigs.$inferSelect;
export type AIModelConfigRow = typeof aiModelConfigs.$inferSelect;
export type AICircuitBreakerPolicyRow = typeof aiCircuitBreakerPolicies.$inferSelect;
export type AICircuitBreakerPolicyRevisionRow = typeof aiCircuitBreakerPolicyRevisions.$inferSelect;
export type AICircuitBreakerStateRow = typeof aiCircuitBreakerStates.$inferSelect;
export type AICircuitBreakerEventRow = typeof aiCircuitBreakerEvents.$inferSelect;
export type AISecretRefRow = typeof aiSecretRefs.$inferSelect;
export type AISecretAuditEventRow = typeof aiSecretAuditEvents.$inferSelect;
export type AIRateCardRow = typeof aiRateCards.$inferSelect;
export type AIRateCardRevisionRow = typeof aiRateCardRevisions.$inferSelect;
export type AIRateCardTimeBandRow = typeof aiRateCardTimeBands.$inferSelect;
export type AIRateCardPriceLineRow = typeof aiRateCardPriceLines.$inferSelect;
export type AICostOperationRow = typeof aiCostOperations.$inferSelect;
export type AIUsageCostRecordRow = typeof aiUsageCostRecords.$inferSelect;
export type AICostCorrectionRow = typeof aiCostCorrections.$inferSelect;
export type AIBudgetPolicyRow = typeof aiBudgetPolicies.$inferSelect;
export type AIBudgetPolicyRevisionRow = typeof aiBudgetPolicyRevisions.$inferSelect;
export type AIRateLimitPolicyRow = typeof aiRateLimitPolicies.$inferSelect;
export type AIRateLimitPolicyRevisionRow = typeof aiRateLimitPolicyRevisions.$inferSelect;
export type AIBudgetAccountRow = typeof aiBudgetAccounts.$inferSelect;
export type AIBudgetReservationRow = typeof aiBudgetReservations.$inferSelect;
export type AIRateLimitEventRow = typeof aiRateLimitEvents.$inferSelect;
export type AIBudgetLedgerEntryRow = typeof aiBudgetLedgerEntries.$inferSelect;
export type AIJobRow = typeof aiJobs.$inferSelect;
export type AIJobAttemptRow = typeof aiJobAttempts.$inferSelect;
export type AIOutboxEventRow = typeof aiOutboxEvents.$inferSelect;
