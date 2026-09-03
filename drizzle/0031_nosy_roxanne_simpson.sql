CREATE TABLE `ai_eval_case_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`case_revision` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`observed_subject_key` text NOT NULL,
	`observed_status` text NOT NULL,
	`finish_reason` text,
	`output_sha256` text NOT NULL,
	`output_byte_size` integer NOT NULL,
	`evidence` text NOT NULL,
	`retrieval_status` text NOT NULL,
	`elapsed_latency_ms` integer,
	`cost_operation_id` text,
	`privacy_class` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`case_id`) REFERENCES `ai_eval_cases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`observed_subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_case_results_case_revision_positive" CHECK("ai_eval_case_results"."case_revision" >= 1),
	CONSTRAINT "ai_eval_case_results_ordinal_valid" CHECK("ai_eval_case_results"."ordinal" between 1 and 10000),
	CONSTRAINT "ai_eval_case_results_status_valid" CHECK("ai_eval_case_results"."observed_status" in ('COMPLETED','BLOCKED','FAILED','CANCELLED')),
	CONSTRAINT "ai_eval_case_results_finish_valid" CHECK("ai_eval_case_results"."finish_reason" is null or "ai_eval_case_results"."finish_reason" in ('STOP','LENGTH','CONTENT_FILTER','OTHER','FAILED','CANCELLED')),
	CONSTRAINT "ai_eval_case_results_hash_valid" CHECK(length("ai_eval_case_results"."output_sha256") = 64 and "ai_eval_case_results"."output_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_eval_case_results_output_size_valid" CHECK("ai_eval_case_results"."output_byte_size" between 0 and 524288),
	CONSTRAINT "ai_eval_case_results_evidence_valid" CHECK(json_valid("ai_eval_case_results"."evidence") and json_type("ai_eval_case_results"."evidence") = 'array'),
	CONSTRAINT "ai_eval_case_results_retrieval_valid" CHECK("ai_eval_case_results"."retrieval_status" in ('SUFFICIENT','INSUFFICIENT','NOT_APPLICABLE')),
	CONSTRAINT "ai_eval_case_results_latency_valid" CHECK("ai_eval_case_results"."elapsed_latency_ms" is null or "ai_eval_case_results"."elapsed_latency_ms" between 0 and 8640000000000),
	CONSTRAINT "ai_eval_case_results_privacy_valid" CHECK("ai_eval_case_results"."privacy_class" in ('SYNTHETIC_PUBLIC_SAFE','INTERNAL_CURATED','DEIDENTIFIED_REGRESSION')),
	CONSTRAINT "ai_eval_case_results_created_nonnegative" CHECK("ai_eval_case_results"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_case_results_run_case_unique` ON `ai_eval_case_results` (`run_id`,`case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_case_results_run_ordinal_unique` ON `ai_eval_case_results` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `ai_eval_case_results_run_index` ON `ai_eval_case_results` (`run_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `ai_eval_case_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`subject_key` text NOT NULL,
	`input_text` text NOT NULL,
	`origin` text NOT NULL,
	`privacy_class` text NOT NULL,
	`deidentification_proof` text,
	`expected_status` text NOT NULL,
	`allowed_finish_reasons` text NOT NULL,
	`required_output_literals` text NOT NULL,
	`forbidden_output_literals` text NOT NULL,
	`required_evidence_origins` text NOT NULL,
	`forbidden_evidence_origins` text NOT NULL,
	`required_citation_labels` text NOT NULL,
	`minimum_evidence_item_count` integer DEFAULT 0 NOT NULL,
	`security_leakage_markers` text NOT NULL,
	`maximum_output_bytes` integer,
	`source_revision_references` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `ai_eval_cases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_case_revisions_revision_positive" CHECK("ai_eval_case_revisions"."revision" >= 1),
	CONSTRAINT "ai_eval_case_revisions_display_name_valid" CHECK(length(trim("ai_eval_case_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_eval_case_revisions_description_valid" CHECK("ai_eval_case_revisions"."description" is null or length("ai_eval_case_revisions"."description") <= 1000),
	CONSTRAINT "ai_eval_case_revisions_input_valid" CHECK(length(cast("ai_eval_case_revisions"."input_text" as blob)) between 1 and 65536),
	CONSTRAINT "ai_eval_case_revisions_origin_valid" CHECK("ai_eval_case_revisions"."origin" in ('CURATED','SYNTHETIC','DEIDENTIFIED_REGRESSION')),
	CONSTRAINT "ai_eval_case_revisions_privacy_valid" CHECK("ai_eval_case_revisions"."privacy_class" in ('SYNTHETIC_PUBLIC_SAFE','INTERNAL_CURATED','DEIDENTIFIED_REGRESSION')),
	CONSTRAINT "ai_eval_case_revisions_deidentification_valid" CHECK("ai_eval_case_revisions"."deidentification_proof" is null or (json_valid("ai_eval_case_revisions"."deidentification_proof") and json_type("ai_eval_case_revisions"."deidentification_proof") = 'object')),
	CONSTRAINT "ai_eval_case_revisions_status_valid" CHECK("ai_eval_case_revisions"."expected_status" in ('COMPLETED','BLOCKED','FAILED','CANCELLED')),
	CONSTRAINT "ai_eval_case_revisions_finish_reasons_valid" CHECK(json_valid("ai_eval_case_revisions"."allowed_finish_reasons") and json_type("ai_eval_case_revisions"."allowed_finish_reasons") = 'array'),
	CONSTRAINT "ai_eval_case_revisions_literals_valid" CHECK(json_valid("ai_eval_case_revisions"."required_output_literals") and json_type("ai_eval_case_revisions"."required_output_literals") = 'array' and json_valid("ai_eval_case_revisions"."forbidden_output_literals") and json_type("ai_eval_case_revisions"."forbidden_output_literals") = 'array'),
	CONSTRAINT "ai_eval_case_revisions_evidence_expectations_valid" CHECK(json_valid("ai_eval_case_revisions"."required_evidence_origins") and json_type("ai_eval_case_revisions"."required_evidence_origins") = 'array' and json_valid("ai_eval_case_revisions"."forbidden_evidence_origins") and json_type("ai_eval_case_revisions"."forbidden_evidence_origins") = 'array'),
	CONSTRAINT "ai_eval_case_revisions_citations_valid" CHECK(json_valid("ai_eval_case_revisions"."required_citation_labels") and json_type("ai_eval_case_revisions"."required_citation_labels") = 'array'),
	CONSTRAINT "ai_eval_case_revisions_evidence_count_valid" CHECK("ai_eval_case_revisions"."minimum_evidence_item_count" between 0 and 50),
	CONSTRAINT "ai_eval_case_revisions_security_markers_valid" CHECK(json_valid("ai_eval_case_revisions"."security_leakage_markers") and json_type("ai_eval_case_revisions"."security_leakage_markers") = 'array'),
	CONSTRAINT "ai_eval_case_revisions_output_bound_valid" CHECK("ai_eval_case_revisions"."maximum_output_bytes" is null or "ai_eval_case_revisions"."maximum_output_bytes" between 1 and 524288),
	CONSTRAINT "ai_eval_case_revisions_sources_valid" CHECK(json_valid("ai_eval_case_revisions"."source_revision_references") and json_type("ai_eval_case_revisions"."source_revision_references") = 'array'),
	CONSTRAINT "ai_eval_case_revisions_enabled_boolean" CHECK("ai_eval_case_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_eval_case_revisions_created_nonnegative" CHECK("ai_eval_case_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_case_revisions_identity_unique` ON `ai_eval_case_revisions` (`case_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_eval_case_revisions_case_index` ON `ai_eval_case_revisions` (`case_id`,`revision`);--> statement-breakpoint
CREATE TABLE `ai_eval_cases` (
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
	CONSTRAINT "ai_eval_cases_key_valid" CHECK(length(trim("ai_eval_cases"."key")) between 1 and 160 and "ai_eval_cases"."key" not glob '*[^a-z0-9._-]*'),
	CONSTRAINT "ai_eval_cases_subject_valid" CHECK(length(trim("ai_eval_cases"."subject_key")) between 1 and 80 and "ai_eval_cases"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_eval_cases_revision_positive" CHECK("ai_eval_cases"."current_revision" >= 1),
	CONSTRAINT "ai_eval_cases_created_nonnegative" CHECK("ai_eval_cases"."created_at" >= 0),
	CONSTRAINT "ai_eval_cases_timestamps_ordered" CHECK("ai_eval_cases"."updated_at" >= "ai_eval_cases"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_cases_key_unique` ON `ai_eval_cases` (`key`);--> statement-breakpoint
CREATE INDEX `ai_eval_cases_subject_index` ON `ai_eval_cases` (`subject_key`);--> statement-breakpoint
CREATE TABLE `ai_eval_dimension_aggregates` (
	`run_id` text NOT NULL,
	`dimension` text NOT NULL,
	`applicable_case_count` integer NOT NULL,
	`passed_case_count` integer NOT NULL,
	`failed_case_count` integer NOT NULL,
	`score_units` integer,
	`blocking_failure_count` integer NOT NULL,
	PRIMARY KEY(`run_id`, `dimension`),
	FOREIGN KEY (`run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_dimension_aggregates_dimension_valid" CHECK("ai_eval_dimension_aggregates"."dimension" in ('CORRECTNESS','CURRICULUM_FIDELITY','GROUNDEDNESS','SOURCE_FIDELITY','RELEVANCE','CONCISENESS','INSTRUCTION_FOLLOWING','ARABIC_QUALITY','IRAQI_NATURALNESS','MATHEMATICS_CORRECTNESS','OFF_TOPIC_BEHAVIOR','RETRIEVAL_QUALITY','COST','LATENCY','SECURITY')),
	CONSTRAINT "ai_eval_dimension_aggregates_counts_valid" CHECK("ai_eval_dimension_aggregates"."applicable_case_count" >= 0 and "ai_eval_dimension_aggregates"."passed_case_count" >= 0 and "ai_eval_dimension_aggregates"."failed_case_count" >= 0 and "ai_eval_dimension_aggregates"."blocking_failure_count" >= 0 and "ai_eval_dimension_aggregates"."passed_case_count" + "ai_eval_dimension_aggregates"."failed_case_count" <= "ai_eval_dimension_aggregates"."applicable_case_count"),
	CONSTRAINT "ai_eval_dimension_aggregates_score_valid" CHECK("ai_eval_dimension_aggregates"."score_units" is null or "ai_eval_dimension_aggregates"."score_units" between 0 and 1000000)
);
--> statement-breakpoint
CREATE TABLE `ai_eval_gate_results` (
	`run_id` text NOT NULL,
	`gate_key` text NOT NULL,
	`verdict` text NOT NULL,
	`observed_value` integer,
	`threshold_value` integer,
	`safe_reason_code` text NOT NULL,
	PRIMARY KEY(`run_id`, `gate_key`),
	FOREIGN KEY (`run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_gate_results_key_valid" CHECK(length(trim("ai_eval_gate_results"."gate_key")) between 1 and 160 and "ai_eval_gate_results"."gate_key" not glob '*[^A-Z0-9_-]*'),
	CONSTRAINT "ai_eval_gate_results_verdict_valid" CHECK("ai_eval_gate_results"."verdict" in ('PASS','BLOCKED','INCOMPLETE')),
	CONSTRAINT "ai_eval_gate_results_values_valid" CHECK("ai_eval_gate_results"."observed_value" is null or "ai_eval_gate_results"."observed_value" >= 0),
	CONSTRAINT "ai_eval_gate_results_threshold_valid" CHECK("ai_eval_gate_results"."threshold_value" is null or "ai_eval_gate_results"."threshold_value" >= 0),
	CONSTRAINT "ai_eval_gate_results_reason_valid" CHECK(length(trim("ai_eval_gate_results"."safe_reason_code")) between 1 and 160 and "ai_eval_gate_results"."safe_reason_code" not glob '*[^A-Z0-9_-]*')
);
--> statement-breakpoint
CREATE TABLE `ai_eval_grader_results` (
	`id` text PRIMARY KEY NOT NULL,
	`case_result_id` text NOT NULL,
	`dimension` text NOT NULL,
	`grader_key` text NOT NULL,
	`grader_revision` integer NOT NULL,
	`verdict` text NOT NULL,
	`score_units` integer NOT NULL,
	`safe_reason_code` text NOT NULL,
	`blocking` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_result_id`) REFERENCES `ai_eval_case_results`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_grader_results_dimension_valid" CHECK("ai_eval_grader_results"."dimension" in ('CORRECTNESS','CURRICULUM_FIDELITY','GROUNDEDNESS','SOURCE_FIDELITY','RELEVANCE','CONCISENESS','INSTRUCTION_FOLLOWING','ARABIC_QUALITY','IRAQI_NATURALNESS','MATHEMATICS_CORRECTNESS','OFF_TOPIC_BEHAVIOR','RETRIEVAL_QUALITY','COST','LATENCY','SECURITY')),
	CONSTRAINT "ai_eval_grader_results_key_valid" CHECK(length(trim("ai_eval_grader_results"."grader_key")) between 1 and 120 and "ai_eval_grader_results"."grader_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_eval_grader_results_revision_positive" CHECK("ai_eval_grader_results"."grader_revision" >= 1),
	CONSTRAINT "ai_eval_grader_results_verdict_valid" CHECK("ai_eval_grader_results"."verdict" in ('PASS','FAIL','NOT_APPLICABLE')),
	CONSTRAINT "ai_eval_grader_results_score_valid" CHECK("ai_eval_grader_results"."score_units" between 0 and 1000000),
	CONSTRAINT "ai_eval_grader_results_reason_valid" CHECK(length(trim("ai_eval_grader_results"."safe_reason_code")) between 1 and 160 and "ai_eval_grader_results"."safe_reason_code" not glob '*[^A-Z0-9_-]*'),
	CONSTRAINT "ai_eval_grader_results_blocking_boolean" CHECK("ai_eval_grader_results"."blocking" in (0,1)),
	CONSTRAINT "ai_eval_grader_results_created_nonnegative" CHECK("ai_eval_grader_results"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_grader_results_identity_unique` ON `ai_eval_grader_results` (`case_result_id`,`grader_key`,`grader_revision`);--> statement-breakpoint
CREATE INDEX `ai_eval_grader_results_case_index` ON `ai_eval_grader_results` (`case_result_id`);--> statement-breakpoint
CREATE TABLE `ai_eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`suite_id` text NOT NULL,
	`suite_revision` integer NOT NULL,
	`manifest_fingerprint` text NOT NULL,
	`candidate_snapshot` text NOT NULL,
	`candidate_fingerprint` text NOT NULL,
	`baseline_run_id` text,
	`status` text NOT NULL,
	`recommendation` text,
	`safe_failure_code` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`scored_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`suite_id`) REFERENCES `ai_eval_suites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`baseline_run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_runs_suite_revision_positive" CHECK("ai_eval_runs"."suite_revision" >= 1),
	CONSTRAINT "ai_eval_runs_manifest_fingerprint_valid" CHECK(length("ai_eval_runs"."manifest_fingerprint") = 64 and "ai_eval_runs"."manifest_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_eval_runs_candidate_snapshot_valid" CHECK(json_valid("ai_eval_runs"."candidate_snapshot") and json_type("ai_eval_runs"."candidate_snapshot") = 'object'),
	CONSTRAINT "ai_eval_runs_candidate_fingerprint_valid" CHECK(length("ai_eval_runs"."candidate_fingerprint") = 64 and "ai_eval_runs"."candidate_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_eval_runs_status_valid" CHECK("ai_eval_runs"."status" in ('CREATED','RUNNING','SCORING','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "ai_eval_runs_recommendation_valid" CHECK("ai_eval_runs"."recommendation" is null or "ai_eval_runs"."recommendation" in ('PASS_RECOMMENDED','BLOCKED','INCOMPLETE')),
	CONSTRAINT "ai_eval_runs_failure_code_valid" CHECK("ai_eval_runs"."safe_failure_code" is null or (length(trim("ai_eval_runs"."safe_failure_code")) between 1 and 160 and "ai_eval_runs"."safe_failure_code" not glob '*[^A-Z0-9_-]*')),
	CONSTRAINT "ai_eval_runs_timestamps_valid" CHECK("ai_eval_runs"."updated_at" >= "ai_eval_runs"."created_at" and ("ai_eval_runs"."started_at" is null or "ai_eval_runs"."started_at" >= "ai_eval_runs"."created_at") and ("ai_eval_runs"."scored_at" is null or "ai_eval_runs"."scored_at" >= "ai_eval_runs"."created_at") and ("ai_eval_runs"."completed_at" is null or "ai_eval_runs"."completed_at" >= "ai_eval_runs"."created_at")),
	CONSTRAINT "ai_eval_runs_created_nonnegative" CHECK("ai_eval_runs"."created_at" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_eval_runs_suite_index` ON `ai_eval_runs` (`suite_id`,`suite_revision`);--> statement-breakpoint
CREATE INDEX `ai_eval_runs_status_index` ON `ai_eval_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_eval_runs_baseline_index` ON `ai_eval_runs` (`baseline_run_id`);--> statement-breakpoint
CREATE TABLE `ai_eval_suite_case_refs` (
	`suite_revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`case_id` text NOT NULL,
	`case_revision` integer NOT NULL,
	PRIMARY KEY(`suite_revision_id`, `ordinal`),
	FOREIGN KEY (`suite_revision_id`) REFERENCES `ai_eval_suite_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`case_id`) REFERENCES `ai_eval_cases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_suite_case_refs_ordinal_valid" CHECK("ai_eval_suite_case_refs"."ordinal" between 1 and 10000),
	CONSTRAINT "ai_eval_suite_case_refs_revision_positive" CHECK("ai_eval_suite_case_refs"."case_revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_suite_case_refs_case_unique` ON `ai_eval_suite_case_refs` (`suite_revision_id`,`case_id`);--> statement-breakpoint
CREATE TABLE `ai_eval_suite_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`suite_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`required_dimensions` text NOT NULL,
	`grader_configs` text NOT NULL,
	`gate_config` text NOT NULL,
	`permitted_regression_deltas` text NOT NULL,
	`baseline_mode` text NOT NULL,
	`supplementary_judge_config` text,
	`manifest_sealed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`suite_id`) REFERENCES `ai_eval_suites`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_suite_revisions_revision_positive" CHECK("ai_eval_suite_revisions"."revision" >= 1),
	CONSTRAINT "ai_eval_suite_revisions_display_name_valid" CHECK(length(trim("ai_eval_suite_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_eval_suite_revisions_enabled_boolean" CHECK("ai_eval_suite_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_eval_suite_revisions_dimensions_valid" CHECK(json_valid("ai_eval_suite_revisions"."required_dimensions") and json_type("ai_eval_suite_revisions"."required_dimensions") = 'array' and json_array_length("ai_eval_suite_revisions"."required_dimensions") between 1 and 15),
	CONSTRAINT "ai_eval_suite_revisions_graders_valid" CHECK(json_valid("ai_eval_suite_revisions"."grader_configs") and json_type("ai_eval_suite_revisions"."grader_configs") = 'array' and json_array_length("ai_eval_suite_revisions"."grader_configs") between 0 and 100),
	CONSTRAINT "ai_eval_suite_revisions_gate_valid" CHECK(json_valid("ai_eval_suite_revisions"."gate_config") and json_type("ai_eval_suite_revisions"."gate_config") = 'object'),
	CONSTRAINT "ai_eval_suite_revisions_regression_valid" CHECK(json_valid("ai_eval_suite_revisions"."permitted_regression_deltas") and json_type("ai_eval_suite_revisions"."permitted_regression_deltas") = 'array' and json_array_length("ai_eval_suite_revisions"."permitted_regression_deltas") <= 15),
	CONSTRAINT "ai_eval_suite_revisions_baseline_valid" CHECK("ai_eval_suite_revisions"."baseline_mode" in ('OPTIONAL','REQUIRED')),
	CONSTRAINT "ai_eval_suite_revisions_judge_valid" CHECK("ai_eval_suite_revisions"."supplementary_judge_config" is null or (json_valid("ai_eval_suite_revisions"."supplementary_judge_config") and json_type("ai_eval_suite_revisions"."supplementary_judge_config") = 'object')),
	CONSTRAINT "ai_eval_suite_revisions_created_nonnegative" CHECK("ai_eval_suite_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_suite_revisions_identity_unique` ON `ai_eval_suite_revisions` (`suite_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_eval_suite_revisions_suite_index` ON `ai_eval_suite_revisions` (`suite_id`,`revision`);--> statement-breakpoint
CREATE TABLE `ai_eval_suites` (
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
	CONSTRAINT "ai_eval_suites_key_valid" CHECK(length(trim("ai_eval_suites"."key")) between 1 and 120 and "ai_eval_suites"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_eval_suites_subject_valid" CHECK(length(trim("ai_eval_suites"."subject_key")) between 1 and 80 and "ai_eval_suites"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_eval_suites_revision_positive" CHECK("ai_eval_suites"."current_revision" >= 1),
	CONSTRAINT "ai_eval_suites_created_nonnegative" CHECK("ai_eval_suites"."created_at" >= 0),
	CONSTRAINT "ai_eval_suites_timestamps_ordered" CHECK("ai_eval_suites"."updated_at" >= "ai_eval_suites"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_suites_key_unique` ON `ai_eval_suites` (`key`);--> statement-breakpoint
CREATE INDEX `ai_eval_suites_subject_index` ON `ai_eval_suites` (`subject_key`);
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suites_identity_immutable`
BEFORE UPDATE ON `ai_eval_suites`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`key` IS NOT OLD.`key` OR NEW.`subject_key` IS NOT OLD.`subject_key` OR NEW.`created_at` IS NOT OLD.`created_at` OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN SELECT RAISE(ABORT, 'Eval Suite identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suites_initial_revision_valid`
BEFORE INSERT ON `ai_eval_suites`
WHEN NEW.`current_revision` <> 1
BEGIN SELECT RAISE(ABORT, 'Eval Suite identities must begin at revision one'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suites_delete_blocked`
BEFORE DELETE ON `ai_eval_suites`
BEGIN SELECT RAISE(ABORT, 'Eval Suite history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suites_revision_pointer_valid`
BEFORE UPDATE ON `ai_eval_suites`
WHEN NEW.`current_revision` < OLD.`current_revision` OR NEW.`current_revision` > OLD.`current_revision` + 1 OR (NEW.`current_revision` = OLD.`current_revision` + 1 AND NOT EXISTS (
  SELECT 1 FROM `ai_eval_suite_revisions` AS revision
  WHERE revision.`suite_id` = NEW.`id` AND revision.`revision` = NEW.`current_revision` AND revision.`manifest_sealed` = 1
))
BEGIN SELECT RAISE(ABORT, 'Eval Suite revision pointer must advance one published revision at a time'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suite_revisions_insert_valid`
BEFORE INSERT ON `ai_eval_suite_revisions`
WHEN NEW.`manifest_sealed` <> 0 OR NOT EXISTS (
  SELECT 1 FROM `ai_eval_suites` AS suite
  WHERE suite.`id` = NEW.`suite_id` AND ((NEW.`revision` = 1 AND suite.`current_revision` = 1 AND NOT EXISTS (SELECT 1 FROM `ai_eval_suite_revisions` AS prior WHERE prior.`suite_id` = NEW.`suite_id`)) OR NEW.`revision` = suite.`current_revision` + 1)
)
BEGIN SELECT RAISE(ABORT, 'Eval Suite revision sequence or seal state is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suite_revisions_update_blocked`
BEFORE UPDATE ON `ai_eval_suite_revisions`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`suite_id` IS NOT OLD.`suite_id` OR NEW.`revision` IS NOT OLD.`revision` OR NEW.`display_name` IS NOT OLD.`display_name` OR NEW.`enabled` IS NOT OLD.`enabled` OR NEW.`required_dimensions` IS NOT OLD.`required_dimensions` OR NEW.`grader_configs` IS NOT OLD.`grader_configs` OR NEW.`gate_config` IS NOT OLD.`gate_config` OR NEW.`permitted_regression_deltas` IS NOT OLD.`permitted_regression_deltas` OR NEW.`baseline_mode` IS NOT OLD.`baseline_mode` OR NEW.`supplementary_judge_config` IS NOT OLD.`supplementary_judge_config` OR NEW.`created_at` IS NOT OLD.`created_at` OR NEW.`created_by` IS NOT OLD.`created_by` OR NOT (OLD.`manifest_sealed` = 0 AND NEW.`manifest_sealed` = 1) OR NOT EXISTS (SELECT 1 FROM `ai_eval_suite_case_refs` AS ref WHERE ref.`suite_revision_id` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'Eval Suite revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suite_revisions_delete_blocked`
BEFORE DELETE ON `ai_eval_suite_revisions`
BEGIN SELECT RAISE(ABORT, 'Eval Suite revisions are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suite_case_refs_insert_valid`
BEFORE INSERT ON `ai_eval_suite_case_refs`
WHEN NOT EXISTS (
  SELECT 1
  FROM `ai_eval_suite_revisions` AS suite_revision
  JOIN `ai_eval_suites` AS suite ON suite.`id` = suite_revision.`suite_id`
  JOIN `ai_eval_cases` AS eval_case ON eval_case.`id` = NEW.`case_id`
  JOIN `ai_eval_case_revisions` AS case_revision ON case_revision.`case_id` = NEW.`case_id` AND case_revision.`revision` = NEW.`case_revision`
  WHERE suite_revision.`id` = NEW.`suite_revision_id` AND suite_revision.`manifest_sealed` = 0 AND suite.`subject_key` = case_revision.`subject_key` AND eval_case.`subject_key` = case_revision.`subject_key` AND case_revision.`enabled` = 1 AND NEW.`ordinal` = COALESCE((SELECT MAX(existing.`ordinal`) FROM `ai_eval_suite_case_refs` AS existing WHERE existing.`suite_revision_id` = NEW.`suite_revision_id`), 0) + 1
)
BEGIN SELECT RAISE(ABORT, 'Eval Suite Case manifest reference is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suite_case_refs_update_blocked`
BEFORE UPDATE ON `ai_eval_suite_case_refs`
BEGIN SELECT RAISE(ABORT, 'Eval Suite Case manifests are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suite_case_refs_delete_blocked`
BEFORE DELETE ON `ai_eval_suite_case_refs`
BEGIN SELECT RAISE(ABORT, 'Eval Suite Case manifests are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_cases_identity_immutable`
BEFORE UPDATE ON `ai_eval_cases`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`key` IS NOT OLD.`key` OR NEW.`subject_key` IS NOT OLD.`subject_key` OR NEW.`created_at` IS NOT OLD.`created_at` OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN SELECT RAISE(ABORT, 'Eval Case identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_cases_initial_revision_valid`
BEFORE INSERT ON `ai_eval_cases`
WHEN NEW.`current_revision` <> 1
BEGIN SELECT RAISE(ABORT, 'Eval Case identities must begin at revision one'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_cases_delete_blocked`
BEFORE DELETE ON `ai_eval_cases`
BEGIN SELECT RAISE(ABORT, 'Eval Case history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_cases_revision_pointer_valid`
BEFORE UPDATE ON `ai_eval_cases`
WHEN NEW.`current_revision` < OLD.`current_revision` OR NEW.`current_revision` > OLD.`current_revision` + 1 OR (NEW.`current_revision` = OLD.`current_revision` + 1 AND NOT EXISTS (SELECT 1 FROM `ai_eval_case_revisions` AS revision WHERE revision.`case_id` = NEW.`id` AND revision.`revision` = NEW.`current_revision`))
BEGIN SELECT RAISE(ABORT, 'Eval Case revision pointer must advance one revision at a time'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_revisions_insert_valid`
BEFORE INSERT ON `ai_eval_case_revisions`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_eval_cases` AS eval_case
  WHERE eval_case.`id` = NEW.`case_id` AND eval_case.`subject_key` = NEW.`subject_key` AND ((NEW.`revision` = 1 AND eval_case.`current_revision` = 1 AND NOT EXISTS (SELECT 1 FROM `ai_eval_case_revisions` AS prior WHERE prior.`case_id` = NEW.`case_id`)) OR NEW.`revision` = eval_case.`current_revision` + 1)
)
BEGIN SELECT RAISE(ABORT, 'Eval Case revision sequence or subject is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_revisions_update_blocked`
BEFORE UPDATE ON `ai_eval_case_revisions`
BEGIN SELECT RAISE(ABORT, 'Eval Case revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_revisions_delete_blocked`
BEFORE DELETE ON `ai_eval_case_revisions`
BEGIN SELECT RAISE(ABORT, 'Eval Case revisions are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_runs_insert_valid`
BEFORE INSERT ON `ai_eval_runs`
WHEN NOT EXISTS (SELECT 1 FROM `ai_eval_suites` AS suite JOIN `ai_eval_suite_revisions` AS revision ON revision.`suite_id` = suite.`id` AND revision.`revision` = NEW.`suite_revision` WHERE suite.`id` = NEW.`suite_id`)
 OR NEW.`status` <> 'CREATED'
 OR (NEW.`status` NOT IN ('CREATED','RUNNING','SCORING','COMPLETED','FAILED','CANCELLED'))
 OR (NEW.`status` <> 'COMPLETED' AND NEW.`recommendation` IS NOT NULL)
 OR (NEW.`status` = 'COMPLETED' AND NEW.`recommendation` IS NULL)
BEGIN SELECT RAISE(ABORT, 'Eval Run creation is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_runs_identity_immutable`
BEFORE UPDATE ON `ai_eval_runs`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`suite_id` IS NOT OLD.`suite_id` OR NEW.`suite_revision` IS NOT OLD.`suite_revision` OR NEW.`manifest_fingerprint` IS NOT OLD.`manifest_fingerprint` OR NEW.`candidate_snapshot` IS NOT OLD.`candidate_snapshot` OR NEW.`candidate_fingerprint` IS NOT OLD.`candidate_fingerprint` OR NEW.`baseline_run_id` IS NOT OLD.`baseline_run_id` OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN SELECT RAISE(ABORT, 'Eval Run identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_runs_lifecycle_valid`
BEFORE UPDATE ON `ai_eval_runs`
WHEN NOT (NEW.`status` IS OLD.`status` OR (OLD.`status` = 'CREATED' AND NEW.`status` IN ('RUNNING','FAILED','CANCELLED')) OR (OLD.`status` = 'RUNNING' AND NEW.`status` IN ('SCORING','FAILED','CANCELLED')) OR (OLD.`status` = 'SCORING' AND NEW.`status` IN ('COMPLETED','FAILED','CANCELLED')))
BEGIN SELECT RAISE(ABORT, 'Eval Run lifecycle transition is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_runs_recommendation_state_valid`
BEFORE UPDATE ON `ai_eval_runs`
WHEN (NEW.`status` <> 'COMPLETED' AND NEW.`recommendation` IS NOT NULL) OR (NEW.`status` = 'COMPLETED' AND NEW.`recommendation` IS NULL)
BEGIN SELECT RAISE(ABORT, 'Eval Run recommendation state is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_runs_terminal_timestamp_valid`
BEFORE UPDATE ON `ai_eval_runs`
WHEN (NEW.`status` IN ('COMPLETED','FAILED','CANCELLED') AND NEW.`completed_at` IS NULL) OR (NEW.`status` IN ('CREATED','RUNNING','SCORING') AND NEW.`completed_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Eval Run terminal timestamp state is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_runs_terminal_immutable`
BEFORE UPDATE ON `ai_eval_runs`
WHEN OLD.`status` IN ('COMPLETED','FAILED','CANCELLED') AND (NEW.`status` IS NOT OLD.`status` OR NEW.`recommendation` IS NOT OLD.`recommendation` OR NEW.`safe_failure_code` IS NOT OLD.`safe_failure_code` OR NEW.`started_at` IS NOT OLD.`started_at` OR NEW.`scored_at` IS NOT OLD.`scored_at` OR NEW.`completed_at` IS NOT OLD.`completed_at` OR NEW.`updated_at` IS NOT OLD.`updated_at`)
BEGIN SELECT RAISE(ABORT, 'Terminal Eval Runs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_runs_delete_blocked`
BEFORE DELETE ON `ai_eval_runs`
BEGIN SELECT RAISE(ABORT, 'Eval Run history is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_results_insert_valid`
BEFORE INSERT ON `ai_eval_case_results`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_eval_runs` AS run
  JOIN `ai_eval_suite_revisions` AS suite_revision ON suite_revision.`suite_id` = run.`suite_id` AND suite_revision.`revision` = run.`suite_revision`
  JOIN `ai_eval_suite_case_refs` AS manifest ON manifest.`suite_revision_id` = suite_revision.`id` AND manifest.`case_id` = NEW.`case_id` AND manifest.`case_revision` = NEW.`case_revision` AND manifest.`ordinal` = NEW.`ordinal`
  JOIN `ai_eval_case_revisions` AS case_revision ON case_revision.`case_id` = NEW.`case_id` AND case_revision.`revision` = NEW.`case_revision`
  WHERE run.`id` = NEW.`run_id` AND run.`status` IN ('RUNNING','SCORING') AND case_revision.`subject_key` = NEW.`observed_subject_key` AND case_revision.`privacy_class` = NEW.`privacy_class` AND (NEW.`cost_operation_id` IS NULL OR EXISTS (SELECT 1 FROM `ai_cost_operations` AS operation WHERE operation.`id` = NEW.`cost_operation_id` AND operation.`eval_run_id` = NEW.`run_id` AND operation.`cost_center` = 'EVALS'))
)
BEGIN SELECT RAISE(ABORT, 'Eval Case result does not match its Run manifest'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_results_update_blocked`
BEFORE UPDATE ON `ai_eval_case_results`
BEGIN SELECT RAISE(ABORT, 'Eval Case results are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_results_delete_blocked`
BEFORE DELETE ON `ai_eval_case_results`
BEGIN SELECT RAISE(ABORT, 'Eval Case results are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_grader_results_insert_valid`
BEFORE INSERT ON `ai_eval_grader_results`
WHEN NOT EXISTS (SELECT 1 FROM `ai_eval_case_results` AS result JOIN `ai_eval_runs` AS run ON run.`id` = result.`run_id` WHERE result.`id` = NEW.`case_result_id` AND run.`status` IN ('RUNNING','SCORING'))
BEGIN SELECT RAISE(ABORT, 'Eval grader result parent is not active'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_grader_results_update_blocked`
BEFORE UPDATE ON `ai_eval_grader_results`
BEGIN SELECT RAISE(ABORT, 'Eval grader results are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_grader_results_delete_blocked`
BEFORE DELETE ON `ai_eval_grader_results`
BEGIN SELECT RAISE(ABORT, 'Eval grader results are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_dimension_aggregates_insert_valid`
BEFORE INSERT ON `ai_eval_dimension_aggregates`
WHEN NOT EXISTS (SELECT 1 FROM `ai_eval_runs` AS run WHERE run.`id` = NEW.`run_id` AND run.`status` = 'SCORING')
BEGIN SELECT RAISE(ABORT, 'Eval aggregates require a SCORING Run'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_dimension_aggregates_update_blocked`
BEFORE UPDATE ON `ai_eval_dimension_aggregates`
BEGIN SELECT RAISE(ABORT, 'Eval dimension aggregates are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_dimension_aggregates_delete_blocked`
BEFORE DELETE ON `ai_eval_dimension_aggregates`
BEGIN SELECT RAISE(ABORT, 'Eval dimension aggregates are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_gate_results_insert_valid`
BEFORE INSERT ON `ai_eval_gate_results`
WHEN NOT EXISTS (SELECT 1 FROM `ai_eval_runs` AS run WHERE run.`id` = NEW.`run_id` AND run.`status` = 'SCORING')
BEGIN SELECT RAISE(ABORT, 'Eval gates require a SCORING Run'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_gate_results_update_blocked`
BEFORE UPDATE ON `ai_eval_gate_results`
BEGIN SELECT RAISE(ABORT, 'Eval gate results are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_gate_results_delete_blocked`
BEFORE DELETE ON `ai_eval_gate_results`
BEGIN SELECT RAISE(ABORT, 'Eval gate results are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_revisions_privacy_integrity`
BEFORE INSERT ON `ai_eval_case_revisions`
WHEN (NEW.`origin` = 'SYNTHETIC' AND NEW.`privacy_class` <> 'SYNTHETIC_PUBLIC_SAFE') OR (NEW.`origin` = 'CURATED' AND NEW.`privacy_class` <> 'INTERNAL_CURATED') OR (NEW.`origin` = 'DEIDENTIFIED_REGRESSION' AND (NEW.`privacy_class` <> 'DEIDENTIFIED_REGRESSION' OR NEW.`deidentification_proof` IS NULL OR json_valid(NEW.`deidentification_proof`) = 0 OR json_extract(NEW.`deidentification_proof`, '$.approved') <> 1)) OR (NEW.`origin` <> 'DEIDENTIFIED_REGRESSION' AND NEW.`deidentification_proof` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Eval Case privacy classification is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suite_revisions_json_integrity`
BEFORE INSERT ON `ai_eval_suite_revisions`
WHEN EXISTS (SELECT 1 FROM json_each(NEW.`required_dimensions`) AS item WHERE json_type(item.`value`) <> 'object' OR json_type(item.`value`, '$.dimension') <> 'text' OR json_extract(item.`value`, '$.dimension') NOT IN ('CORRECTNESS','CURRICULUM_FIDELITY','GROUNDEDNESS','SOURCE_FIDELITY','RELEVANCE','CONCISENESS','INSTRUCTION_FOLLOWING','ARABIC_QUALITY','IRAQI_NATURALNESS','MATHEMATICS_CORRECTNESS','OFF_TOPIC_BEHAVIOR','RETRIEVAL_QUALITY','COST','LATENCY','SECURITY') OR json_type(item.`value`, '$.mode') <> 'text' OR json_extract(item.`value`, '$.mode') NOT IN ('DETERMINISTICALLY_GRADED','JUDGE_REQUIRED','NOT_APPLICABLE')) OR EXISTS (SELECT 1 FROM (SELECT json_extract(item.`value`, '$.dimension') AS dimension, COUNT(*) AS count FROM json_each(NEW.`required_dimensions`) AS item GROUP BY dimension) AS duplicates WHERE duplicates.`count` > 1) OR EXISTS (SELECT 1 FROM json_each(NEW.`grader_configs`) AS item WHERE json_type(item.`value`) <> 'object' OR json_type(item.`value`, '$.graderKey') <> 'text' OR json_type(item.`value`, '$.graderRevision') <> 'integer' OR json_extract(item.`value`, '$.graderRevision') < 1 OR json_type(item.`value`, '$.dimension') <> 'text' OR json_extract(item.`value`, '$.dimension') NOT IN ('CORRECTNESS','CURRICULUM_FIDELITY','GROUNDEDNESS','SOURCE_FIDELITY','RELEVANCE','CONCISENESS','INSTRUCTION_FOLLOWING','ARABIC_QUALITY','IRAQI_NATURALNESS','MATHEMATICS_CORRECTNESS','OFF_TOPIC_BEHAVIOR','RETRIEVAL_QUALITY','COST','LATENCY','SECURITY') OR json_type(item.`value`, '$.required') NOT IN ('true','false')) OR EXISTS (SELECT 1 FROM (SELECT json_extract(item.`value`, '$.graderKey') AS grader_key, json_extract(item.`value`, '$.graderRevision') AS grader_revision, COUNT(*) AS count FROM json_each(NEW.`grader_configs`) AS item GROUP BY grader_key, grader_revision) AS duplicates WHERE duplicates.`count` > 1) OR json_type(NEW.`gate_config`, '$.minimumScores') <> 'array' OR EXISTS (SELECT 1 FROM json_each(json_extract(NEW.`gate_config`, '$.minimumScores')) AS item WHERE json_type(item.`value`) <> 'object' OR json_type(item.`value`, '$.dimension') <> 'text' OR json_extract(item.`value`, '$.dimension') NOT IN ('CORRECTNESS','CURRICULUM_FIDELITY','GROUNDEDNESS','SOURCE_FIDELITY','RELEVANCE','CONCISENESS','INSTRUCTION_FOLLOWING','ARABIC_QUALITY','IRAQI_NATURALNESS','MATHEMATICS_CORRECTNESS','OFF_TOPIC_BEHAVIOR','RETRIEVAL_QUALITY','COST','LATENCY','SECURITY') OR json_type(item.`value`, '$.scoreUnits') <> 'integer' OR json_extract(item.`value`, '$.scoreUnits') NOT BETWEEN 0 AND 1000000) OR EXISTS (SELECT 1 FROM (SELECT json_extract(item.`value`, '$.dimension') AS dimension, COUNT(*) AS count FROM json_each(json_extract(NEW.`gate_config`, '$.minimumScores')) AS item GROUP BY dimension) AS duplicates WHERE duplicates.`count` > 1) OR json_type(NEW.`gate_config`, '$.maximumCostNano') NOT IN ('integer','null') OR (json_type(NEW.`gate_config`, '$.maximumCostNano') = 'integer' AND json_extract(NEW.`gate_config`, '$.maximumCostNano') < 0) OR json_type(NEW.`gate_config`, '$.maximumLatencyMs') NOT IN ('integer','null') OR (json_type(NEW.`gate_config`, '$.maximumLatencyMs') = 'integer' AND json_extract(NEW.`gate_config`, '$.maximumLatencyMs') < 0) OR json_type(NEW.`gate_config`, '$.requireSecurityPass') NOT IN ('true','false') OR EXISTS (SELECT 1 FROM json_each(NEW.`permitted_regression_deltas`) AS item WHERE json_type(item.`value`) <> 'object' OR json_type(item.`value`, '$.dimension') <> 'text' OR json_extract(item.`value`, '$.dimension') NOT IN ('CORRECTNESS','CURRICULUM_FIDELITY','GROUNDEDNESS','SOURCE_FIDELITY','RELEVANCE','CONCISENESS','INSTRUCTION_FOLLOWING','ARABIC_QUALITY','IRAQI_NATURALNESS','MATHEMATICS_CORRECTNESS','OFF_TOPIC_BEHAVIOR','RETRIEVAL_QUALITY','COST','LATENCY','SECURITY') OR json_type(item.`value`, '$.maximumRegressionUnits') <> 'integer' OR json_extract(item.`value`, '$.maximumRegressionUnits') NOT BETWEEN 0 AND 1000000) OR EXISTS (SELECT 1 FROM (SELECT json_extract(item.`value`, '$.dimension') AS dimension, COUNT(*) AS count FROM json_each(NEW.`permitted_regression_deltas`) AS item GROUP BY dimension) AS duplicates WHERE duplicates.`count` > 1)
BEGIN SELECT RAISE(ABORT, 'Eval Suite JSON configuration is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_suite_revisions_required_json_fields`
BEFORE INSERT ON `ai_eval_suite_revisions`
WHEN EXISTS (SELECT 1 FROM json_each(NEW.`required_dimensions`) AS item WHERE json_type(item.`value`, '$.dimension') IS NULL OR json_type(item.`value`, '$.mode') IS NULL)
 OR EXISTS (SELECT 1 FROM json_each(NEW.`grader_configs`) AS item WHERE json_type(item.`value`, '$.graderKey') IS NULL OR json_type(item.`value`, '$.graderRevision') IS NULL OR json_type(item.`value`, '$.dimension') IS NULL OR json_type(item.`value`, '$.required') IS NULL)
 OR json_type(NEW.`gate_config`, '$.minimumScores') IS NULL
 OR json_type(NEW.`gate_config`, '$.maximumCostNano') IS NULL
 OR json_type(NEW.`gate_config`, '$.maximumLatencyMs') IS NULL
 OR json_type(NEW.`gate_config`, '$.requireSecurityPass') IS NULL
 OR EXISTS (SELECT 1 FROM json_each(json_extract(NEW.`gate_config`, '$.minimumScores')) AS item WHERE json_type(item.`value`, '$.dimension') IS NULL OR json_type(item.`value`, '$.scoreUnits') IS NULL)
 OR EXISTS (SELECT 1 FROM json_each(NEW.`permitted_regression_deltas`) AS item WHERE json_type(item.`value`, '$.dimension') IS NULL OR json_type(item.`value`, '$.maximumRegressionUnits') IS NULL)
 OR (NEW.`supplementary_judge_config` IS NOT NULL AND (json_type(NEW.`supplementary_judge_config`, '$.referenceKey') IS NULL OR json_type(NEW.`supplementary_judge_config`, '$.revision') IS NULL))
BEGIN SELECT RAISE(ABORT, 'Eval Suite JSON fields are incomplete'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_revisions_required_deidentification_fields`
BEFORE INSERT ON `ai_eval_case_revisions`
WHEN NEW.`origin` = 'DEIDENTIFIED_REGRESSION' AND (json_type(NEW.`deidentification_proof`, '$.approved') IS NULL OR json_type(NEW.`deidentification_proof`, '$.methodKey') IS NULL OR json_type(NEW.`deidentification_proof`, '$.reviewerReference') IS NULL)
BEGIN SELECT RAISE(ABORT, 'Eval Case de-identification proof is incomplete'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_results_cost_privacy`
BEFORE INSERT ON `ai_eval_case_results`
WHEN NEW.`cost_operation_id` IS NOT NULL AND EXISTS (
  SELECT 1 FROM `ai_cost_operations` AS operation
  WHERE operation.`id` = NEW.`cost_operation_id`
    AND (operation.`opaque_principal_ref` IS NOT NULL OR operation.`conversation_id` IS NOT NULL OR operation.`response_id` IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'Eval cost operation identity is not permitted'); END;
