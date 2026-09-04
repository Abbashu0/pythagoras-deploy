-- AI-M10A2: rebaseline private Memory storage for GLOBAL and SUBJECT scopes.
-- Existing M10 rows are preserved as SUBJECT / LEGACY_SUBJECT; no row is
-- promoted to GLOBAL by this migration.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD COLUMN `origin` text NOT NULL DEFAULT 'STUDENT' CHECK(`origin` in ('STUDENT','EVAL_SYNTHETIC'));
--> statement-breakpoint
CREATE TRIGGER `ai_conversations_origin_immutable`
BEFORE UPDATE OF `origin` ON `ai_conversations`
WHEN NEW.`origin` <> OLD.`origin`
BEGIN
	SELECT RAISE(ABORT, 'AI Conversation origin is immutable');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_insert_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_lifecycle_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_no_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_policy_revisions_insert_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_policy_revisions_no_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_policy_revisions_no_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_policies_insert_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_policies_no_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_policies_lifecycle_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_execution_memory_links_exact_owner`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_executions_insert_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_executions_lifecycle_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_executions_no_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_execution_memory_links_insert_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_execution_memory_links_no_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_execution_memory_links_no_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_system_auto_approved_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memory_executions_result_commit_valid`;
--> statement-breakpoint
CREATE TABLE `__m10a2_memory_policies_hold` AS SELECT * FROM `ai_memory_policies`;
--> statement-breakpoint
CREATE TABLE `__m10a2_policy_revisions_hold` AS SELECT * FROM `ai_memory_policy_revisions`;
--> statement-breakpoint
CREATE TABLE `__m10a2_memories_hold` AS SELECT * FROM `ai_memories`;
--> statement-breakpoint
CREATE TABLE `__m10a2_executions_hold` AS SELECT * FROM `ai_memory_executions`;
--> statement-breakpoint
CREATE TABLE `__m10a2_memory_links_hold` AS SELECT * FROM `ai_memory_execution_memory_links`;
--> statement-breakpoint
DROP TABLE `ai_memory_execution_memory_links`;
--> statement-breakpoint
DROP TABLE `ai_memory_executions`;
--> statement-breakpoint
DROP TABLE `ai_memories`;
--> statement-breakpoint
DROP TABLE `ai_memory_policy_revisions`;
--> statement-breakpoint
DROP TABLE `ai_memory_policies`;
--> statement-breakpoint
CREATE TABLE `__new_ai_memory_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`scope` text NOT NULL DEFAULT 'SUBJECT',
	`subject_key` text,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `ai_memory_policies_key_valid` CHECK(length(trim(`key`)) between 1 and 120 and `key` not glob '*[^a-z0-9.-]*'),
	CONSTRAINT `ai_memory_policies_scope_valid` CHECK(`scope` in ('GLOBAL','SUBJECT') and ((`scope` = 'GLOBAL' and `subject_key` is null) or (`scope` = 'SUBJECT' and `subject_key` is not null and length(trim(`subject_key`)) between 1 and 80 and `subject_key` not glob '*[^a-z0-9-]*'))),
	CONSTRAINT `ai_memory_policies_revision_positive` CHECK(`current_revision` >= 1),
	CONSTRAINT `ai_memory_policies_created_nonnegative` CHECK(`created_at` >= 0),
	CONSTRAINT `ai_memory_policies_updated_ordered` CHECK(`updated_at` >= `created_at`)
);
--> statement-breakpoint
INSERT INTO `__new_ai_memory_policies`(`id`,`key`,`scope`,`subject_key`,`current_revision`,`created_at`,`updated_at`,`created_by`,`updated_by`)
SELECT `id`,`key`,'SUBJECT',`subject_key`,`current_revision`,`created_at`,`updated_at`,`created_by`,`updated_by`
FROM `__m10a2_memory_policies_hold`;
--> statement-breakpoint
ALTER TABLE `__new_ai_memory_policies` RENAME TO `ai_memory_policies`;
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_policies_key_unique` ON `ai_memory_policies` (`key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_policies_global_unique` ON `ai_memory_policies` (`scope`) WHERE `scope` = 'GLOBAL';
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_policies_subject_unique` ON `ai_memory_policies` (`subject_key`) WHERE `scope` = 'SUBJECT' AND `subject_key` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `__new_ai_memory_policy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_policy_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`candidate_review_required` integer NOT NULL,
	`allowed_kinds` text NOT NULL,
	`target_active_count` integer NOT NULL,
	`hard_active_maximum` integer NOT NULL,
	`max_selected_per_request` integer NOT NULL,
	`proposed_hard_maximum` integer NOT NULL,
	`per_memory_max_bytes` integer NOT NULL,
	`retention_days` integer NOT NULL,
	`max_selected_memories` integer NOT NULL,
	`mutation_enabled` integer NOT NULL,
	`explicit_min_confidence_units` integer NOT NULL,
	`inferred_min_confidence_units` integer NOT NULL,
	`inferred_min_distinct_evidence_turns` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`memory_policy_id`) REFERENCES `ai_memory_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `ai_memory_policy_revisions_revision_positive` CHECK(`revision` >= 1),
	CONSTRAINT `ai_memory_policy_revisions_display_name_valid` CHECK(length(trim(`display_name`)) between 1 and 200),
	CONSTRAINT `ai_memory_policy_revisions_enabled_boolean` CHECK(`enabled` in (0,1) and `candidate_review_required` in (0,1)),
	CONSTRAINT `ai_memory_policy_revisions_allowed_kinds_valid` CHECK(length(trim(`allowed_kinds`)) between 2 and 2048),
	CONSTRAINT `ai_memory_policy_revisions_quota_bounds` CHECK(`target_active_count` between 0 and 100 and `hard_active_maximum` between 1 and 100 and `target_active_count` <= `hard_active_maximum` and `max_selected_per_request` between 0 and 100 and `max_selected_per_request` <= `hard_active_maximum` and `proposed_hard_maximum` between 0 and 20 and `per_memory_max_bytes` between 1 and 131072),
	CONSTRAINT `ai_memory_policy_revisions_retention_valid` CHECK(`retention_days` between 1 and 3650),
	CONSTRAINT `ai_memory_policy_revisions_selection_bound_valid` CHECK(`max_selected_memories` between 1 and 100),
	CONSTRAINT `ai_memory_policy_revisions_confidence_bounds` CHECK(`mutation_enabled` in (0,1) and `explicit_min_confidence_units` between 0 and 1000000 and `inferred_min_confidence_units` between 0 and 1000000 and `inferred_min_distinct_evidence_turns` between 1 and 10),
	CONSTRAINT `ai_memory_policy_revisions_created_nonnegative` CHECK(`created_at` >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_ai_memory_policy_revisions`(`id`,`memory_policy_id`,`revision`,`display_name`,`enabled`,`candidate_review_required`,`allowed_kinds`,`target_active_count`,`hard_active_maximum`,`max_selected_per_request`,`proposed_hard_maximum`,`per_memory_max_bytes`,`retention_days`,`max_selected_memories`,`mutation_enabled`,`explicit_min_confidence_units`,`inferred_min_confidence_units`,`inferred_min_distinct_evidence_turns`,`created_at`,`created_by`)
SELECT `id`,`memory_policy_id`,`revision`,`display_name`,`enabled`,`candidate_review_required`,
	'["LEARNING_PREFERENCE","EXPLANATION_PREFERENCE","RESPONSE_DEPTH_PREFERENCE","FORM_OF_ADDRESS","PREFERRED_NAME","LEARNING_DIFFICULTY","STUDY_GOAL","STUDY_PROGRESS","LEARNING_STRATEGY_PREFERENCE"]',
	CASE WHEN `max_selected_memories` < 3 THEN `max_selected_memories` ELSE 3 END,
	100,
	`max_selected_memories`,
	CASE WHEN `max_selected_memories` < 20 THEN `max_selected_memories` ELSE 20 END,
	131072,`retention_days`,`max_selected_memories`,1,0,900000,2,`created_at`,`created_by`
FROM `__m10a2_policy_revisions_hold`;
--> statement-breakpoint
ALTER TABLE `__new_ai_memory_policy_revisions` RENAME TO `ai_memory_policy_revisions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_policy_revisions_identity_unique` ON `ai_memory_policy_revisions` (`memory_policy_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `ai_memory_policy_revisions_policy_index` ON `ai_memory_policy_revisions` (`memory_policy_id`,`revision`);
--> statement-breakpoint
CREATE TABLE `__new_ai_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_ref` text NOT NULL,
	`scope` text NOT NULL DEFAULT 'SUBJECT',
	`subject_key` text,
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
	`updated_at` integer NOT NULL,
	`reviewed_at` integer,
	`resolved_at` integer,
	`deleted_at` integer,
	`expires_at` integer NOT NULL,
	`safe_review_code` text,
	`content_sha256` text,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_policy_id`) REFERENCES `ai_memory_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `ai_memories_principal_valid` CHECK(length(trim(`principal_ref`)) between 1 and 200 and `principal_ref` not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT `ai_memories_scope_valid` CHECK(`scope` in ('GLOBAL','SUBJECT') and ((`scope` = 'GLOBAL' and `subject_key` is null and `visibility_scope` = 'PRINCIPAL_GLOBAL') or (`scope` = 'SUBJECT' and `subject_key` is not null and length(trim(`subject_key`)) between 1 and 80 and `subject_key` not glob '*[^a-z0-9-]*' and `visibility_scope` = 'PRINCIPAL_SUBJECT'))),
	CONSTRAINT `ai_memories_policy_revision_valid` CHECK(`memory_policy_revision` >= 1),
	CONSTRAINT `ai_memories_revision_valid` CHECK(`revision` >= 1),
	CONSTRAINT `ai_memories_status_valid` CHECK(`status` in ('PROPOSED','ACTIVE','RESOLVED','EXPIRED','DELETED')),
	CONSTRAINT `ai_memories_visibility_valid` CHECK(`visibility_scope` in ('PRINCIPAL_GLOBAL','PRINCIPAL_SUBJECT')),
	CONSTRAINT `ai_memories_origin_valid` CHECK(`creation_origin` in ('EXPLICIT','INFERRED','LEGACY_SUBJECT')),
	CONSTRAINT `ai_memories_kind_valid` CHECK(`kind` is null or `kind` in ('LEARNING_PREFERENCE','EXPLANATION_PREFERENCE','RESPONSE_DEPTH_PREFERENCE','FORM_OF_ADDRESS','PREFERRED_NAME','LEARNING_DIFFICULTY','STUDY_GOAL','STUDY_PROGRESS','LEARNING_STRATEGY_PREFERENCE')),
	CONSTRAINT `ai_memories_source_range_valid` CHECK(`source_start_ordinal` >= 1 and `source_end_ordinal` >= `source_start_ordinal` and `source_end_ordinal` - `source_start_ordinal` + 1 <= 10000),
	CONSTRAINT `ai_memories_text_valid` CHECK((`status` in ('RESOLVED','EXPIRED','DELETED') and `memory_text` is null) or (`status` in ('PROPOSED','ACTIVE') and `memory_text` is not null and length(cast(`memory_text` as blob)) between 1 and 131072)),
	CONSTRAINT `ai_memories_confidence_valid` CHECK(`confidence_units` between 0 and 1000000),
	CONSTRAINT `ai_memories_created_nonnegative` CHECK(`created_at` >= 0),
	CONSTRAINT `ai_memories_reviewed_consistent` CHECK((`status` = 'PROPOSED' and `resolved_at` is null and `deleted_at` is null and `safe_review_code` in ('INFERRED_PROPOSED','LEGACY_MIGRATED')) or (`status` = 'ACTIVE' and `resolved_at` is null and `deleted_at` is null and `safe_review_code` in ('EXPLICIT_CREATED','INFERRED_ACTIVATED','LEGACY_MIGRATED','STUDENT_APPROVED')) or (`status` = 'RESOLVED' and `resolved_at` is not null and `memory_text` is null and `safe_review_code` = 'MEMORY_RESOLVED') or (`status` = 'EXPIRED' and `memory_text` is null and `safe_review_code` = 'MEMORY_EXPIRED') or (`status` = 'DELETED' and `deleted_at` is not null and `memory_text` is null and `safe_review_code` in ('MEMORY_DELETED','CONVERSATION_DELETED','PRINCIPAL_PURGED'))),
	CONSTRAINT `ai_memories_updated_ordered` CHECK(`updated_at` >= `created_at`),
	CONSTRAINT `ai_memories_deleted_timestamp_valid` CHECK(`deleted_at` is null or `deleted_at` >= `created_at`),
	CONSTRAINT `ai_memories_resolved_timestamp_valid` CHECK(`resolved_at` is null or `resolved_at` >= `created_at`),
	CONSTRAINT `ai_memories_content_hash_valid` CHECK(`content_sha256` is null or (length(`content_sha256`) = 64 and `content_sha256` not glob '*[^0-9a-f]*')),
	CONSTRAINT `ai_memories_expiry_valid` CHECK(`expires_at` > `created_at`)
);
--> statement-breakpoint
INSERT INTO `__new_ai_memories`(`id`,`principal_ref`,`scope`,`subject_key`,`memory_policy_id`,`memory_policy_revision`,`revision`,`status`,`visibility_scope`,`creation_origin`,`kind`,`source_conversation_id`,`source_start_ordinal`,`source_end_ordinal`,`memory_text`,`confidence_units`,`created_at`,`updated_at`,`reviewed_at`,`resolved_at`,`deleted_at`,`expires_at`,`safe_review_code`,`content_sha256`)
SELECT `id`,`principal_ref`,'SUBJECT',`subject_key`,`memory_policy_id`,`memory_policy_revision`,`revision`,
	CASE `status` WHEN 'CANDIDATE' THEN 'PROPOSED' WHEN 'APPROVED' THEN 'ACTIVE' WHEN 'REJECTED' THEN 'RESOLVED' ELSE 'DELETED' END,
	'PRINCIPAL_SUBJECT','LEGACY_SUBJECT',`kind`,`source_conversation_id`,`source_start_ordinal`,`source_end_ordinal`,
	CASE WHEN `status` in ('CANDIDATE','APPROVED') THEN `memory_text` ELSE NULL END,
	`confidence_units`,`created_at`,COALESCE(`deleted_at`,`reviewed_at`,`created_at`),`reviewed_at`,
	CASE WHEN `status` = 'REJECTED' THEN COALESCE(`reviewed_at`,`created_at`) ELSE NULL END,
	CASE WHEN `status` = 'DELETED' THEN `deleted_at` ELSE NULL END,
	`expires_at`,
	CASE WHEN `status` = 'REJECTED' THEN 'MEMORY_RESOLVED' WHEN `status` = 'DELETED' THEN 'MEMORY_DELETED' ELSE 'LEGACY_MIGRATED' END,
	NULL
FROM `__m10a2_memories_hold`;
--> statement-breakpoint
ALTER TABLE `__new_ai_memories` RENAME TO `ai_memories`;
--> statement-breakpoint
CREATE INDEX `ai_memories_principal_scope_index` ON `ai_memories` (`principal_ref`,`scope`,`subject_key`,`status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `ai_memories_source_conversation_index` ON `ai_memories` (`source_conversation_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memories_global_singleton_preference_unique` ON `ai_memories` (`principal_ref`,`kind`) WHERE `scope` = 'GLOBAL' AND `status` = 'ACTIVE' AND `kind` in ('PREFERRED_NAME','FORM_OF_ADDRESS','RESPONSE_DEPTH_PREFERENCE');
--> statement-breakpoint
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
	CONSTRAINT `ai_memory_executions_kind_valid` CHECK(`execution_kind` in ('EXTRACTION','COMPACTION')),
	CONSTRAINT `ai_memory_executions_schedule_valid` CHECK(length(trim(`schedule_key`)) between 1 and 500),
	CONSTRAINT `ai_memory_executions_principal_valid` CHECK(length(trim(`principal_ref`)) between 1 and 200),
	CONSTRAINT `ai_memory_executions_subject_valid` CHECK(length(trim(`subject_key`)) between 1 and 80),
	CONSTRAINT `ai_memory_executions_ordinals_valid` CHECK(`request_ordinal` >= 1 and `assistant_ordinal` > `request_ordinal`),
	CONSTRAINT `ai_memory_executions_config_valid` CHECK(`execution_config_revision` >= 1 and length(`execution_config_fingerprint`) = 64 and `execution_config_fingerprint` not glob '*[^0-9a-f]*'),
	CONSTRAINT `ai_memory_executions_dependency_revisions_valid` CHECK(`generation_model_config_revision` >= 1 and `generation_provider_config_revision` >= 1 and `budget_policy_revision` >= 1 and `rate_limit_policy_revision` >= 1),
	CONSTRAINT `ai_memory_executions_protocol_valid` CHECK(length(trim(`protocol_key`)) between 1 and 120 and `protocol_revision` >= 1),
	CONSTRAINT `ai_memory_executions_admission_valid` CHECK(`admission_attempt` between 0 and 100),
	CONSTRAINT `ai_memory_executions_status_valid` CHECK(`status` in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST')),
	CONSTRAINT `ai_memory_executions_invocation_valid` CHECK(`provider_invocation_state` in ('NOT_INVOKED','INVOKING','INVOKED_WITH_ACCOUNTING','AMBIGUOUS')),
	CONSTRAINT `ai_memory_executions_result_valid` CHECK(`result_sha256` is null or (length(`result_sha256`) = 64 and `result_sha256` not glob '*[^0-9a-f]*')),
	CONSTRAINT `ai_memory_executions_result_size_valid` CHECK(`result_byte_size` is null or `result_byte_size` between 0 and 262144),
	CONSTRAINT `ai_memory_executions_result_count_valid` CHECK(`result_count` between 0 and 100),
	CONSTRAINT `ai_memory_executions_summary_valid` CHECK((`result_summary_id` is null and `result_summary_revision` is null) or (`result_summary_id` is not null and `result_summary_revision` >= 1)),
	CONSTRAINT `ai_memory_executions_failure_valid` CHECK(`safe_failure_code` is null or (length(trim(`safe_failure_code`)) between 1 and 120 and `safe_failure_code` not glob '*[^A-Z0-9_.-]*')),
	CONSTRAINT `ai_memory_executions_timestamps_valid` CHECK(`created_at` >= 0 and `updated_at` >= `created_at` and (`started_at` is null or `started_at` >= `created_at`) and (`completed_at` is null or `completed_at` >= `created_at`))
);
--> statement-breakpoint
INSERT INTO `ai_memory_executions` SELECT * FROM `__m10a2_executions_hold`;
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_executions_schedule_unique` ON `ai_memory_executions` (`schedule_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_executions_job_unique` ON `ai_memory_executions` (`job_id`) WHERE `job_id` is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_executions_operation_unique` ON `ai_memory_executions` (`cost_operation_id`) WHERE `cost_operation_id` is not null;
--> statement-breakpoint
CREATE INDEX `ai_memory_executions_status_index` ON `ai_memory_executions` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `ai_memory_executions_source_index` ON `ai_memory_executions` (`conversation_id`,`response_id`);
--> statement-breakpoint
CREATE TABLE `ai_memory_execution_memory_links` (
	`execution_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`memory_id` text NOT NULL,
	PRIMARY KEY(`execution_id`,`ordinal`),
	FOREIGN KEY (`execution_id`) REFERENCES `ai_memory_executions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_id`) REFERENCES `ai_memories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `ai_memory_execution_memory_links_ordinal_valid` CHECK(`ordinal` between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_execution_memory_links_memory_unique` ON `ai_memory_execution_memory_links` (`execution_id`,`memory_id`);
--> statement-breakpoint
INSERT INTO `ai_memory_execution_memory_links` SELECT * FROM `__m10a2_memory_links_hold`;
--> statement-breakpoint
DROP TABLE `__m10a2_memory_links_hold`;
--> statement-breakpoint
DROP TABLE `__m10a2_executions_hold`;
--> statement-breakpoint
DROP TABLE `__m10a2_memories_hold`;
--> statement-breakpoint
DROP TABLE `__m10a2_policy_revisions_hold`;
--> statement-breakpoint
DROP TABLE `__m10a2_memory_policies_hold`;
--> statement-breakpoint
CREATE TABLE `ai_memory_provenance` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`memory_revision` integer NOT NULL,
	`principal_ref` text NOT NULL,
	`scope` text NOT NULL,
	`subject_key` text,
	`conversation_id` text NOT NULL,
	`response_id` text NOT NULL,
	`request_message_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`source_start_ordinal` integer NOT NULL,
	`source_end_ordinal` integer NOT NULL,
	`source_state` text NOT NULL DEFAULT 'ACTIVE',
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `ai_memories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `ai_memory_provenance_revision_valid` CHECK(`memory_revision` >= 1),
	CONSTRAINT `ai_memory_provenance_scope_valid` CHECK(`scope` in ('GLOBAL','SUBJECT') and ((`scope` = 'GLOBAL' and `subject_key` is null) or (`scope` = 'SUBJECT' and `subject_key` is not null and length(trim(`subject_key`)) between 1 and 80 and `subject_key` not glob '*[^a-z0-9-]*'))),
	CONSTRAINT `ai_memory_provenance_source_state_valid` CHECK(`source_state` in ('ACTIVE','DELETED')),
	CONSTRAINT `ai_memory_provenance_range_valid` CHECK(`source_start_ordinal` >= 1 and `source_end_ordinal` >= `source_start_ordinal` and `source_end_ordinal` - `source_start_ordinal` + 1 <= 10000),
	CONSTRAINT `ai_memory_provenance_created_nonnegative` CHECK(`created_at` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_provenance_evidence_unique` ON `ai_memory_provenance` (`memory_id`,`memory_revision`,`response_id`);
--> statement-breakpoint
CREATE INDEX `ai_memory_provenance_memory_index` ON `ai_memory_provenance` (`memory_id`,`memory_revision`);
--> statement-breakpoint
CREATE TABLE `ai_memory_mutation_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`principal_ref` text NOT NULL,
	`response_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`scope` text NOT NULL,
	`subject_key` text,
	`action` text NOT NULL,
	`memory_id` text,
	`expected_revision` integer,
	`kind` text,
	`origin` text,
	`confidence_units` integer,
	`memory_text` text,
	`status` text NOT NULL DEFAULT 'PENDING',
	`content_sha256` text,
	`created_at` integer NOT NULL,
	`applied_at` integer,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_id`) REFERENCES `ai_memories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `ai_memory_mutation_intents_scope_valid` CHECK(`scope` in ('GLOBAL','SUBJECT') and ((`scope` = 'GLOBAL' and `subject_key` is null) or (`scope` = 'SUBJECT' and `subject_key` is not null and `subject_key` not glob '*[^a-z0-9-]*'))),
	CONSTRAINT `ai_memory_mutation_intents_action_valid` CHECK(`action` in ('NOOP','CREATE','UPDATE','RESOLVE','DELETE')),
	CONSTRAINT `ai_memory_mutation_intents_status_valid` CHECK(`status` in ('PENDING','APPLIED','FAILED','CANCELLED')),
	CONSTRAINT `ai_memory_mutation_intents_revision_valid` CHECK(`expected_revision` is null or `expected_revision` >= 1),
	CONSTRAINT `ai_memory_mutation_intents_confidence_valid` CHECK(`confidence_units` is null or `confidence_units` between 0 and 1000000),
	CONSTRAINT `ai_memory_mutation_intents_text_valid` CHECK(`memory_text` is null or length(cast(`memory_text` as blob)) between 1 and 131072),
	CONSTRAINT `ai_memory_mutation_intents_hash_valid` CHECK(`content_sha256` is null or (length(`content_sha256`) = 64 and `content_sha256` not glob '*[^0-9a-f]*')),
	CONSTRAINT `ai_memory_mutation_intents_applied_valid` CHECK((`status` = 'PENDING' and `applied_at` is null) or (`status` = 'APPLIED' and `applied_at` is not null and `memory_text` is null) or (`status` in ('FAILED','CANCELLED') and `memory_text` is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_mutation_intents_command_unique` ON `ai_memory_mutation_intents` (`command_id`);
--> statement-breakpoint
CREATE INDEX `ai_memory_mutation_intents_status_index` ON `ai_memory_mutation_intents` (`status`,`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE `ai_memory_mutation_records` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`principal_ref` text NOT NULL,
	`response_id` text NOT NULL,
	`scope` text NOT NULL,
	`subject_key` text,
	`action` text NOT NULL,
	`memory_id` text,
	`origin` text,
	`expected_revision` integer,
	`result_revision` integer,
	`status` text NOT NULL,
	`content_sha256` text,
	`safe_error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_id`) REFERENCES `ai_memories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `ai_memory_mutation_records_scope_valid` CHECK(`scope` in ('GLOBAL','SUBJECT') and ((`scope` = 'GLOBAL' and `subject_key` is null) or (`scope` = 'SUBJECT' and `subject_key` is not null and `subject_key` not glob '*[^a-z0-9-]*'))),
	CONSTRAINT `ai_memory_mutation_records_action_valid` CHECK(`action` in ('NOOP','CREATE','UPDATE','RESOLVE','DELETE')),
	CONSTRAINT `ai_memory_mutation_records_status_valid` CHECK(`status` in ('APPLIED','REJECTED')),
	CONSTRAINT `ai_memory_mutation_records_revision_valid` CHECK((`expected_revision` is null or `expected_revision` >= 1) and (`result_revision` is null or `result_revision` >= 1)),
	CONSTRAINT `ai_memory_mutation_records_hash_valid` CHECK(`content_sha256` is null or (length(`content_sha256`) = 64 and `content_sha256` not glob '*[^0-9a-f]*')),
	CONSTRAINT `ai_memory_mutation_records_created_nonnegative` CHECK(`created_at` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_memory_mutation_records_command_unique` ON `ai_memory_mutation_records` (`command_id`);
--> statement-breakpoint
CREATE INDEX `ai_memory_mutation_records_principal_index` ON `ai_memory_mutation_records` (`principal_ref`,`created_at`);
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
 OR NEW.`scope` <> OLD.`scope`
 OR NEW.`subject_key` IS NOT OLD.`subject_key`
 OR NEW.`created_at` <> OLD.`created_at`
 OR NEW.`created_by` <> OLD.`created_by`
 OR NEW.`current_revision` NOT IN (OLD.`current_revision`, OLD.`current_revision` + 1)
 OR (NEW.`current_revision` = OLD.`current_revision` + 1 AND NOT EXISTS (SELECT 1 FROM `ai_memory_policy_revisions` revision WHERE revision.`memory_policy_id` = OLD.`id` AND revision.`revision` = NEW.`current_revision`))
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Policy identity or revision lifecycle is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policy_revisions_insert_valid`
BEFORE INSERT ON `ai_memory_policy_revisions`
WHEN NOT EXISTS (SELECT 1 FROM `ai_memory_policies` policy WHERE policy.`id` = NEW.`memory_policy_id`)
 OR NEW.`revision` <> COALESCE((SELECT MAX(existing.`revision`) + 1 FROM `ai_memory_policy_revisions` existing WHERE existing.`memory_policy_id` = NEW.`memory_policy_id`), 1)
 OR NOT json_valid(NEW.`allowed_kinds`)
 OR json_type(NEW.`allowed_kinds`) <> 'array'
 OR json_array_length(NEW.`allowed_kinds`) < 1
 OR EXISTS (SELECT 1 FROM json_each(NEW.`allowed_kinds`) kind WHERE kind.`type` <> 'text' OR kind.`value` NOT IN ('LEARNING_PREFERENCE','EXPLANATION_PREFERENCE','RESPONSE_DEPTH_PREFERENCE','FORM_OF_ADDRESS','PREFERRED_NAME','LEARNING_DIFFICULTY','STUDY_GOAL','STUDY_PROGRESS','LEARNING_STRATEGY_PREFERENCE'))
 OR (SELECT COUNT(*) FROM json_each(NEW.`allowed_kinds`)) <> (SELECT COUNT(DISTINCT kind.`value`) FROM json_each(NEW.`allowed_kinds`) kind)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory Policy revision scope, sequence, or allowed kinds are invalid');
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
WHEN NEW.`revision` <> 1
 OR NEW.`status` NOT IN ('PROPOSED','ACTIVE')
 OR (NEW.`status` = 'PROPOSED' AND NEW.`creation_origin` <> 'INFERRED')
 OR (NEW.`status` = 'ACTIVE' AND NEW.`creation_origin` <> 'EXPLICIT')
 OR NEW.`resolved_at` IS NOT NULL
 OR NEW.`deleted_at` IS NOT NULL
 OR NOT EXISTS (
	SELECT 1 FROM `ai_memory_policies` policy
	JOIN `ai_memory_policy_revisions` policy_revision ON policy_revision.`memory_policy_id` = policy.`id` AND policy_revision.`revision` = NEW.`memory_policy_revision`
	WHERE policy.`id` = NEW.`memory_policy_id`
	AND policy.`scope` = NEW.`scope`
	AND policy.`subject_key` IS NEW.`subject_key`
	AND policy_revision.`enabled` = 1
	AND policy_revision.`mutation_enabled` = 1
 )
 OR NOT EXISTS (
	SELECT 1 FROM `ai_conversations` conversation
	WHERE conversation.`id` = NEW.`source_conversation_id`
	AND conversation.`principal_ref` = NEW.`principal_ref`
	AND conversation.`status` = 'ACTIVE'
	AND conversation.`origin` = 'STUDENT'
 )
BEGIN
	SELECT RAISE(ABORT, 'AI Memory scope, policy, or Student source ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_quota_valid`
BEFORE INSERT ON `ai_memories`
WHEN (
	NEW.`status` = 'ACTIVE'
	AND (SELECT COUNT(*) FROM `ai_memories` existing WHERE existing.`principal_ref` = NEW.`principal_ref` AND existing.`scope` = NEW.`scope` AND existing.`subject_key` IS NEW.`subject_key` AND existing.`status` = 'ACTIVE') >= (SELECT revision.`hard_active_maximum` FROM `ai_memory_policy_revisions` revision WHERE revision.`memory_policy_id` = NEW.`memory_policy_id` AND revision.`revision` = NEW.`memory_policy_revision`)
 ) OR (
	NEW.`status` = 'PROPOSED'
	AND (SELECT COUNT(*) FROM `ai_memories` existing WHERE existing.`principal_ref` = NEW.`principal_ref` AND existing.`scope` = NEW.`scope` AND existing.`subject_key` IS NEW.`subject_key` AND existing.`status` = 'PROPOSED') >= (SELECT revision.`proposed_hard_maximum` FROM `ai_memory_policy_revisions` revision WHERE revision.`memory_policy_id` = NEW.`memory_policy_id` AND revision.`revision` = NEW.`memory_policy_revision`)
 )
BEGIN
	SELECT RAISE(ABORT, 'AI Memory scope quota has been reached');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_retention_valid`
BEFORE INSERT ON `ai_memories`
WHEN NEW.`expires_at` <> NEW.`created_at` + (SELECT revision.`retention_days` * 86400000 FROM `ai_memory_policy_revisions` revision WHERE revision.`memory_policy_id` = NEW.`memory_policy_id` AND revision.`revision` = NEW.`memory_policy_revision`)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory retention does not match its pinned Policy');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_update_retention_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`expires_at` <> NEW.`created_at` + (SELECT revision.`retention_days` * 86400000 FROM `ai_memory_policy_revisions` revision WHERE revision.`memory_policy_id` = NEW.`memory_policy_id` AND revision.`revision` = NEW.`memory_policy_revision`)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory retention does not match its pinned Policy');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_text_bound_valid`
BEFORE INSERT ON `ai_memories`
WHEN NEW.`memory_text` IS NOT NULL
 AND length(cast(NEW.`memory_text` as blob)) > (SELECT revision.`per_memory_max_bytes` FROM `ai_memory_policy_revisions` revision WHERE revision.`memory_policy_id` = NEW.`memory_policy_id` AND revision.`revision` = NEW.`memory_policy_revision`)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory text exceeds its pinned Policy bound');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_update_text_bound_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`memory_text` IS NOT NULL
 AND length(cast(NEW.`memory_text` as blob)) > (SELECT revision.`per_memory_max_bytes` FROM `ai_memory_policy_revisions` revision WHERE revision.`memory_policy_id` = NEW.`memory_policy_id` AND revision.`revision` = NEW.`memory_policy_revision`)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory text exceeds its pinned Policy bound');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_no_delete`
BEFORE DELETE ON `ai_memories`
BEGIN
	SELECT RAISE(ABORT, 'AI Memories are immutable durable lifecycle records');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_safe_review_valid`
BEFORE UPDATE ON `ai_memories`
WHEN (NEW.`status` = 'PROPOSED' AND NEW.`safe_review_code` NOT IN ('INFERRED_PROPOSED','LEGACY_MIGRATED'))
 OR (NEW.`status` = 'ACTIVE' AND NEW.`safe_review_code` NOT IN ('EXPLICIT_CREATED','INFERRED_ACTIVATED','LEGACY_MIGRATED','STUDENT_APPROVED'))
 OR (NEW.`status` = 'RESOLVED' AND NEW.`safe_review_code` <> 'MEMORY_RESOLVED')
 OR (NEW.`status` = 'EXPIRED' AND NEW.`safe_review_code` <> 'MEMORY_EXPIRED')
 OR (NEW.`status` = 'DELETED' AND NEW.`safe_review_code` NOT IN ('MEMORY_DELETED','CONVERSATION_DELETED','PRINCIPAL_PURGED'))
BEGIN
	SELECT RAISE(ABORT, 'AI Memory lifecycle review code is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_lifecycle_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`id` <> OLD.`id`
 OR NEW.`principal_ref` <> OLD.`principal_ref`
 OR NEW.`scope` <> OLD.`scope`
 OR NEW.`subject_key` IS NOT OLD.`subject_key`
 OR NEW.`memory_policy_id` <> OLD.`memory_policy_id`
 OR NEW.`memory_policy_revision` <> OLD.`memory_policy_revision`
 OR NEW.`creation_origin` <> OLD.`creation_origin`
 OR NEW.`source_conversation_id` <> OLD.`source_conversation_id`
 OR NEW.`source_start_ordinal` <> OLD.`source_start_ordinal`
 OR NEW.`source_end_ordinal` <> OLD.`source_end_ordinal`
 OR NEW.`visibility_scope` <> OLD.`visibility_scope`
 OR NEW.`created_at` <> OLD.`created_at`
 OR NEW.`revision` <> OLD.`revision` + 1
 OR OLD.`status` IN ('RESOLVED','EXPIRED','DELETED')
 OR (NEW.`status` IN ('RESOLVED','EXPIRED','DELETED') AND NEW.`memory_text` IS NOT NULL)
 OR (NEW.`status` = 'RESOLVED' AND NEW.`resolved_at` IS NULL)
 OR (NEW.`status` = 'DELETED' AND NEW.`deleted_at` IS NULL)
 OR (NEW.`status` = 'ACTIVE' AND NEW.`memory_text` IS NULL)
 OR (NEW.`status` = 'ACTIVE' AND NEW.`creation_origin` = 'INFERRED' AND NOT EXISTS (SELECT 1 FROM `ai_memory_provenance` evidence WHERE evidence.`memory_id` = OLD.`id` AND evidence.`memory_revision` = OLD.`revision` AND evidence.`source_state` = 'ACTIVE'))
BEGIN
	SELECT RAISE(ABORT, 'AI Memory lifecycle, scope, or optimistic revision is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_update_quota_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`status` = 'ACTIVE' AND OLD.`status` <> 'ACTIVE' AND (SELECT COUNT(*) FROM `ai_memories` existing WHERE existing.`principal_ref` = NEW.`principal_ref` AND existing.`scope` = NEW.`scope` AND existing.`subject_key` IS NEW.`subject_key` AND existing.`status` = 'ACTIVE') >= (SELECT revision.`hard_active_maximum` FROM `ai_memory_policy_revisions` revision WHERE revision.`memory_policy_id` = NEW.`memory_policy_id` AND revision.`revision` = NEW.`memory_policy_revision`)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory active quota has been reached');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_provenance_insert_valid`
BEFORE INSERT ON `ai_memory_provenance`
WHEN NOT EXISTS (
	SELECT 1
	FROM `ai_memories` memory
	JOIN `ai_conversations` conversation ON conversation.`id` = NEW.`conversation_id`
	JOIN `ai_conversation_responses` response ON response.`id` = NEW.`response_id`
	JOIN `ai_conversation_messages` request ON request.`id` = NEW.`request_message_id`
	JOIN `ai_conversation_messages` assistant ON assistant.`id` = NEW.`assistant_message_id`
	WHERE memory.`id` = NEW.`memory_id`
	AND memory.`revision` = NEW.`memory_revision`
	AND memory.`status` IN ('PROPOSED','ACTIVE')
	AND memory.`principal_ref` = NEW.`principal_ref`
	AND memory.`scope` = NEW.`scope`
	AND memory.`subject_key` IS NEW.`subject_key`
	AND conversation.`id` = response.`conversation_id`
	AND conversation.`principal_ref` = NEW.`principal_ref`
	AND conversation.`status` = 'ACTIVE'
	AND conversation.`origin` = 'STUDENT'
	AND response.`principal_ref` = NEW.`principal_ref`
	AND response.`status` = 'COMPLETED'
	AND response.`request_message_id` = NEW.`request_message_id`
	AND response.`assistant_message_id` = NEW.`assistant_message_id`
	AND request.`conversation_id` = conversation.`id`
	AND request.`role` = 'USER'
	AND request.`is_partial` = 0
	AND request.`ordinal` = NEW.`source_start_ordinal`
	AND assistant.`conversation_id` = conversation.`id`
	AND assistant.`role` = 'ASSISTANT'
	AND assistant.`is_partial` = 0
	AND assistant.`ordinal` = NEW.`source_end_ordinal`
	AND assistant.`ordinal` = request.`ordinal` + 1
	AND NEW.`source_state` = 'ACTIVE'
	AND ((NEW.`scope` = 'GLOBAL' AND NEW.`subject_key` IS NULL) OR (NEW.`scope` = 'SUBJECT' AND NEW.`subject_key` = conversation.`subject_key`))
)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory provenance must reference an owned completed Student turn');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_provenance_no_delete`
BEFORE DELETE ON `ai_memory_provenance`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory provenance is durable metadata');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_provenance_lifecycle_valid`
BEFORE UPDATE ON `ai_memory_provenance`
WHEN NOT (
	OLD.`source_state` = 'ACTIVE'
	AND NEW.`source_state` = 'DELETED'
	AND (EXISTS (SELECT 1 FROM `ai_conversations` conversation WHERE conversation.`id` = OLD.`conversation_id` AND conversation.`status` = 'DELETED') OR EXISTS (SELECT 1 FROM `ai_memories` memory WHERE memory.`id` = OLD.`memory_id` AND memory.`status` IN ('RESOLVED','EXPIRED','DELETED')))
)
OR NEW.`id` <> OLD.`id`
OR NEW.`memory_id` <> OLD.`memory_id`
OR NEW.`memory_revision` <> OLD.`memory_revision`
OR NEW.`principal_ref` <> OLD.`principal_ref`
OR NEW.`scope` <> OLD.`scope`
OR NEW.`subject_key` IS NOT OLD.`subject_key`
OR NEW.`conversation_id` <> OLD.`conversation_id`
OR NEW.`response_id` <> OLD.`response_id`
OR NEW.`request_message_id` <> OLD.`request_message_id`
OR NEW.`assistant_message_id` <> OLD.`assistant_message_id`
OR NEW.`source_start_ordinal` <> OLD.`source_start_ordinal`
OR NEW.`source_end_ordinal` <> OLD.`source_end_ordinal`
OR NEW.`created_at` <> OLD.`created_at`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory provenance is immutable outside source tombstoning');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_mutation_intents_insert_valid`
BEFORE INSERT ON `ai_memory_mutation_intents`
WHEN NEW.`status` <> 'PENDING'
 OR NEW.`applied_at` IS NOT NULL
 OR NOT EXISTS (
	SELECT 1 FROM `ai_conversation_responses` response
	JOIN `ai_conversations` conversation ON conversation.`id` = response.`conversation_id`
	WHERE response.`id` = NEW.`response_id`
	AND response.`conversation_id` = NEW.`conversation_id`
	AND response.`principal_ref` = NEW.`principal_ref`
	AND conversation.`principal_ref` = NEW.`principal_ref`
	AND conversation.`origin` = 'STUDENT'
	AND conversation.`status` = 'ACTIVE'
	AND ((NEW.`scope` = 'GLOBAL' AND NEW.`subject_key` IS NULL) OR (NEW.`scope` = 'SUBJECT' AND NEW.`subject_key` = conversation.`subject_key`))
 )
 OR (NEW.`action` = 'NOOP' AND (NEW.`memory_id` IS NOT NULL OR NEW.`kind` IS NOT NULL OR NEW.`origin` IS NOT NULL OR NEW.`memory_text` IS NOT NULL OR NEW.`expected_revision` IS NOT NULL))
 OR (NEW.`action` = 'CREATE' AND (NEW.`memory_id` IS NOT NULL OR NEW.`kind` IS NULL OR NEW.`origin` NOT IN ('EXPLICIT','INFERRED') OR NEW.`memory_text` IS NULL))
 OR (NEW.`action` IN ('UPDATE','RESOLVE','DELETE') AND (NEW.`memory_id` IS NULL OR NEW.`expected_revision` IS NULL))
BEGIN
	SELECT RAISE(ABORT, 'AI Memory mutation intent ownership or action shape is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_mutation_intents_lifecycle_valid`
BEFORE UPDATE ON `ai_memory_mutation_intents`
WHEN NOT (
	OLD.`status` = 'PENDING'
	AND NEW.`status` IN ('APPLIED','FAILED','CANCELLED')
	AND NEW.`applied_at` IS NOT NULL
	AND NEW.`memory_text` IS NULL
)
OR NEW.`id` <> OLD.`id`
OR NEW.`command_id` <> OLD.`command_id`
OR NEW.`principal_ref` <> OLD.`principal_ref`
OR NEW.`response_id` <> OLD.`response_id`
OR NEW.`conversation_id` <> OLD.`conversation_id`
OR NEW.`scope` <> OLD.`scope`
OR NEW.`subject_key` IS NOT OLD.`subject_key`
OR NEW.`action` <> OLD.`action`
OR NEW.`memory_id` IS NOT OLD.`memory_id`
OR NEW.`expected_revision` IS NOT OLD.`expected_revision`
OR NEW.`kind` IS NOT OLD.`kind`
OR NEW.`origin` IS NOT OLD.`origin`
OR NEW.`confidence_units` IS NOT OLD.`confidence_units`
OR NEW.`content_sha256` IS NOT OLD.`content_sha256`
OR NEW.`created_at` <> OLD.`created_at`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory mutation intent is immutable after terminalization');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_mutation_intents_no_delete`
BEFORE DELETE ON `ai_memory_mutation_intents`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory mutation intents are durable lifecycle records');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_mutation_records_insert_valid`
BEFORE INSERT ON `ai_memory_mutation_records`
WHEN NOT EXISTS (
	SELECT 1 FROM `ai_conversation_responses` response
	JOIN `ai_conversations` conversation ON conversation.`id` = response.`conversation_id`
	WHERE response.`id` = NEW.`response_id`
	AND response.`principal_ref` = NEW.`principal_ref`
	AND conversation.`id` = response.`conversation_id`
	AND conversation.`principal_ref` = NEW.`principal_ref`
	AND ((NEW.`scope` = 'GLOBAL' AND NEW.`subject_key` IS NULL) OR (NEW.`scope` = 'SUBJECT' AND NEW.`subject_key` = conversation.`subject_key`))
 )
BEGIN
	SELECT RAISE(ABORT, 'AI Memory mutation record ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_mutation_records_no_update`
BEFORE UPDATE ON `ai_memory_mutation_records`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory mutation records are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_mutation_records_no_delete`
BEFORE DELETE ON `ai_memory_mutation_records`
BEGIN
	SELECT RAISE(ABORT, 'AI Memory mutation records are immutable');
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
	AND policy.`scope` = 'SUBJECT'
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
  OR OLD.`status` IN ('COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST') AND NEW.`status` <> OLD.`status`
  OR OLD.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING' AND NEW.`provider_invocation_state` = 'NOT_INVOKED'
  OR NEW.`provider_invoked` = 1 AND NEW.`provider_invocation_state` = 'NOT_INVOKED'
  OR NEW.`provider_invocation_state` = 'INVOKING' AND OLD.`provider_invocation_state` <> 'NOT_INVOKED'
  OR NEW.`status` = 'PENDING' AND NEW.`provider_invocation_state` <> 'NOT_INVOKED'
  OR NEW.`status` = 'PENDING' AND NEW.`started_at` IS NOT NULL
  OR NEW.`status` = 'RUNNING' AND NEW.`started_at` IS NULL
  OR NEW.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING' AND NEW.`provider_invoked` <> 1
  OR NEW.`provider_invocation_state` = 'AMBIGUOUS' AND NEW.`provider_invoked` <> 1
  OR NEW.`provider_invocation_state` = 'INVOKING' AND NEW.`status` <> 'RUNNING'
  OR NEW.`status` IN ('COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST') AND NEW.`completed_at` IS NULL
  OR NEW.`status` IN ('PENDING','RUNNING') AND NEW.`completed_at` IS NOT NULL
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
	AND memory.`scope` = 'SUBJECT'
	AND memory.`subject_key` = execution.`subject_key`
	AND memory.`source_conversation_id` = execution.`conversation_id`
	AND memory.`source_start_ordinal` = execution.`request_ordinal`
	AND memory.`source_end_ordinal` = execution.`assistant_ordinal`
	AND memory.`status` IN ('PROPOSED','ACTIVE')
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
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_memory_links_exact_owner`
BEFORE INSERT ON `ai_memory_execution_memory_links`
WHEN NOT EXISTS (
	SELECT 1 FROM `ai_memory_execution_memory_links` existing_link
	WHERE existing_link.`execution_id` = NEW.`execution_id`
	AND existing_link.`ordinal` = NEW.`ordinal`
)
AND NOT EXISTS (
	SELECT 1
	FROM `ai_memory_executions` execution
	JOIN `ai_memories` memory ON memory.`id` = NEW.`memory_id`
	WHERE execution.`id` = NEW.`execution_id`
	AND execution.`execution_kind` = 'EXTRACTION'
	AND execution.`status` = 'RUNNING'
	AND execution.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING'
	AND execution.`provider_invoked` = 1
	AND execution.`cost_operation_id` IS NOT NULL
	AND execution.`budget_reservation_id` IS NOT NULL
	AND memory.`status` = 'PROPOSED'
	AND memory.`principal_ref` = execution.`principal_ref`
	AND memory.`scope` = 'SUBJECT'
	AND memory.`subject_key` = execution.`subject_key`
	AND memory.`memory_policy_id` = execution.`memory_policy_id`
	AND memory.`memory_policy_revision` = execution.`memory_policy_revision`
)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution result Policy ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_executions_result_commit_valid`
BEFORE UPDATE ON `ai_memory_executions`
WHEN NEW.`status` = 'COMPLETED'
AND (
	OLD.`status` <> 'RUNNING'
	OR OLD.`provider_invocation_state` <> 'INVOKED_WITH_ACCOUNTING'
	OR OLD.`provider_invoked` <> 1
	OR NEW.`provider_invocation_state` <> 'INVOKED_WITH_ACCOUNTING'
	OR NEW.`provider_invoked` <> 1
	OR NEW.`cost_operation_id` IS NULL
	OR NEW.`budget_reservation_id` IS NULL
	OR NEW.`result_sha256` IS NULL
	OR NEW.`result_byte_size` IS NULL
	OR NOT EXISTS (SELECT 1 FROM `ai_cost_operations` operation WHERE operation.`id` = NEW.`cost_operation_id` AND operation.`cost_center` = 'STUDENT_GENERATION' AND operation.`opaque_principal_ref` = NEW.`principal_ref` AND operation.`subject_key` = NEW.`subject_key` AND operation.`conversation_id` = NEW.`conversation_id` AND operation.`response_id` = NEW.`response_id` AND operation.`status` = 'OPEN')
	OR NOT EXISTS (SELECT 1 FROM `ai_budget_reservations` reservation WHERE reservation.`id` = NEW.`budget_reservation_id` AND reservation.`operation_id` = NEW.`cost_operation_id` AND reservation.`status` = 'EXECUTING')
	OR NOT EXISTS (SELECT 1 FROM `ai_usage_cost_records` usage_record WHERE usage_record.`operation_id` = NEW.`cost_operation_id` AND usage_record.`capability` = 'GENERATION')
	OR (NEW.`execution_kind` = 'EXTRACTION' AND (NEW.`result_summary_id` IS NOT NULL OR NEW.`result_summary_revision` IS NOT NULL OR (SELECT COUNT(*) FROM `ai_memory_execution_memory_links` result_link WHERE result_link.`execution_id` = NEW.`id`) <> NEW.`result_count`))
	OR (NEW.`execution_kind` = 'COMPACTION' AND NOT EXISTS (SELECT 1 FROM `ai_conversation_summary_revisions` summary WHERE summary.`id` = NEW.`result_summary_id` AND summary.`conversation_id` = NEW.`conversation_id` AND summary.`principal_ref` = NEW.`principal_ref` AND summary.`subject_key` = NEW.`subject_key` AND summary.`revision` = NEW.`result_summary_revision` AND summary.`status` = 'ACTIVE' AND summary.`summary_text` IS NOT NULL))
)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution completion requires proven Provider accounting');
END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
