CREATE TABLE `change_set_events` (
	`id` text PRIMARY KEY NOT NULL,
	`change_set_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`note` text,
	`metadata` text,
	FOREIGN KEY (`change_set_id`) REFERENCES `change_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "change_set_events_type_valid" CHECK("change_set_events"."event_type" in ('CREATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','SUBMITTED','REQUESTED_CHANGES','RESUBMITTED','APPROVED','REJECTED','CONFLICT_DETECTED','AUTO_MERGED_DISJOINT_FIELDS','REBASED','PUBLISHED','CANCELLED')),
	CONSTRAINT "change_set_events_note_valid" CHECK("change_set_events"."note" is null or length(trim("change_set_events"."note")) between 1 and 2000)
);
--> statement-breakpoint
CREATE INDEX `change_set_events_change_set_time_index` ON `change_set_events` (`change_set_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `change_set_events_actor_index` ON `change_set_events` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `change_set_items` (
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
	CONSTRAINT "change_set_items_operation_valid" CHECK("change_set_items"."operation" = 'UPDATE'),
	CONSTRAINT "change_set_items_resource_type_valid" CHECK(length(trim("change_set_items"."resource_type")) between 1 and 80),
	CONSTRAINT "change_set_items_resource_id_valid" CHECK(length(trim("change_set_items"."resource_id")) > 0),
	CONSTRAINT "change_set_items_base_revision_positive" CHECK("change_set_items"."base_resource_revision" >= 1),
	CONSTRAINT "change_set_items_changed_paths_array" CHECK(json_valid("change_set_items"."changed_paths") and json_type("change_set_items"."changed_paths") = 'array'),
	CONSTRAINT "change_set_items_before_snapshot_object" CHECK(json_valid("change_set_items"."before_snapshot") and json_type("change_set_items"."before_snapshot") = 'object'),
	CONSTRAINT "change_set_items_proposed_snapshot_object" CHECK(json_valid("change_set_items"."proposed_snapshot") and json_type("change_set_items"."proposed_snapshot") = 'object'),
	CONSTRAINT "change_set_items_conflict_state_valid" CHECK("change_set_items"."conflict_state" in ('NONE','BLOCKING','AUTO_MERGED')),
	CONSTRAINT "change_set_items_revision_positive" CHECK("change_set_items"."revision" >= 1),
	CONSTRAINT "change_set_items_timestamps_ordered" CHECK("change_set_items"."updated_at" >= "change_set_items"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_set_items_resource_unique` ON `change_set_items` (`change_set_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `change_set_items_change_set_index` ON `change_set_items` (`change_set_id`);--> statement-breakpoint
CREATE INDEX `change_set_items_resource_index` ON `change_set_items` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `change_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`created_by` text NOT NULL,
	`status` text NOT NULL,
	`base_publication_revision` integer NOT NULL,
	`review_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_at` integer,
	`reviewed_by` text,
	`reviewed_at` integer,
	`approved_at` integer,
	`published_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "change_sets_status_valid" CHECK("change_sets"."status" in ('DRAFT','SUBMITTED','NEEDS_CHANGES','APPROVED','REJECTED','CONFLICTED','PUBLISHED','CANCELLED','SUPERSEDED')),
	CONSTRAINT "change_sets_title_valid" CHECK(length(trim("change_sets"."title")) between 1 and 160),
	CONSTRAINT "change_sets_description_valid" CHECK("change_sets"."description" is null or length("change_sets"."description") <= 2000),
	CONSTRAINT "change_sets_review_note_valid" CHECK("change_sets"."review_note" is null or length(trim("change_sets"."review_note")) between 1 and 2000),
	CONSTRAINT "change_sets_base_publication_revision_nonnegative" CHECK("change_sets"."base_publication_revision" >= 0),
	CONSTRAINT "change_sets_revision_positive" CHECK("change_sets"."revision" >= 1),
	CONSTRAINT "change_sets_timestamps_ordered" CHECK("change_sets"."updated_at" >= "change_sets"."created_at")
);
--> statement-breakpoint
CREATE INDEX `change_sets_status_index` ON `change_sets` (`status`);--> statement-breakpoint
CREATE INDEX `change_sets_created_by_index` ON `change_sets` (`created_by`);--> statement-breakpoint
CREATE INDEX `change_sets_updated_at_index` ON `change_sets` (`updated_at`);--> statement-breakpoint
CREATE TABLE `publication_items` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`operation` text NOT NULL,
	`before_snapshot` text NOT NULL,
	`after_snapshot` text NOT NULL,
	`resulting_resource_revision` integer NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publication_items_operation_valid" CHECK("publication_items"."operation" = 'UPDATE'),
	CONSTRAINT "publication_items_before_snapshot_object" CHECK(json_valid("publication_items"."before_snapshot") and json_type("publication_items"."before_snapshot") = 'object'),
	CONSTRAINT "publication_items_after_snapshot_object" CHECK(json_valid("publication_items"."after_snapshot") and json_type("publication_items"."after_snapshot") = 'object'),
	CONSTRAINT "publication_items_result_revision_positive" CHECK("publication_items"."resulting_resource_revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `publication_items_publication_index` ON `publication_items` (`publication_id`);--> statement-breakpoint
CREATE INDEX `publication_items_resource_index` ON `publication_items` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `publication_state` (
	`id` text PRIMARY KEY NOT NULL,
	`current_revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "publication_state_singleton" CHECK("publication_state"."id" = 'global'),
	CONSTRAINT "publication_state_revision_nonnegative" CHECK("publication_state"."current_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`change_set_id` text NOT NULL,
	`published_by` text NOT NULL,
	`published_at` integer NOT NULL,
	`summary` text NOT NULL,
	FOREIGN KEY (`change_set_id`) REFERENCES `change_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`published_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "publications_revision_positive" CHECK("publications"."revision" >= 1),
	CONSTRAINT "publications_summary_valid" CHECK(length(trim("publications"."summary")) between 1 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_revision_unique` ON `publications` (`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `publications_change_set_unique` ON `publications` (`change_set_id`);--> statement-breakpoint
CREATE INDEX `publications_published_at_index` ON `publications` (`published_at`);
--> statement-breakpoint
INSERT INTO `publication_state` (`id`, `current_revision`, `updated_at`) VALUES ('global', 0, 0);
