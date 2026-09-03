CREATE TABLE `ai_eval_case_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`case_revision` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`subject_key` text NOT NULL,
	`execution_config_id` text NOT NULL,
	`execution_config_revision` integer NOT NULL,
	`execution_config_fingerprint` text NOT NULL,
	`execution_protocol_key` text NOT NULL,
	`execution_protocol_revision` integer NOT NULL,
	`cleanup_protocol_key` text NOT NULL,
	`cleanup_protocol_revision` integer NOT NULL,
	`target_cost_operation_id` text,
	`budget_reservation_id` text,
	`job_id` text,
	`status` text NOT NULL,
	`provider_invocation_state` text NOT NULL,
	`provider_invoked` integer DEFAULT false NOT NULL,
	`output_sha256` text,
	`output_byte_size` integer,
	`finish_reason` text,
	`retrieval_status` text,
	`candidate_fingerprint` text NOT NULL,
	`plan_fingerprint` text,
	`safe_failure_code` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`case_id`) REFERENCES `ai_eval_cases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`execution_config_id`) REFERENCES `ai_eval_execution_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_reservation_id`) REFERENCES `ai_budget_reservations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_case_executions_case_revision_valid" CHECK("ai_eval_case_executions"."case_revision" >= 1 and "ai_eval_case_executions"."ordinal" between 1 and 10000),
	CONSTRAINT "ai_eval_case_executions_subject_valid" CHECK(length(trim("ai_eval_case_executions"."subject_key")) between 1 and 80),
	CONSTRAINT "ai_eval_case_executions_config_revision_valid" CHECK("ai_eval_case_executions"."execution_config_revision" >= 1),
	CONSTRAINT "ai_eval_case_executions_fingerprints_valid" CHECK(length("ai_eval_case_executions"."execution_config_fingerprint") = 64 and "ai_eval_case_executions"."execution_config_fingerprint" not glob '*[^0-9a-f]*' and length("ai_eval_case_executions"."candidate_fingerprint") = 64 and "ai_eval_case_executions"."candidate_fingerprint" not glob '*[^0-9a-f]*' and ("ai_eval_case_executions"."plan_fingerprint" is null or (length("ai_eval_case_executions"."plan_fingerprint") = 64 and "ai_eval_case_executions"."plan_fingerprint" not glob '*[^0-9a-f]*'))),
	CONSTRAINT "ai_eval_case_executions_status_valid" CHECK("ai_eval_case_executions"."status" in ('PENDING','RUNNING','COMPLETED','BLOCKED','FAILED','CANCELLED','AMBIGUOUS')),
	CONSTRAINT "ai_eval_case_executions_invocation_state_valid" CHECK("ai_eval_case_executions"."provider_invocation_state" in ('NOT_INVOKED','INVOKING','INVOKED_WITH_ACCOUNTING','AMBIGUOUS')),
	CONSTRAINT "ai_eval_case_executions_output_valid" CHECK("ai_eval_case_executions"."output_sha256" is null or (length("ai_eval_case_executions"."output_sha256") = 64 and "ai_eval_case_executions"."output_sha256" not glob '*[^0-9a-f]*')),
	CONSTRAINT "ai_eval_case_executions_output_size_valid" CHECK("ai_eval_case_executions"."output_byte_size" is null or "ai_eval_case_executions"."output_byte_size" between 0 and 524288),
	CONSTRAINT "ai_eval_case_executions_finish_valid" CHECK("ai_eval_case_executions"."finish_reason" is null or "ai_eval_case_executions"."finish_reason" in ('STOP','LENGTH','CONTENT_FILTER','OTHER','FAILED','CANCELLED')),
	CONSTRAINT "ai_eval_case_executions_retrieval_valid" CHECK("ai_eval_case_executions"."retrieval_status" is null or "ai_eval_case_executions"."retrieval_status" in ('SUFFICIENT','INSUFFICIENT','NOT_APPLICABLE')),
	CONSTRAINT "ai_eval_case_executions_protocol_valid" CHECK(length(trim("ai_eval_case_executions"."execution_protocol_key")) between 1 and 120 and "ai_eval_case_executions"."execution_protocol_revision" >= 1 and length(trim("ai_eval_case_executions"."cleanup_protocol_key")) between 1 and 120 and "ai_eval_case_executions"."cleanup_protocol_revision" >= 1),
	CONSTRAINT "ai_eval_case_executions_timestamps_valid" CHECK("ai_eval_case_executions"."created_at" >= 0 and "ai_eval_case_executions"."updated_at" >= "ai_eval_case_executions"."created_at" and ("ai_eval_case_executions"."started_at" is null or "ai_eval_case_executions"."started_at" >= "ai_eval_case_executions"."created_at") and ("ai_eval_case_executions"."completed_at" is null or "ai_eval_case_executions"."completed_at" >= "ai_eval_case_executions"."created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_case_executions_run_case_unique` ON `ai_eval_case_executions` (`run_id`,`case_id`,`case_revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_case_executions_run_ordinal_unique` ON `ai_eval_case_executions` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_case_executions_job_unique` ON `ai_eval_case_executions` (`job_id`) WHERE "ai_eval_case_executions"."job_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_case_executions_operation_unique` ON `ai_eval_case_executions` (`target_cost_operation_id`) WHERE "ai_eval_case_executions"."target_cost_operation_id" is not null;--> statement-breakpoint
CREATE INDEX `ai_eval_case_executions_status_index` ON `ai_eval_case_executions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_eval_case_executions_run_index` ON `ai_eval_case_executions` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `ai_eval_case_executions_job_index` ON `ai_eval_case_executions` (`job_id`,`status`);--> statement-breakpoint
CREATE TABLE `ai_eval_execution_config_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_config_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`budget_policy_id` text NOT NULL,
	`budget_policy_revision` integer NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`rate_limit_policy_revision` integer NOT NULL,
	`protocol_key` text NOT NULL,
	`protocol_revision` integer NOT NULL,
	`target_timeout_ms` integer NOT NULL,
	`max_concurrency` integer NOT NULL,
	`cleanup_protocol_key` text NOT NULL,
	`cleanup_protocol_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`execution_config_id`) REFERENCES `ai_eval_execution_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_policy_id`) REFERENCES `ai_budget_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_execution_config_revisions_revision_positive" CHECK("ai_eval_execution_config_revisions"."revision" >= 1),
	CONSTRAINT "ai_eval_execution_config_revisions_display_name_valid" CHECK(length(trim("ai_eval_execution_config_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_eval_execution_config_revisions_enabled_boolean" CHECK("ai_eval_execution_config_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_eval_execution_config_revisions_policy_revision_valid" CHECK("ai_eval_execution_config_revisions"."budget_policy_revision" >= 1 and "ai_eval_execution_config_revisions"."rate_limit_policy_revision" >= 1),
	CONSTRAINT "ai_eval_execution_config_revisions_protocol_valid" CHECK(length(trim("ai_eval_execution_config_revisions"."protocol_key")) between 1 and 120 and "ai_eval_execution_config_revisions"."protocol_key" not glob '*[^a-z0-9.-]*' and "ai_eval_execution_config_revisions"."protocol_revision" >= 1 and length(trim("ai_eval_execution_config_revisions"."cleanup_protocol_key")) between 1 and 120 and "ai_eval_execution_config_revisions"."cleanup_protocol_key" not glob '*[^a-z0-9.-]*' and "ai_eval_execution_config_revisions"."cleanup_protocol_revision" >= 1),
	CONSTRAINT "ai_eval_execution_config_revisions_bounds_valid" CHECK("ai_eval_execution_config_revisions"."target_timeout_ms" between 100 and 86400000 and "ai_eval_execution_config_revisions"."max_concurrency" between 1 and 100),
	CONSTRAINT "ai_eval_execution_config_revisions_created_nonnegative" CHECK("ai_eval_execution_config_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_execution_config_revisions_identity_unique` ON `ai_eval_execution_config_revisions` (`execution_config_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_eval_execution_config_revisions_config_index` ON `ai_eval_execution_config_revisions` (`execution_config_id`,`revision`);--> statement-breakpoint
CREATE TABLE `ai_eval_execution_configs` (
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
	CONSTRAINT "ai_eval_execution_configs_key_valid" CHECK(length(trim("ai_eval_execution_configs"."key")) between 1 and 120 and "ai_eval_execution_configs"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_eval_execution_configs_subject_valid" CHECK(length(trim("ai_eval_execution_configs"."subject_key")) between 1 and 80 and "ai_eval_execution_configs"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_eval_execution_configs_revision_positive" CHECK("ai_eval_execution_configs"."current_revision" >= 1),
	CONSTRAINT "ai_eval_execution_configs_created_nonnegative" CHECK("ai_eval_execution_configs"."created_at" >= 0),
	CONSTRAINT "ai_eval_execution_configs_timestamps_ordered" CHECK("ai_eval_execution_configs"."updated_at" >= "ai_eval_execution_configs"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_execution_configs_key_unique` ON `ai_eval_execution_configs` (`key`);--> statement-breakpoint
CREATE INDEX `ai_eval_execution_configs_subject_index` ON `ai_eval_execution_configs` (`subject_key`);--> statement-breakpoint
CREATE TABLE `ai_eval_run_execution_bindings` (
	`run_id` text PRIMARY KEY NOT NULL,
	`execution_config_id` text NOT NULL,
	`execution_config_revision` integer NOT NULL,
	`execution_config_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`execution_config_id`) REFERENCES `ai_eval_execution_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_run_execution_bindings_revision_valid" CHECK("ai_eval_run_execution_bindings"."execution_config_revision" >= 1),
	CONSTRAINT "ai_eval_run_execution_bindings_fingerprint_valid" CHECK(length("ai_eval_run_execution_bindings"."execution_config_fingerprint") = 64 and "ai_eval_run_execution_bindings"."execution_config_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_eval_run_execution_bindings_created_nonnegative" CHECK("ai_eval_run_execution_bindings"."created_at" >= 0),
	CONSTRAINT "ai_eval_run_execution_bindings_actor_valid" CHECK(length(trim("ai_eval_run_execution_bindings"."created_by")) between 1 and 200)
);
--> statement-breakpoint
CREATE INDEX `ai_eval_run_execution_bindings_config_index` ON `ai_eval_run_execution_bindings` (`execution_config_id`,`execution_config_revision`);
--> statement-breakpoint
CREATE TRIGGER `ai_eval_execution_configs_identity_immutable`
BEFORE UPDATE ON `ai_eval_execution_configs`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`key` IS NOT OLD.`key` OR NEW.`subject_key` IS NOT OLD.`subject_key` OR NEW.`created_at` IS NOT OLD.`created_at` OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN SELECT RAISE(ABORT, 'Eval Execution Config identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_execution_configs_revision_advance_valid`
BEFORE UPDATE ON `ai_eval_execution_configs`
WHEN NEW.`current_revision` <> OLD.`current_revision` + 1 OR NOT EXISTS (SELECT 1 FROM `ai_eval_execution_config_revisions` revision WHERE revision.`execution_config_id` = NEW.`id` AND revision.`revision` = NEW.`current_revision`)
BEGIN SELECT RAISE(ABORT, 'Eval Execution Config revisions must advance by one'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_execution_configs_pointer_only`
BEFORE UPDATE ON `ai_eval_execution_configs`
WHEN NEW.`current_revision` = OLD.`current_revision` AND (NEW.`updated_at` IS NOT OLD.`updated_at` OR NEW.`updated_by` IS NOT OLD.`updated_by`)
BEGIN SELECT RAISE(ABORT, 'Eval Execution Config updates require a new revision'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_execution_config_revisions_insert_valid`
BEFORE INSERT ON `ai_eval_execution_config_revisions`
WHEN NEW.`revision` <> COALESCE((SELECT MAX(revision) + 1 FROM `ai_eval_execution_config_revisions` WHERE execution_config_id = NEW.`execution_config_id`), 1)
 OR NEW.`protocol_key` <> 'eval-target-v1' OR NEW.`protocol_revision` <> 1
 OR NEW.`cleanup_protocol_key` <> 'synthetic-c4-cleanup-v1' OR NEW.`cleanup_protocol_revision` <> 1
 OR NOT EXISTS (SELECT 1 FROM `ai_eval_execution_configs` config WHERE config.`id` = NEW.`execution_config_id`)
 OR NOT EXISTS (SELECT 1 FROM `ai_budget_policy_revisions` policy WHERE policy.`budget_policy_id` = NEW.`budget_policy_id` AND policy.`revision` = NEW.`budget_policy_revision` AND policy.`enabled` = 1 AND policy.`cost_center` = 'EVALS')
 OR NOT EXISTS (SELECT 1 FROM `ai_rate_limit_policy_revisions` policy WHERE policy.`rate_limit_policy_id` = NEW.`rate_limit_policy_id` AND policy.`revision` = NEW.`rate_limit_policy_revision` AND policy.`enabled` = 1)
BEGIN SELECT RAISE(ABORT, 'Eval Execution Config revision is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_execution_config_revisions_update_blocked`
BEFORE UPDATE ON `ai_eval_execution_config_revisions`
BEGIN SELECT RAISE(ABORT, 'Eval Execution Config revisions are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_execution_config_revisions_delete_blocked`
BEFORE DELETE ON `ai_eval_execution_config_revisions`
BEGIN SELECT RAISE(ABORT, 'Eval Execution Config revision history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_execution_configs_delete_blocked`
BEFORE DELETE ON `ai_eval_execution_configs`
BEGIN SELECT RAISE(ABORT, 'Eval Execution Config history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_run_execution_bindings_insert_valid`
BEFORE INSERT ON `ai_eval_run_execution_bindings`
WHEN NOT EXISTS (
 SELECT 1 FROM `ai_eval_runs` run
 JOIN `ai_eval_execution_configs` config ON config.`id` = NEW.`execution_config_id`
 JOIN `ai_eval_execution_config_revisions` revision ON revision.`execution_config_id` = config.`id` AND revision.`revision` = NEW.`execution_config_revision`
 WHERE run.`id` = NEW.`run_id` AND run.`status` = 'CREATED'
 AND config.`subject_key` = (SELECT subject_key FROM `ai_eval_suites` WHERE id = run.`suite_id`)
)
BEGIN SELECT RAISE(ABORT, 'Eval Run execution binding is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_run_execution_bindings_update_blocked`
BEFORE UPDATE ON `ai_eval_run_execution_bindings`
BEGIN SELECT RAISE(ABORT, 'Eval Run execution bindings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_run_execution_bindings_delete_blocked`
BEFORE DELETE ON `ai_eval_run_execution_bindings`
BEGIN SELECT RAISE(ABORT, 'Eval Run execution bindings are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_insert_valid`
BEFORE INSERT ON `ai_eval_case_executions`
WHEN NOT EXISTS (
 SELECT 1
 FROM `ai_eval_runs` run
 JOIN `ai_eval_suites` suite ON suite.`id` = run.`suite_id`
 JOIN `ai_eval_suite_revisions` suite_revision ON suite_revision.`suite_id` = run.`suite_id` AND suite_revision.`revision` = run.`suite_revision`
 JOIN `ai_eval_suite_case_refs` manifest ON manifest.`suite_revision_id` = suite_revision.`id` AND manifest.`case_id` = NEW.`case_id` AND manifest.`case_revision` = NEW.`case_revision` AND manifest.`ordinal` = NEW.`ordinal`
 JOIN `ai_eval_case_revisions` case_revision ON case_revision.`case_id` = NEW.`case_id` AND case_revision.`revision` = NEW.`case_revision`
 JOIN `ai_eval_run_execution_bindings` binding ON binding.`run_id` = run.`id` AND binding.`execution_config_id` = NEW.`execution_config_id` AND binding.`execution_config_revision` = NEW.`execution_config_revision` AND binding.`execution_config_fingerprint` = NEW.`execution_config_fingerprint`
 WHERE run.`id` = NEW.`run_id` AND run.`status` = 'RUNNING' AND suite.`subject_key` = NEW.`subject_key` AND case_revision.`subject_key` = NEW.`subject_key`
 AND NEW.`status` = 'PENDING' AND NEW.`provider_invocation_state` = 'NOT_INVOKED' AND NEW.`provider_invoked` = 0
 AND NEW.`target_cost_operation_id` IS NULL AND NEW.`budget_reservation_id` IS NULL AND NEW.`job_id` IS NULL
)
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution ownership or initial state is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_identity_immutable`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`run_id` IS NOT OLD.`run_id` OR NEW.`case_id` IS NOT OLD.`case_id` OR NEW.`case_revision` IS NOT OLD.`case_revision` OR NEW.`ordinal` IS NOT OLD.`ordinal` OR NEW.`subject_key` IS NOT OLD.`subject_key` OR NEW.`execution_config_id` IS NOT OLD.`execution_config_id` OR NEW.`execution_config_revision` IS NOT OLD.`execution_config_revision` OR NEW.`execution_config_fingerprint` IS NOT OLD.`execution_config_fingerprint` OR NEW.`execution_protocol_key` IS NOT OLD.`execution_protocol_key` OR NEW.`execution_protocol_revision` IS NOT OLD.`execution_protocol_revision` OR NEW.`cleanup_protocol_key` IS NOT OLD.`cleanup_protocol_key` OR NEW.`cleanup_protocol_revision` IS NOT OLD.`cleanup_protocol_revision` OR NEW.`candidate_fingerprint` IS NOT OLD.`candidate_fingerprint` OR NEW.`created_at` IS NOT OLD.`created_at` OR (OLD.`started_at` IS NOT NULL AND NEW.`started_at` IS NOT OLD.`started_at`)
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_concurrency_valid`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN OLD.`status` = 'PENDING' AND NEW.`status` = 'RUNNING'
 AND (SELECT COUNT(*) FROM `ai_eval_case_executions` active WHERE active.`run_id` = NEW.`run_id` AND active.`status` = 'RUNNING') >= COALESCE((SELECT revision.`max_concurrency` FROM `ai_eval_run_execution_bindings` binding JOIN `ai_eval_execution_config_revisions` revision ON revision.`execution_config_id` = binding.`execution_config_id` AND revision.`revision` = binding.`execution_config_revision` WHERE binding.`run_id` = NEW.`run_id`), 1)
BEGIN SELECT RAISE(ABORT, 'Eval target concurrency limit is reached'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_timestamp_monotonic`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN NEW.`updated_at` < OLD.`updated_at`
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution timestamps cannot move backward'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_lifecycle_valid`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN (OLD.`status` = 'PENDING' AND NEW.`status` NOT IN ('PENDING','RUNNING','FAILED','CANCELLED','AMBIGUOUS')) OR (OLD.`status` = 'RUNNING' AND NEW.`status` NOT IN ('RUNNING','COMPLETED','BLOCKED','FAILED','CANCELLED','AMBIGUOUS')) OR (OLD.`status` IN ('COMPLETED','BLOCKED','FAILED','CANCELLED','AMBIGUOUS') AND NEW.`status` IS NOT OLD.`status`) OR (OLD.`status` IN ('COMPLETED','BLOCKED','FAILED','CANCELLED','AMBIGUOUS') AND (NEW.`target_cost_operation_id` IS NOT OLD.`target_cost_operation_id` OR NEW.`budget_reservation_id` IS NOT OLD.`budget_reservation_id` OR NEW.`job_id` IS NOT OLD.`job_id` OR NEW.`provider_invocation_state` IS NOT OLD.`provider_invocation_state` OR NEW.`provider_invoked` IS NOT OLD.`provider_invoked` OR NEW.`output_sha256` IS NOT OLD.`output_sha256` OR NEW.`output_byte_size` IS NOT OLD.`output_byte_size` OR NEW.`finish_reason` IS NOT OLD.`finish_reason` OR NEW.`retrieval_status` IS NOT OLD.`retrieval_status` OR NEW.`plan_fingerprint` IS NOT OLD.`plan_fingerprint` OR NEW.`safe_failure_code` IS NOT OLD.`safe_failure_code` OR NEW.`completed_at` IS NOT OLD.`completed_at` OR NEW.`updated_at` IS NOT OLD.`updated_at`))
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution lifecycle is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_invocation_state_valid`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN (NEW.`provider_invocation_state` = 'INVOKING' AND OLD.`status` NOT IN ('PENDING','RUNNING')) OR (NEW.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING' AND (NEW.`provider_invoked` <> 1 OR OLD.`provider_invocation_state` NOT IN ('NOT_INVOKED','INVOKING','INVOKED_WITH_ACCOUNTING'))) OR (NEW.`provider_invocation_state` = 'AMBIGUOUS' AND NEW.`status` <> 'AMBIGUOUS') OR (NEW.`provider_invoked` = 1 AND NEW.`provider_invocation_state` = 'NOT_INVOKED')
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution Provider state is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_binding_valid`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN (OLD.`target_cost_operation_id` IS NOT NULL AND NEW.`target_cost_operation_id` IS NOT OLD.`target_cost_operation_id`) OR (OLD.`budget_reservation_id` IS NOT NULL AND NEW.`budget_reservation_id` IS NOT OLD.`budget_reservation_id`) OR (OLD.`job_id` IS NOT NULL AND NEW.`job_id` IS NOT OLD.`job_id`) OR (NEW.`target_cost_operation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_cost_operations` operation WHERE operation.`id` = NEW.`target_cost_operation_id` AND operation.`cost_center` = 'EVALS' AND operation.`eval_run_id` = NEW.`run_id` AND operation.`subject_key` = NEW.`subject_key` AND operation.`opaque_principal_ref` IS NULL AND operation.`conversation_id` IS NULL AND operation.`response_id` IS NULL AND operation.`job_id` IS NULL AND operation.`idempotency_key` IS NULL)) OR (NEW.`budget_reservation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_budget_reservations` reservation WHERE reservation.`id` = NEW.`budget_reservation_id` AND reservation.`operation_id` = NEW.`target_cost_operation_id` AND reservation.`principal_ref` = 'system-evals')) OR (NEW.`job_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_jobs` job WHERE job.`id` = NEW.`job_id` AND job.`kind` = 'ai.eval.target-execution' AND job.`payload_version` = 1 AND job.`cost_center` = 'EVALS'))
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution binding is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_delete_blocked`
BEFORE DELETE ON `ai_eval_case_executions`
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution history is append-only'); END;
