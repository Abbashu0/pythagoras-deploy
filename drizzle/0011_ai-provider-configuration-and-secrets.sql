CREATE TABLE `ai_provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_key` text NOT NULL,
	`display_name` text NOT NULL,
	`base_url` text NOT NULL,
	`credential_ref` text,
	`enabled` integer DEFAULT false NOT NULL,
	`retention_policy` text NOT NULL,
	`training_policy` text NOT NULL,
	`zdr_supported` integer DEFAULT false NOT NULL,
	`zdr_required` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`credential_ref`) REFERENCES `ai_secret_refs`(`credential_ref`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_provider_configs_key_valid" CHECK(length(trim("ai_provider_configs"."provider_key")) between 1 and 120 and "ai_provider_configs"."provider_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_provider_configs_display_name_valid" CHECK(length(trim("ai_provider_configs"."display_name")) between 1 and 200),
	CONSTRAINT "ai_provider_configs_base_url_valid" CHECK(length(trim("ai_provider_configs"."base_url")) between 1 and 2048),
	CONSTRAINT "ai_provider_configs_credential_ref_valid" CHECK("ai_provider_configs"."credential_ref" is null or (length("ai_provider_configs"."credential_ref") = 36 and "ai_provider_configs"."credential_ref" not glob '*[^0-9a-f-]*')),
	CONSTRAINT "ai_provider_configs_enabled_boolean" CHECK("ai_provider_configs"."enabled" in (0,1)),
	CONSTRAINT "ai_provider_configs_retention_policy_valid" CHECK("ai_provider_configs"."retention_policy" in ('UNKNOWN','ZERO_RETENTION','BOUNDED_RETENTION','PROVIDER_DEFINED')),
	CONSTRAINT "ai_provider_configs_training_policy_valid" CHECK("ai_provider_configs"."training_policy" in ('UNKNOWN','NOT_USED_FOR_TRAINING','MAY_BE_USED','PROVIDER_DEFINED')),
	CONSTRAINT "ai_provider_configs_zdr_supported_boolean" CHECK("ai_provider_configs"."zdr_supported" in (0,1)),
	CONSTRAINT "ai_provider_configs_zdr_required_boolean" CHECK("ai_provider_configs"."zdr_required" in (0,1)),
	CONSTRAINT "ai_provider_configs_revision_positive" CHECK("ai_provider_configs"."revision" >= 1),
	CONSTRAINT "ai_provider_configs_timestamps_ordered" CHECK("ai_provider_configs"."updated_at" >= "ai_provider_configs"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_configs_key_unique` ON `ai_provider_configs` (`provider_key`);--> statement-breakpoint
CREATE INDEX `ai_provider_configs_enabled_index` ON `ai_provider_configs` (`enabled`);--> statement-breakpoint
CREATE INDEX `ai_provider_configs_credential_ref_index` ON `ai_provider_configs` (`credential_ref`);--> statement-breakpoint
CREATE TABLE `ai_secret_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_ref` text NOT NULL,
	`event_type` text NOT NULL,
	`secret_version` integer,
	`actor_type` text NOT NULL,
	`actor_user_id` text,
	`outcome` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`credential_ref`) REFERENCES `ai_secret_refs`(`credential_ref`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_secret_audit_events_type_valid" CHECK("ai_secret_audit_events"."event_type" in ('CREATED','RESOLVED','ROTATED','REVOKED','RESOLVE_FAILED')),
	CONSTRAINT "ai_secret_audit_events_version_valid" CHECK("ai_secret_audit_events"."secret_version" is null or "ai_secret_audit_events"."secret_version" >= 1),
	CONSTRAINT "ai_secret_audit_events_actor_type_valid" CHECK("ai_secret_audit_events"."actor_type" in ('ADMIN','SYSTEM')),
	CONSTRAINT "ai_secret_audit_events_outcome_valid" CHECK("ai_secret_audit_events"."outcome" in ('SUCCESS','FAILURE')),
	CONSTRAINT "ai_secret_audit_events_error_code_valid" CHECK("ai_secret_audit_events"."error_code" is null or length(trim("ai_secret_audit_events"."error_code")) between 1 and 120)
);
--> statement-breakpoint
CREATE INDEX `ai_secret_audit_events_credential_time_index` ON `ai_secret_audit_events` (`credential_ref`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_secret_audit_events_actor_index` ON `ai_secret_audit_events` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `ai_secret_refs` (
	`credential_ref` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`secret_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`rotated_at` integer,
	`revoked_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ai_secret_refs_credential_ref_valid" CHECK(length("ai_secret_refs"."credential_ref") = 36 and "ai_secret_refs"."credential_ref" not glob '*[^0-9a-f-]*'),
	CONSTRAINT "ai_secret_refs_status_valid" CHECK("ai_secret_refs"."status" in ('ACTIVE','REVOKED')),
	CONSTRAINT "ai_secret_refs_version_positive" CHECK("ai_secret_refs"."secret_version" >= 1),
	CONSTRAINT "ai_secret_refs_revision_positive" CHECK("ai_secret_refs"."revision" >= 1),
	CONSTRAINT "ai_secret_refs_rotated_at_valid" CHECK("ai_secret_refs"."rotated_at" is null or "ai_secret_refs"."rotated_at" >= "ai_secret_refs"."created_at"),
	CONSTRAINT "ai_secret_refs_revoked_at_valid" CHECK("ai_secret_refs"."revoked_at" is null or "ai_secret_refs"."revoked_at" >= "ai_secret_refs"."created_at"),
	CONSTRAINT "ai_secret_refs_timestamps_ordered" CHECK("ai_secret_refs"."updated_at" >= "ai_secret_refs"."created_at")
);
--> statement-breakpoint
CREATE INDEX `ai_secret_refs_status_index` ON `ai_secret_refs` (`status`);