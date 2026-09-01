CREATE TABLE `ai_budget_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_ref` text NOT NULL,
	`budget_policy_id` text NOT NULL,
	`budget_policy_revision` integer NOT NULL,
	`currency` text NOT NULL,
	`cost_center` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`hard_cap_nano` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`budget_policy_id`) REFERENCES `ai_budget_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_policy_id`,`budget_policy_revision`) REFERENCES `ai_budget_policy_revisions`(`budget_policy_id`,`revision`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_budget_accounts_principal_valid" CHECK(length(trim("ai_budget_accounts"."principal_ref")) between 1 and 200),
	CONSTRAINT "ai_budget_accounts_revision_positive" CHECK("ai_budget_accounts"."budget_policy_revision" >= 1),
	CONSTRAINT "ai_budget_accounts_currency_valid" CHECK(length("ai_budget_accounts"."currency") = 3 and "ai_budget_accounts"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "ai_budget_accounts_cost_center_valid" CHECK("ai_budget_accounts"."cost_center" in ('STUDENT_GENERATION','KNOWLEDGE_INDEXING','AGENT_2','EVALS','EXPERIMENTS')),
	CONSTRAINT "ai_budget_accounts_period_valid" CHECK("ai_budget_accounts"."period_start" >= 0 and "ai_budget_accounts"."period_end" > "ai_budget_accounts"."period_start"),
	CONSTRAINT "ai_budget_accounts_hard_cap_valid" CHECK("ai_budget_accounts"."hard_cap_nano" between 0 and 9007199254740991),
	CONSTRAINT "ai_budget_accounts_created_nonnegative" CHECK("ai_budget_accounts"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_budget_accounts_identity_unique` ON `ai_budget_accounts` (`principal_ref`,`budget_policy_id`,`budget_policy_revision`,`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `ai_budget_accounts_principal_period_index` ON `ai_budget_accounts` (`principal_ref`,`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `ai_budget_accounts_policy_index` ON `ai_budget_accounts` (`budget_policy_id`,`budget_policy_revision`);--> statement-breakpoint
CREATE TABLE `ai_budget_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_account_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`amount_nano` integer,
	`currency` text NOT NULL,
	`reason_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`budget_account_id`) REFERENCES `ai_budget_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reservation_id`) REFERENCES `ai_budget_reservations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_budget_ledger_event_type_valid" CHECK("ai_budget_ledger_entries"."event_type" in ('RESERVED','EXECUTION_STARTED','RELEASED','SETTLED','RECONCILIATION_REQUIRED')),
	CONSTRAINT "ai_budget_ledger_amount_valid" CHECK("ai_budget_ledger_entries"."amount_nano" is null or "ai_budget_ledger_entries"."amount_nano" between 0 and 9007199254740991),
	CONSTRAINT "ai_budget_ledger_currency_valid" CHECK(length("ai_budget_ledger_entries"."currency") = 3 and "ai_budget_ledger_entries"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "ai_budget_ledger_reason_valid" CHECK("ai_budget_ledger_entries"."reason_code" is null or (length(trim("ai_budget_ledger_entries"."reason_code")) between 1 and 120 and "ai_budget_ledger_entries"."reason_code" not glob '*[^A-Z0-9_.-]*')),
	CONSTRAINT "ai_budget_ledger_created_nonnegative" CHECK("ai_budget_ledger_entries"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_budget_ledger_reservation_event_unique` ON `ai_budget_ledger_entries` (`reservation_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `ai_budget_ledger_account_time_index` ON `ai_budget_ledger_entries` (`budget_account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_budget_ledger_operation_index` ON `ai_budget_ledger_entries` (`operation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_budget_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_policy_key` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_budget_policies_key_valid" CHECK(length(trim("ai_budget_policies"."budget_policy_key")) between 1 and 120 and "ai_budget_policies"."budget_policy_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_budget_policies_revision_positive" CHECK("ai_budget_policies"."current_revision" >= 1),
	CONSTRAINT "ai_budget_policies_timestamps_ordered" CHECK("ai_budget_policies"."updated_at" >= "ai_budget_policies"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_budget_policies_key_unique` ON `ai_budget_policies` (`budget_policy_key`);--> statement-breakpoint
CREATE INDEX `ai_budget_policies_updated_at_index` ON `ai_budget_policies` (`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_budget_policy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_policy_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`currency` text NOT NULL,
	`cost_center` text NOT NULL,
	`hard_cap_nano` integer NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`budget_policy_id`) REFERENCES `ai_budget_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_budget_policy_revisions_revision_positive" CHECK("ai_budget_policy_revisions"."revision" >= 1),
	CONSTRAINT "ai_budget_policy_revisions_currency_valid" CHECK(length("ai_budget_policy_revisions"."currency") = 3 and "ai_budget_policy_revisions"."currency" not glob '*[^A-Z]*'),
	CONSTRAINT "ai_budget_policy_revisions_cost_center_valid" CHECK("ai_budget_policy_revisions"."cost_center" in ('STUDENT_GENERATION','KNOWLEDGE_INDEXING','AGENT_2','EVALS','EXPERIMENTS')),
	CONSTRAINT "ai_budget_policy_revisions_hard_cap_valid" CHECK("ai_budget_policy_revisions"."hard_cap_nano" between 0 and 9007199254740991),
	CONSTRAINT "ai_budget_policy_revisions_enabled_boolean" CHECK("ai_budget_policy_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_budget_policy_revisions_display_name_valid" CHECK(length(trim("ai_budget_policy_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_budget_policy_revisions_created_nonnegative" CHECK("ai_budget_policy_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_budget_policy_revisions_identity_unique` ON `ai_budget_policy_revisions` (`budget_policy_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_budget_policy_revisions_enabled_index` ON `ai_budget_policy_revisions` (`enabled`);--> statement-breakpoint
CREATE TABLE `ai_budget_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_account_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`principal_ref` text NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`rate_limit_policy_revision` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`reserved_nano` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`execution_started_at` integer,
	`finalized_at` integer,
	`overage_nano` integer,
	FOREIGN KEY (`budget_account_id`) REFERENCES `ai_budget_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`,`rate_limit_policy_revision`) REFERENCES `ai_rate_limit_policy_revisions`(`rate_limit_policy_id`,`revision`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_budget_reservations_principal_valid" CHECK(length(trim("ai_budget_reservations"."principal_ref")) between 1 and 200),
	CONSTRAINT "ai_budget_reservations_policy_revision_positive" CHECK("ai_budget_reservations"."rate_limit_policy_revision" >= 1),
	CONSTRAINT "ai_budget_reservations_idempotency_valid" CHECK(length(trim("ai_budget_reservations"."idempotency_key")) between 1 and 200),
	CONSTRAINT "ai_budget_reservations_fingerprint_valid" CHECK(length("ai_budget_reservations"."request_fingerprint") = 64 and "ai_budget_reservations"."request_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_budget_reservations_amount_valid" CHECK("ai_budget_reservations"."reserved_nano" between 0 and 9007199254740991),
	CONSTRAINT "ai_budget_reservations_status_valid" CHECK("ai_budget_reservations"."status" in ('RESERVED','EXECUTING','SETTLED','RELEASED','RECONCILIATION_REQUIRED')),
	CONSTRAINT "ai_budget_reservations_created_nonnegative" CHECK("ai_budget_reservations"."created_at" >= 0),
	CONSTRAINT "ai_budget_reservations_execution_started_valid" CHECK("ai_budget_reservations"."execution_started_at" is null or "ai_budget_reservations"."execution_started_at" >= "ai_budget_reservations"."created_at"),
	CONSTRAINT "ai_budget_reservations_finalized_valid" CHECK("ai_budget_reservations"."finalized_at" is null or "ai_budget_reservations"."finalized_at" >= "ai_budget_reservations"."created_at"),
	CONSTRAINT "ai_budget_reservations_overage_valid" CHECK("ai_budget_reservations"."overage_nano" is null or "ai_budget_reservations"."overage_nano" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_budget_reservations_operation_unique` ON `ai_budget_reservations` (`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_budget_reservations_principal_idempotency_unique` ON `ai_budget_reservations` (`principal_ref`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ai_budget_reservations_account_status_index` ON `ai_budget_reservations` (`budget_account_id`,`status`);--> statement-breakpoint
CREATE INDEX `ai_budget_reservations_concurrency_index` ON `ai_budget_reservations` (`principal_ref`,`rate_limit_policy_id`,`rate_limit_policy_revision`,`status`);--> statement-breakpoint
CREATE TABLE `ai_rate_limit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_ref` text NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`rate_limit_policy_revision` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`operation_id` text NOT NULL,
	`reservation_id` text,
	`outcome` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reservation_id`) REFERENCES `ai_budget_reservations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`,`rate_limit_policy_revision`) REFERENCES `ai_rate_limit_policy_revisions`(`rate_limit_policy_id`,`revision`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_rate_limit_events_principal_valid" CHECK(length(trim("ai_rate_limit_events"."principal_ref")) between 1 and 200),
	CONSTRAINT "ai_rate_limit_events_policy_revision_positive" CHECK("ai_rate_limit_events"."rate_limit_policy_revision" >= 1),
	CONSTRAINT "ai_rate_limit_events_idempotency_valid" CHECK(length(trim("ai_rate_limit_events"."idempotency_key")) between 1 and 200),
	CONSTRAINT "ai_rate_limit_events_fingerprint_valid" CHECK(length("ai_rate_limit_events"."request_fingerprint") = 64 and "ai_rate_limit_events"."request_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_rate_limit_events_outcome_valid" CHECK("ai_rate_limit_events"."outcome" in ('ADMITTED','BUDGET_EXCEEDED','CONCURRENCY_LIMITED')),
	CONSTRAINT "ai_rate_limit_events_occurred_nonnegative" CHECK("ai_rate_limit_events"."occurred_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_rate_limit_events_principal_idempotency_unique` ON `ai_rate_limit_events` (`principal_ref`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ai_rate_limit_events_window_index` ON `ai_rate_limit_events` (`principal_ref`,`rate_limit_policy_id`,`rate_limit_policy_revision`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ai_rate_limit_events_operation_index` ON `ai_rate_limit_events` (`operation_id`);--> statement-breakpoint
CREATE TABLE `ai_rate_limit_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`rate_limit_policy_key` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_rate_limit_policies_key_valid" CHECK(length(trim("ai_rate_limit_policies"."rate_limit_policy_key")) between 1 and 120 and "ai_rate_limit_policies"."rate_limit_policy_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_rate_limit_policies_revision_positive" CHECK("ai_rate_limit_policies"."current_revision" >= 1),
	CONSTRAINT "ai_rate_limit_policies_timestamps_ordered" CHECK("ai_rate_limit_policies"."updated_at" >= "ai_rate_limit_policies"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_rate_limit_policies_key_unique` ON `ai_rate_limit_policies` (`rate_limit_policy_key`);--> statement-breakpoint
CREATE INDEX `ai_rate_limit_policies_updated_at_index` ON `ai_rate_limit_policies` (`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_rate_limit_policy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`window_ms` integer NOT NULL,
	`max_requests` integer NOT NULL,
	`max_concurrent_requests` integer NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_rate_limit_policy_revisions_revision_positive" CHECK("ai_rate_limit_policy_revisions"."revision" >= 1),
	CONSTRAINT "ai_rate_limit_policy_revisions_window_positive" CHECK("ai_rate_limit_policy_revisions"."window_ms" >= 1),
	CONSTRAINT "ai_rate_limit_policy_revisions_requests_nonnegative" CHECK("ai_rate_limit_policy_revisions"."max_requests" >= 0 and "ai_rate_limit_policy_revisions"."max_concurrent_requests" >= 0),
	CONSTRAINT "ai_rate_limit_policy_revisions_enabled_boolean" CHECK("ai_rate_limit_policy_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_rate_limit_policy_revisions_display_name_valid" CHECK(length(trim("ai_rate_limit_policy_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_rate_limit_policy_revisions_created_nonnegative" CHECK("ai_rate_limit_policy_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_rate_limit_policy_revisions_identity_unique` ON `ai_rate_limit_policy_revisions` (`rate_limit_policy_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_rate_limit_policy_revisions_enabled_index` ON `ai_rate_limit_policy_revisions` (`enabled`);