PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_ref` text NOT NULL,
	`subject_key` text NOT NULL,
	`memory_policy_id` text NOT NULL,
	`memory_policy_revision` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`visibility_scope` text NOT NULL,
	`creation_origin` text NOT NULL,
	`source_conversation_id` text NOT NULL,
	`source_start_ordinal` integer NOT NULL,
	`source_end_ordinal` integer NOT NULL,
	`memory_text` text,
	`confidence_units` integer NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`deleted_at` integer,
	`expires_at` integer NOT NULL,
	`safe_review_code` text,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_policy_id`) REFERENCES `ai_memory_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_memories_principal_valid" CHECK(length(trim("__new_ai_memories"."principal_ref")) between 1 and 200 and "__new_ai_memories"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_memories_subject_valid" CHECK(length(trim("__new_ai_memories"."subject_key")) between 1 and 80 and "__new_ai_memories"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_memories_policy_revision_valid" CHECK("__new_ai_memories"."memory_policy_revision" >= 1),
	CONSTRAINT "ai_memories_revision_valid" CHECK("__new_ai_memories"."revision" >= 1),
	CONSTRAINT "ai_memories_status_valid" CHECK("__new_ai_memories"."status" in ('CANDIDATE','APPROVED','REJECTED','DELETED')),
	CONSTRAINT "ai_memories_visibility_valid" CHECK("__new_ai_memories"."visibility_scope" = 'PRINCIPAL_SUBJECT'),
	CONSTRAINT "ai_memories_origin_valid" CHECK("__new_ai_memories"."creation_origin" = 'CONVERSATION'),
	CONSTRAINT "ai_memories_source_range_valid" CHECK("__new_ai_memories"."source_start_ordinal" >= 1 and "__new_ai_memories"."source_end_ordinal" >= "__new_ai_memories"."source_start_ordinal" and "__new_ai_memories"."source_end_ordinal" - "__new_ai_memories"."source_start_ordinal" + 1 <= 10000),
	CONSTRAINT "ai_memories_text_valid" CHECK(("__new_ai_memories"."status" = 'DELETED' and "__new_ai_memories"."memory_text" is null) or ("__new_ai_memories"."status" <> 'DELETED' and "__new_ai_memories"."memory_text" is not null and length(cast("__new_ai_memories"."memory_text" as blob)) between 1 and 131072)),
	CONSTRAINT "ai_memories_confidence_valid" CHECK("__new_ai_memories"."confidence_units" between 0 and 1000000),
	CONSTRAINT "ai_memories_created_nonnegative" CHECK("__new_ai_memories"."created_at" >= 0),
	CONSTRAINT "ai_memories_reviewed_consistent" CHECK(("__new_ai_memories"."status" = 'CANDIDATE' and "__new_ai_memories"."reviewed_at" is null and "__new_ai_memories"."safe_review_code" is null) or ("__new_ai_memories"."status" = 'APPROVED' and "__new_ai_memories"."reviewed_at" is not null and "__new_ai_memories"."safe_review_code" = 'STUDENT_APPROVED') or ("__new_ai_memories"."status" = 'REJECTED' and "__new_ai_memories"."reviewed_at" is not null and "__new_ai_memories"."safe_review_code" = 'STUDENT_REJECTED') or ("__new_ai_memories"."status" = 'DELETED' and "__new_ai_memories"."deleted_at" is not null and "__new_ai_memories"."safe_review_code" in ('CONVERSATION_DELETED','PRINCIPAL_PURGED'))),
	CONSTRAINT "ai_memories_deleted_timestamp_valid" CHECK("__new_ai_memories"."deleted_at" is null or "__new_ai_memories"."deleted_at" >= "__new_ai_memories"."created_at"),
	CONSTRAINT "ai_memories_expiry_valid" CHECK("__new_ai_memories"."expires_at" > "__new_ai_memories"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_ai_memories`("id", "principal_ref", "subject_key", "memory_policy_id", "memory_policy_revision", "revision", "status", "visibility_scope", "creation_origin", "source_conversation_id", "source_start_ordinal", "source_end_ordinal", "memory_text", "confidence_units", "created_at", "reviewed_at", "deleted_at", "expires_at", "safe_review_code") SELECT "id", "principal_ref", "subject_key", "memory_policy_id", "memory_policy_revision", "revision", "status", "visibility_scope", "creation_origin", "source_conversation_id", "source_start_ordinal", "source_end_ordinal", "memory_text", "confidence_units", "created_at", "reviewed_at", "deleted_at", "expires_at", "safe_review_code" FROM `ai_memories`;--> statement-breakpoint
DROP TABLE `ai_memories`;--> statement-breakpoint
ALTER TABLE `__new_ai_memories` RENAME TO `ai_memories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_memories_principal_subject_index` ON `ai_memories` (`principal_ref`,`subject_key`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `ai_memories_source_conversation_index` ON `ai_memories` (`source_conversation_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_ai_conversation_summary_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`principal_ref` text NOT NULL,
	`subject_key` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`summary_text` text,
	`covers_through_ordinal` integer NOT NULL,
	`source_start_ordinal` integer NOT NULL,
	`source_end_ordinal` integer NOT NULL,
	`source_message_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	`safe_deletion_code` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_conversation_summary_revisions_principal_valid" CHECK(length(trim("__new_ai_conversation_summary_revisions"."principal_ref")) between 1 and 200 and "__new_ai_conversation_summary_revisions"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_conversation_summary_revisions_subject_valid" CHECK(length(trim("__new_ai_conversation_summary_revisions"."subject_key")) between 1 and 80 and "__new_ai_conversation_summary_revisions"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_conversation_summary_revisions_revision_positive" CHECK("__new_ai_conversation_summary_revisions"."revision" >= 1),
	CONSTRAINT "ai_conversation_summary_revisions_status_valid" CHECK("__new_ai_conversation_summary_revisions"."status" in ('ACTIVE','DELETED')),
	CONSTRAINT "ai_conversation_summary_revisions_text_valid" CHECK(("__new_ai_conversation_summary_revisions"."status" = 'DELETED' and "__new_ai_conversation_summary_revisions"."summary_text" is null) or ("__new_ai_conversation_summary_revisions"."status" = 'ACTIVE' and "__new_ai_conversation_summary_revisions"."summary_text" is not null and length(cast("__new_ai_conversation_summary_revisions"."summary_text" as blob)) between 1 and 131072)),
	CONSTRAINT "ai_conversation_summary_revisions_coverage_valid" CHECK("__new_ai_conversation_summary_revisions"."covers_through_ordinal" >= 1 and "__new_ai_conversation_summary_revisions"."source_start_ordinal" = 1 and "__new_ai_conversation_summary_revisions"."source_end_ordinal" = "__new_ai_conversation_summary_revisions"."covers_through_ordinal" and "__new_ai_conversation_summary_revisions"."source_message_count" = "__new_ai_conversation_summary_revisions"."covers_through_ordinal"),
	CONSTRAINT "ai_conversation_summary_revisions_created_nonnegative" CHECK("__new_ai_conversation_summary_revisions"."created_at" >= 0),
	CONSTRAINT "ai_conversation_summary_revisions_deleted_timestamp_valid" CHECK("__new_ai_conversation_summary_revisions"."deleted_at" is null or "__new_ai_conversation_summary_revisions"."deleted_at" >= "__new_ai_conversation_summary_revisions"."created_at"),
	CONSTRAINT "ai_conversation_summary_revisions_deletion_code_valid" CHECK(("__new_ai_conversation_summary_revisions"."status" = 'ACTIVE' and "__new_ai_conversation_summary_revisions"."safe_deletion_code" is null) or ("__new_ai_conversation_summary_revisions"."status" = 'DELETED' and "__new_ai_conversation_summary_revisions"."safe_deletion_code" in ('CONVERSATION_DELETED','PRINCIPAL_PURGED')))
);
--> statement-breakpoint
INSERT INTO `__new_ai_conversation_summary_revisions`("id", "conversation_id", "principal_ref", "subject_key", "revision", "status", "summary_text", "covers_through_ordinal", "source_start_ordinal", "source_end_ordinal", "source_message_count", "created_at", "deleted_at", "safe_deletion_code") SELECT "id", "conversation_id", "principal_ref", "subject_key", "revision", "status", "summary_text", "covers_through_ordinal", "source_start_ordinal", "source_end_ordinal", "source_message_count", "created_at", "deleted_at", CASE WHEN "status" = 'DELETED' THEN 'CONVERSATION_DELETED' ELSE NULL END FROM `ai_conversation_summary_revisions`;--> statement-breakpoint
DROP TABLE `ai_conversation_summary_revisions`;--> statement-breakpoint
ALTER TABLE `__new_ai_conversation_summary_revisions` RENAME TO `ai_conversation_summary_revisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_conversation_summary_revisions_identity_unique` ON `ai_conversation_summary_revisions` (`conversation_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_conversation_summary_revisions_conversation_index` ON `ai_conversation_summary_revisions` (`conversation_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_conversation_summary_revisions_principal_subject_index` ON `ai_conversation_summary_revisions` (`principal_ref`,`subject_key`,`status`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_insert_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_no_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_lifecycle_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_conversation_summary_revisions_insert_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_conversation_summary_revisions_no_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_conversation_summary_revisions_lifecycle_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_insert_valid`
BEFORE INSERT ON `ai_memories`
WHEN NEW.`status` <> 'CANDIDATE'
  OR NEW.`visibility_scope` <> 'PRINCIPAL_SUBJECT'
  OR NEW.`creation_origin` <> 'CONVERSATION'
  OR NEW.`reviewed_at` IS NOT NULL
  OR NEW.`deleted_at` IS NOT NULL
  OR NEW.`safe_review_code` IS NOT NULL
  OR NEW.`created_at` < 0
  OR NEW.`created_at` > 8640000000000000
  OR NEW.`expires_at` < 0
  OR NEW.`expires_at` > 8640000000000000
  OR NOT EXISTS (
	SELECT 1
	FROM `ai_memory_policies` policy
	JOIN `ai_memory_policy_revisions` policy_revision
	ON policy_revision.`memory_policy_id` = policy.`id`
	AND policy_revision.`revision` = NEW.`memory_policy_revision`
	WHERE policy.`id` = NEW.`memory_policy_id`
	AND policy.`subject_key` = NEW.`subject_key`
	AND policy.`current_revision` = NEW.`memory_policy_revision`
	AND policy_revision.`enabled` = 1
	AND NEW.`expires_at` = NEW.`created_at` + policy_revision.`retention_days` * 86400000
  )
  OR NOT EXISTS (
	SELECT 1 FROM `ai_conversations` conversation
	WHERE conversation.`id` = NEW.`source_conversation_id`
	AND conversation.`principal_ref` = NEW.`principal_ref`
	AND conversation.`subject_key` = NEW.`subject_key`
	AND conversation.`status` = 'ACTIVE'
  )
  OR (
	SELECT COUNT(*) FROM `ai_conversation_messages` message
	WHERE message.`conversation_id` = NEW.`source_conversation_id`
	AND message.`ordinal` BETWEEN NEW.`source_start_ordinal` AND NEW.`source_end_ordinal`
	) <> NEW.`source_end_ordinal` - NEW.`source_start_ordinal` + 1
  OR (
	SELECT COUNT(*) FROM `ai_conversation_messages` message
	WHERE message.`conversation_id` = NEW.`source_conversation_id`
	AND message.`ordinal` BETWEEN NEW.`source_start_ordinal` AND NEW.`source_end_ordinal`
	AND message.`is_partial` = 0
	) <> NEW.`source_end_ordinal` - NEW.`source_start_ordinal` + 1
  OR COALESCE((
	SELECT message.`role` FROM `ai_conversation_messages` message
	WHERE message.`conversation_id` = NEW.`source_conversation_id`
	AND message.`ordinal` = NEW.`source_end_ordinal`
	), '') <> 'ASSISTANT'
BEGIN
	SELECT RAISE(ABORT, 'AI Memory candidate ownership, retention, or source coverage is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_no_delete`
BEFORE DELETE ON `ai_memories`
BEGIN
	SELECT RAISE(ABORT, 'AI Memories are append-only records');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_lifecycle_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NOT (
	(
		OLD.`status` = 'CANDIDATE'
		AND NEW.`status` IN ('APPROVED','REJECTED')
		AND NEW.`reviewed_at` IS NOT NULL
		AND NEW.`reviewed_at` >= OLD.`created_at`
		AND NEW.`reviewed_at` <= 8640000000000000
		AND NEW.`deleted_at` IS NULL
		AND NEW.`safe_review_code` = CASE NEW.`status` WHEN 'APPROVED' THEN 'STUDENT_APPROVED' ELSE 'STUDENT_REJECTED' END
	)
	OR (
		OLD.`status` IN ('CANDIDATE','APPROVED','REJECTED')
		AND NEW.`status` = 'DELETED'
		AND NEW.`memory_text` IS NULL
		AND NEW.`deleted_at` IS NOT NULL
		AND NEW.`safe_review_code` = 'CONVERSATION_DELETED'
		AND EXISTS (
			SELECT 1 FROM `ai_conversations` conversation
			WHERE conversation.`id` = NEW.`source_conversation_id`
			AND conversation.`principal_ref` = NEW.`principal_ref`
			AND conversation.`status` = 'DELETED'
		)
	)
	OR (
		OLD.`status` IN ('CANDIDATE','APPROVED','REJECTED')
		AND NEW.`status` = 'DELETED'
		AND NEW.`memory_text` IS NULL
		AND NEW.`deleted_at` IS NOT NULL
		AND NEW.`safe_review_code` = 'PRINCIPAL_PURGED'
	)
)
OR NEW.`id` <> OLD.`id`
OR NEW.`principal_ref` <> OLD.`principal_ref`
OR NEW.`subject_key` <> OLD.`subject_key`
OR NEW.`memory_policy_id` <> OLD.`memory_policy_id`
OR NEW.`memory_policy_revision` <> OLD.`memory_policy_revision`
OR NEW.`revision` <> OLD.`revision`
OR NEW.`visibility_scope` <> OLD.`visibility_scope`
OR NEW.`creation_origin` <> OLD.`creation_origin`
OR NEW.`source_conversation_id` <> OLD.`source_conversation_id`
OR NEW.`source_start_ordinal` <> OLD.`source_start_ordinal`
OR NEW.`source_end_ordinal` <> OLD.`source_end_ordinal`
OR NEW.`confidence_units` <> OLD.`confidence_units`
OR NEW.`created_at` <> OLD.`created_at`
OR NEW.`expires_at` <> OLD.`expires_at`
OR (NEW.`reviewed_at` IS NOT NULL AND (NEW.`reviewed_at` < OLD.`created_at` OR NEW.`reviewed_at` > 8640000000000000))
OR (OLD.`status` = 'CANDIDATE' AND NEW.`status` IN ('APPROVED','REJECTED') AND OLD.`memory_text` <> NEW.`memory_text`)
OR (NEW.`status` = 'DELETED' AND OLD.`memory_text` IS NOT NULL AND NEW.`reviewed_at` IS NOT OLD.`reviewed_at`)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory lifecycle or immutable content mutation is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_conversation_summary_revisions_insert_valid`
BEFORE INSERT ON `ai_conversation_summary_revisions`
WHEN NEW.`status` <> 'ACTIVE'
  OR NEW.`summary_text` IS NULL
  OR NEW.`deleted_at` IS NOT NULL
  OR NEW.`safe_deletion_code` IS NOT NULL
  OR NOT EXISTS (
	SELECT 1 FROM `ai_conversations` conversation
	WHERE conversation.`id` = NEW.`conversation_id`
	AND conversation.`principal_ref` = NEW.`principal_ref`
	AND conversation.`subject_key` = NEW.`subject_key`
	AND conversation.`status` = 'ACTIVE'
  )
  OR NEW.`revision` <> COALESCE((
	SELECT MAX(existing.`revision`) + 1
	FROM `ai_conversation_summary_revisions` existing
	WHERE existing.`conversation_id` = NEW.`conversation_id`
	), 1)
  OR (
	NEW.`revision` > 1
	AND NEW.`covers_through_ordinal` < (
		SELECT existing.`covers_through_ordinal`
		FROM `ai_conversation_summary_revisions` existing
		WHERE existing.`conversation_id` = NEW.`conversation_id`
		AND existing.`revision` = NEW.`revision` - 1
	)
  )
  OR (
	SELECT COUNT(*) FROM `ai_conversation_messages` message
	WHERE message.`conversation_id` = NEW.`conversation_id`
	AND message.`ordinal` BETWEEN 1 AND NEW.`covers_through_ordinal`
	) <> NEW.`source_message_count`
  OR (
	SELECT COUNT(*) FROM `ai_conversation_messages` message
	WHERE message.`conversation_id` = NEW.`conversation_id`
	AND message.`ordinal` BETWEEN 1 AND NEW.`covers_through_ordinal`
	AND message.`is_partial` = 0
	) <> NEW.`source_message_count`
  OR COALESCE((
	SELECT message.`role` FROM `ai_conversation_messages` message
	WHERE message.`conversation_id` = NEW.`conversation_id`
	AND message.`ordinal` = NEW.`covers_through_ordinal`
	), '') <> 'ASSISTANT'
BEGIN
	SELECT RAISE(ABORT, 'AI Conversation Summary ownership, coverage, or monotonicity is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_conversation_summary_revisions_no_delete`
BEFORE DELETE ON `ai_conversation_summary_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Conversation Summary revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_conversation_summary_revisions_lifecycle_valid`
BEFORE UPDATE ON `ai_conversation_summary_revisions`
WHEN NOT (
	(
		OLD.`status` = 'ACTIVE'
		AND NEW.`status` = 'DELETED'
		AND NEW.`summary_text` IS NULL
		AND NEW.`deleted_at` IS NOT NULL
		AND NEW.`safe_deletion_code` = 'CONVERSATION_DELETED'
		AND EXISTS (
			SELECT 1 FROM `ai_conversations` conversation
			WHERE conversation.`id` = NEW.`conversation_id`
			AND conversation.`principal_ref` = NEW.`principal_ref`
			AND conversation.`status` = 'DELETED'
		)
	)
	OR (
		OLD.`status` = 'ACTIVE'
		AND NEW.`status` = 'DELETED'
		AND NEW.`summary_text` IS NULL
		AND NEW.`deleted_at` IS NOT NULL
		AND NEW.`safe_deletion_code` = 'PRINCIPAL_PURGED'
	)
)
OR NEW.`id` <> OLD.`id`
OR NEW.`conversation_id` <> OLD.`conversation_id`
OR NEW.`principal_ref` <> OLD.`principal_ref`
OR NEW.`subject_key` <> OLD.`subject_key`
OR NEW.`revision` <> OLD.`revision`
OR NEW.`covers_through_ordinal` <> OLD.`covers_through_ordinal`
OR NEW.`source_start_ordinal` <> OLD.`source_start_ordinal`
OR NEW.`source_end_ordinal` <> OLD.`source_end_ordinal`
OR NEW.`source_message_count` <> OLD.`source_message_count`
OR NEW.`created_at` <> OLD.`created_at`
BEGIN
	SELECT RAISE(ABORT, 'AI Conversation Summary revisions are immutable outside deletion scrubbing');
END;
