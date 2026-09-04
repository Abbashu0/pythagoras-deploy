CREATE TABLE `ai_eval_judge_config_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`judge_config_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`model_config_id` text NOT NULL,
	`model_config_revision` integer NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_config_revision` integer NOT NULL,
	`budget_policy_id` text NOT NULL,
	`budget_policy_revision` integer NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`rate_limit_policy_revision` integer NOT NULL,
	`protocol_key` text NOT NULL,
	`protocol_revision` integer NOT NULL,
	`timeout_ms` integer NOT NULL,
	`max_output_tokens` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`judge_config_id`) REFERENCES `ai_eval_judge_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_policy_id`) REFERENCES `ai_budget_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_judge_config_revisions_revision_positive" CHECK("ai_eval_judge_config_revisions"."revision" >= 1),
	CONSTRAINT "ai_eval_judge_config_revisions_display_name_valid" CHECK(length(trim("ai_eval_judge_config_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_eval_judge_config_revisions_enabled_boolean" CHECK("ai_eval_judge_config_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_eval_judge_config_revisions_policy_revision_valid" CHECK("ai_eval_judge_config_revisions"."model_config_revision" >= 1 and "ai_eval_judge_config_revisions"."provider_config_revision" >= 1 and "ai_eval_judge_config_revisions"."budget_policy_revision" >= 1 and "ai_eval_judge_config_revisions"."rate_limit_policy_revision" >= 1),
	CONSTRAINT "ai_eval_judge_config_revisions_protocol_valid" CHECK(length(trim("ai_eval_judge_config_revisions"."protocol_key")) between 1 and 120 and "ai_eval_judge_config_revisions"."protocol_key" not glob '*[^a-z0-9.-]*' and "ai_eval_judge_config_revisions"."protocol_revision" >= 1),
	CONSTRAINT "ai_eval_judge_config_revisions_bounds_valid" CHECK("ai_eval_judge_config_revisions"."timeout_ms" between 100 and 86400000 and "ai_eval_judge_config_revisions"."max_output_tokens" between 1 and 65536),
	CONSTRAINT "ai_eval_judge_config_revisions_fingerprint_valid" CHECK(length("ai_eval_judge_config_revisions"."fingerprint") = 64 and "ai_eval_judge_config_revisions"."fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_eval_judge_config_revisions_created_nonnegative" CHECK("ai_eval_judge_config_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_judge_config_revisions_identity_unique` ON `ai_eval_judge_config_revisions` (`judge_config_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_eval_judge_config_revisions_config_index` ON `ai_eval_judge_config_revisions` (`judge_config_id`,`revision`);--> statement-breakpoint
CREATE TABLE `ai_eval_judge_configs` (
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
	CONSTRAINT "ai_eval_judge_configs_key_valid" CHECK(length(trim("ai_eval_judge_configs"."key")) between 1 and 120 and "ai_eval_judge_configs"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_eval_judge_configs_subject_valid" CHECK(length(trim("ai_eval_judge_configs"."subject_key")) between 1 and 80 and "ai_eval_judge_configs"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_eval_judge_configs_revision_positive" CHECK("ai_eval_judge_configs"."current_revision" >= 1),
	CONSTRAINT "ai_eval_judge_configs_created_nonnegative" CHECK("ai_eval_judge_configs"."created_at" >= 0),
	CONSTRAINT "ai_eval_judge_configs_timestamps_ordered" CHECK("ai_eval_judge_configs"."updated_at" >= "ai_eval_judge_configs"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_judge_configs_key_unique` ON `ai_eval_judge_configs` (`key`);--> statement-breakpoint
CREATE INDEX `ai_eval_judge_configs_subject_index` ON `ai_eval_judge_configs` (`subject_key`);--> statement-breakpoint
CREATE TABLE `ai_eval_judge_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`case_revision` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`subject_key` text NOT NULL,
	`judge_config_id` text NOT NULL,
	`judge_config_revision` integer NOT NULL,
	`judge_config_fingerprint` text NOT NULL,
	`protocol_key` text NOT NULL,
	`protocol_revision` integer NOT NULL,
	`judge_model_config_id` text NOT NULL,
	`judge_model_config_revision` integer NOT NULL,
	`judge_provider_config_id` text NOT NULL,
	`judge_provider_config_revision` integer NOT NULL,
	`judge_cost_operation_id` text,
	`budget_reservation_id` text,
	`status` text NOT NULL,
	`provider_invocation_state` text NOT NULL,
	`provider_invoked` integer DEFAULT false NOT NULL,
	`judge_output_sha256` text,
	`judge_output_byte_size` integer,
	`safe_failure_code` text,
	`latency_ms` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`case_id`) REFERENCES `ai_eval_cases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`judge_config_id`) REFERENCES `ai_eval_judge_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`judge_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`judge_provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`judge_cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_reservation_id`) REFERENCES `ai_budget_reservations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_judge_executions_case_revision_valid" CHECK("ai_eval_judge_executions"."case_revision" >= 1 and "ai_eval_judge_executions"."ordinal" between 1 and 10000),
	CONSTRAINT "ai_eval_judge_executions_subject_valid" CHECK(length(trim("ai_eval_judge_executions"."subject_key")) between 1 and 80),
	CONSTRAINT "ai_eval_judge_executions_config_revision_valid" CHECK("ai_eval_judge_executions"."judge_config_revision" >= 1),
	CONSTRAINT "ai_eval_judge_executions_fingerprints_valid" CHECK(length("ai_eval_judge_executions"."judge_config_fingerprint") = 64 and "ai_eval_judge_executions"."judge_config_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_eval_judge_executions_status_valid" CHECK("ai_eval_judge_executions"."status" in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST')),
	CONSTRAINT "ai_eval_judge_executions_invocation_state_valid" CHECK("ai_eval_judge_executions"."provider_invocation_state" in ('NOT_INVOKED','INVOKING','INVOKED_WITH_ACCOUNTING','AMBIGUOUS')),
	CONSTRAINT "ai_eval_judge_executions_output_valid" CHECK("ai_eval_judge_executions"."judge_output_sha256" is null or (length("ai_eval_judge_executions"."judge_output_sha256") = 64 and "ai_eval_judge_executions"."judge_output_sha256" not glob '*[^0-9a-f]*')),
	CONSTRAINT "ai_eval_judge_executions_output_size_valid" CHECK("ai_eval_judge_executions"."judge_output_byte_size" is null or "ai_eval_judge_executions"."judge_output_byte_size" between 0 and 524288),
	CONSTRAINT "ai_eval_judge_executions_protocol_valid" CHECK(length(trim("ai_eval_judge_executions"."protocol_key")) between 1 and 120 and "ai_eval_judge_executions"."protocol_revision" >= 1),
	CONSTRAINT "ai_eval_judge_executions_timestamps_valid" CHECK("ai_eval_judge_executions"."created_at" >= 0 and "ai_eval_judge_executions"."updated_at" >= "ai_eval_judge_executions"."created_at" and ("ai_eval_judge_executions"."started_at" is null or "ai_eval_judge_executions"."started_at" >= "ai_eval_judge_executions"."created_at") and ("ai_eval_judge_executions"."completed_at" is null or "ai_eval_judge_executions"."completed_at" >= "ai_eval_judge_executions"."created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_judge_executions_run_case_unique` ON `ai_eval_judge_executions` (`run_id`,`case_id`,`case_revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_judge_executions_run_ordinal_unique` ON `ai_eval_judge_executions` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_judge_executions_operation_unique` ON `ai_eval_judge_executions` (`judge_cost_operation_id`) WHERE "ai_eval_judge_executions"."judge_cost_operation_id" is not null;--> statement-breakpoint
CREATE INDEX `ai_eval_judge_executions_status_index` ON `ai_eval_judge_executions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_eval_judge_executions_run_index` ON `ai_eval_judge_executions` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `ai_eval_judge_results` (
	`id` text PRIMARY KEY NOT NULL,
	`judge_execution_id` text NOT NULL,
	`case_result_id` text NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`case_revision` integer NOT NULL,
	`dimension` text NOT NULL,
	`judge_config_id` text NOT NULL,
	`judge_config_revision` integer NOT NULL,
	`protocol_key` text NOT NULL,
	`protocol_revision` integer NOT NULL,
	`judge_model_config_id` text NOT NULL,
	`judge_model_config_revision` integer NOT NULL,
	`judge_provider_config_id` text NOT NULL,
	`judge_provider_config_revision` integer NOT NULL,
	`score_units` integer NOT NULL,
	`rubric_band` text NOT NULL,
	`safe_reason_code` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`judge_execution_id`) REFERENCES `ai_eval_judge_executions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`case_result_id`) REFERENCES `ai_eval_case_results`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`case_id`) REFERENCES `ai_eval_cases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`judge_config_id`) REFERENCES `ai_eval_judge_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`judge_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`judge_provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_judge_results_dimension_valid" CHECK("ai_eval_judge_results"."dimension" in ('CORRECTNESS','CURRICULUM_FIDELITY','GROUNDEDNESS','SOURCE_FIDELITY','RELEVANCE','CONCISENESS','INSTRUCTION_FOLLOWING','ARABIC_QUALITY','IRAQI_NATURALNESS','MATHEMATICS_CORRECTNESS','OFF_TOPIC_BEHAVIOR','RETRIEVAL_QUALITY') and "ai_eval_judge_results"."dimension" != 'SECURITY'),
	CONSTRAINT "ai_eval_judge_results_score_valid" CHECK("ai_eval_judge_results"."score_units" between 0 and 1000000),
	CONSTRAINT "ai_eval_judge_results_rubric_band_valid" CHECK(length(trim("ai_eval_judge_results"."rubric_band")) between 1 and 60 and "ai_eval_judge_results"."rubric_band" not glob '*[^A-Z0-9_-]*'),
	CONSTRAINT "ai_eval_judge_results_reason_valid" CHECK(length(trim("ai_eval_judge_results"."safe_reason_code")) between 1 and 160 and "ai_eval_judge_results"."safe_reason_code" not glob '*[^A-Z0-9_-]*'),
	CONSTRAINT "ai_eval_judge_results_protocol_valid" CHECK(length(trim("ai_eval_judge_results"."protocol_key")) between 1 and 120 and "ai_eval_judge_results"."protocol_revision" >= 1),
	CONSTRAINT "ai_eval_judge_results_created_nonnegative" CHECK("ai_eval_judge_results"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_judge_results_execution_dim_unique` ON `ai_eval_judge_results` (`judge_execution_id`,`dimension`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_judge_results_case_dim_unique` ON `ai_eval_judge_results` (`case_result_id`,`dimension`);--> statement-breakpoint
CREATE INDEX `ai_eval_judge_results_run_dim_index` ON `ai_eval_judge_results` (`run_id`,`dimension`);--> statement-breakpoint
CREATE INDEX `ai_eval_judge_results_case_index` ON `ai_eval_judge_results` (`case_result_id`);--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_configs_identity_immutable`
BEFORE UPDATE ON `ai_eval_judge_configs`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`key` IS NOT OLD.`key` OR NEW.`subject_key` IS NOT OLD.`subject_key` OR NEW.`created_at` IS NOT OLD.`created_at` OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN SELECT RAISE(ABORT, 'Eval Judge Config identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_configs_revision_advance_valid`
BEFORE UPDATE ON `ai_eval_judge_configs`
WHEN NEW.`current_revision` <> OLD.`current_revision` + 1 OR NOT EXISTS (SELECT 1 FROM `ai_eval_judge_config_revisions` revision WHERE revision.`judge_config_id` = NEW.`id` AND revision.`revision` = NEW.`current_revision`)
BEGIN SELECT RAISE(ABORT, 'Eval Judge Config revisions must advance by one'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_configs_pointer_only`
BEFORE UPDATE ON `ai_eval_judge_configs`
WHEN NEW.`current_revision` = OLD.`current_revision` AND (NEW.`updated_at` IS NOT OLD.`updated_at` OR NEW.`updated_by` IS NOT OLD.`updated_by`)
BEGIN SELECT RAISE(ABORT, 'Eval Judge Config updates require a new revision'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_configs_delete_blocked`
BEFORE DELETE ON `ai_eval_judge_configs`
BEGIN SELECT RAISE(ABORT, 'Eval Judge Config history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_config_revisions_insert_valid`
BEFORE INSERT ON `ai_eval_judge_config_revisions`
WHEN NEW.`revision` <> COALESCE((SELECT MAX(revision) + 1 FROM `ai_eval_judge_config_revisions` WHERE judge_config_id = NEW.`judge_config_id`), 1)
 OR NEW.`protocol_key` <> 'eval-judge-v1' OR NEW.`protocol_revision` <> 1
 OR NOT EXISTS (SELECT 1 FROM `ai_eval_judge_configs` config WHERE config.`id` = NEW.`judge_config_id`)
 OR NOT EXISTS (SELECT 1 FROM `ai_model_configs` model WHERE model.`id` = NEW.`model_config_id` AND model.`revision` = NEW.`model_config_revision` AND model.`capability` = 'GENERATION' AND model.`enabled` = 1 AND model.`provider_config_id` = NEW.`provider_config_id`)
 OR NOT EXISTS (SELECT 1 FROM `ai_provider_configs` provider WHERE provider.`id` = NEW.`provider_config_id` AND provider.`revision` = NEW.`provider_config_revision` AND provider.`enabled` = 1 AND provider.`credential_ref` IS NOT NULL)
 OR NOT EXISTS (SELECT 1 FROM `ai_budget_policy_revisions` policy WHERE policy.`budget_policy_id` = NEW.`budget_policy_id` AND policy.`revision` = NEW.`budget_policy_revision` AND policy.`enabled` = 1 AND policy.`cost_center` = 'EVALS')
 OR NOT EXISTS (SELECT 1 FROM `ai_rate_limit_policy_revisions` policy WHERE policy.`rate_limit_policy_id` = NEW.`rate_limit_policy_id` AND policy.`revision` = NEW.`rate_limit_policy_revision` AND policy.`enabled` = 1)
BEGIN SELECT RAISE(ABORT, 'Eval Judge Config revision is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_config_revisions_update_blocked`
BEFORE UPDATE ON `ai_eval_judge_config_revisions`
BEGIN SELECT RAISE(ABORT, 'Eval Judge Config revisions are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_config_revisions_delete_blocked`
BEFORE DELETE ON `ai_eval_judge_config_revisions`
BEGIN SELECT RAISE(ABORT, 'Eval Judge Config revision history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_executions_insert_valid`
BEFORE INSERT ON `ai_eval_judge_executions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `ai_eval_runs` run
  JOIN `ai_eval_suites` suite ON suite.`id` = run.`suite_id`
  JOIN `ai_eval_suite_revisions` suite_revision ON suite_revision.`suite_id` = run.`suite_id` AND suite_revision.`revision` = run.`suite_revision`
  JOIN `ai_eval_suite_case_refs` manifest ON manifest.`suite_revision_id` = suite_revision.`id` AND manifest.`case_id` = NEW.`case_id` AND manifest.`case_revision` = NEW.`case_revision` AND manifest.`ordinal` = NEW.`ordinal`
  JOIN `ai_eval_case_revisions` case_revision ON case_revision.`case_id` = NEW.`case_id` AND case_revision.`revision` = NEW.`case_revision`
  JOIN `ai_eval_judge_configs` judge_config ON judge_config.`id` = NEW.`judge_config_id`
  JOIN `ai_eval_judge_config_revisions` judge_revision ON judge_revision.`judge_config_id` = judge_config.`id` AND judge_revision.`revision` = NEW.`judge_config_revision` AND judge_revision.`fingerprint` = NEW.`judge_config_fingerprint`
  WHERE run.`id` = NEW.`run_id` AND run.`status` = 'RUNNING'
  AND suite.`subject_key` = NEW.`subject_key` AND case_revision.`subject_key` = NEW.`subject_key` AND judge_config.`subject_key` = NEW.`subject_key`
  AND NEW.`status` = 'PENDING' AND NEW.`provider_invocation_state` = 'NOT_INVOKED' AND NEW.`provider_invoked` = 0
  AND NEW.`judge_cost_operation_id` IS NULL AND NEW.`budget_reservation_id` IS NULL
)
BEGIN SELECT RAISE(ABORT, 'Eval Judge Execution ownership or initial state is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_executions_identity_immutable`
BEFORE UPDATE ON `ai_eval_judge_executions`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`run_id` IS NOT OLD.`run_id` OR NEW.`case_id` IS NOT OLD.`case_id` OR NEW.`case_revision` IS NOT OLD.`case_revision` OR NEW.`ordinal` IS NOT OLD.`ordinal` OR NEW.`subject_key` IS NOT OLD.`subject_key` OR NEW.`judge_config_id` IS NOT OLD.`judge_config_id` OR NEW.`judge_config_revision` IS NOT OLD.`judge_config_revision` OR NEW.`judge_config_fingerprint` IS NOT OLD.`judge_config_fingerprint` OR NEW.`protocol_key` IS NOT OLD.`protocol_key` OR NEW.`protocol_revision` IS NOT OLD.`protocol_revision` OR NEW.`judge_model_config_id` IS NOT OLD.`judge_model_config_id` OR NEW.`judge_model_config_revision` IS NOT OLD.`judge_model_config_revision` OR NEW.`judge_provider_config_id` IS NOT OLD.`judge_provider_config_id` OR NEW.`judge_provider_config_revision` IS NOT OLD.`judge_provider_config_revision` OR NEW.`created_at` IS NOT OLD.`created_at` OR (OLD.`started_at` IS NOT NULL AND NEW.`started_at` IS NOT OLD.`started_at`)
BEGIN SELECT RAISE(ABORT, 'Eval Judge Execution identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_executions_timestamp_monotonic`
BEFORE UPDATE ON `ai_eval_judge_executions`
WHEN NEW.`updated_at` < OLD.`updated_at`
BEGIN SELECT RAISE(ABORT, 'Eval Judge Execution timestamps cannot move backward'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_executions_lifecycle_valid`
BEFORE UPDATE ON `ai_eval_judge_executions`
WHEN (OLD.`status` = 'PENDING' AND NEW.`status` NOT IN ('PENDING','RUNNING','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST'))
  OR (OLD.`status` = 'RUNNING' AND NEW.`status` NOT IN ('RUNNING','COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST'))
  OR (OLD.`status` IN ('COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST') AND NEW.`status` IS NOT OLD.`status`)
  OR (NEW.`status` = 'COMPLETED' AND EXISTS (
    SELECT 1 FROM `ai_eval_runs` run
    WHERE run.`id` = NEW.`run_id`
    AND json_extract(run.`candidate_snapshot`, '$.generationModel.id') = NEW.`judge_model_config_id`
    AND json_extract(run.`candidate_snapshot`, '$.generationModel.revision') = NEW.`judge_model_config_revision`
  ))
  OR (OLD.`status` IN ('COMPLETED','FAILED','CANCELLED','AMBIGUOUS','INPUT_LOST') AND (
    NEW.`judge_cost_operation_id` IS NOT OLD.`judge_cost_operation_id`
    OR NEW.`budget_reservation_id` IS NOT OLD.`budget_reservation_id`
    OR NEW.`provider_invocation_state` IS NOT OLD.`provider_invocation_state`
    OR NEW.`provider_invoked` IS NOT OLD.`provider_invoked`
    OR NEW.`judge_output_sha256` IS NOT OLD.`judge_output_sha256`
    OR NEW.`judge_output_byte_size` IS NOT OLD.`judge_output_byte_size`
    OR NEW.`safe_failure_code` IS NOT OLD.`safe_failure_code`
    OR NEW.`latency_ms` IS NOT OLD.`latency_ms`
    OR NEW.`completed_at` IS NOT OLD.`completed_at`
    OR NEW.`updated_at` IS NOT OLD.`updated_at`
  ))
BEGIN SELECT RAISE(ABORT, 'Eval Judge Execution lifecycle is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_executions_invocation_state_valid`
BEFORE UPDATE ON `ai_eval_judge_executions`
WHEN (NEW.`provider_invocation_state` = 'INVOKING' AND OLD.`status` NOT IN ('PENDING','RUNNING'))
  OR (NEW.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING' AND (NEW.`provider_invoked` <> 1 OR OLD.`provider_invocation_state` NOT IN ('NOT_INVOKED','INVOKING','INVOKED_WITH_ACCOUNTING')))
  OR (NEW.`provider_invocation_state` = 'AMBIGUOUS' AND NEW.`status` <> 'AMBIGUOUS')
  OR (NEW.`provider_invoked` = 1 AND NEW.`provider_invocation_state` = 'NOT_INVOKED')
BEGIN SELECT RAISE(ABORT, 'Eval Judge Execution Provider state is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_executions_binding_valid`
BEFORE UPDATE ON `ai_eval_judge_executions`
WHEN (OLD.`judge_cost_operation_id` IS NOT NULL AND NEW.`judge_cost_operation_id` IS NOT OLD.`judge_cost_operation_id`)
  OR (OLD.`budget_reservation_id` IS NOT NULL AND NEW.`budget_reservation_id` IS NOT OLD.`budget_reservation_id`)
  OR (NEW.`judge_cost_operation_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `ai_cost_operations` operation
    WHERE operation.`id` = NEW.`judge_cost_operation_id`
    AND operation.`cost_center` = 'EVALS'
    AND operation.`eval_run_id` = NEW.`run_id`
    AND operation.`subject_key` = NEW.`subject_key`
    AND operation.`opaque_principal_ref` IS NULL
    AND operation.`conversation_id` IS NULL
    AND operation.`response_id` IS NULL
    AND operation.`job_id` IS NULL
    AND operation.`idempotency_key` IS NULL
  ))
  OR (NEW.`budget_reservation_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `ai_budget_reservations` reservation
    WHERE reservation.`id` = NEW.`budget_reservation_id`
    AND reservation.`operation_id` = NEW.`judge_cost_operation_id`
    AND reservation.`principal_ref` = 'system-evals'
  ))
BEGIN SELECT RAISE(ABORT, 'Eval Judge Execution binding is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_executions_delete_blocked`
BEFORE DELETE ON `ai_eval_judge_executions`
BEGIN SELECT RAISE(ABORT, 'Eval Judge Execution history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_results_insert_valid`
BEFORE INSERT ON `ai_eval_judge_results`
WHEN NEW.`dimension` = 'SECURITY'
  OR EXISTS (
    SELECT 1 FROM `ai_eval_runs` run
    WHERE run.`id` = NEW.`run_id`
    AND json_extract(run.`candidate_snapshot`, '$.generationModel.id') = NEW.`judge_model_config_id`
    AND json_extract(run.`candidate_snapshot`, '$.generationModel.revision') = NEW.`judge_model_config_revision`
  )
  OR NOT EXISTS (
    SELECT 1 FROM `ai_eval_runs` run
    JOIN `ai_eval_suite_revisions` suite_revision ON suite_revision.`suite_id` = run.`suite_id` AND suite_revision.`revision` = run.`suite_revision`
    JOIN `ai_eval_case_results` case_result ON case_result.`id` = NEW.`case_result_id` AND case_result.`run_id` = run.`id` AND case_result.`case_id` = NEW.`case_id` AND case_result.`case_revision` = NEW.`case_revision`
    JOIN `ai_eval_judge_executions` execution ON execution.`id` = NEW.`judge_execution_id` AND execution.`run_id` = run.`id` AND execution.`case_id` = NEW.`case_id` AND execution.`case_revision` = NEW.`case_revision`
    WHERE run.`id` = NEW.`run_id`
    AND run.`status` = 'RUNNING'
    AND execution.`judge_config_id` = NEW.`judge_config_id`
    AND execution.`judge_config_revision` = NEW.`judge_config_revision`
    AND execution.`protocol_key` = NEW.`protocol_key`
    AND execution.`protocol_revision` = NEW.`protocol_revision`
    AND execution.`judge_model_config_id` = NEW.`judge_model_config_id`
    AND execution.`judge_model_config_revision` = NEW.`judge_model_config_revision`
    AND execution.`judge_provider_config_id` = NEW.`judge_provider_config_id`
    AND execution.`judge_provider_config_revision` = NEW.`judge_provider_config_revision`
    AND EXISTS (
      SELECT 1 FROM json_each(suite_revision.`required_dimensions`) d
      WHERE json_extract(d.value, '$.dimension') = NEW.`dimension`
      AND json_extract(d.value, '$.mode') = 'JUDGE_REQUIRED'
    )
  )
BEGIN SELECT RAISE(ABORT, 'Eval Judge Result is invalid or dimension is not configured as JUDGE_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_results_update_blocked`
BEFORE UPDATE ON `ai_eval_judge_results`
BEGIN SELECT RAISE(ABORT, 'Eval Judge results are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_results_delete_blocked`
BEFORE DELETE ON `ai_eval_judge_results`
BEGIN SELECT RAISE(ABORT, 'Eval Judge result history is append-only'); END;
