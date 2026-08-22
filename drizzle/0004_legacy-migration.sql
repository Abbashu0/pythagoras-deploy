CREATE TABLE `legacy_migration_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`legacy_reference` text NOT NULL,
	`source_kind` text NOT NULL,
	`asset_id` text NOT NULL,
	`reference_contexts` text NOT NULL,
	`reused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `legacy_migration_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "legacy_migration_assets_source_kind_valid" CHECK("legacy_migration_assets"."source_kind" in ('INDEXED_DB','INLINE')),
	CONSTRAINT "legacy_migration_assets_contexts_valid" CHECK(json_valid("legacy_migration_assets"."reference_contexts") and json_type("legacy_migration_assets"."reference_contexts") = 'array'),
	CONSTRAINT "legacy_migration_assets_reused_boolean" CHECK("legacy_migration_assets"."reused" in (0,1)),
	CONSTRAINT "legacy_migration_assets_reference_valid" CHECK(length(trim("legacy_migration_assets"."legacy_reference")) between 1 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_migration_assets_run_reference_unique` ON `legacy_migration_assets` (`run_id`,`legacy_reference`);--> statement-breakpoint
CREATE INDEX `legacy_migration_assets_asset_index` ON `legacy_migration_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `legacy_migration_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`metadata` text,
	FOREIGN KEY (`run_id`) REFERENCES `legacy_migration_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "legacy_migration_events_type_valid" CHECK("legacy_migration_events"."event_type" in ('RUN_CREATED','SNAPSHOT_STORED','IMAGE_IMPORTED','IMAGE_REUSED','ISSUE_RECORDED','FINALIZED_READY','FAILED','CANCELLED')),
	CONSTRAINT "legacy_migration_events_metadata_valid" CHECK("legacy_migration_events"."metadata" is null or (json_valid("legacy_migration_events"."metadata") and json_type("legacy_migration_events"."metadata") = 'object'))
);
--> statement-breakpoint
CREATE INDEX `legacy_migration_events_run_time_index` ON `legacy_migration_events` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `legacy_migration_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`severity` text NOT NULL,
	`code` text NOT NULL,
	`section` text,
	`legacy_reference` text,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `legacy_migration_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "legacy_migration_issues_severity_valid" CHECK("legacy_migration_issues"."severity" in ('ERROR','WARNING','INFO')),
	CONSTRAINT "legacy_migration_issues_message_valid" CHECK(length(trim("legacy_migration_issues"."message")) between 1 and 1000)
);
--> statement-breakpoint
CREATE INDEX `legacy_migration_issues_run_severity_index` ON `legacy_migration_issues` (`run_id`,`severity`);--> statement-breakpoint
CREATE TABLE `legacy_migration_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`source_origin` text NOT NULL,
	`source_fingerprint` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`snapshot` text,
	`snapshot_version` integer,
	`banner_count` integer DEFAULT 0 NOT NULL,
	`material_count` integer DEFAULT 0 NOT NULL,
	`tool_count` integer DEFAULT 0 NOT NULL,
	`navigation_count` integer DEFAULT 0 NOT NULL,
	`image_reference_count` integer DEFAULT 0 NOT NULL,
	`image_imported_count` integer DEFAULT 0 NOT NULL,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finalized_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "legacy_migration_runs_status_valid" CHECK("legacy_migration_runs"."status" in ('DRAFT','IMPORTING','READY','FAILED','CANCELLED','APPLIED')),
	CONSTRAINT "legacy_migration_runs_revision_positive" CHECK("legacy_migration_runs"."revision" >= 1),
	CONSTRAINT "legacy_migration_runs_snapshot_version_valid" CHECK("legacy_migration_runs"."snapshot_version" is null or "legacy_migration_runs"."snapshot_version" = 1),
	CONSTRAINT "legacy_migration_runs_snapshot_valid" CHECK("legacy_migration_runs"."snapshot" is null or (json_valid("legacy_migration_runs"."snapshot") and json_type("legacy_migration_runs"."snapshot") = 'object')),
	CONSTRAINT "legacy_migration_runs_counts_nonnegative" CHECK("legacy_migration_runs"."banner_count" >= 0 and "legacy_migration_runs"."material_count" >= 0 and "legacy_migration_runs"."tool_count" >= 0 and "legacy_migration_runs"."navigation_count" >= 0 and "legacy_migration_runs"."image_reference_count" >= 0 and "legacy_migration_runs"."image_imported_count" >= 0 and "legacy_migration_runs"."issue_count" >= 0),
	CONSTRAINT "legacy_migration_runs_timestamps_ordered" CHECK("legacy_migration_runs"."updated_at" >= "legacy_migration_runs"."created_at")
);
--> statement-breakpoint
CREATE INDEX `legacy_migration_runs_fingerprint_index` ON `legacy_migration_runs` (`source_fingerprint`);--> statement-breakpoint
CREATE INDEX `legacy_migration_runs_status_index` ON `legacy_migration_runs` (`status`);--> statement-breakpoint
CREATE INDEX `legacy_migration_runs_created_by_index` ON `legacy_migration_runs` (`created_by`);