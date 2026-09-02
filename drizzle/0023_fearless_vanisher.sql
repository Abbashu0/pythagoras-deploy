CREATE TABLE `ai_retrieval_chunks` (
	`chunk_id` text NOT NULL,
	`projection_revision_id` text NOT NULL,
	`subject_key` text NOT NULL,
	`origin_kind` text NOT NULL,
	`origin_id` text NOT NULL,
	`origin_revision` integer NOT NULL,
	`origin_content_revision` integer NOT NULL,
	`source_id` text,
	`source_revision` integer,
	`source_type` text,
	`trust_tier` text NOT NULL,
	`artifact_sha256` text,
	`source_item_id` text NOT NULL,
	`source_item_order` integer NOT NULL,
	`question_id` text,
	`question_revision` integer,
	`variant_id` text,
	`variant_revision` integer,
	`chunk_ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`text_hash` text NOT NULL,
	`language` text NOT NULL,
	`provenance` text,
	`origin_metadata` text NOT NULL,
	`strategy_key` text NOT NULL,
	`strategy_revision` integer NOT NULL,
	`normalizer_key` text NOT NULL,
	`normalizer_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`projection_revision_id`, `chunk_id`),
	FOREIGN KEY (`projection_revision_id`) REFERENCES `ai_retrieval_projection_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_retrieval_chunks_id_valid" CHECK(length(trim("ai_retrieval_chunks"."chunk_id")) = 64 and "ai_retrieval_chunks"."chunk_id" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_retrieval_chunks_origin_kind_valid" CHECK("ai_retrieval_chunks"."origin_kind" in ('KNOWLEDGE_PACKAGE','QUESTION_PACKAGE')),
	CONSTRAINT "ai_retrieval_chunks_origin_valid" CHECK(length(trim("ai_retrieval_chunks"."origin_id")) between 1 and 120 and "ai_retrieval_chunks"."origin_revision" >= 1 and "ai_retrieval_chunks"."origin_content_revision" >= 1),
	CONSTRAINT "ai_retrieval_chunks_source_pin_valid" CHECK(("ai_retrieval_chunks"."source_id" is null and "ai_retrieval_chunks"."source_revision" is null and "ai_retrieval_chunks"."source_type" is null and "ai_retrieval_chunks"."artifact_sha256" is null) or ("ai_retrieval_chunks"."source_id" is not null and "ai_retrieval_chunks"."source_revision" is not null and "ai_retrieval_chunks"."source_type" is not null and "ai_retrieval_chunks"."artifact_sha256" is not null and "ai_retrieval_chunks"."source_revision" >= 1)),
	CONSTRAINT "ai_retrieval_chunks_trust_valid" CHECK("ai_retrieval_chunks"."trust_tier" in ('OFFICIAL','PYTHAGORAS_APPROVED','TEACHER_REVIEWED','OTHER_APPROVED')),
	CONSTRAINT "ai_retrieval_chunks_artifact_hash_valid" CHECK("ai_retrieval_chunks"."artifact_sha256" is null or (length("ai_retrieval_chunks"."artifact_sha256") = 64 and "ai_retrieval_chunks"."artifact_sha256" not glob '*[^0-9a-f]*')),
	CONSTRAINT "ai_retrieval_chunks_source_item_valid" CHECK(length(trim("ai_retrieval_chunks"."source_item_id")) between 1 and 160 and "ai_retrieval_chunks"."source_item_order" >= 1),
	CONSTRAINT "ai_retrieval_chunks_question_identity_valid" CHECK(("ai_retrieval_chunks"."origin_kind" = 'KNOWLEDGE_PACKAGE' and "ai_retrieval_chunks"."question_id" is null and "ai_retrieval_chunks"."question_revision" is null and "ai_retrieval_chunks"."variant_id" is null and "ai_retrieval_chunks"."variant_revision" is null) or ("ai_retrieval_chunks"."origin_kind" = 'QUESTION_PACKAGE' and "ai_retrieval_chunks"."question_id" is not null and "ai_retrieval_chunks"."question_revision" is not null and "ai_retrieval_chunks"."variant_id" is not null and "ai_retrieval_chunks"."variant_revision" is not null and "ai_retrieval_chunks"."question_revision" >= 1 and "ai_retrieval_chunks"."variant_revision" >= 1)),
	CONSTRAINT "ai_retrieval_chunks_ordinal_positive" CHECK("ai_retrieval_chunks"."chunk_ordinal" >= 1),
	CONSTRAINT "ai_retrieval_chunks_text_valid" CHECK(length(cast("ai_retrieval_chunks"."text" as blob)) between 1 and 4096),
	CONSTRAINT "ai_retrieval_chunks_hash_valid" CHECK(length("ai_retrieval_chunks"."text_hash") = 64 and "ai_retrieval_chunks"."text_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_retrieval_chunks_language_valid" CHECK(length(trim("ai_retrieval_chunks"."language")) between 2 and 32),
	CONSTRAINT "ai_retrieval_chunks_provenance_valid" CHECK("ai_retrieval_chunks"."provenance" is null or (json_valid("ai_retrieval_chunks"."provenance") and json_type("ai_retrieval_chunks"."provenance") = 'object')),
	CONSTRAINT "ai_retrieval_chunks_origin_metadata_valid" CHECK(json_valid("ai_retrieval_chunks"."origin_metadata") and json_type("ai_retrieval_chunks"."origin_metadata") = 'object'),
	CONSTRAINT "ai_retrieval_chunks_strategy_valid" CHECK(length(trim("ai_retrieval_chunks"."strategy_key")) between 1 and 120 and "ai_retrieval_chunks"."strategy_revision" >= 1 and length(trim("ai_retrieval_chunks"."normalizer_key")) between 1 and 120 and "ai_retrieval_chunks"."normalizer_revision" >= 1),
	CONSTRAINT "ai_retrieval_chunks_created_nonnegative" CHECK("ai_retrieval_chunks"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_chunks_revision_ordinal_unique` ON `ai_retrieval_chunks` (`projection_revision_id`,`chunk_ordinal`);--> statement-breakpoint
CREATE INDEX `ai_retrieval_chunks_subject_origin_index` ON `ai_retrieval_chunks` (`subject_key`,`origin_kind`,`origin_id`);--> statement-breakpoint
CREATE INDEX `ai_retrieval_chunks_source_item_index` ON `ai_retrieval_chunks` (`source_item_id`);--> statement-breakpoint
CREATE TABLE `ai_retrieval_projection_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`projection_set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`input_fingerprint` text NOT NULL,
	`strategy_key` text NOT NULL,
	`strategy_revision` integer NOT NULL,
	`normalizer_key` text NOT NULL,
	`normalizer_revision` integer NOT NULL,
	`status` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`source_cursor` text,
	`batch_count` integer DEFAULT 0 NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ready_at` integer,
	`failed_at` integer,
	`safe_error_code` text,
	FOREIGN KEY (`projection_set_id`) REFERENCES `ai_retrieval_projection_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_retrieval_projection_revisions_revision_positive" CHECK("ai_retrieval_projection_revisions"."revision" >= 1),
	CONSTRAINT "ai_retrieval_projection_revisions_fingerprint_valid" CHECK(length("ai_retrieval_projection_revisions"."input_fingerprint") = 64 and "ai_retrieval_projection_revisions"."input_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_retrieval_projection_revisions_strategy_valid" CHECK(length(trim("ai_retrieval_projection_revisions"."strategy_key")) between 1 and 120 and "ai_retrieval_projection_revisions"."strategy_key" not glob '*[^a-z0-9.-]*' and "ai_retrieval_projection_revisions"."strategy_revision" >= 1),
	CONSTRAINT "ai_retrieval_projection_revisions_normalizer_valid" CHECK(length(trim("ai_retrieval_projection_revisions"."normalizer_key")) between 1 and 120 and "ai_retrieval_projection_revisions"."normalizer_key" not glob '*[^a-z0-9.-]*' and "ai_retrieval_projection_revisions"."normalizer_revision" >= 1),
	CONSTRAINT "ai_retrieval_projection_revisions_status_valid" CHECK("ai_retrieval_projection_revisions"."status" in ('BUILDING','READY','FAILED')),
	CONSTRAINT "ai_retrieval_projection_revisions_current_boolean" CHECK("ai_retrieval_projection_revisions"."is_current" in (0,1)),
	CONSTRAINT "ai_retrieval_projection_revisions_cursor_valid" CHECK("ai_retrieval_projection_revisions"."source_cursor" is null or (json_valid("ai_retrieval_projection_revisions"."source_cursor") and json_type("ai_retrieval_projection_revisions"."source_cursor") = 'object')),
	CONSTRAINT "ai_retrieval_projection_revisions_counts_valid" CHECK("ai_retrieval_projection_revisions"."batch_count" >= 0 and "ai_retrieval_projection_revisions"."chunk_count" >= 0),
	CONSTRAINT "ai_retrieval_projection_revisions_timestamps_valid" CHECK("ai_retrieval_projection_revisions"."started_at" >= 0 and "ai_retrieval_projection_revisions"."updated_at" >= "ai_retrieval_projection_revisions"."started_at" and ("ai_retrieval_projection_revisions"."ready_at" is null or "ai_retrieval_projection_revisions"."ready_at" >= "ai_retrieval_projection_revisions"."started_at") and ("ai_retrieval_projection_revisions"."failed_at" is null or "ai_retrieval_projection_revisions"."failed_at" >= "ai_retrieval_projection_revisions"."started_at")),
	CONSTRAINT "ai_retrieval_projection_revisions_state_consistency" CHECK(("ai_retrieval_projection_revisions"."status" = 'READY' and "ai_retrieval_projection_revisions"."ready_at" is not null and "ai_retrieval_projection_revisions"."failed_at" is null) or ("ai_retrieval_projection_revisions"."status" = 'FAILED' and "ai_retrieval_projection_revisions"."failed_at" is not null and "ai_retrieval_projection_revisions"."is_current" = 0) or ("ai_retrieval_projection_revisions"."status" = 'BUILDING' and "ai_retrieval_projection_revisions"."ready_at" is null and "ai_retrieval_projection_revisions"."failed_at" is null and "ai_retrieval_projection_revisions"."is_current" = 0)),
	CONSTRAINT "ai_retrieval_projection_revisions_error_valid" CHECK("ai_retrieval_projection_revisions"."safe_error_code" is null or length(trim("ai_retrieval_projection_revisions"."safe_error_code")) between 1 and 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_projection_revisions_identity_unique` ON `ai_retrieval_projection_revisions` (`projection_set_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_projection_revisions_current_unique` ON `ai_retrieval_projection_revisions` (`projection_set_id`) WHERE "ai_retrieval_projection_revisions"."is_current" = 1;--> statement-breakpoint
CREATE INDEX `ai_retrieval_projection_revisions_status_index` ON `ai_retrieval_projection_revisions` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_retrieval_projection_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_key` text NOT NULL,
	`origin_kind` text NOT NULL,
	`origin_id` text NOT NULL,
	`strategy_key` text NOT NULL,
	`normalizer_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_retrieval_projection_sets_origin_kind_valid" CHECK("ai_retrieval_projection_sets"."origin_kind" in ('KNOWLEDGE_PACKAGE','QUESTION_PACKAGE')),
	CONSTRAINT "ai_retrieval_projection_sets_origin_id_valid" CHECK(length(trim("ai_retrieval_projection_sets"."origin_id")) between 1 and 120),
	CONSTRAINT "ai_retrieval_projection_sets_strategy_key_valid" CHECK(length(trim("ai_retrieval_projection_sets"."strategy_key")) between 1 and 120 and "ai_retrieval_projection_sets"."strategy_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_retrieval_projection_sets_normalizer_key_valid" CHECK(length(trim("ai_retrieval_projection_sets"."normalizer_key")) between 1 and 120 and "ai_retrieval_projection_sets"."normalizer_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_retrieval_projection_sets_created_nonnegative" CHECK("ai_retrieval_projection_sets"."created_at" >= 0),
	CONSTRAINT "ai_retrieval_projection_sets_updated_ordered" CHECK("ai_retrieval_projection_sets"."updated_at" >= "ai_retrieval_projection_sets"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_projection_sets_identity_unique` ON `ai_retrieval_projection_sets` (`subject_key`,`origin_kind`,`origin_id`,`strategy_key`,`normalizer_key`);--> statement-breakpoint
CREATE INDEX `ai_retrieval_projection_sets_subject_index` ON `ai_retrieval_projection_sets` (`subject_key`,`origin_kind`);
--> statement-breakpoint
-- Separate M7A lexical index; no semantic/vector fields are part of this projection.
CREATE VIRTUAL TABLE `ai_retrieval_fts` USING fts5(
  `chunk_id` UNINDEXED,
  `projection_revision_id` UNINDEXED,
  `subject_key` UNINDEXED,
  `search_text`,
  tokenize = 'unicode61 remove_diacritics 0'
);
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_ready_chunks_no_update`
BEFORE UPDATE ON `ai_retrieval_chunks`
WHEN EXISTS (
	SELECT 1
	FROM `ai_retrieval_projection_revisions`
	WHERE `id` = OLD.`projection_revision_id`
		AND `status` = 'READY'
)
BEGIN
	SELECT RAISE(ABORT, 'READY retrieval chunks are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_ready_chunks_no_delete`
BEFORE DELETE ON `ai_retrieval_chunks`
WHEN EXISTS (
	SELECT 1
	FROM `ai_retrieval_projection_revisions`
	WHERE `id` = OLD.`projection_revision_id`
		AND `status` = 'READY'
)
BEGIN
	SELECT RAISE(ABORT, 'READY retrieval chunks are immutable');
END;
