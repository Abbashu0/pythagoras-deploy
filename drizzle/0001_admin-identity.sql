CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "admin_sessions_token_hash_sha256" CHECK(length("admin_sessions"."token_hash") = 64 and "admin_sessions"."token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "admin_sessions_expiration_after_creation" CHECK("admin_sessions"."expires_at" > "admin_sessions"."created_at"),
	CONSTRAINT "admin_sessions_last_seen_not_before_creation" CHECK("admin_sessions"."last_seen_at" >= "admin_sessions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_hash_unique` ON `admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `admin_sessions_user_index` ON `admin_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_index` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer,
	`password_changed_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "admin_users_role_valid" CHECK("admin_users"."role" in ('OWNER', 'ADMIN')),
	CONSTRAINT "admin_users_enabled_boolean" CHECK("admin_users"."enabled" in (0, 1)),
	CONSTRAINT "admin_users_revision_positive" CHECK("admin_users"."revision" >= 1),
	CONSTRAINT "admin_users_email_not_empty" CHECK(length(trim("admin_users"."email")) > 0),
	CONSTRAINT "admin_users_display_name_not_empty" CHECK(length(trim("admin_users"."display_name")) > 0),
	CONSTRAINT "admin_users_password_hash_not_empty" CHECK(length("admin_users"."password_hash") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_email_unique` ON `admin_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_single_owner` ON `admin_users` (`role`) WHERE "admin_users"."role" = 'OWNER';--> statement-breakpoint
CREATE INDEX `admin_users_role_index` ON `admin_users` (`role`);