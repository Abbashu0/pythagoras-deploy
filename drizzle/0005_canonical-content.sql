CREATE TABLE `canonical_banners` (
	`id` text PRIMARY KEY NOT NULL,
	`banner_type` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text NOT NULL,
	`icon_key` text NOT NULL,
	`gradient` text NOT NULL,
	`asset_id` text,
	`status` text NOT NULL,
	`display_order` integer NOT NULL,
	`offset_x` real DEFAULT 0 NOT NULL,
	`offset_y` real DEFAULT 0 NOT NULL,
	`scale` real DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "canonical_banners_type_valid" CHECK("canonical_banners"."banner_type" in ('FULL','SPLIT')),
	CONSTRAINT "canonical_banners_status_valid" CHECK("canonical_banners"."status" in ('ACTIVE','ARCHIVED')),
	CONSTRAINT "canonical_banners_title_valid" CHECK(length("canonical_banners"."title") <= 160),
	CONSTRAINT "canonical_banners_subtitle_valid" CHECK(length("canonical_banners"."subtitle") <= 500),
	CONSTRAINT "canonical_banners_icon_valid" CHECK(length(trim("canonical_banners"."icon_key")) between 1 and 80),
	CONSTRAINT "canonical_banners_gradient_valid" CHECK(length(trim("canonical_banners"."gradient")) between 1 and 500),
	CONSTRAINT "canonical_banners_order_nonnegative" CHECK("canonical_banners"."display_order" >= 0),
	CONSTRAINT "canonical_banners_offset_x_valid" CHECK("canonical_banners"."offset_x" between -50 and 50),
	CONSTRAINT "canonical_banners_offset_y_valid" CHECK("canonical_banners"."offset_y" between -50 and 50),
	CONSTRAINT "canonical_banners_scale_valid" CHECK("canonical_banners"."scale" between 0.5 and 3),
	CONSTRAINT "canonical_banners_revision_positive" CHECK("canonical_banners"."revision" >= 1),
	CONSTRAINT "canonical_banners_timestamps_ordered" CHECK("canonical_banners"."updated_at" >= "canonical_banners"."created_at")
);
--> statement-breakpoint
CREATE INDEX `canonical_banners_status_order_index` ON `canonical_banners` (`status`,`display_order`);--> statement-breakpoint
CREATE INDEX `canonical_banners_asset_index` ON `canonical_banners` (`asset_id`);--> statement-breakpoint
CREATE TABLE `canonical_carousel_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`auto_slide_interval` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "canonical_carousel_settings_singleton" CHECK("canonical_carousel_settings"."id" = 'global'),
	CONSTRAINT "canonical_carousel_settings_interval_valid" CHECK("canonical_carousel_settings"."auto_slide_interval" between 1000 and 120000),
	CONSTRAINT "canonical_carousel_settings_revision_positive" CHECK("canonical_carousel_settings"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE `canonical_content_state` (
	`id` text PRIMARY KEY NOT NULL,
	`bootstrap_version` integer NOT NULL,
	`bootstrap_completed_at` integer NOT NULL,
	`runtime_source_mode` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "canonical_content_state_singleton" CHECK("canonical_content_state"."id" = 'global'),
	CONSTRAINT "canonical_content_state_bootstrap_positive" CHECK("canonical_content_state"."bootstrap_version" >= 1),
	CONSTRAINT "canonical_content_state_source_valid" CHECK("canonical_content_state"."runtime_source_mode" in ('LEGACY','CANONICAL')),
	CONSTRAINT "canonical_content_state_revision_positive" CHECK("canonical_content_state"."revision" >= 1),
	CONSTRAINT "canonical_content_state_timestamps_ordered" CHECK("canonical_content_state"."updated_at" >= "canonical_content_state"."bootstrap_completed_at")
);
--> statement-breakpoint
CREATE TABLE `canonical_material_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`fade_intensity` real NOT NULL,
	`text_vertical_position` real NOT NULL,
	`text_scale` real NOT NULL,
	`card_height` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "canonical_material_settings_singleton" CHECK("canonical_material_settings"."id" = 'global'),
	CONSTRAINT "canonical_material_settings_fade_valid" CHECK("canonical_material_settings"."fade_intensity" between 0 and 1),
	CONSTRAINT "canonical_material_settings_position_valid" CHECK("canonical_material_settings"."text_vertical_position" between -100 and 100),
	CONSTRAINT "canonical_material_settings_scale_valid" CHECK("canonical_material_settings"."text_scale" between 0.8 and 1.4),
	CONSTRAINT "canonical_material_settings_height_valid" CHECK("canonical_material_settings"."card_height" between 160 and 340),
	CONSTRAINT "canonical_material_settings_revision_positive" CHECK("canonical_material_settings"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE `canonical_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_key` text NOT NULL,
	`label` text NOT NULL,
	`english_title` text NOT NULL,
	`icon_key` text NOT NULL,
	`available` integer NOT NULL,
	`display_order` integer NOT NULL,
	`asset_id` text,
	`gradient` text NOT NULL,
	`offset_x` real DEFAULT 0 NOT NULL,
	`offset_y` real DEFAULT 0 NOT NULL,
	`scale` real DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "canonical_materials_subject_key_valid" CHECK(length(trim("canonical_materials"."subject_key")) between 1 and 80 and "canonical_materials"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "canonical_materials_label_valid" CHECK(length(trim("canonical_materials"."label")) between 1 and 160),
	CONSTRAINT "canonical_materials_english_title_valid" CHECK(length(trim("canonical_materials"."english_title")) between 1 and 160),
	CONSTRAINT "canonical_materials_icon_valid" CHECK(length(trim("canonical_materials"."icon_key")) between 1 and 80),
	CONSTRAINT "canonical_materials_available_boolean" CHECK("canonical_materials"."available" in (0,1)),
	CONSTRAINT "canonical_materials_order_nonnegative" CHECK("canonical_materials"."display_order" >= 0),
	CONSTRAINT "canonical_materials_gradient_valid" CHECK(length(trim("canonical_materials"."gradient")) between 1 and 500),
	CONSTRAINT "canonical_materials_offset_x_valid" CHECK("canonical_materials"."offset_x" between -50 and 50),
	CONSTRAINT "canonical_materials_offset_y_valid" CHECK("canonical_materials"."offset_y" between -50 and 50),
	CONSTRAINT "canonical_materials_scale_valid" CHECK("canonical_materials"."scale" between 0.5 and 3),
	CONSTRAINT "canonical_materials_revision_positive" CHECK("canonical_materials"."revision" >= 1),
	CONSTRAINT "canonical_materials_timestamps_ordered" CHECK("canonical_materials"."updated_at" >= "canonical_materials"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_materials_subject_key_unique` ON `canonical_materials` (`subject_key`);--> statement-breakpoint
CREATE INDEX `canonical_materials_display_order_index` ON `canonical_materials` (`display_order`);--> statement-breakpoint
CREATE INDEX `canonical_materials_asset_index` ON `canonical_materials` (`asset_id`);--> statement-breakpoint
CREATE TABLE `canonical_navigation` (
	`id` text PRIMARY KEY NOT NULL,
	`nav_key` text NOT NULL,
	`label` text NOT NULL,
	`icon_key` text NOT NULL,
	`enabled` integer NOT NULL,
	`display_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "canonical_navigation_key_valid" CHECK(length(trim("canonical_navigation"."nav_key")) between 1 and 80 and "canonical_navigation"."nav_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "canonical_navigation_label_valid" CHECK(length(trim("canonical_navigation"."label")) between 1 and 160),
	CONSTRAINT "canonical_navigation_icon_valid" CHECK(length(trim("canonical_navigation"."icon_key")) between 1 and 80),
	CONSTRAINT "canonical_navigation_enabled_boolean" CHECK("canonical_navigation"."enabled" in (0,1)),
	CONSTRAINT "canonical_navigation_order_nonnegative" CHECK("canonical_navigation"."display_order" >= 0),
	CONSTRAINT "canonical_navigation_revision_positive" CHECK("canonical_navigation"."revision" >= 1),
	CONSTRAINT "canonical_navigation_timestamps_ordered" CHECK("canonical_navigation"."updated_at" >= "canonical_navigation"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_navigation_nav_key_unique` ON `canonical_navigation` (`nav_key`);--> statement-breakpoint
CREATE INDEX `canonical_navigation_display_order_index` ON `canonical_navigation` (`display_order`);--> statement-breakpoint
CREATE TABLE `canonical_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`tool_key` text NOT NULL,
	`label` text NOT NULL,
	`icon_key` text NOT NULL,
	`available` integer NOT NULL,
	`display_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "canonical_tools_key_valid" CHECK(length(trim("canonical_tools"."tool_key")) between 1 and 80 and "canonical_tools"."tool_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "canonical_tools_label_valid" CHECK(length(trim("canonical_tools"."label")) between 1 and 160),
	CONSTRAINT "canonical_tools_icon_valid" CHECK(length(trim("canonical_tools"."icon_key")) between 1 and 80),
	CONSTRAINT "canonical_tools_available_boolean" CHECK("canonical_tools"."available" in (0,1)),
	CONSTRAINT "canonical_tools_order_nonnegative" CHECK("canonical_tools"."display_order" >= 0),
	CONSTRAINT "canonical_tools_revision_positive" CHECK("canonical_tools"."revision" >= 1),
	CONSTRAINT "canonical_tools_timestamps_ordered" CHECK("canonical_tools"."updated_at" >= "canonical_tools"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_tools_tool_key_unique` ON `canonical_tools` (`tool_key`);--> statement-breakpoint
CREATE INDEX `canonical_tools_display_order_index` ON `canonical_tools` (`display_order`);--> statement-breakpoint
CREATE TABLE `__new_change_set_items` (
	`id` text PRIMARY KEY NOT NULL,
	`change_set_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`operation` text NOT NULL,
	`base_resource_revision` integer NOT NULL,
	`before_snapshot` text NOT NULL,
	`proposed_snapshot` text NOT NULL,
	`changed_paths` text NOT NULL,
	`conflict_state` text DEFAULT 'NONE' NOT NULL,
	`conflict_details` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`change_set_id`) REFERENCES `change_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "change_set_items_operation_valid" CHECK("__new_change_set_items"."operation" in ('CREATE','UPDATE')),
	CONSTRAINT "change_set_items_resource_type_valid" CHECK(length(trim("__new_change_set_items"."resource_type")) between 1 and 80),
	CONSTRAINT "change_set_items_resource_id_valid" CHECK(length(trim("__new_change_set_items"."resource_id")) > 0),
	CONSTRAINT "change_set_items_base_revision_nonnegative" CHECK("__new_change_set_items"."base_resource_revision" >= 0),
	CONSTRAINT "change_set_items_changed_paths_array" CHECK(json_valid("__new_change_set_items"."changed_paths") and json_type("__new_change_set_items"."changed_paths") = 'array'),
	CONSTRAINT "change_set_items_before_snapshot_object" CHECK(json_valid("__new_change_set_items"."before_snapshot") and json_type("__new_change_set_items"."before_snapshot") = 'object'),
	CONSTRAINT "change_set_items_proposed_snapshot_object" CHECK(json_valid("__new_change_set_items"."proposed_snapshot") and json_type("__new_change_set_items"."proposed_snapshot") = 'object'),
	CONSTRAINT "change_set_items_conflict_state_valid" CHECK("__new_change_set_items"."conflict_state" in ('NONE','BLOCKING','AUTO_MERGED')),
	CONSTRAINT "change_set_items_revision_positive" CHECK("__new_change_set_items"."revision" >= 1),
	CONSTRAINT "change_set_items_timestamps_ordered" CHECK("__new_change_set_items"."updated_at" >= "__new_change_set_items"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_change_set_items`("id", "change_set_id", "resource_type", "resource_id", "operation", "base_resource_revision", "before_snapshot", "proposed_snapshot", "changed_paths", "conflict_state", "conflict_details", "created_at", "updated_at", "revision") SELECT "id", "change_set_id", "resource_type", "resource_id", "operation", "base_resource_revision", "before_snapshot", "proposed_snapshot", "changed_paths", "conflict_state", "conflict_details", "created_at", "updated_at", "revision" FROM `change_set_items`;--> statement-breakpoint
DROP TABLE `change_set_items`;--> statement-breakpoint
ALTER TABLE `__new_change_set_items` RENAME TO `change_set_items`;--> statement-breakpoint
CREATE UNIQUE INDEX `change_set_items_resource_unique` ON `change_set_items` (`change_set_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `change_set_items_change_set_index` ON `change_set_items` (`change_set_id`);--> statement-breakpoint
CREATE INDEX `change_set_items_resource_index` ON `change_set_items` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `__new_publication_items` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`operation` text NOT NULL,
	`before_snapshot` text NOT NULL,
	`after_snapshot` text NOT NULL,
	`resulting_resource_revision` integer NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_items_operation_valid" CHECK("__new_publication_items"."operation" in ('CREATE','UPDATE')),
	CONSTRAINT "publication_items_before_snapshot_object" CHECK(json_valid("__new_publication_items"."before_snapshot") and json_type("__new_publication_items"."before_snapshot") = 'object'),
	CONSTRAINT "publication_items_after_snapshot_object" CHECK(json_valid("__new_publication_items"."after_snapshot") and json_type("__new_publication_items"."after_snapshot") = 'object'),
	CONSTRAINT "publication_items_result_revision_positive" CHECK("__new_publication_items"."resulting_resource_revision" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_publication_items`("id", "publication_id", "resource_type", "resource_id", "operation", "before_snapshot", "after_snapshot", "resulting_resource_revision") SELECT "id", "publication_id", "resource_type", "resource_id", "operation", "before_snapshot", "after_snapshot", "resulting_resource_revision" FROM `publication_items`;--> statement-breakpoint
DROP TABLE `publication_items`;--> statement-breakpoint
ALTER TABLE `__new_publication_items` RENAME TO `publication_items`;--> statement-breakpoint
CREATE INDEX `publication_items_publication_index` ON `publication_items` (`publication_id`);--> statement-breakpoint
CREATE INDEX `publication_items_resource_index` ON `publication_items` (`resource_type`,`resource_id`);
