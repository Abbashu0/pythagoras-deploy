CREATE TABLE `ai_knowledge_documents` (
	`package_revision_id` text NOT NULL,
	`document_id` text NOT NULL,
	`display_order` integer NOT NULL,
	`title` text,
	`provenance` text,
	`content` text NOT NULL,
	PRIMARY KEY(`package_revision_id`, `document_id`),
	FOREIGN KEY (`package_revision_id`) REFERENCES `ai_knowledge_package_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_knowledge_documents_id_valid" CHECK(length(trim("ai_knowledge_documents"."document_id")) between 1 and 120),
	CONSTRAINT "ai_knowledge_documents_order_positive" CHECK("ai_knowledge_documents"."display_order" >= 1),
	CONSTRAINT "ai_knowledge_documents_title_valid" CHECK("ai_knowledge_documents"."title" is null or length(trim("ai_knowledge_documents"."title")) between 1 and 500),
	CONSTRAINT "ai_knowledge_documents_provenance_valid" CHECK("ai_knowledge_documents"."provenance" is null or (json_valid("ai_knowledge_documents"."provenance") and json_type("ai_knowledge_documents"."provenance") = 'object')),
	CONSTRAINT "ai_knowledge_documents_content_valid" CHECK(json_valid("ai_knowledge_documents"."content") and json_type("ai_knowledge_documents"."content") = 'object')
);
--> statement-breakpoint
CREATE INDEX `ai_knowledge_documents_revision_order_index` ON `ai_knowledge_documents` (`package_revision_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `ai_knowledge_package_assets` (
	`package_revision_id` text NOT NULL,
	`asset_ref` text NOT NULL,
	`expected_sha256` text NOT NULL,
	`asset_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`metadata` text,
	PRIMARY KEY(`package_revision_id`, `asset_ref`),
	FOREIGN KEY (`package_revision_id`) REFERENCES `ai_knowledge_package_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_knowledge_package_assets_ref_valid" CHECK(length(trim("ai_knowledge_package_assets"."asset_ref")) between 1 and 120 and "ai_knowledge_package_assets"."asset_ref" not glob '*[^A-Za-z0-9._-]*'),
	CONSTRAINT "ai_knowledge_package_assets_hash_valid" CHECK(length("ai_knowledge_package_assets"."expected_sha256") = 64 and "ai_knowledge_package_assets"."expected_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_knowledge_package_assets_filename_valid" CHECK(length(trim("ai_knowledge_package_assets"."filename")) between 1 and 255 and "ai_knowledge_package_assets"."filename" not glob '*[\/]*'),
	CONSTRAINT "ai_knowledge_package_assets_mime_valid" CHECK(length(trim("ai_knowledge_package_assets"."mime_type")) between 1 and 200),
	CONSTRAINT "ai_knowledge_package_assets_size_valid" CHECK("ai_knowledge_package_assets"."byte_size" > 0),
	CONSTRAINT "ai_knowledge_package_assets_metadata_valid" CHECK("ai_knowledge_package_assets"."metadata" is null or (json_valid("ai_knowledge_package_assets"."metadata") and json_type("ai_knowledge_package_assets"."metadata") = 'object'))
);
--> statement-breakpoint
CREATE INDEX `ai_knowledge_package_assets_asset_index` ON `ai_knowledge_package_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `ai_knowledge_package_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`language` text NOT NULL,
	`content_revision` integer NOT NULL,
	`source_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`artifact_ref` text NOT NULL,
	`artifact_sha256` text NOT NULL,
	`artifact_byte_size` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `ai_knowledge_packages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`,`source_revision`) REFERENCES `ai_knowledge_source_revisions`(`source_id`,`revision`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_knowledge_package_revisions_revision_positive" CHECK("ai_knowledge_package_revisions"."revision" >= 1),
	CONSTRAINT "ai_knowledge_package_revisions_title_valid" CHECK(length(trim("ai_knowledge_package_revisions"."title")) between 1 and 500),
	CONSTRAINT "ai_knowledge_package_revisions_language_valid" CHECK(length(trim("ai_knowledge_package_revisions"."language")) between 2 and 32),
	CONSTRAINT "ai_knowledge_package_revisions_content_revision_positive" CHECK("ai_knowledge_package_revisions"."content_revision" >= 1),
	CONSTRAINT "ai_knowledge_package_revisions_source_revision_positive" CHECK("ai_knowledge_package_revisions"."source_revision" >= 1),
	CONSTRAINT "ai_knowledge_package_revisions_artifact_ref_valid" CHECK(length(trim("ai_knowledge_package_revisions"."artifact_ref")) between 1 and 128 and "ai_knowledge_package_revisions"."artifact_ref" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_knowledge_package_revisions_artifact_hash_valid" CHECK(length("ai_knowledge_package_revisions"."artifact_sha256") = 64 and "ai_knowledge_package_revisions"."artifact_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_knowledge_package_revisions_artifact_size_valid" CHECK("ai_knowledge_package_revisions"."artifact_byte_size" > 0),
	CONSTRAINT "ai_knowledge_package_revisions_created_nonnegative" CHECK("ai_knowledge_package_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_knowledge_package_revisions_identity_unique` ON `ai_knowledge_package_revisions` (`package_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_knowledge_package_revisions_source_index` ON `ai_knowledge_package_revisions` (`source_id`,`source_revision`);--> statement-breakpoint
CREATE TABLE `ai_knowledge_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`subject_key` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_knowledge_packages_key_valid" CHECK(length(trim("ai_knowledge_packages"."key")) between 1 and 120 and "ai_knowledge_packages"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_knowledge_packages_subject_valid" CHECK(length(trim("ai_knowledge_packages"."subject_key")) between 1 and 80 and "ai_knowledge_packages"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_knowledge_packages_revision_positive" CHECK("ai_knowledge_packages"."current_revision" >= 1),
	CONSTRAINT "ai_knowledge_packages_created_nonnegative" CHECK("ai_knowledge_packages"."created_at" >= 0),
	CONSTRAINT "ai_knowledge_packages_updated_ordered" CHECK("ai_knowledge_packages"."updated_at" >= "ai_knowledge_packages"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_knowledge_packages_key_unique` ON `ai_knowledge_packages` (`key`);--> statement-breakpoint
CREATE INDEX `ai_knowledge_packages_subject_index` ON `ai_knowledge_packages` (`subject_key`);--> statement-breakpoint
CREATE TABLE `ai_knowledge_source_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`revision` integer NOT NULL,
	`source_type` text NOT NULL,
	`display_name` text NOT NULL,
	`language` text NOT NULL,
	`edition` text,
	`authority_name` text,
	`authority_type` text,
	`trust_tier` text NOT NULL,
	`rights_status` text NOT NULL,
	`rights_basis` text,
	`license_name` text,
	`attribution` text,
	`rights_notes` text,
	`source_url` text,
	`source_asset_id` text,
	`enabled` integer NOT NULL,
	`preparation_method` text NOT NULL,
	`producer_key` text NOT NULL,
	`producer_revision` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `ai_knowledge_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_knowledge_source_revisions_revision_positive" CHECK("ai_knowledge_source_revisions"."revision" >= 1),
	CONSTRAINT "ai_knowledge_source_revisions_type_valid" CHECK("ai_knowledge_source_revisions"."source_type" in ('OFFICIAL_TEXTBOOK','MINISTERIAL_REFERENCE','PYTHAGORAS_APPROVED','TEACHER_SUPPLEMENT','REFERENCE_TABLE','OTHER_APPROVED')),
	CONSTRAINT "ai_knowledge_source_revisions_display_name_valid" CHECK(length(trim("ai_knowledge_source_revisions"."display_name")) between 1 and 500),
	CONSTRAINT "ai_knowledge_source_revisions_language_valid" CHECK(length(trim("ai_knowledge_source_revisions"."language")) between 2 and 32),
	CONSTRAINT "ai_knowledge_source_revisions_trust_valid" CHECK("ai_knowledge_source_revisions"."trust_tier" in ('OFFICIAL','PYTHAGORAS_APPROVED','TEACHER_REVIEWED','OTHER_APPROVED')),
	CONSTRAINT "ai_knowledge_source_revisions_rights_status_valid" CHECK("ai_knowledge_source_revisions"."rights_status" in ('CLEARED','RESTRICTED','UNKNOWN')),
	CONSTRAINT "ai_knowledge_source_revisions_rights_basis_valid" CHECK("ai_knowledge_source_revisions"."rights_basis" is null or "ai_knowledge_source_revisions"."rights_basis" in ('OWNED','LICENSED','PERMISSION','PUBLIC_DOMAIN','OTHER_REVIEWED')),
	CONSTRAINT "ai_knowledge_source_revisions_cleared_basis" CHECK(("ai_knowledge_source_revisions"."rights_status" = 'CLEARED' and "ai_knowledge_source_revisions"."rights_basis" is not null) or ("ai_knowledge_source_revisions"."rights_status" <> 'CLEARED' and "ai_knowledge_source_revisions"."rights_basis" is null)),
	CONSTRAINT "ai_knowledge_source_revisions_enabled_boolean" CHECK("ai_knowledge_source_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_knowledge_source_revisions_preparation_valid" CHECK("ai_knowledge_source_revisions"."preparation_method" in ('MANUAL','DETERMINISTIC','AI_ASSISTED')),
	CONSTRAINT "ai_knowledge_source_revisions_text_bounds" CHECK(("ai_knowledge_source_revisions"."edition" is null or length("ai_knowledge_source_revisions"."edition") <= 500) and ("ai_knowledge_source_revisions"."authority_name" is null or length("ai_knowledge_source_revisions"."authority_name") <= 500) and ("ai_knowledge_source_revisions"."authority_type" is null or length("ai_knowledge_source_revisions"."authority_type") <= 120) and ("ai_knowledge_source_revisions"."license_name" is null or length("ai_knowledge_source_revisions"."license_name") <= 500) and ("ai_knowledge_source_revisions"."attribution" is null or length("ai_knowledge_source_revisions"."attribution") <= 2000) and ("ai_knowledge_source_revisions"."rights_notes" is null or length("ai_knowledge_source_revisions"."rights_notes") <= 2000) and ("ai_knowledge_source_revisions"."source_url" is null or length("ai_knowledge_source_revisions"."source_url") <= 2000)),
	CONSTRAINT "ai_knowledge_source_revisions_producer_valid" CHECK(length(trim("ai_knowledge_source_revisions"."producer_key")) between 1 and 120 and length(trim("ai_knowledge_source_revisions"."producer_revision")) between 1 and 120),
	CONSTRAINT "ai_knowledge_source_revisions_created_nonnegative" CHECK("ai_knowledge_source_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_knowledge_source_revisions_identity_unique` ON `ai_knowledge_source_revisions` (`source_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_knowledge_source_revisions_source_index` ON `ai_knowledge_source_revisions` (`source_id`,`revision`);--> statement-breakpoint
CREATE TABLE `ai_knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`subject_key` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_knowledge_sources_key_valid" CHECK(length(trim("ai_knowledge_sources"."key")) between 1 and 120 and "ai_knowledge_sources"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_knowledge_sources_subject_valid" CHECK(length(trim("ai_knowledge_sources"."subject_key")) between 1 and 80 and "ai_knowledge_sources"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_knowledge_sources_revision_positive" CHECK("ai_knowledge_sources"."current_revision" >= 1),
	CONSTRAINT "ai_knowledge_sources_created_nonnegative" CHECK("ai_knowledge_sources"."created_at" >= 0),
	CONSTRAINT "ai_knowledge_sources_updated_ordered" CHECK("ai_knowledge_sources"."updated_at" >= "ai_knowledge_sources"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_knowledge_sources_key_unique` ON `ai_knowledge_sources` (`key`);--> statement-breakpoint
CREATE INDEX `ai_knowledge_sources_subject_index` ON `ai_knowledge_sources` (`subject_key`);
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_sources_identity_no_update`
BEFORE UPDATE OF `id`, `key`, `subject_key` ON `ai_knowledge_sources`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Source identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_source_revisions_no_update`
BEFORE UPDATE ON `ai_knowledge_source_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Source revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_source_revisions_no_delete`
BEFORE DELETE ON `ai_knowledge_source_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Source revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_packages_identity_no_update`
BEFORE UPDATE OF `id`, `key`, `subject_key` ON `ai_knowledge_packages`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Package identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_package_revisions_no_update`
BEFORE UPDATE ON `ai_knowledge_package_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Package revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_package_revisions_no_delete`
BEFORE DELETE ON `ai_knowledge_package_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Package revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_documents_no_update`
BEFORE UPDATE ON `ai_knowledge_documents`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Documents are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_documents_no_delete`
BEFORE DELETE ON `ai_knowledge_documents`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Documents are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_package_assets_no_update`
BEFORE UPDATE ON `ai_knowledge_package_assets`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Package assets are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_knowledge_package_assets_no_delete`
BEFORE DELETE ON `ai_knowledge_package_assets`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Package assets are immutable');
END;
