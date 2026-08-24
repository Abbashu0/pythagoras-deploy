CREATE TABLE `question_bank_browse_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`node_key` text NOT NULL,
	`label` text NOT NULL,
	`node_type` text NOT NULL,
	`parent_id` text,
	`display_order` integer NOT NULL,
	`taxonomy_node_id` text,
	`include_descendants` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `question_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`package_id`,`parent_id`) REFERENCES `question_bank_browse_nodes`(`package_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`package_id`,`taxonomy_node_id`) REFERENCES `question_taxonomy_nodes`(`package_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_browse_key_valid" CHECK(length(trim("question_bank_browse_nodes"."node_key")) between 1 and 120),
	CONSTRAINT "question_browse_label_valid" CHECK(length(trim("question_bank_browse_nodes"."label")) between 1 and 1000),
	CONSTRAINT "question_browse_type_valid" CHECK("question_bank_browse_nodes"."node_type" in ('GROUP','QUESTION_LIST')),
	CONSTRAINT "question_browse_order_positive" CHECK("question_bank_browse_nodes"."display_order" >= 1),
	CONSTRAINT "question_browse_not_self_parent" CHECK("question_bank_browse_nodes"."parent_id" is null or "question_bank_browse_nodes"."parent_id" <> "question_bank_browse_nodes"."id"),
	CONSTRAINT "question_browse_filter_shape_valid" CHECK(("question_bank_browse_nodes"."node_type" = 'GROUP' and "question_bank_browse_nodes"."taxonomy_node_id" is null and "question_bank_browse_nodes"."include_descendants" is null) or ("question_bank_browse_nodes"."node_type" = 'QUESTION_LIST' and "question_bank_browse_nodes"."taxonomy_node_id" is not null and "question_bank_browse_nodes"."include_descendants" in (0,1))),
	CONSTRAINT "question_browse_revision_positive" CHECK("question_bank_browse_nodes"."revision" >= 1),
	CONSTRAINT "question_browse_timestamps_ordered" CHECK("question_bank_browse_nodes"."updated_at" >= "question_bank_browse_nodes"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_browse_package_id_unique` ON `question_bank_browse_nodes` (`package_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_browse_package_key_unique` ON `question_bank_browse_nodes` (`package_id`,`node_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_browse_root_order_unique` ON `question_bank_browse_nodes` (`package_id`,`display_order`) WHERE "question_bank_browse_nodes"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `question_browse_sibling_order_unique` ON `question_bank_browse_nodes` (`package_id`,`parent_id`,`display_order`) WHERE "question_bank_browse_nodes"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX `question_browse_parent_order_index` ON `question_bank_browse_nodes` (`package_id`,`parent_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `question_browse_taxonomy_index` ON `question_bank_browse_nodes` (`package_id`,`taxonomy_node_id`);--> statement-breakpoint
CREATE TABLE `question_occurrence_branches` (
	`occurrence_id` text NOT NULL,
	`position` integer NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`occurrence_id`, `position`),
	FOREIGN KEY (`occurrence_id`) REFERENCES `question_occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_occurrence_branches_position_nonnegative" CHECK("question_occurrence_branches"."position" >= 0),
	CONSTRAINT "question_occurrence_branches_value_valid" CHECK(length(trim("question_occurrence_branches"."value")) between 1 and 160)
);
--> statement-breakpoint
CREATE INDEX `question_occurrence_branches_value_index` ON `question_occurrence_branches` (`value`);--> statement-breakpoint
CREATE TABLE `question_occurrence_qualifiers` (
	`occurrence_id` text NOT NULL,
	`position` integer NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`occurrence_id`, `position`),
	FOREIGN KEY (`occurrence_id`) REFERENCES `question_occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_occurrence_qualifiers_position_nonnegative" CHECK("question_occurrence_qualifiers"."position" >= 0),
	CONSTRAINT "question_occurrence_qualifiers_value_valid" CHECK(length(trim("question_occurrence_qualifiers"."value")) between 1 and 160)
);
--> statement-breakpoint
CREATE INDEX `question_occurrence_qualifiers_value_index` ON `question_occurrence_qualifiers` (`value`);--> statement-breakpoint
CREATE TABLE `question_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`source_kind` text NOT NULL,
	`year` integer,
	`round_code` text,
	`session` text,
	`source_name` text,
	`notes` text,
	`raw_label` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `question_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_occurrences_order_positive" CHECK("question_occurrences"."display_order" >= 1),
	CONSTRAINT "question_occurrences_source_kind_valid" CHECK("question_occurrences"."source_kind" in ('ministerial','discussion-question','educational-tv','end-of-chapter','book-question','book-exercise','enrichment','other')),
	CONSTRAINT "question_occurrences_year_valid" CHECK("question_occurrences"."year" is null or "question_occurrences"."year" between 1900 and 2200),
	CONSTRAINT "question_occurrences_raw_label_valid" CHECK(length(trim("question_occurrences"."raw_label")) between 1 and 1000),
	CONSTRAINT "question_occurrences_revision_positive" CHECK("question_occurrences"."revision" >= 1),
	CONSTRAINT "question_occurrences_timestamps_ordered" CHECK("question_occurrences"."updated_at" >= "question_occurrences"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_occurrences_variant_order_unique` ON `question_occurrences` (`variant_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `question_occurrences_variant_order_index` ON `question_occurrences` (`variant_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `question_occurrences_source_year_index` ON `question_occurrences` (`source_kind`,`year`);--> statement-breakpoint
CREATE TABLE `question_package_asset_bindings` (
	`package_id` text NOT NULL,
	`asset_ref` text NOT NULL,
	`expected_sha256` text NOT NULL,
	`asset_id` text,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`metadata` text,
	`position` integer NOT NULL,
	PRIMARY KEY(`package_id`, `asset_ref`),
	FOREIGN KEY (`package_id`) REFERENCES `question_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_package_asset_bindings_ref_valid" CHECK(length(trim("question_package_asset_bindings"."asset_ref")) between 1 and 120),
	CONSTRAINT "question_package_asset_bindings_sha256_valid" CHECK(length("question_package_asset_bindings"."expected_sha256") = 64 and "question_package_asset_bindings"."expected_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "question_package_asset_bindings_filename_valid" CHECK(length(trim("question_package_asset_bindings"."filename")) between 1 and 1000),
	CONSTRAINT "question_package_asset_bindings_mime_valid" CHECK(length(trim("question_package_asset_bindings"."mime_type")) between 1 and 127),
	CONSTRAINT "question_package_asset_bindings_size_positive" CHECK("question_package_asset_bindings"."byte_size" > 0),
	CONSTRAINT "question_package_asset_bindings_metadata_valid" CHECK("question_package_asset_bindings"."metadata" is null or (json_valid("question_package_asset_bindings"."metadata") and json_type("question_package_asset_bindings"."metadata") = 'object')),
	CONSTRAINT "question_package_asset_bindings_position_nonnegative" CHECK("question_package_asset_bindings"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_package_asset_bindings_position_unique` ON `question_package_asset_bindings` (`package_id`,`position`);--> statement-breakpoint
CREATE INDEX `question_package_asset_bindings_asset_index` ON `question_package_asset_bindings` (`asset_id`);--> statement-breakpoint
CREATE TABLE `question_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`package_key` text NOT NULL,
	`title` text NOT NULL,
	`subject_key` text NOT NULL,
	`language` text NOT NULL,
	`content_revision` integer NOT NULL,
	`bank_browse_mode` text NOT NULL,
	`bank_browse_entry_key` text NOT NULL,
	`bank_browse_entry_label` text NOT NULL,
	`bank_browse_entry_order` integer NOT NULL,
	`source_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_packages_key_valid" CHECK(length(trim("question_packages"."package_key")) between 1 and 120),
	CONSTRAINT "question_packages_title_valid" CHECK(length(trim("question_packages"."title")) between 1 and 1000),
	CONSTRAINT "question_packages_language_valid" CHECK(length(trim("question_packages"."language")) between 2 and 35),
	CONSTRAINT "question_packages_content_revision_positive" CHECK("question_packages"."content_revision" >= 1),
	CONSTRAINT "question_packages_browse_mode_valid" CHECK("question_packages"."bank_browse_mode" in ('ALL_PACKAGE_QUESTIONS','TREE')),
	CONSTRAINT "question_packages_entry_key_valid" CHECK(length(trim("question_packages"."bank_browse_entry_key")) between 1 and 120),
	CONSTRAINT "question_packages_entry_label_valid" CHECK(length(trim("question_packages"."bank_browse_entry_label")) between 1 and 1000),
	CONSTRAINT "question_packages_entry_order_positive" CHECK("question_packages"."bank_browse_entry_order" >= 1),
	CONSTRAINT "question_packages_revision_positive" CHECK("question_packages"."revision" >= 1),
	CONSTRAINT "question_packages_timestamps_ordered" CHECK("question_packages"."updated_at" >= "question_packages"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_packages_key_unique` ON `question_packages` (`package_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_packages_subject_entry_key_unique` ON `question_packages` (`subject_key`,`bank_browse_entry_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_packages_subject_entry_order_unique` ON `question_packages` (`subject_key`,`bank_browse_entry_order`);--> statement-breakpoint
CREATE INDEX `question_packages_subject_order_index` ON `question_packages` (`subject_key`,`bank_browse_entry_order`);--> statement-breakpoint
CREATE INDEX `question_packages_source_asset_index` ON `question_packages` (`source_asset_id`);--> statement-breakpoint
CREATE TABLE `question_primary_variants` (
	`question_id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`,`variant_id`) REFERENCES `question_variants`(`question_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_primary_variants_variant_unique` ON `question_primary_variants` (`variant_id`);--> statement-breakpoint
CREATE TABLE `question_taxonomy_assignments` (
	`package_id` text NOT NULL,
	`question_id` text NOT NULL,
	`taxonomy_node_id` text NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`question_id`, `taxonomy_node_id`),
	FOREIGN KEY (`package_id`,`question_id`) REFERENCES `questions`(`package_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_id`,`taxonomy_node_id`) REFERENCES `question_taxonomy_nodes`(`package_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_taxonomy_assignments_role_valid" CHECK("question_taxonomy_assignments"."role" in ('PRIMARY','RELATED')),
	CONSTRAINT "question_taxonomy_assignments_position_nonnegative" CHECK("question_taxonomy_assignments"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_taxonomy_assignments_question_position_unique` ON `question_taxonomy_assignments` (`question_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_taxonomy_assignments_one_primary` ON `question_taxonomy_assignments` (`question_id`) WHERE "question_taxonomy_assignments"."role" = 'PRIMARY';--> statement-breakpoint
CREATE INDEX `question_taxonomy_assignments_taxonomy_index` ON `question_taxonomy_assignments` (`taxonomy_node_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `question_taxonomy_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`node_key` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text,
	`display_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `question_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`package_id`,`parent_id`) REFERENCES `question_taxonomy_nodes`(`package_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_taxonomy_key_valid" CHECK(length(trim("question_taxonomy_nodes"."node_key")) between 1 and 120),
	CONSTRAINT "question_taxonomy_label_valid" CHECK(length(trim("question_taxonomy_nodes"."label")) between 1 and 1000),
	CONSTRAINT "question_taxonomy_kind_valid" CHECK(length(trim("question_taxonomy_nodes"."kind")) between 1 and 120),
	CONSTRAINT "question_taxonomy_order_positive" CHECK("question_taxonomy_nodes"."display_order" >= 1),
	CONSTRAINT "question_taxonomy_not_self_parent" CHECK("question_taxonomy_nodes"."parent_id" is null or "question_taxonomy_nodes"."parent_id" <> "question_taxonomy_nodes"."id"),
	CONSTRAINT "question_taxonomy_revision_positive" CHECK("question_taxonomy_nodes"."revision" >= 1),
	CONSTRAINT "question_taxonomy_timestamps_ordered" CHECK("question_taxonomy_nodes"."updated_at" >= "question_taxonomy_nodes"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_taxonomy_package_id_unique` ON `question_taxonomy_nodes` (`package_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_taxonomy_package_key_unique` ON `question_taxonomy_nodes` (`package_id`,`node_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_taxonomy_root_order_unique` ON `question_taxonomy_nodes` (`package_id`,`display_order`) WHERE "question_taxonomy_nodes"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `question_taxonomy_sibling_order_unique` ON `question_taxonomy_nodes` (`package_id`,`parent_id`,`display_order`) WHERE "question_taxonomy_nodes"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX `question_taxonomy_parent_order_index` ON `question_taxonomy_nodes` (`package_id`,`parent_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `question_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_variants_order_positive" CHECK("question_variants"."display_order" >= 1),
	CONSTRAINT "question_variants_content_valid_json" CHECK(json_valid("question_variants"."content") and json_type("question_variants"."content") = 'object'),
	CONSTRAINT "question_variants_revision_positive" CHECK("question_variants"."revision" >= 1),
	CONSTRAINT "question_variants_timestamps_ordered" CHECK("question_variants"."updated_at" >= "question_variants"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_variants_question_id_unique` ON `question_variants` (`question_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_variants_question_order_unique` ON `question_variants` (`question_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `question_variants_question_order_index` ON `question_variants` (`question_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`shared_answer` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `question_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "questions_order_positive" CHECK("questions"."display_order" >= 1),
	CONSTRAINT "questions_shared_answer_valid_json" CHECK("questions"."shared_answer" is null or (json_valid("questions"."shared_answer") and json_type("questions"."shared_answer") = 'object')),
	CONSTRAINT "questions_revision_positive" CHECK("questions"."revision" >= 1),
	CONSTRAINT "questions_timestamps_ordered" CHECK("questions"."updated_at" >= "questions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `questions_package_id_unique` ON `questions` (`package_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `questions_package_order_unique` ON `questions` (`package_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `questions_package_order_index` ON `questions` (`package_id`,`display_order`);