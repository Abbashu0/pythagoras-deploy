CREATE TABLE `ai_cost_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`original_record_id` text NOT NULL,
	`currency` text NOT NULL,
	`delta_cost_nano` integer NOT NULL,
	`reason_code` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`original_record_id`) REFERENCES `ai_usage_cost_records`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_cost_corrections_currency_valid" CHECK(length("ai_cost_corrections"."currency") = 3 and "ai_cost_corrections"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "ai_cost_corrections_delta_valid" CHECK("ai_cost_corrections"."delta_cost_nano" between -9007199254740991 and 9007199254740991),
	CONSTRAINT "ai_cost_corrections_reason_valid" CHECK(length(trim("ai_cost_corrections"."reason_code")) between 1 and 120 and "ai_cost_corrections"."reason_code" not glob '*[^A-Z0-9_.-]*'),
	CONSTRAINT "ai_cost_corrections_actor_valid" CHECK(("ai_cost_corrections"."actor_type" = 'SYSTEM' and "ai_cost_corrections"."actor_user_id" is null) or ("ai_cost_corrections"."actor_type" = 'ADMIN' and "ai_cost_corrections"."actor_user_id" is not null)),
	CONSTRAINT "ai_cost_corrections_actor_type_valid" CHECK("ai_cost_corrections"."actor_type" in ('ADMIN','SYSTEM')),
	CONSTRAINT "ai_cost_corrections_created_nonnegative" CHECK("ai_cost_corrections"."created_at" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_cost_corrections_original_index` ON `ai_cost_corrections` (`original_record_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_cost_corrections_currency_index` ON `ai_cost_corrections` (`currency`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_cost_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`cost_center` text NOT NULL,
	`idempotency_key` text,
	`opaque_principal_ref` text,
	`subject_key` text,
	`conversation_id` text,
	`response_id` text,
	`job_id` text,
	`eval_run_id` text,
	`knowledge_revision` integer,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "ai_cost_operations_cost_center_valid" CHECK("ai_cost_operations"."cost_center" in ('STUDENT_GENERATION','KNOWLEDGE_INDEXING','AGENT_2','EVALS','EXPERIMENTS')),
	CONSTRAINT "ai_cost_operations_status_valid" CHECK("ai_cost_operations"."status" in ('OPEN','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "ai_cost_operations_knowledge_revision_valid" CHECK("ai_cost_operations"."knowledge_revision" is null or "ai_cost_operations"."knowledge_revision" >= 1),
	CONSTRAINT "ai_cost_operations_started_nonnegative" CHECK("ai_cost_operations"."started_at" >= 0),
	CONSTRAINT "ai_cost_operations_timestamps_ordered" CHECK("ai_cost_operations"."completed_at" is null or "ai_cost_operations"."completed_at" >= "ai_cost_operations"."started_at"),
	CONSTRAINT "ai_cost_operations_idempotency_length" CHECK("ai_cost_operations"."idempotency_key" is null or length(trim("ai_cost_operations"."idempotency_key")) between 1 and 200),
	CONSTRAINT "ai_cost_operations_principal_length" CHECK("ai_cost_operations"."opaque_principal_ref" is null or length(trim("ai_cost_operations"."opaque_principal_ref")) between 1 and 200),
	CONSTRAINT "ai_cost_operations_subject_length" CHECK("ai_cost_operations"."subject_key" is null or length(trim("ai_cost_operations"."subject_key")) between 1 and 120),
	CONSTRAINT "ai_cost_operations_conversation_length" CHECK("ai_cost_operations"."conversation_id" is null or length(trim("ai_cost_operations"."conversation_id")) between 1 and 120),
	CONSTRAINT "ai_cost_operations_response_length" CHECK("ai_cost_operations"."response_id" is null or length(trim("ai_cost_operations"."response_id")) between 1 and 120),
	CONSTRAINT "ai_cost_operations_job_length" CHECK("ai_cost_operations"."job_id" is null or length(trim("ai_cost_operations"."job_id")) between 1 and 120),
	CONSTRAINT "ai_cost_operations_eval_length" CHECK("ai_cost_operations"."eval_run_id" is null or length(trim("ai_cost_operations"."eval_run_id")) between 1 and 120)
);
--> statement-breakpoint
CREATE INDEX `ai_cost_operations_cost_center_index` ON `ai_cost_operations` (`cost_center`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_cost_operations_status_index` ON `ai_cost_operations` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_cost_operations_subject_index` ON `ai_cost_operations` (`subject_key`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_cost_operations_idempotency_index` ON `ai_cost_operations` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `ai_rate_card_price_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`rate_card_revision_id` text NOT NULL,
	`time_band_id` text,
	`component` text NOT NULL,
	`unit` text NOT NULL,
	`amount_nano` integer NOT NULL,
	FOREIGN KEY (`rate_card_revision_id`) REFERENCES `ai_rate_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`time_band_id`) REFERENCES `ai_rate_card_time_bands`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_rate_card_price_lines_component_valid" CHECK("ai_rate_card_price_lines"."component" in ('STANDARD_INPUT','CACHE_HIT_INPUT','CACHE_MISS_INPUT','OUTPUT','REASONING','REQUEST')),
	CONSTRAINT "ai_rate_card_price_lines_unit_valid" CHECK("ai_rate_card_price_lines"."unit" in ('PER_MILLION_TOKENS','PER_REQUEST')),
	CONSTRAINT "ai_rate_card_price_lines_amount_valid" CHECK("ai_rate_card_price_lines"."amount_nano" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `ai_rate_card_price_lines_revision_index` ON `ai_rate_card_price_lines` (`rate_card_revision_id`);--> statement-breakpoint
CREATE INDEX `ai_rate_card_price_lines_band_index` ON `ai_rate_card_price_lines` (`time_band_id`);--> statement-breakpoint
CREATE TABLE `ai_rate_card_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`rate_card_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`model_config_id` text NOT NULL,
	`model_config_revision` integer NOT NULL,
	`currency` text NOT NULL,
	`billing_usage_normalizer_key` text NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`rate_card_id`) REFERENCES `ai_rate_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_rate_card_revisions_revision_positive" CHECK("ai_rate_card_revisions"."revision" >= 1),
	CONSTRAINT "ai_rate_card_revisions_model_revision_positive" CHECK("ai_rate_card_revisions"."model_config_revision" >= 1),
	CONSTRAINT "ai_rate_card_revisions_currency_valid" CHECK(length("ai_rate_card_revisions"."currency") = 3 and "ai_rate_card_revisions"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "ai_rate_card_revisions_normalizer_key_valid" CHECK(length(trim("ai_rate_card_revisions"."billing_usage_normalizer_key")) between 1 and 120 and "ai_rate_card_revisions"."billing_usage_normalizer_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_rate_card_revisions_effective_from_valid" CHECK("ai_rate_card_revisions"."effective_from" >= 0),
	CONSTRAINT "ai_rate_card_revisions_effective_window_valid" CHECK("ai_rate_card_revisions"."effective_to" is null or "ai_rate_card_revisions"."effective_to" > "ai_rate_card_revisions"."effective_from"),
	CONSTRAINT "ai_rate_card_revisions_enabled_boolean" CHECK("ai_rate_card_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_rate_card_revisions_display_name_valid" CHECK(length(trim("ai_rate_card_revisions"."display_name")) between 1 and 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_rate_card_revisions_identity_unique` ON `ai_rate_card_revisions` (`rate_card_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_rate_card_revisions_target_index` ON `ai_rate_card_revisions` (`model_config_id`,`model_config_revision`,`currency`,`effective_from`);--> statement-breakpoint
CREATE INDEX `ai_rate_card_revisions_enabled_index` ON `ai_rate_card_revisions` (`enabled`);--> statement-breakpoint
CREATE TABLE `ai_rate_card_time_bands` (
	`id` text PRIMARY KEY NOT NULL,
	`rate_card_revision_id` text NOT NULL,
	`time_zone` text NOT NULL,
	`days_of_week_mask` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	FOREIGN KEY (`rate_card_revision_id`) REFERENCES `ai_rate_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_rate_card_time_bands_timezone_valid" CHECK(length(trim("ai_rate_card_time_bands"."time_zone")) between 1 and 120),
	CONSTRAINT "ai_rate_card_time_bands_days_valid" CHECK("ai_rate_card_time_bands"."days_of_week_mask" between 1 and 127),
	CONSTRAINT "ai_rate_card_time_bands_start_valid" CHECK("ai_rate_card_time_bands"."start_minute" between 0 and 1439),
	CONSTRAINT "ai_rate_card_time_bands_end_valid" CHECK("ai_rate_card_time_bands"."end_minute" between 1 and 1440),
	CONSTRAINT "ai_rate_card_time_bands_ordered" CHECK("ai_rate_card_time_bands"."start_minute" < "ai_rate_card_time_bands"."end_minute")
);
--> statement-breakpoint
CREATE INDEX `ai_rate_card_time_bands_revision_index` ON `ai_rate_card_time_bands` (`rate_card_revision_id`);--> statement-breakpoint
CREATE TABLE `ai_rate_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`rate_card_key` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_rate_cards_key_valid" CHECK(length(trim("ai_rate_cards"."rate_card_key")) between 1 and 120 and "ai_rate_cards"."rate_card_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_rate_cards_revision_positive" CHECK("ai_rate_cards"."current_revision" >= 1),
	CONSTRAINT "ai_rate_cards_timestamps_ordered" CHECK("ai_rate_cards"."updated_at" >= "ai_rate_cards"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_rate_cards_key_unique` ON `ai_rate_cards` (`rate_card_key`);--> statement-breakpoint
CREATE INDEX `ai_rate_cards_updated_at_index` ON `ai_rate_cards` (`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_usage_cost_records` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`gateway_request_id` text,
	`attempt_index` integer,
	`capability` text NOT NULL,
	`model_config_id` text NOT NULL,
	`model_config_revision` integer NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_config_revision` integer NOT NULL,
	`provider_request_id` text,
	`rate_card_id` text NOT NULL,
	`rate_card_revision` integer NOT NULL,
	`rate_card_revision_id` text NOT NULL,
	`resolved_pricing_rule` text NOT NULL,
	`normalized_input_tokens` integer,
	`normalized_cache_hit_input_tokens` integer,
	`normalized_cache_miss_input_tokens` integer,
	`normalized_output_tokens` integer,
	`normalized_reasoning_tokens` integer,
	`billable_standard_input_tokens` integer,
	`billable_cache_hit_input_tokens` integer,
	`billable_cache_miss_input_tokens` integer,
	`billable_output_tokens` integer,
	`billable_reasoning_tokens` integer,
	`request_units` integer NOT NULL,
	`currency` text NOT NULL,
	`known_cost_nano` integer NOT NULL,
	`cost_completeness` text NOT NULL,
	`cost_basis` text NOT NULL,
	`attempt_status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`latency_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_card_id`) REFERENCES `ai_rate_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_card_revision_id`) REFERENCES `ai_rate_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_usage_cost_records_attempt_index_valid" CHECK("ai_usage_cost_records"."attempt_index" is null or "ai_usage_cost_records"."attempt_index" >= 0),
	CONSTRAINT "ai_usage_cost_records_capability_valid" CHECK("ai_usage_cost_records"."capability" in ('GENERATION','EMBEDDING','RERANK')),
	CONSTRAINT "ai_usage_cost_records_model_revision_positive" CHECK("ai_usage_cost_records"."model_config_revision" >= 1),
	CONSTRAINT "ai_usage_cost_records_provider_revision_positive" CHECK("ai_usage_cost_records"."provider_config_revision" >= 1),
	CONSTRAINT "ai_usage_cost_records_rate_card_revision_positive" CHECK("ai_usage_cost_records"."rate_card_revision" >= 1),
	CONSTRAINT "ai_usage_cost_records_gateway_length" CHECK("ai_usage_cost_records"."gateway_request_id" is null or length(trim("ai_usage_cost_records"."gateway_request_id")) between 1 and 120),
	CONSTRAINT "ai_usage_cost_records_provider_request_length" CHECK("ai_usage_cost_records"."provider_request_id" is null or length(trim("ai_usage_cost_records"."provider_request_id")) between 1 and 200),
	CONSTRAINT "ai_usage_cost_records_pricing_rule_length" CHECK(length(trim("ai_usage_cost_records"."resolved_pricing_rule")) between 1 and 200),
	CONSTRAINT "ai_usage_cost_records_currency_valid" CHECK(length("ai_usage_cost_records"."currency") = 3 and "ai_usage_cost_records"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "ai_usage_cost_records_nonnegative_usage" CHECK(
      ("ai_usage_cost_records"."normalized_input_tokens" is null or "ai_usage_cost_records"."normalized_input_tokens" >= 0) and
      ("ai_usage_cost_records"."normalized_cache_hit_input_tokens" is null or "ai_usage_cost_records"."normalized_cache_hit_input_tokens" >= 0) and
      ("ai_usage_cost_records"."normalized_cache_miss_input_tokens" is null or "ai_usage_cost_records"."normalized_cache_miss_input_tokens" >= 0) and
      ("ai_usage_cost_records"."normalized_output_tokens" is null or "ai_usage_cost_records"."normalized_output_tokens" >= 0) and
      ("ai_usage_cost_records"."normalized_reasoning_tokens" is null or "ai_usage_cost_records"."normalized_reasoning_tokens" >= 0) and
      ("ai_usage_cost_records"."billable_standard_input_tokens" is null or "ai_usage_cost_records"."billable_standard_input_tokens" >= 0) and
      ("ai_usage_cost_records"."billable_cache_hit_input_tokens" is null or "ai_usage_cost_records"."billable_cache_hit_input_tokens" >= 0) and
      ("ai_usage_cost_records"."billable_cache_miss_input_tokens" is null or "ai_usage_cost_records"."billable_cache_miss_input_tokens" >= 0)
    ),
	CONSTRAINT "ai_usage_cost_records_billable_output_nonnegative" CHECK("ai_usage_cost_records"."billable_output_tokens" is null or "ai_usage_cost_records"."billable_output_tokens" >= 0),
	CONSTRAINT "ai_usage_cost_records_billable_reasoning_nonnegative" CHECK("ai_usage_cost_records"."billable_reasoning_tokens" is null or "ai_usage_cost_records"."billable_reasoning_tokens" >= 0),
	CONSTRAINT "ai_usage_cost_records_request_units_valid" CHECK("ai_usage_cost_records"."request_units" >= 0),
	CONSTRAINT "ai_usage_cost_records_known_cost_valid" CHECK("ai_usage_cost_records"."known_cost_nano" between 0 and 9007199254740991),
	CONSTRAINT "ai_usage_cost_records_completeness_valid" CHECK("ai_usage_cost_records"."cost_completeness" in ('COMPLETE','PARTIAL')),
	CONSTRAINT "ai_usage_cost_records_basis_valid" CHECK("ai_usage_cost_records"."cost_basis" in ('RATE_CARD','PROVIDER_REPORTED')),
	CONSTRAINT "ai_usage_cost_records_status_valid" CHECK("ai_usage_cost_records"."attempt_status" in ('SUCCEEDED','FAILED','CANCELLED','TIMEOUT')),
	CONSTRAINT "ai_usage_cost_records_started_nonnegative" CHECK("ai_usage_cost_records"."started_at" >= 0),
	CONSTRAINT "ai_usage_cost_records_completed_ordered" CHECK("ai_usage_cost_records"."completed_at" is null or "ai_usage_cost_records"."completed_at" >= "ai_usage_cost_records"."started_at"),
	CONSTRAINT "ai_usage_cost_records_latency_valid" CHECK("ai_usage_cost_records"."latency_ms" is null or "ai_usage_cost_records"."latency_ms" >= 0),
	CONSTRAINT "ai_usage_cost_records_created_nonnegative" CHECK("ai_usage_cost_records"."created_at" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_operation_index` ON `ai_usage_cost_records` (`operation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_gateway_index` ON `ai_usage_cost_records` (`gateway_request_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_model_index` ON `ai_usage_cost_records` (`model_config_id`,`model_config_revision`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_provider_index` ON `ai_usage_cost_records` (`provider_config_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_currency_index` ON `ai_usage_cost_records` (`currency`,`created_at`);