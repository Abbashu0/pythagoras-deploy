CREATE TABLE `ai_memory_execution_config_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_execution_config_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`generation_model_config_id` text NOT NULL,
	`generation_model_config_revision` integer NOT NULL,
	`generation_provider_config_id` text NOT NULL,
	`generation_provider_config_revision` integer NOT NULL,
	`budget_policy_id` text NOT NULL,
	`budget_policy_revision` integer NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`rate_limit_policy_revision` integer NOT NULL,
	`timeout_ms` integer NOT NULL,
	`extraction_max_output_tokens` integer NOT NULL,
	`compaction_max_output_tokens` integer NOT NULL,
	`max_extraction_candidates` integer NOT NULL,
	`auto_approval_min_confidence_units` integer NOT NULL,
	`compaction_trigger_message_count` integer NOT NULL,
	`compaction_retain_recent_message_count` integer NOT NULL,
	`extraction_protocol_key` text NOT NULL,
	`extraction_protocol_revision` integer NOT NULL,
	`compaction_protocol_key` text NOT NULL,
	`compaction_protocol_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`memory_execution_config_id`) REFERENCES `ai_memory_execution_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_policy_id`) REFERENCES `ai_budget_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_memory_execution_config_revisions_revision_positive" CHECK("ai_memory_execution_config_revisions"."revision" >= 1),
	CONSTRAINT "ai_memory_execution_config_revisions_display_name_valid" CHECK(length(trim("ai_memory_execution_config_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_memory_execution_config_revisions_enabled_boolean" CHECK("ai_memory_execution_config_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_memory_execution_config_revisions_dependency_revisions_valid" CHECK("ai_memory_execution_config_revisions"."generation_model_config_revision" >= 1 and "ai_memory_execution_config_revisions"."generation_provider_config_revision" >= 1 and "ai_memory_execution_config_revisions"."budget_policy_revision" >= 1 and "ai_memory_execution_config_revisions"."rate_limit_policy_revision" >= 1),
	CONSTRAINT "ai_memory_execution_config_revisions_bounds_valid" CHECK("ai_memory_execution_config_revisions"."timeout_ms" between 100 and 120000 and "ai_memory_execution_config_revisions"."extraction_max_output_tokens" between 1 and 65536 and "ai_memory_execution_config_revisions"."compaction_max_output_tokens" between 1 and 65536 and "ai_memory_execution_config_revisions"."max_extraction_candidates" between 1 and 100 and "ai_memory_execution_config_revisions"."auto_approval_min_confidence_units" between 0 and 1000000 and "ai_memory_execution_config_revisions"."compaction_trigger_message_count" between 2 and 10000 and "ai_memory_execution_config_revisions"."compaction_retain_recent_message_count" between 1 and 9999 and "ai_memory_execution_config_revisions"."compaction_trigger_message_count" > "ai_memory_execution_config_revisions"."compaction_retain_recent_message_count"),
	CONSTRAINT "ai_memory_execution_config_revisions_protocol_valid" CHECK("ai_memory_execution_config_revisions"."extraction_protocol_key" = 'memory-extraction-v1' and "ai_memory_execution_config_revisions"."extraction_protocol_revision" = 1 and "ai_memory_execution_config_revisions"."compaction_protocol_key" = 'conversation-compaction-v1' and "ai_memory_execution_config_revisions"."compaction_protocol_revision" = 1),
	CONSTRAINT "ai_memory_execution_config_revisions_created_nonnegative" CHECK("ai_memory_execution_config_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_execution_config_revisions_identity_unique` ON `ai_memory_execution_config_revisions` (`memory_execution_config_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_memory_execution_config_revisions_config_index` ON `ai_memory_execution_config_revisions` (`memory_execution_config_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_memory_execution_config_revisions_enabled_index` ON `ai_memory_execution_config_revisions` (`enabled`);--> statement-breakpoint
CREATE TABLE `ai_memory_execution_configs` (
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
	CONSTRAINT "ai_memory_execution_configs_key_valid" CHECK(length(trim("ai_memory_execution_configs"."key")) between 1 and 120 and "ai_memory_execution_configs"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_memory_execution_configs_subject_valid" CHECK(length(trim("ai_memory_execution_configs"."subject_key")) between 1 and 80 and "ai_memory_execution_configs"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_memory_execution_configs_revision_positive" CHECK("ai_memory_execution_configs"."current_revision" >= 1),
	CONSTRAINT "ai_memory_execution_configs_created_nonnegative" CHECK("ai_memory_execution_configs"."created_at" >= 0),
	CONSTRAINT "ai_memory_execution_configs_timestamps_ordered" CHECK("ai_memory_execution_configs"."updated_at" >= "ai_memory_execution_configs"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_execution_configs_key_unique` ON `ai_memory_execution_configs` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_execution_configs_subject_unique` ON `ai_memory_execution_configs` (`subject_key`);--> statement-breakpoint
CREATE TABLE `ai_memory_execution_memory_links` (
	`execution_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`memory_id` text NOT NULL,
	PRIMARY KEY(`execution_id`, `ordinal`),
	FOREIGN KEY (`execution_id`) REFERENCES `ai_memory_executions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_id`) REFERENCES `ai_memories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_memory_execution_memory_links_ordinal_valid" CHECK("ai_memory_execution_memory_links"."ordinal" between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_execution_memory_links_memory_unique` ON `ai_memory_execution_memory_links` (`execution_id`,`memory_id`);--> statement-breakpoint
CREATE TABLE `ai_memory_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_kind` text NOT NULL,
	`schedule_key` text NOT NULL,
	`principal_ref` text NOT NULL,
	`subject_key` text NOT NULL,
	`conversation_id` text NOT NULL,
	`response_id` text NOT NULL,
	`request_message_id` text NOT NULL,
	`request_ordinal` integer NOT NULL,
	`assistant_message_id` text NOT NULL,
	`assistant_ordinal` integer NOT NULL,
	`execution_config_id` text NOT NULL,
	`execution_config_revision` integer NOT NULL,
	`execution_config_fingerprint` text NOT NULL,
	`generation_model_config_id` text NOT NULL,
	`generation_model_config_revision` integer NOT NULL,
	`generation_provider_config_id` text NOT NULL,
	`generation_provider_config_revision` integer NOT NULL,
	`budget_policy_id` text NOT NULL,
	`budget_policy_revision` integer NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`rate_limit_policy_revision` integer NOT NULL,
	`protocol_key` text NOT NULL,
	`protocol_revision` integer NOT NULL,
	`memory_policy_id` text,
	`memory_policy_revision` integer,
	`base_summary_id` text,
	`base_summary_revision` integer,
	`base_summary_coverage` integer,
	`target_cutoff_ordinal` integer,
	`job_id` text,
	`cost_operation_id` text,
	`budget_reservation_id` text,
	`admission_attempt` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`provider_invocation_state` text NOT NULL,
	`provider_invoked` integer DEFAULT false NOT NULL,
	`result_sha256` text,
	`result_byte_size` integer,
	`result_count` integer DEFAULT 0 NOT NULL,
	`result_summary_id` text,
	`result_summary_revision` integer,
	`safe_failure_code` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`execution_config_id`) REFERENCES `ai_memory_execution_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_policy_id`) REFERENCES `ai_budget_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_policy_id`) REFERENCES `ai_memory_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`base_summary_id`) REFERENCES `ai_conversation_summary_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_reservation_id`) REFERENCES `ai_budget_reservations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`result_summary_id`) REFERENCES `ai_conversation_summary_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_memory_executions_kind_valid" CHECK("ai_memory_executions"."execution_kind" in ('EXTRACTION','COMPACTION')),
	CONSTRAINT "ai_memory_executions_schedule_valid" CHECK(length(trim("ai_memory_executions"."schedule_key")) between 1 and 500),
	CONSTRAINT "ai_memory_executions_principal_valid" CHECK(length(trim("ai_memory_executions"."principal_ref")) between 1 and 200),
	CONSTRAINT "ai_memory_executions_subject_valid" CHECK(length(trim("ai_memory_executions"."subject_key")) between 1 and 80),
	CONSTRAINT "ai_memory_executions_ordinals_valid" CHECK("ai_memory_executions"."request_ordinal" >= 1 and "ai_memory_executions"."assistant_ordinal" > "ai_memory_executions"."request_ordinal"),
	CONSTRAINT "ai_memory_executions_config_valid" CHECK("ai_memory_executions"."execution_config_revision" >= 1 and length("ai_memory_executions"."execution_config_fingerprint") = 64 and "ai_memory_executions"."execution_config_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_memory_executions_dependency_revisions_valid" CHECK("ai_memory_executions"."generation_model_config_revision" >= 1 and "ai_memory_executions"."generation_provider_config_revision" >= 1 and "ai_memory_executions"."budget_policy_revision" >= 1 and "ai_memory_executions"."rate_limit_policy_revision" >= 1),
	CONSTRAINT "ai_memory_executions_protocol_valid" CHECK(length(trim("ai_memory_executions"."protocol_key")) between 1 and 120 and "ai_memory_executions"."protocol_revision" >= 1),
	CONSTRAINT "ai_memory_executions_admission_valid" CHECK("ai_memory_executions"."admission_attempt" between 0 and 100),
	CONSTRAINT "ai_memory_executions_status_valid" CHECK("ai_memory_executions"."status" in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST')),
	CONSTRAINT "ai_memory_executions_invocation_valid" CHECK("ai_memory_executions"."provider_invocation_state" in ('NOT_INVOKED','INVOKING','INVOKED_WITH_ACCOUNTING','AMBIGUOUS')),
	CONSTRAINT "ai_memory_executions_result_valid" CHECK("ai_memory_executions"."result_sha256" is null or (length("ai_memory_executions"."result_sha256") = 64 and "ai_memory_executions"."result_sha256" not glob '*[^0-9a-f]*')),
	CONSTRAINT "ai_memory_executions_result_size_valid" CHECK("ai_memory_executions"."result_byte_size" is null or "ai_memory_executions"."result_byte_size" between 0 and 262144),
	CONSTRAINT "ai_memory_executions_result_count_valid" CHECK("ai_memory_executions"."result_count" between 0 and 100),
	CONSTRAINT "ai_memory_executions_summary_valid" CHECK(("ai_memory_executions"."result_summary_id" is null and "ai_memory_executions"."result_summary_revision" is null) or ("ai_memory_executions"."result_summary_id" is not null and "ai_memory_executions"."result_summary_revision" >= 1)),
	CONSTRAINT "ai_memory_executions_failure_valid" CHECK("ai_memory_executions"."safe_failure_code" is null or (length(trim("ai_memory_executions"."safe_failure_code")) between 1 and 120 and "ai_memory_executions"."safe_failure_code" not glob '*[^A-Z0-9_.-]*')),
	CONSTRAINT "ai_memory_executions_timestamps_valid" CHECK("ai_memory_executions"."created_at" >= 0 and "ai_memory_executions"."updated_at" >= "ai_memory_executions"."created_at" and ("ai_memory_executions"."started_at" is null or "ai_memory_executions"."started_at" >= "ai_memory_executions"."created_at") and ("ai_memory_executions"."completed_at" is null or "ai_memory_executions"."completed_at" >= "ai_memory_executions"."created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_executions_schedule_unique` ON `ai_memory_executions` (`schedule_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_executions_job_unique` ON `ai_memory_executions` (`job_id`) WHERE "ai_memory_executions"."job_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_executions_operation_unique` ON `ai_memory_executions` (`cost_operation_id`) WHERE "ai_memory_executions"."cost_operation_id" is not null;--> statement-breakpoint
CREATE INDEX `ai_memory_executions_status_index` ON `ai_memory_executions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_memory_executions_source_index` ON `ai_memory_executions` (`conversation_id`,`response_id`);--> statement-breakpoint
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
	`kind` text,
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
	CONSTRAINT "ai_memories_kind_valid" CHECK("__new_ai_memories"."kind" is null or "__new_ai_memories"."kind" in ('LEARNING_PREFERENCE','EXPLANATION_PREFERENCE','LEARNING_DIFFICULTY','STUDY_GOAL','STUDY_PROGRESS')),
	CONSTRAINT "ai_memories_source_range_valid" CHECK("__new_ai_memories"."source_start_ordinal" >= 1 and "__new_ai_memories"."source_end_ordinal" >= "__new_ai_memories"."source_start_ordinal" and "__new_ai_memories"."source_end_ordinal" - "__new_ai_memories"."source_start_ordinal" + 1 <= 10000),
	CONSTRAINT "ai_memories_text_valid" CHECK(("__new_ai_memories"."status" = 'DELETED' and "__new_ai_memories"."memory_text" is null) or ("__new_ai_memories"."status" <> 'DELETED' and "__new_ai_memories"."memory_text" is not null and length(cast("__new_ai_memories"."memory_text" as blob)) between 1 and 131072)),
	CONSTRAINT "ai_memories_confidence_valid" CHECK("__new_ai_memories"."confidence_units" between 0 and 1000000),
	CONSTRAINT "ai_memories_created_nonnegative" CHECK("__new_ai_memories"."created_at" >= 0),
	CONSTRAINT "ai_memories_reviewed_consistent" CHECK(("__new_ai_memories"."status" = 'CANDIDATE' and "__new_ai_memories"."reviewed_at" is null and "__new_ai_memories"."safe_review_code" is null) or ("__new_ai_memories"."status" = 'APPROVED' and "__new_ai_memories"."reviewed_at" is not null and "__new_ai_memories"."safe_review_code" in ('STUDENT_APPROVED','SYSTEM_AUTO_APPROVED')) or ("__new_ai_memories"."status" = 'REJECTED' and "__new_ai_memories"."reviewed_at" is not null and "__new_ai_memories"."safe_review_code" = 'STUDENT_REJECTED') or ("__new_ai_memories"."status" = 'DELETED' and "__new_ai_memories"."deleted_at" is not null and "__new_ai_memories"."safe_review_code" in ('CONVERSATION_DELETED','PRINCIPAL_PURGED'))),
	CONSTRAINT "ai_memories_deleted_timestamp_valid" CHECK("__new_ai_memories"."deleted_at" is null or "__new_ai_memories"."deleted_at" >= "__new_ai_memories"."created_at"),
	CONSTRAINT "ai_memories_expiry_valid" CHECK("__new_ai_memories"."expires_at" > "__new_ai_memories"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_ai_memories`("id", "principal_ref", "subject_key", "memory_policy_id", "memory_policy_revision", "revision", "status", "visibility_scope", "creation_origin", "kind", "source_conversation_id", "source_start_ordinal", "source_end_ordinal", "memory_text", "confidence_units", "created_at", "reviewed_at", "deleted_at", "expires_at", "safe_review_code") SELECT "id", "principal_ref", "subject_key", "memory_policy_id", "memory_policy_revision", "revision", "status", "visibility_scope", "creation_origin", NULL, "source_conversation_id", "source_start_ordinal", "source_end_ordinal", "memory_text", "confidence_units", "created_at", "reviewed_at", "deleted_at", "expires_at", "safe_review_code" FROM `ai_memories`;--> statement-breakpoint
DROP TABLE `ai_memories`;--> statement-breakpoint
ALTER TABLE `__new_ai_memories` RENAME TO `ai_memories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_memories_principal_subject_index` ON `ai_memories` (`principal_ref`,`subject_key`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `ai_memories_source_conversation_index` ON `ai_memories` (`source_conversation_id`,`status`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_insert_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_lifecycle_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_insert_valid`
BEFORE INSERT ON `ai_memories`
WHEN NEW.`status` <> 'CANDIDATE'
  OR (NEW.`kind` IS NOT NULL AND NEW.`kind` NOT IN ('LEARNING_PREFERENCE','EXPLANATION_PREFERENCE','LEARNING_DIFFICULTY','STUDY_GOAL','STUDY_PROGRESS'))
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
	SELECT RAISE(ABORT, 'AI Memory candidate ownership, retention, source coverage, or kind is invalid');
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
		AND NEW.`status` = 'APPROVED'
		AND NEW.`reviewed_at` IS NOT NULL
		AND NEW.`reviewed_at` >= OLD.`created_at`
		AND NEW.`reviewed_at` <= 8640000000000000
		AND NEW.`deleted_at` IS NULL
		AND NEW.`safe_review_code` = 'STUDENT_APPROVED'
	)
	OR (
		OLD.`status` = 'CANDIDATE'
		AND NEW.`status` = 'APPROVED'
		AND NEW.`reviewed_at` IS NOT NULL
		AND NEW.`reviewed_at` >= OLD.`created_at`
		AND NEW.`reviewed_at` <= 8640000000000000
		AND NEW.`deleted_at` IS NULL
		AND NEW.`safe_review_code` = 'SYSTEM_AUTO_APPROVED'
		AND NEW.`kind` IS NOT NULL
		AND NEW.`kind` IN ('LEARNING_PREFERENCE','EXPLANATION_PREFERENCE','LEARNING_DIFFICULTY','STUDY_GOAL','STUDY_PROGRESS')
		AND EXISTS (
			SELECT 1
			FROM `ai_memory_policies` policy
			JOIN `ai_memory_policy_revisions` policy_revision
			ON policy_revision.`memory_policy_id` = policy.`id`
			AND policy_revision.`revision` = NEW.`memory_policy_revision`
			WHERE policy.`id` = NEW.`memory_policy_id`
			AND policy.`subject_key` = NEW.`subject_key`
			AND policy_revision.`enabled` = 1
			AND policy_revision.`candidate_review_required` = 0
		)
		AND EXISTS (
			SELECT 1 FROM `ai_conversations` conversation
			WHERE conversation.`id` = NEW.`source_conversation_id`
			AND conversation.`principal_ref` = NEW.`principal_ref`
			AND conversation.`subject_key` = NEW.`subject_key`
			AND conversation.`status` = 'ACTIVE'
		)
	)
	OR (
		OLD.`status` = 'CANDIDATE'
		AND NEW.`status` = 'REJECTED'
		AND NEW.`reviewed_at` IS NOT NULL
		AND NEW.`reviewed_at` >= OLD.`created_at`
		AND NEW.`reviewed_at` <= 8640000000000000
		AND NEW.`deleted_at` IS NULL
		AND NEW.`safe_review_code` = 'STUDENT_REJECTED'
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
OR NEW.`kind` IS NOT OLD.`kind`
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
CREATE TRIGGER `ai_memory_execution_configs_identity_valid`
BEFORE UPDATE ON `ai_memory_execution_configs`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`key` <> OLD.`key`
  OR NEW.`subject_key` <> OLD.`subject_key`
  OR NEW.`created_at` <> OLD.`created_at`
  OR NEW.`created_by` <> OLD.`created_by`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Execution Config identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_configs_insert_valid`
BEFORE INSERT ON `ai_memory_execution_configs`
WHEN NEW.`current_revision` <> 1
BEGIN
	SELECT RAISE(ABORT, 'A new AI Memory Execution Config must begin at revision one');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_configs_revision_valid`
BEFORE UPDATE ON `ai_memory_execution_configs`
WHEN NEW.`current_revision` <> OLD.`current_revision`
  AND (
	NEW.`current_revision` <> OLD.`current_revision` + 1
	OR NOT EXISTS (
		SELECT 1 FROM `ai_memory_execution_config_revisions` revision
		WHERE revision.`memory_execution_config_id` = NEW.`id`
		AND revision.`revision` = NEW.`current_revision`
	)
  )
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Execution Config revisions must advance one step');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_config_revisions_insert_valid`
BEFORE INSERT ON `ai_memory_execution_config_revisions`
WHEN NOT EXISTS (SELECT 1 FROM `ai_memory_execution_configs` config WHERE config.`id` = NEW.`memory_execution_config_id`)
  OR NEW.`revision` <> COALESCE((SELECT MAX(existing.`revision`) + 1 FROM `ai_memory_execution_config_revisions` existing WHERE existing.`memory_execution_config_id` = NEW.`memory_execution_config_id`), 1)
  OR NOT EXISTS (
	SELECT 1
	FROM `ai_model_configs` model
	JOIN `ai_provider_configs` provider ON provider.`id` = NEW.`generation_provider_config_id`
	WHERE model.`id` = NEW.`generation_model_config_id`
	AND model.`revision` = NEW.`generation_model_config_revision`
	AND model.`capability` = 'GENERATION'
	AND model.`enabled` = 1
	AND model.`max_output_tokens` IS NOT NULL
	AND NEW.`extraction_max_output_tokens` <= model.`max_output_tokens`
	AND NEW.`compaction_max_output_tokens` <= model.`max_output_tokens`
	AND model.`provider_config_id` = NEW.`generation_provider_config_id`
	AND provider.`revision` = NEW.`generation_provider_config_revision`
	AND provider.`enabled` = 1
	AND provider.`credential_ref` IS NOT NULL
	)
  OR NOT EXISTS (
	SELECT 1 FROM `ai_budget_policy_revisions` policy
	WHERE policy.`budget_policy_id` = NEW.`budget_policy_id`
	AND policy.`revision` = NEW.`budget_policy_revision`
	AND policy.`cost_center` = 'STUDENT_GENERATION'
	AND policy.`enabled` = 1
	)
  OR NOT EXISTS (
	SELECT 1 FROM `ai_rate_limit_policy_revisions` policy
	WHERE policy.`rate_limit_policy_id` = NEW.`rate_limit_policy_id`
	AND policy.`revision` = NEW.`rate_limit_policy_revision`
	AND policy.`enabled` = 1
	)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Execution Config revision ownership or sequence is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_config_revisions_no_update`
BEFORE UPDATE ON `ai_memory_execution_config_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Execution Config revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_config_revisions_no_delete`
BEFORE DELETE ON `ai_memory_execution_config_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Execution Config revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_executions_insert_valid`
BEFORE INSERT ON `ai_memory_executions`
WHEN NEW.`status` <> 'PENDING'
  OR NEW.`provider_invocation_state` <> 'NOT_INVOKED'
  OR NEW.`provider_invoked` <> 0
  OR NEW.`started_at` IS NOT NULL
  OR NEW.`completed_at` IS NOT NULL
  OR NEW.`safe_failure_code` IS NOT NULL
  OR NOT EXISTS (
	SELECT 1
	FROM `ai_memory_execution_configs` config
	JOIN `ai_memory_execution_config_revisions` config_revision
	ON config_revision.`memory_execution_config_id` = config.`id`
	AND config_revision.`revision` = NEW.`execution_config_revision`
	WHERE config.`id` = NEW.`execution_config_id`
	AND config.`subject_key` = NEW.`subject_key`
	AND config_revision.`enabled` = 1
	AND config_revision.`generation_model_config_id` = NEW.`generation_model_config_id`
	AND config_revision.`generation_model_config_revision` = NEW.`generation_model_config_revision`
	AND config_revision.`generation_provider_config_id` = NEW.`generation_provider_config_id`
	AND config_revision.`generation_provider_config_revision` = NEW.`generation_provider_config_revision`
	AND config_revision.`budget_policy_id` = NEW.`budget_policy_id`
	AND config_revision.`budget_policy_revision` = NEW.`budget_policy_revision`
	AND config_revision.`rate_limit_policy_id` = NEW.`rate_limit_policy_id`
	AND config_revision.`rate_limit_policy_revision` = NEW.`rate_limit_policy_revision`
	)
  OR NOT EXISTS (
	SELECT 1
	FROM `ai_conversations` conversation
	JOIN `ai_conversation_responses` response ON response.`id` = NEW.`response_id`
	WHERE conversation.`id` = NEW.`conversation_id`
	AND conversation.`principal_ref` = NEW.`principal_ref`
	AND conversation.`subject_key` = NEW.`subject_key`
	AND response.`conversation_id` = conversation.`id`
	AND response.`principal_ref` = conversation.`principal_ref`
	)
  OR (NEW.`execution_kind` = 'EXTRACTION' AND (NEW.`memory_policy_id` IS NULL OR NEW.`memory_policy_revision` IS NULL))
  OR (NEW.`execution_kind` = 'COMPACTION' AND (NEW.`memory_policy_id` IS NOT NULL OR NEW.`memory_policy_revision` IS NOT NULL))
  OR (NEW.`base_summary_id` IS NULL AND (NEW.`base_summary_revision` IS NOT NULL OR NEW.`base_summary_coverage` IS NOT NULL))
  OR (NEW.`base_summary_id` IS NOT NULL AND (NEW.`base_summary_revision` IS NULL OR NEW.`base_summary_coverage` IS NULL))
  OR (NEW.`execution_kind` = 'EXTRACTION' AND NEW.`target_cutoff_ordinal` IS NOT NULL)
  OR (NEW.`execution_kind` = 'COMPACTION' AND NEW.`target_cutoff_ordinal` IS NULL)
  OR (NEW.`execution_kind` = 'EXTRACTION' AND NOT EXISTS (
	SELECT 1 FROM `ai_memory_policies` policy
	JOIN `ai_memory_policy_revisions` policy_revision
	ON policy_revision.`memory_policy_id` = policy.`id`
	AND policy_revision.`revision` = NEW.`memory_policy_revision`
	WHERE policy.`id` = NEW.`memory_policy_id`
	AND policy.`subject_key` = NEW.`subject_key`
	AND policy_revision.`enabled` = 1
  ))
  OR (NEW.`base_summary_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `ai_conversation_summary_revisions` summary
	WHERE summary.`id` = NEW.`base_summary_id`
	AND summary.`conversation_id` = NEW.`conversation_id`
	AND summary.`principal_ref` = NEW.`principal_ref`
	AND summary.`subject_key` = NEW.`subject_key`
	AND summary.`revision` = NEW.`base_summary_revision`
	AND summary.`covers_through_ordinal` = NEW.`base_summary_coverage`
	AND summary.`status` = 'ACTIVE'
	AND summary.`summary_text` IS NOT NULL
  ))
  OR (NEW.`execution_kind` = 'EXTRACTION' AND (NEW.`protocol_key` <> 'memory-extraction-v1' OR NEW.`protocol_revision` <> 1))
  OR (NEW.`execution_kind` = 'COMPACTION' AND (NEW.`protocol_key` <> 'conversation-compaction-v1' OR NEW.`protocol_revision` <> 1))
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution ownership or initial lifecycle is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_executions_lifecycle_valid`
BEFORE UPDATE ON `ai_memory_executions`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`execution_kind` <> OLD.`execution_kind`
  OR NEW.`schedule_key` <> OLD.`schedule_key`
  OR NEW.`principal_ref` <> OLD.`principal_ref`
  OR NEW.`subject_key` <> OLD.`subject_key`
  OR NEW.`conversation_id` <> OLD.`conversation_id`
  OR NEW.`response_id` <> OLD.`response_id`
  OR NEW.`request_message_id` <> OLD.`request_message_id`
  OR NEW.`request_ordinal` <> OLD.`request_ordinal`
  OR NEW.`assistant_message_id` <> OLD.`assistant_message_id`
  OR NEW.`assistant_ordinal` <> OLD.`assistant_ordinal`
  OR NEW.`execution_config_id` <> OLD.`execution_config_id`
  OR NEW.`execution_config_revision` <> OLD.`execution_config_revision`
  OR NEW.`execution_config_fingerprint` <> OLD.`execution_config_fingerprint`
  OR NEW.`generation_model_config_id` <> OLD.`generation_model_config_id`
  OR NEW.`generation_model_config_revision` <> OLD.`generation_model_config_revision`
  OR NEW.`generation_provider_config_id` <> OLD.`generation_provider_config_id`
  OR NEW.`generation_provider_config_revision` <> OLD.`generation_provider_config_revision`
  OR NEW.`budget_policy_id` <> OLD.`budget_policy_id`
  OR NEW.`budget_policy_revision` <> OLD.`budget_policy_revision`
  OR NEW.`rate_limit_policy_id` <> OLD.`rate_limit_policy_id`
  OR NEW.`rate_limit_policy_revision` <> OLD.`rate_limit_policy_revision`
  OR NEW.`protocol_key` <> OLD.`protocol_key`
  OR NEW.`protocol_revision` <> OLD.`protocol_revision`
  OR NEW.`memory_policy_id` IS NOT OLD.`memory_policy_id`
  OR NEW.`memory_policy_revision` IS NOT OLD.`memory_policy_revision`
  OR NEW.`base_summary_id` IS NOT OLD.`base_summary_id`
  OR NEW.`base_summary_revision` IS NOT OLD.`base_summary_revision`
  OR NEW.`base_summary_coverage` IS NOT OLD.`base_summary_coverage`
  OR NEW.`target_cutoff_ordinal` IS NOT OLD.`target_cutoff_ordinal`
  OR OLD.`status` IN ('COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST')
  AND NEW.`status` <> OLD.`status`
  OR OLD.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING'
  AND NEW.`provider_invocation_state` = 'NOT_INVOKED'
  OR NEW.`provider_invoked` = 1
  AND NEW.`provider_invocation_state` = 'NOT_INVOKED'
  OR NEW.`provider_invocation_state` = 'INVOKING'
  AND OLD.`provider_invocation_state` <> 'NOT_INVOKED'
  OR NEW.`status` = 'PENDING'
  AND NEW.`provider_invocation_state` <> 'NOT_INVOKED'
  OR NEW.`status` = 'PENDING'
  AND NEW.`started_at` IS NOT NULL
  OR NEW.`status` = 'RUNNING'
  AND NEW.`started_at` IS NULL
  OR NEW.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING'
  AND NEW.`provider_invoked` <> 1
  OR NEW.`provider_invocation_state` = 'AMBIGUOUS'
  AND NEW.`provider_invoked` <> 1
  OR NEW.`provider_invocation_state` = 'INVOKING'
  AND NEW.`status` <> 'RUNNING'
  OR NEW.`status` IN ('COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST')
  AND NEW.`completed_at` IS NULL
  OR NEW.`status` IN ('PENDING','RUNNING')
  AND NEW.`completed_at` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution lifecycle or immutable identity mutation is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_executions_no_delete`
BEFORE DELETE ON `ai_memory_executions`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory executions are durable lifecycle records');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_memory_links_insert_valid`
BEFORE INSERT ON `ai_memory_execution_memory_links`
WHEN NOT EXISTS (
	SELECT 1 FROM `ai_memory_executions` execution
	JOIN `ai_memories` memory ON memory.`id` = NEW.`memory_id`
	WHERE execution.`id` = NEW.`execution_id`
	AND execution.`execution_kind` = 'EXTRACTION'
	AND execution.`status` = 'RUNNING'
	AND execution.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING'
	AND execution.`provider_invoked` = 1
	AND memory.`principal_ref` = execution.`principal_ref`
	AND memory.`subject_key` = execution.`subject_key`
	AND memory.`source_conversation_id` = execution.`conversation_id`
	AND memory.`source_start_ordinal` = execution.`request_ordinal`
	AND memory.`source_end_ordinal` = execution.`assistant_ordinal`
	AND memory.`status` <> 'DELETED'
)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution result ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_memory_links_no_update`
BEFORE UPDATE ON `ai_memory_execution_memory_links`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution result links are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_memory_links_no_delete`
BEFORE DELETE ON `ai_memory_execution_memory_links`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution result links are immutable');
END;
