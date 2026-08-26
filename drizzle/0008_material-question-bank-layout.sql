CREATE TABLE `material_question_bank_layouts` (
	`material_id` text PRIMARY KEY NOT NULL,
	`root_presentation` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `canonical_materials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_question_bank_layouts_root_valid" CHECK("material_question_bank_layouts"."root_presentation" in ('DIRECT','CARDS')),
	CONSTRAINT "material_question_bank_layouts_revision_positive" CHECK("material_question_bank_layouts"."revision" >= 1),
	CONSTRAINT "material_question_bank_layouts_timestamps_ordered" CHECK("material_question_bank_layouts"."updated_at" >= "material_question_bank_layouts"."created_at")
);
--> statement-breakpoint
CREATE TABLE `material_question_bank_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`node_key` text NOT NULL,
	`label` text NOT NULL,
	`node_type` text NOT NULL,
	`parent_id` text,
	`display_order` integer NOT NULL,
	`group_presentation` text,
	`package_id` text,
	`target_mode` text,
	`taxonomy_node_id` text,
	`include_descendants` integer,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_question_bank_layouts`(`material_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_id`) REFERENCES `question_packages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`material_id`,`parent_id`) REFERENCES `material_question_bank_nodes`(`material_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`package_id`,`taxonomy_node_id`) REFERENCES `question_taxonomy_nodes`(`package_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_question_bank_nodes_key_valid" CHECK(length(trim("material_question_bank_nodes"."node_key")) between 1 and 120),
	CONSTRAINT "material_question_bank_nodes_label_valid" CHECK(length(trim("material_question_bank_nodes"."label")) between 1 and 500),
	CONSTRAINT "material_question_bank_nodes_type_valid" CHECK("material_question_bank_nodes"."node_type" in ('GROUP','BANK')),
	CONSTRAINT "material_question_bank_nodes_order_positive" CHECK("material_question_bank_nodes"."display_order" >= 1),
	CONSTRAINT "material_question_bank_nodes_not_self_parent" CHECK("material_question_bank_nodes"."parent_id" is null or "material_question_bank_nodes"."parent_id" <> "material_question_bank_nodes"."id"),
	CONSTRAINT "material_question_bank_nodes_enabled_boolean" CHECK("material_question_bank_nodes"."enabled" in (0,1)),
	CONSTRAINT "material_question_bank_nodes_shape_valid" CHECK((
      "material_question_bank_nodes"."node_type" = 'GROUP'
      and "material_question_bank_nodes"."group_presentation" in ('CARDS','SWITCHER')
      and "material_question_bank_nodes"."package_id" is null
      and "material_question_bank_nodes"."target_mode" is null
      and "material_question_bank_nodes"."taxonomy_node_id" is null
      and "material_question_bank_nodes"."include_descendants" is null
    ) or (
      "material_question_bank_nodes"."node_type" = 'BANK'
      and "material_question_bank_nodes"."group_presentation" is null
      and (
        ("material_question_bank_nodes"."target_mode" = 'ALL_PACKAGE_QUESTIONS' and "material_question_bank_nodes"."taxonomy_node_id" is null and "material_question_bank_nodes"."include_descendants" is null)
        or
        ("material_question_bank_nodes"."target_mode" = 'TAXONOMY_FILTER' and "material_question_bank_nodes"."package_id" is not null and "material_question_bank_nodes"."taxonomy_node_id" is not null and "material_question_bank_nodes"."include_descendants" in (0,1))
      )
    ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_question_bank_nodes_material_id_unique` ON `material_question_bank_nodes` (`material_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_question_bank_nodes_key_unique` ON `material_question_bank_nodes` (`material_id`,`node_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_question_bank_nodes_root_order_unique` ON `material_question_bank_nodes` (`material_id`,`display_order`) WHERE "material_question_bank_nodes"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `material_question_bank_nodes_sibling_order_unique` ON `material_question_bank_nodes` (`material_id`,`parent_id`,`display_order`) WHERE "material_question_bank_nodes"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX `material_question_bank_nodes_parent_order_index` ON `material_question_bank_nodes` (`material_id`,`parent_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `material_question_bank_nodes_package_index` ON `material_question_bank_nodes` (`package_id`);--> statement-breakpoint
CREATE INDEX `material_question_bank_nodes_taxonomy_index` ON `material_question_bank_nodes` (`package_id`,`taxonomy_node_id`);