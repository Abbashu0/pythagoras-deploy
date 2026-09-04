CREATE TABLE `ai_conversation_summary_revisions` (
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
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_conversation_summary_revisions_principal_valid" CHECK(length(trim("ai_conversation_summary_revisions"."principal_ref")) between 1 and 200 and "ai_conversation_summary_revisions"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_conversation_summary_revisions_subject_valid" CHECK(length(trim("ai_conversation_summary_revisions"."subject_key")) between 1 and 80 and "ai_conversation_summary_revisions"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_conversation_summary_revisions_revision_positive" CHECK("ai_conversation_summary_revisions"."revision" >= 1),
	CONSTRAINT "ai_conversation_summary_revisions_status_valid" CHECK("ai_conversation_summary_revisions"."status" in ('ACTIVE','DELETED')),
	CONSTRAINT "ai_conversation_summary_revisions_text_valid" CHECK(("ai_conversation_summary_revisions"."status" = 'DELETED' and "ai_conversation_summary_revisions"."summary_text" is null) or ("ai_conversation_summary_revisions"."status" = 'ACTIVE' and "ai_conversation_summary_revisions"."summary_text" is not null and length(cast("ai_conversation_summary_revisions"."summary_text" as blob)) between 1 and 131072)),
	CONSTRAINT "ai_conversation_summary_revisions_coverage_valid" CHECK("ai_conversation_summary_revisions"."covers_through_ordinal" >= 1 and "ai_conversation_summary_revisions"."source_start_ordinal" = 1 and "ai_conversation_summary_revisions"."source_end_ordinal" = "ai_conversation_summary_revisions"."covers_through_ordinal" and "ai_conversation_summary_revisions"."source_message_count" = "ai_conversation_summary_revisions"."covers_through_ordinal"),
	CONSTRAINT "ai_conversation_summary_revisions_created_nonnegative" CHECK("ai_conversation_summary_revisions"."created_at" >= 0),
	CONSTRAINT "ai_conversation_summary_revisions_deleted_timestamp_valid" CHECK("ai_conversation_summary_revisions"."deleted_at" is null or "ai_conversation_summary_revisions"."deleted_at" >= "ai_conversation_summary_revisions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_conversation_summary_revisions_identity_unique` ON `ai_conversation_summary_revisions` (`conversation_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_conversation_summary_revisions_conversation_index` ON `ai_conversation_summary_revisions` (`conversation_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_conversation_summary_revisions_principal_subject_index` ON `ai_conversation_summary_revisions` (`principal_ref`,`subject_key`,`status`);--> statement-breakpoint
CREATE TABLE `ai_memories` (
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
	CONSTRAINT "ai_memories_principal_valid" CHECK(length(trim("ai_memories"."principal_ref")) between 1 and 200 and "ai_memories"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_memories_subject_valid" CHECK(length(trim("ai_memories"."subject_key")) between 1 and 80 and "ai_memories"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_memories_policy_revision_valid" CHECK("ai_memories"."memory_policy_revision" >= 1),
	CONSTRAINT "ai_memories_revision_valid" CHECK("ai_memories"."revision" >= 1),
	CONSTRAINT "ai_memories_status_valid" CHECK("ai_memories"."status" in ('CANDIDATE','APPROVED','REJECTED','DELETED')),
	CONSTRAINT "ai_memories_visibility_valid" CHECK("ai_memories"."visibility_scope" = 'PRINCIPAL_SUBJECT'),
	CONSTRAINT "ai_memories_origin_valid" CHECK("ai_memories"."creation_origin" = 'CONVERSATION'),
	CONSTRAINT "ai_memories_source_range_valid" CHECK("ai_memories"."source_start_ordinal" >= 1 and "ai_memories"."source_end_ordinal" >= "ai_memories"."source_start_ordinal" and "ai_memories"."source_end_ordinal" - "ai_memories"."source_start_ordinal" + 1 <= 10000),
	CONSTRAINT "ai_memories_text_valid" CHECK(("ai_memories"."status" = 'DELETED' and "ai_memories"."memory_text" is null) or ("ai_memories"."status" <> 'DELETED' and "ai_memories"."memory_text" is not null and length(cast("ai_memories"."memory_text" as blob)) between 1 and 131072)),
	CONSTRAINT "ai_memories_confidence_valid" CHECK("ai_memories"."confidence_units" between 0 and 1000000),
	CONSTRAINT "ai_memories_created_nonnegative" CHECK("ai_memories"."created_at" >= 0),
	CONSTRAINT "ai_memories_reviewed_consistent" CHECK(("ai_memories"."status" = 'CANDIDATE' and "ai_memories"."reviewed_at" is null and "ai_memories"."safe_review_code" is null) or ("ai_memories"."status" = 'APPROVED' and "ai_memories"."reviewed_at" is not null and "ai_memories"."safe_review_code" = 'STUDENT_APPROVED') or ("ai_memories"."status" = 'REJECTED' and "ai_memories"."reviewed_at" is not null and "ai_memories"."safe_review_code" = 'STUDENT_REJECTED') or ("ai_memories"."status" = 'DELETED' and "ai_memories"."deleted_at" is not null and "ai_memories"."safe_review_code" = 'CONVERSATION_DELETED')),
	CONSTRAINT "ai_memories_deleted_timestamp_valid" CHECK("ai_memories"."deleted_at" is null or "ai_memories"."deleted_at" >= "ai_memories"."created_at"),
	CONSTRAINT "ai_memories_expiry_valid" CHECK("ai_memories"."expires_at" > "ai_memories"."created_at")
);
--> statement-breakpoint
CREATE INDEX `ai_memories_principal_subject_index` ON `ai_memories` (`principal_ref`,`subject_key`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `ai_memories_source_conversation_index` ON `ai_memories` (`source_conversation_id`,`status`);--> statement-breakpoint
CREATE TABLE `ai_memory_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`subject_key` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_memory_policies_key_valid" CHECK(length(trim("ai_memory_policies"."key")) between 1 and 120 and "ai_memory_policies"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_memory_policies_subject_valid" CHECK(length(trim("ai_memory_policies"."subject_key")) between 1 and 80 and "ai_memory_policies"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_memory_policies_revision_positive" CHECK("ai_memory_policies"."current_revision" >= 1),
	CONSTRAINT "ai_memory_policies_created_nonnegative" CHECK("ai_memory_policies"."created_at" >= 0),
	CONSTRAINT "ai_memory_policies_updated_ordered" CHECK("ai_memory_policies"."updated_at" >= "ai_memory_policies"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_policies_key_unique` ON `ai_memory_policies` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_policies_subject_unique` ON `ai_memory_policies` (`subject_key`);--> statement-breakpoint
CREATE TABLE `ai_memory_policy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_policy_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`candidate_review_required` integer NOT NULL,
	`retention_days` integer NOT NULL,
	`max_selected_memories` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`memory_policy_id`) REFERENCES `ai_memory_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_memory_policy_revisions_revision_positive" CHECK("ai_memory_policy_revisions"."revision" >= 1),
	CONSTRAINT "ai_memory_policy_revisions_display_name_valid" CHECK(length(trim("ai_memory_policy_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_memory_policy_revisions_enabled_boolean" CHECK("ai_memory_policy_revisions"."enabled" in (0,1) and "ai_memory_policy_revisions"."candidate_review_required" in (0,1)),
	CONSTRAINT "ai_memory_policy_revisions_retention_valid" CHECK("ai_memory_policy_revisions"."retention_days" between 1 and 3650),
	CONSTRAINT "ai_memory_policy_revisions_selection_bound_valid" CHECK("ai_memory_policy_revisions"."max_selected_memories" between 1 and 100),
	CONSTRAINT "ai_memory_policy_revisions_created_nonnegative" CHECK("ai_memory_policy_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_policy_revisions_identity_unique` ON `ai_memory_policy_revisions` (`memory_policy_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_memory_policy_revisions_policy_index` ON `ai_memory_policy_revisions` (`memory_policy_id`,`revision`);
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policies_insert_valid`
BEFORE INSERT ON `ai_memory_policies`
WHEN NEW.`current_revision` <> 1
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Policy identities must begin at revision 1');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policies_no_delete`
BEFORE DELETE ON `ai_memory_policies`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Policy identities are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policies_lifecycle_valid`
BEFORE UPDATE ON `ai_memory_policies`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`key` <> OLD.`key`
  OR NEW.`subject_key` <> OLD.`subject_key`
  OR NEW.`created_at` <> OLD.`created_at`
  OR NEW.`created_by` <> OLD.`created_by`
  OR NEW.`current_revision` NOT IN (OLD.`current_revision`, OLD.`current_revision` + 1)
  OR (NEW.`current_revision` = OLD.`current_revision` + 1 AND NOT EXISTS (
	SELECT 1 FROM `ai_memory_policy_revisions` revision
	WHERE revision.`memory_policy_id` = OLD.`id`
	AND revision.`revision` = NEW.`current_revision`
  ))
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Policy identity or revision lifecycle is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policy_revisions_insert_valid`
BEFORE INSERT ON `ai_memory_policy_revisions`
WHEN NOT EXISTS (
	SELECT 1 FROM `ai_memory_policies` policy
	WHERE policy.`id` = NEW.`memory_policy_id`
	AND (
		(NEW.`revision` = 1 AND NOT EXISTS (
			SELECT 1 FROM `ai_memory_policy_revisions` existing
			WHERE existing.`memory_policy_id` = NEW.`memory_policy_id`
		))
		OR NEW.`revision` = policy.`current_revision` + 1
	)
)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Policy revisions must advance exactly one step');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policy_revisions_no_update`
BEFORE UPDATE ON `ai_memory_policy_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Policy revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policy_revisions_no_delete`
BEFORE DELETE ON `ai_memory_policy_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Policy revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_insert_valid`
BEFORE INSERT ON `ai_memories`
WHEN NEW.`status` <> 'CANDIDATE'
  OR NEW.`visibility_scope` <> 'PRINCIPAL_SUBJECT'
  OR NEW.`creation_origin` <> 'CONVERSATION'
  OR NEW.`reviewed_at` IS NOT NULL
  OR NEW.`deleted_at` IS NOT NULL
  OR NEW.`safe_review_code` IS NOT NULL
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
	SELECT RAISE(ABORT, 'AI Memory candidate ownership or source coverage is invalid');
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
	SELECT RAISE(ABORT, 'AI Conversation Summary ownership or source coverage is invalid');
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
	OLD.`status` = 'ACTIVE'
	AND NEW.`status` = 'DELETED'
	AND NEW.`summary_text` IS NULL
	AND NEW.`deleted_at` IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM `ai_conversations` conversation
		WHERE conversation.`id` = NEW.`conversation_id`
		AND conversation.`principal_ref` = NEW.`principal_ref`
		AND conversation.`status` = 'DELETED'
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
