CREATE TABLE `question_package_inspections` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`source_sha256` text NOT NULL,
	`status` text NOT NULL,
	`format` text,
	`schema_version` text,
	`package_id` text,
	`package_key` text,
	`title` text,
	`subject_key` text,
	`question_count` integer NOT NULL,
	`variant_count` integer NOT NULL,
	`error_count` integer NOT NULL,
	`warning_count` integer NOT NULL,
	`diagnostics` text NOT NULL,
	`inspector_version` integer NOT NULL,
	`inspected_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_package_inspections_status_valid" CHECK("question_package_inspections"."status" in ('GENERIC_JSON','VALID','VALID_WITH_WARNINGS','INVALID','UNSUPPORTED_VERSION')),
	CONSTRAINT "question_package_inspections_source_sha256_valid" CHECK(length("question_package_inspections"."source_sha256") = 64 and "question_package_inspections"."source_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "question_package_inspections_counts_nonnegative" CHECK("question_package_inspections"."question_count" >= 0 and "question_package_inspections"."variant_count" >= 0 and "question_package_inspections"."error_count" >= 0 and "question_package_inspections"."warning_count" >= 0),
	CONSTRAINT "question_package_inspections_diagnostics_array" CHECK(json_valid("question_package_inspections"."diagnostics") and json_type("question_package_inspections"."diagnostics") = 'array'),
	CONSTRAINT "question_package_inspections_version_positive" CHECK("question_package_inspections"."inspector_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `question_package_inspections_status_index` ON `question_package_inspections` (`status`);--> statement-breakpoint
CREATE INDEX `question_package_inspections_subject_index` ON `question_package_inspections` (`subject_key`);--> statement-breakpoint
CREATE INDEX `question_package_inspections_package_id_index` ON `question_package_inspections` (`package_id`);