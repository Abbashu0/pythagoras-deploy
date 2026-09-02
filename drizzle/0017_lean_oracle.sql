CREATE TABLE `ai_circuit_breaker_events` (
	`id` text PRIMARY KEY NOT NULL,
	`target_hash` text NOT NULL,
	`state_generation` integer NOT NULL,
	`event_type` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_hash`) REFERENCES `ai_circuit_breaker_states`(`target_hash`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_circuit_breaker_events_target_hash_valid" CHECK(length("ai_circuit_breaker_events"."target_hash") = 64 and "ai_circuit_breaker_events"."target_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_circuit_breaker_events_generation_valid" CHECK("ai_circuit_breaker_events"."state_generation" >= 1),
	CONSTRAINT "ai_circuit_breaker_events_type_valid" CHECK("ai_circuit_breaker_events"."event_type" in ('FAILURE_COUNTED','OPENED','AUTHENTICATION_OPENED','HALF_OPEN_PROBE_GRANTED','HALF_OPEN_PROBE_RECLAIMED','HALF_OPEN_PROBE_RELEASED','CLOSED')),
	CONSTRAINT "ai_circuit_breaker_events_error_valid" CHECK("ai_circuit_breaker_events"."error_code" is null or "ai_circuit_breaker_events"."error_code" in ('RATE_LIMITED','TIMEOUT','UNAVAILABLE','BAD_RESPONSE','UNKNOWN','AUTHENTICATION')),
	CONSTRAINT "ai_circuit_breaker_events_created_nonnegative" CHECK("ai_circuit_breaker_events"."created_at" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_circuit_breaker_events_target_time_index` ON `ai_circuit_breaker_events` (`target_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_circuit_breaker_events_time_index` ON `ai_circuit_breaker_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `ai_circuit_breaker_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_key` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_circuit_breaker_policies_key_valid" CHECK(length(trim("ai_circuit_breaker_policies"."policy_key")) between 1 and 120 and "ai_circuit_breaker_policies"."policy_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_circuit_breaker_policies_revision_positive" CHECK("ai_circuit_breaker_policies"."current_revision" >= 1),
	CONSTRAINT "ai_circuit_breaker_policies_created_nonnegative" CHECK("ai_circuit_breaker_policies"."created_at" >= 0),
	CONSTRAINT "ai_circuit_breaker_policies_timestamps_ordered" CHECK("ai_circuit_breaker_policies"."updated_at" >= "ai_circuit_breaker_policies"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_circuit_breaker_policies_key_unique` ON `ai_circuit_breaker_policies` (`policy_key`);--> statement-breakpoint
CREATE TABLE `ai_circuit_breaker_policy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`circuit_policy_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`failure_threshold` integer NOT NULL,
	`open_duration_ms` integer NOT NULL,
	`half_open_probe_lease_ms` integer NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`circuit_policy_id`) REFERENCES `ai_circuit_breaker_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_circuit_breaker_policy_revisions_revision_positive" CHECK("ai_circuit_breaker_policy_revisions"."revision" >= 1),
	CONSTRAINT "ai_circuit_breaker_policy_revisions_display_name_valid" CHECK(length(trim("ai_circuit_breaker_policy_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_circuit_breaker_policy_revisions_threshold_valid" CHECK("ai_circuit_breaker_policy_revisions"."failure_threshold" between 1 and 100),
	CONSTRAINT "ai_circuit_breaker_policy_revisions_open_duration_valid" CHECK("ai_circuit_breaker_policy_revisions"."open_duration_ms" between 1000 and 86400000),
	CONSTRAINT "ai_circuit_breaker_policy_revisions_probe_lease_valid" CHECK("ai_circuit_breaker_policy_revisions"."half_open_probe_lease_ms" between 100 and 86400000),
	CONSTRAINT "ai_circuit_breaker_policy_revisions_enabled_boolean" CHECK("ai_circuit_breaker_policy_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_circuit_breaker_policy_revisions_created_nonnegative" CHECK("ai_circuit_breaker_policy_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_circuit_breaker_policy_revisions_identity_unique` ON `ai_circuit_breaker_policy_revisions` (`circuit_policy_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_circuit_breaker_policy_revisions_policy_index` ON `ai_circuit_breaker_policy_revisions` (`circuit_policy_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_circuit_breaker_states` (
	`id` text PRIMARY KEY NOT NULL,
	`target_hash` text NOT NULL,
	`policy_id` text NOT NULL,
	`policy_revision` integer NOT NULL,
	`model_config_id` text NOT NULL,
	`model_config_revision` integer NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_config_revision` integer NOT NULL,
	`capability` text NOT NULL,
	`adapter_key` text NOT NULL,
	`secret_version` integer NOT NULL,
	`state` text NOT NULL,
	`state_generation` integer NOT NULL,
	`consecutive_failures` integer NOT NULL,
	`opened_at` integer,
	`open_until` integer,
	`probe_owner` text,
	`probe_token` text,
	`probe_expires_at` integer,
	`last_success_at` integer,
	`last_failure_at` integer,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `ai_circuit_breaker_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_circuit_breaker_states_target_hash_valid" CHECK(length("ai_circuit_breaker_states"."target_hash") = 64 and "ai_circuit_breaker_states"."target_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_circuit_breaker_states_policy_revision_positive" CHECK("ai_circuit_breaker_states"."policy_revision" >= 1),
	CONSTRAINT "ai_circuit_breaker_states_model_revision_positive" CHECK("ai_circuit_breaker_states"."model_config_revision" >= 1),
	CONSTRAINT "ai_circuit_breaker_states_provider_revision_positive" CHECK("ai_circuit_breaker_states"."provider_config_revision" >= 1),
	CONSTRAINT "ai_circuit_breaker_states_capability_valid" CHECK("ai_circuit_breaker_states"."capability" in ('GENERATION','EMBEDDING','RERANK')),
	CONSTRAINT "ai_circuit_breaker_states_adapter_key_valid" CHECK(length(trim("ai_circuit_breaker_states"."adapter_key")) between 1 and 120 and "ai_circuit_breaker_states"."adapter_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_circuit_breaker_states_secret_version_positive" CHECK("ai_circuit_breaker_states"."secret_version" >= 1),
	CONSTRAINT "ai_circuit_breaker_states_state_valid" CHECK("ai_circuit_breaker_states"."state" in ('CLOSED','OPEN','HALF_OPEN')),
	CONSTRAINT "ai_circuit_breaker_states_generation_valid" CHECK("ai_circuit_breaker_states"."state_generation" between 1 and 1000000000),
	CONSTRAINT "ai_circuit_breaker_states_failure_count_valid" CHECK("ai_circuit_breaker_states"."consecutive_failures" between 0 and 1000000),
	CONSTRAINT "ai_circuit_breaker_states_created_nonnegative" CHECK("ai_circuit_breaker_states"."created_at" >= 0),
	CONSTRAINT "ai_circuit_breaker_states_updated_nonnegative" CHECK("ai_circuit_breaker_states"."updated_at" >= "ai_circuit_breaker_states"."created_at"),
	CONSTRAINT "ai_circuit_breaker_states_opened_nonnegative" CHECK("ai_circuit_breaker_states"."opened_at" is null or "ai_circuit_breaker_states"."opened_at" >= 0),
	CONSTRAINT "ai_circuit_breaker_states_open_until_nonnegative" CHECK("ai_circuit_breaker_states"."open_until" is null or "ai_circuit_breaker_states"."open_until" >= 0),
	CONSTRAINT "ai_circuit_breaker_states_probe_expires_nonnegative" CHECK("ai_circuit_breaker_states"."probe_expires_at" is null or "ai_circuit_breaker_states"."probe_expires_at" >= 0),
	CONSTRAINT "ai_circuit_breaker_states_last_success_nonnegative" CHECK("ai_circuit_breaker_states"."last_success_at" is null or "ai_circuit_breaker_states"."last_success_at" >= 0),
	CONSTRAINT "ai_circuit_breaker_states_last_failure_nonnegative" CHECK("ai_circuit_breaker_states"."last_failure_at" is null or "ai_circuit_breaker_states"."last_failure_at" >= 0),
	CONSTRAINT "ai_circuit_breaker_states_probe_owner_valid" CHECK("ai_circuit_breaker_states"."probe_owner" is null or length(trim("ai_circuit_breaker_states"."probe_owner")) between 1 and 200),
	CONSTRAINT "ai_circuit_breaker_states_probe_token_valid" CHECK("ai_circuit_breaker_states"."probe_token" is null or length(trim("ai_circuit_breaker_states"."probe_token")) between 1 and 200),
	CONSTRAINT "ai_circuit_breaker_states_error_valid" CHECK("ai_circuit_breaker_states"."last_error_code" is null or "ai_circuit_breaker_states"."last_error_code" in ('RATE_LIMITED','TIMEOUT','UNAVAILABLE','BAD_RESPONSE','UNKNOWN','AUTHENTICATION')),
	CONSTRAINT "ai_circuit_breaker_states_fields_valid" CHECK(
      ("ai_circuit_breaker_states"."state" = 'CLOSED' and "ai_circuit_breaker_states"."opened_at" is null and "ai_circuit_breaker_states"."open_until" is null and "ai_circuit_breaker_states"."probe_owner" is null and "ai_circuit_breaker_states"."probe_token" is null and "ai_circuit_breaker_states"."probe_expires_at" is null) or
      ("ai_circuit_breaker_states"."state" = 'OPEN' and "ai_circuit_breaker_states"."opened_at" is not null and "ai_circuit_breaker_states"."open_until" is not null and "ai_circuit_breaker_states"."open_until" >= "ai_circuit_breaker_states"."opened_at" and "ai_circuit_breaker_states"."probe_owner" is null and "ai_circuit_breaker_states"."probe_token" is null and "ai_circuit_breaker_states"."probe_expires_at" is null) or
      ("ai_circuit_breaker_states"."state" = 'HALF_OPEN' and "ai_circuit_breaker_states"."opened_at" is not null and "ai_circuit_breaker_states"."open_until" is null and "ai_circuit_breaker_states"."probe_owner" is not null and "ai_circuit_breaker_states"."probe_token" is not null and "ai_circuit_breaker_states"."probe_expires_at" is not null)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_circuit_breaker_states_target_hash_unique` ON `ai_circuit_breaker_states` (`target_hash`);--> statement-breakpoint
CREATE INDEX `ai_circuit_breaker_states_provider_state_index` ON `ai_circuit_breaker_states` (`provider_config_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_circuit_breaker_states_model_state_index` ON `ai_circuit_breaker_states` (`model_config_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_circuit_breaker_states_policy_index` ON `ai_circuit_breaker_states` (`policy_id`,`policy_revision`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_usage_cost_records` (
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
	CONSTRAINT "ai_usage_cost_records_attempt_index_valid" CHECK("__new_ai_usage_cost_records"."attempt_index" is null or "__new_ai_usage_cost_records"."attempt_index" >= 0),
	CONSTRAINT "ai_usage_cost_records_capability_valid" CHECK("__new_ai_usage_cost_records"."capability" in ('GENERATION','EMBEDDING','RERANK')),
	CONSTRAINT "ai_usage_cost_records_model_revision_positive" CHECK("__new_ai_usage_cost_records"."model_config_revision" >= 1),
	CONSTRAINT "ai_usage_cost_records_provider_revision_positive" CHECK("__new_ai_usage_cost_records"."provider_config_revision" >= 1),
	CONSTRAINT "ai_usage_cost_records_rate_card_revision_positive" CHECK("__new_ai_usage_cost_records"."rate_card_revision" >= 1),
	CONSTRAINT "ai_usage_cost_records_gateway_length" CHECK("__new_ai_usage_cost_records"."gateway_request_id" is null or length(trim("__new_ai_usage_cost_records"."gateway_request_id")) between 1 and 120),
	CONSTRAINT "ai_usage_cost_records_provider_request_length" CHECK("__new_ai_usage_cost_records"."provider_request_id" is null or length(trim("__new_ai_usage_cost_records"."provider_request_id")) between 1 and 200),
	CONSTRAINT "ai_usage_cost_records_pricing_rule_length" CHECK(length(trim("__new_ai_usage_cost_records"."resolved_pricing_rule")) between 1 and 200),
	CONSTRAINT "ai_usage_cost_records_currency_valid" CHECK(length("__new_ai_usage_cost_records"."currency") = 3 and "__new_ai_usage_cost_records"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "ai_usage_cost_records_nonnegative_usage" CHECK(
      ("__new_ai_usage_cost_records"."normalized_input_tokens" is null or "__new_ai_usage_cost_records"."normalized_input_tokens" >= 0) and
      ("__new_ai_usage_cost_records"."normalized_cache_hit_input_tokens" is null or "__new_ai_usage_cost_records"."normalized_cache_hit_input_tokens" >= 0) and
      ("__new_ai_usage_cost_records"."normalized_cache_miss_input_tokens" is null or "__new_ai_usage_cost_records"."normalized_cache_miss_input_tokens" >= 0) and
      ("__new_ai_usage_cost_records"."normalized_output_tokens" is null or "__new_ai_usage_cost_records"."normalized_output_tokens" >= 0) and
      ("__new_ai_usage_cost_records"."normalized_reasoning_tokens" is null or "__new_ai_usage_cost_records"."normalized_reasoning_tokens" >= 0) and
      ("__new_ai_usage_cost_records"."billable_standard_input_tokens" is null or "__new_ai_usage_cost_records"."billable_standard_input_tokens" >= 0) and
      ("__new_ai_usage_cost_records"."billable_cache_hit_input_tokens" is null or "__new_ai_usage_cost_records"."billable_cache_hit_input_tokens" >= 0) and
      ("__new_ai_usage_cost_records"."billable_cache_miss_input_tokens" is null or "__new_ai_usage_cost_records"."billable_cache_miss_input_tokens" >= 0)
    ),
	CONSTRAINT "ai_usage_cost_records_billable_output_nonnegative" CHECK("__new_ai_usage_cost_records"."billable_output_tokens" is null or "__new_ai_usage_cost_records"."billable_output_tokens" >= 0),
	CONSTRAINT "ai_usage_cost_records_billable_reasoning_nonnegative" CHECK("__new_ai_usage_cost_records"."billable_reasoning_tokens" is null or "__new_ai_usage_cost_records"."billable_reasoning_tokens" >= 0),
	CONSTRAINT "ai_usage_cost_records_request_units_valid" CHECK("__new_ai_usage_cost_records"."request_units" >= 0),
	CONSTRAINT "ai_usage_cost_records_known_cost_valid" CHECK("__new_ai_usage_cost_records"."known_cost_nano" between 0 and 9007199254740991),
	CONSTRAINT "ai_usage_cost_records_completeness_valid" CHECK("__new_ai_usage_cost_records"."cost_completeness" in ('COMPLETE','PARTIAL')),
	CONSTRAINT "ai_usage_cost_records_basis_valid" CHECK("__new_ai_usage_cost_records"."cost_basis" in ('RATE_CARD','PROVIDER_REPORTED')),
	CONSTRAINT "ai_usage_cost_records_status_valid" CHECK("__new_ai_usage_cost_records"."attempt_status" in ('SUCCEEDED','FAILED','CANCELLED','TIMEOUT','SKIPPED')),
	CONSTRAINT "ai_usage_cost_records_started_nonnegative" CHECK("__new_ai_usage_cost_records"."started_at" >= 0),
	CONSTRAINT "ai_usage_cost_records_completed_ordered" CHECK("__new_ai_usage_cost_records"."completed_at" is null or "__new_ai_usage_cost_records"."completed_at" >= "__new_ai_usage_cost_records"."started_at"),
	CONSTRAINT "ai_usage_cost_records_latency_valid" CHECK("__new_ai_usage_cost_records"."latency_ms" is null or "__new_ai_usage_cost_records"."latency_ms" >= 0),
	CONSTRAINT "ai_usage_cost_records_created_nonnegative" CHECK("__new_ai_usage_cost_records"."created_at" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage_cost_records`("id", "operation_id", "gateway_request_id", "attempt_index", "capability", "model_config_id", "model_config_revision", "provider_config_id", "provider_config_revision", "provider_request_id", "rate_card_id", "rate_card_revision", "rate_card_revision_id", "resolved_pricing_rule", "normalized_input_tokens", "normalized_cache_hit_input_tokens", "normalized_cache_miss_input_tokens", "normalized_output_tokens", "normalized_reasoning_tokens", "billable_standard_input_tokens", "billable_cache_hit_input_tokens", "billable_cache_miss_input_tokens", "billable_output_tokens", "billable_reasoning_tokens", "request_units", "currency", "known_cost_nano", "cost_completeness", "cost_basis", "attempt_status", "started_at", "completed_at", "latency_ms", "created_at") SELECT "id", "operation_id", "gateway_request_id", "attempt_index", "capability", "model_config_id", "model_config_revision", "provider_config_id", "provider_config_revision", "provider_request_id", "rate_card_id", "rate_card_revision", "rate_card_revision_id", "resolved_pricing_rule", "normalized_input_tokens", "normalized_cache_hit_input_tokens", "normalized_cache_miss_input_tokens", "normalized_output_tokens", "normalized_reasoning_tokens", "billable_standard_input_tokens", "billable_cache_hit_input_tokens", "billable_cache_miss_input_tokens", "billable_output_tokens", "billable_reasoning_tokens", "request_units", "currency", "known_cost_nano", "cost_completeness", "cost_basis", "attempt_status", "started_at", "completed_at", "latency_ms", "created_at" FROM `ai_usage_cost_records`;--> statement-breakpoint
DROP TABLE `ai_usage_cost_records`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage_cost_records` RENAME TO `ai_usage_cost_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_operation_index` ON `ai_usage_cost_records` (`operation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_gateway_index` ON `ai_usage_cost_records` (`gateway_request_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_model_index` ON `ai_usage_cost_records` (`model_config_id`,`model_config_revision`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_provider_index` ON `ai_usage_cost_records` (`provider_config_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_cost_records_currency_index` ON `ai_usage_cost_records` (`currency`,`created_at`);