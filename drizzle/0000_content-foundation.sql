CREATE TABLE `content_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_key` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "content_resources_revision_positive" CHECK("content_resources"."revision" >= 1),
	CONSTRAINT "content_resources_type_not_empty" CHECK(length("content_resources"."resource_type") > 0),
	CONSTRAINT "content_resources_key_not_empty" CHECK(length("content_resources"."resource_key") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_resources_type_key_unique` ON `content_resources` (`resource_type`,`resource_key`);--> statement-breakpoint
CREATE INDEX `content_resources_type_index` ON `content_resources` (`resource_type`);