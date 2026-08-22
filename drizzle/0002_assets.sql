CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`original_filename` text NOT NULL,
	`display_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`media_kind` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assets_media_kind_valid" CHECK("assets"."media_kind" in ('image', 'video', 'audio', 'document', 'json', 'other-safe-file')),
	CONSTRAINT "assets_byte_size_positive" CHECK("assets"."byte_size" > 0),
	CONSTRAINT "assets_sha256_valid" CHECK(length("assets"."sha256") = 64 and "assets"."sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "assets_storage_key_matches_hash" CHECK("assets"."storage_key" = substr("assets"."sha256", 1, 2) || '/' || "assets"."sha256"),
	CONSTRAINT "assets_original_filename_valid" CHECK(length(trim("assets"."original_filename")) between 1 and 255),
	CONSTRAINT "assets_display_name_valid" CHECK(length(trim("assets"."display_name")) between 1 and 255),
	CONSTRAINT "assets_mime_type_valid" CHECK(length(trim("assets"."mime_type")) between 1 and 127),
	CONSTRAINT "assets_image_dimensions_valid" CHECK((("assets"."width" is null and "assets"."height" is null) or ("assets"."width" > 0 and "assets"."height" > 0))),
	CONSTRAINT "assets_duration_positive" CHECK("assets"."duration_ms" is null or "assets"."duration_ms" > 0),
	CONSTRAINT "assets_revision_positive" CHECK("assets"."revision" >= 1),
	CONSTRAINT "assets_timestamps_ordered" CHECK("assets"."updated_at" >= "assets"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_sha256_unique` ON `assets` (`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_storage_key_unique` ON `assets` (`storage_key`);--> statement-breakpoint
CREATE INDEX `assets_media_kind_index` ON `assets` (`media_kind`);--> statement-breakpoint
CREATE INDEX `assets_mime_type_index` ON `assets` (`mime_type`);--> statement-breakpoint
CREATE INDEX `assets_created_by_index` ON `assets` (`created_by`);--> statement-breakpoint
CREATE INDEX `assets_created_at_index` ON `assets` (`created_at`);