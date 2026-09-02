CREATE TABLE `ai_embedding_projection_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`embedding_projection_set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`subject_key` text NOT NULL,
	`chunk_projection_set_id` text NOT NULL,
	`chunk_projection_revision_id` text NOT NULL,
	`chunk_projection_input_fingerprint` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`model_config_id` text NOT NULL,
	`model_config_revision` integer NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_config_revision` integer NOT NULL,
	`provider_model_id` text NOT NULL,
	`embedding_adapter_key` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector_codec_key` text NOT NULL,
	`vector_codec_revision` integer NOT NULL,
	`vector_index_adapter_key` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`source_cursor` text,
	`batch_count` integer DEFAULT 0 NOT NULL,
	`vector_count` integer DEFAULT 0 NOT NULL,
	`job_id` text NOT NULL,
	`cost_operation_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ready_at` integer,
	`failed_at` integer,
	`safe_error_code` text,
	FOREIGN KEY (`embedding_projection_set_id`) REFERENCES `ai_embedding_projection_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`chunk_projection_set_id`) REFERENCES `ai_retrieval_projection_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`chunk_projection_revision_id`) REFERENCES `ai_retrieval_projection_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_embedding_projection_revisions_revision_positive" CHECK("ai_embedding_projection_revisions"."revision" >= 1),
	CONSTRAINT "ai_embedding_projection_revisions_subject_valid" CHECK(length(trim("ai_embedding_projection_revisions"."subject_key")) between 1 and 120),
	CONSTRAINT "ai_embedding_projection_revisions_chunk_fingerprint_valid" CHECK(length("ai_embedding_projection_revisions"."chunk_projection_input_fingerprint") = 64 and "ai_embedding_projection_revisions"."chunk_projection_input_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_embedding_projection_revisions_input_fingerprint_valid" CHECK(length("ai_embedding_projection_revisions"."input_fingerprint") = 64 and "ai_embedding_projection_revisions"."input_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_embedding_projection_revisions_chunk_count_valid" CHECK("ai_embedding_projection_revisions"."chunk_count" >= 0 and "ai_embedding_projection_revisions"."batch_count" >= 0 and "ai_embedding_projection_revisions"."vector_count" >= 0),
	CONSTRAINT "ai_embedding_projection_revisions_model_identity_valid" CHECK("ai_embedding_projection_revisions"."model_config_revision" >= 1 and "ai_embedding_projection_revisions"."provider_config_revision" >= 1 and length(trim("ai_embedding_projection_revisions"."provider_model_id")) between 1 and 200 and length(trim("ai_embedding_projection_revisions"."embedding_adapter_key")) between 1 and 120 and "ai_embedding_projection_revisions"."embedding_adapter_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_embedding_projection_revisions_dimensions_valid" CHECK("ai_embedding_projection_revisions"."dimensions" between 1 and 16384),
	CONSTRAINT "ai_embedding_projection_revisions_codec_valid" CHECK(length(trim("ai_embedding_projection_revisions"."vector_codec_key")) between 1 and 120 and "ai_embedding_projection_revisions"."vector_codec_key" not glob '*[^a-z0-9.-]*' and "ai_embedding_projection_revisions"."vector_codec_revision" >= 1 and length(trim("ai_embedding_projection_revisions"."vector_index_adapter_key")) between 1 and 120 and "ai_embedding_projection_revisions"."vector_index_adapter_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_embedding_projection_revisions_status_valid" CHECK("ai_embedding_projection_revisions"."status" in ('BUILDING','READY','FAILED')),
	CONSTRAINT "ai_embedding_projection_revisions_current_boolean" CHECK("ai_embedding_projection_revisions"."is_current" in (0,1)),
	CONSTRAINT "ai_embedding_projection_revisions_cursor_valid" CHECK("ai_embedding_projection_revisions"."source_cursor" is null or (json_valid("ai_embedding_projection_revisions"."source_cursor") and json_type("ai_embedding_projection_revisions"."source_cursor") = 'object')),
	CONSTRAINT "ai_embedding_projection_revisions_timestamps_valid" CHECK("ai_embedding_projection_revisions"."started_at" >= 0 and "ai_embedding_projection_revisions"."updated_at" >= "ai_embedding_projection_revisions"."started_at" and ("ai_embedding_projection_revisions"."ready_at" is null or "ai_embedding_projection_revisions"."ready_at" >= "ai_embedding_projection_revisions"."started_at") and ("ai_embedding_projection_revisions"."failed_at" is null or "ai_embedding_projection_revisions"."failed_at" >= "ai_embedding_projection_revisions"."started_at")),
	CONSTRAINT "ai_embedding_projection_revisions_state_consistency" CHECK(("ai_embedding_projection_revisions"."status" = 'READY' and "ai_embedding_projection_revisions"."ready_at" is not null and "ai_embedding_projection_revisions"."failed_at" is null and "ai_embedding_projection_revisions"."source_cursor" is not null and json_extract("ai_embedding_projection_revisions"."source_cursor", '$.kind') = 'DONE' and "ai_embedding_projection_revisions"."vector_count" = "ai_embedding_projection_revisions"."chunk_count") or ("ai_embedding_projection_revisions"."status" = 'FAILED' and "ai_embedding_projection_revisions"."failed_at" is not null and "ai_embedding_projection_revisions"."is_current" = 0) or ("ai_embedding_projection_revisions"."status" = 'BUILDING' and "ai_embedding_projection_revisions"."ready_at" is null and "ai_embedding_projection_revisions"."failed_at" is null and "ai_embedding_projection_revisions"."safe_error_code" is null and "ai_embedding_projection_revisions"."is_current" = 0)),
	CONSTRAINT "ai_embedding_projection_revisions_error_valid" CHECK("ai_embedding_projection_revisions"."safe_error_code" is null or length(trim("ai_embedding_projection_revisions"."safe_error_code")) between 1 and 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_embedding_projection_revisions_identity_unique` ON `ai_embedding_projection_revisions` (`embedding_projection_set_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_embedding_projection_revisions_current_unique` ON `ai_embedding_projection_revisions` (`embedding_projection_set_id`) WHERE "ai_embedding_projection_revisions"."is_current" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_embedding_projection_revisions_building_identity_unique` ON `ai_embedding_projection_revisions` (`embedding_projection_set_id`,`input_fingerprint`) WHERE "ai_embedding_projection_revisions"."status" = 'BUILDING';--> statement-breakpoint
CREATE INDEX `ai_embedding_projection_revisions_status_index` ON `ai_embedding_projection_revisions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_embedding_projection_revisions_m7a_index` ON `ai_embedding_projection_revisions` (`chunk_projection_revision_id`);--> statement-breakpoint
CREATE TABLE `ai_embedding_projection_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_key` text NOT NULL,
	`chunk_projection_set_id` text NOT NULL,
	`model_config_id` text NOT NULL,
	`vector_codec_key` text NOT NULL,
	`vector_codec_revision` integer NOT NULL,
	`vector_index_adapter_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`chunk_projection_set_id`) REFERENCES `ai_retrieval_projection_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_embedding_projection_sets_subject_valid" CHECK(length(trim("ai_embedding_projection_sets"."subject_key")) between 1 and 120),
	CONSTRAINT "ai_embedding_projection_sets_codec_valid" CHECK(length(trim("ai_embedding_projection_sets"."vector_codec_key")) between 1 and 120 and "ai_embedding_projection_sets"."vector_codec_key" not glob '*[^a-z0-9.-]*' and "ai_embedding_projection_sets"."vector_codec_revision" >= 1),
	CONSTRAINT "ai_embedding_projection_sets_index_key_valid" CHECK(length(trim("ai_embedding_projection_sets"."vector_index_adapter_key")) between 1 and 120 and "ai_embedding_projection_sets"."vector_index_adapter_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_embedding_projection_sets_timestamps_valid" CHECK("ai_embedding_projection_sets"."created_at" >= 0 and "ai_embedding_projection_sets"."updated_at" >= "ai_embedding_projection_sets"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_embedding_projection_sets_identity_unique` ON `ai_embedding_projection_sets` (`chunk_projection_set_id`,`model_config_id`,`vector_codec_key`,`vector_codec_revision`,`vector_index_adapter_key`);--> statement-breakpoint
CREATE INDEX `ai_embedding_projection_sets_subject_index` ON `ai_embedding_projection_sets` (`subject_key`);--> statement-breakpoint
CREATE INDEX `ai_embedding_projection_sets_chunk_set_index` ON `ai_embedding_projection_sets` (`chunk_projection_set_id`);--> statement-breakpoint
CREATE TABLE `ai_embedding_vectors` (
	`embedding_projection_revision_id` text NOT NULL,
	`chunk_projection_revision_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`subject_key` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector_blob` blob NOT NULL,
	`vector_hash` text NOT NULL,
	`norm` real NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`embedding_projection_revision_id`, `chunk_projection_revision_id`, `chunk_id`),
	FOREIGN KEY (`embedding_projection_revision_id`) REFERENCES `ai_embedding_projection_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`chunk_projection_revision_id`,`chunk_id`) REFERENCES `ai_retrieval_chunks`(`projection_revision_id`,`chunk_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_embedding_vectors_dimensions_valid" CHECK("ai_embedding_vectors"."dimensions" between 1 and 16384),
	CONSTRAINT "ai_embedding_vectors_blob_size_valid" CHECK(length("ai_embedding_vectors"."vector_blob") = "ai_embedding_vectors"."dimensions" * 4),
	CONSTRAINT "ai_embedding_vectors_hash_valid" CHECK(length("ai_embedding_vectors"."vector_hash") = 64 and "ai_embedding_vectors"."vector_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_embedding_vectors_norm_valid" CHECK("ai_embedding_vectors"."norm" > 0),
	CONSTRAINT "ai_embedding_vectors_created_nonnegative" CHECK("ai_embedding_vectors"."created_at" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_embedding_vectors_chunk_index` ON `ai_embedding_vectors` (`chunk_projection_revision_id`,`chunk_id`);--> statement-breakpoint
CREATE INDEX `ai_embedding_vectors_subject_index` ON `ai_embedding_vectors` (`subject_key`,`embedding_projection_revision_id`);
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_projection_sets_owner_insert`
BEFORE INSERT ON `ai_embedding_projection_sets`
WHEN NOT EXISTS (
	SELECT 1
	FROM `ai_retrieval_projection_sets` AS chunk_set
	WHERE chunk_set.`id` = NEW.`chunk_projection_set_id`
		AND chunk_set.`subject_key` = NEW.`subject_key`
)
BEGIN
	SELECT RAISE(ABORT, 'Embedding projection set ownership does not match M7A');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_projection_revisions_owner_insert`
BEFORE INSERT ON `ai_embedding_projection_revisions`
WHEN NOT EXISTS (
	SELECT 1
	FROM `ai_embedding_projection_sets` AS embedding_set
	JOIN `ai_retrieval_projection_sets` AS chunk_set
		ON chunk_set.`id` = NEW.`chunk_projection_set_id`
	JOIN `ai_retrieval_projection_revisions` AS chunk_revision
		ON chunk_revision.`id` = NEW.`chunk_projection_revision_id`
	WHERE embedding_set.`id` = NEW.`embedding_projection_set_id`
		AND embedding_set.`subject_key` = NEW.`subject_key`
		AND embedding_set.`chunk_projection_set_id` = NEW.`chunk_projection_set_id`
		AND embedding_set.`model_config_id` = NEW.`model_config_id`
		AND embedding_set.`vector_codec_key` = NEW.`vector_codec_key`
		AND embedding_set.`vector_codec_revision` = NEW.`vector_codec_revision`
		AND embedding_set.`vector_index_adapter_key` = NEW.`vector_index_adapter_key`
		AND chunk_set.`subject_key` = NEW.`subject_key`
		AND chunk_revision.`projection_set_id` = NEW.`chunk_projection_set_id`
)
BEGIN
	SELECT RAISE(ABORT, 'Embedding projection revision ownership does not match M7A');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_projection_revisions_initial_state`
BEFORE INSERT ON `ai_embedding_projection_revisions`
WHEN NEW.`status` <> 'BUILDING'
 OR NEW.`is_current` <> 0
 OR NEW.`source_cursor` IS NULL
 OR json_extract(NEW.`source_cursor`, '$.kind') <> 'START'
 OR NEW.`batch_count` <> 0
 OR NEW.`vector_count` <> 0
 OR NEW.`ready_at` IS NOT NULL
 OR NEW.`failed_at` IS NOT NULL
 OR NEW.`safe_error_code` IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'Embedding projection revisions must start BUILDING');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_projection_sets_identity_no_update`
BEFORE UPDATE ON `ai_embedding_projection_sets`
WHEN NEW.`id` IS NOT OLD.`id`
 OR NEW.`subject_key` IS NOT OLD.`subject_key`
 OR NEW.`chunk_projection_set_id` IS NOT OLD.`chunk_projection_set_id`
 OR NEW.`model_config_id` IS NOT OLD.`model_config_id`
 OR NEW.`vector_codec_key` IS NOT OLD.`vector_codec_key`
 OR NEW.`vector_codec_revision` IS NOT OLD.`vector_codec_revision`
 OR NEW.`vector_index_adapter_key` IS NOT OLD.`vector_index_adapter_key`
 OR NEW.`created_at` IS NOT OLD.`created_at`
 OR NEW.`updated_at` IS NOT OLD.`updated_at`
BEGIN
	SELECT RAISE(ABORT, 'Embedding projection set identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_projection_revisions_identity_no_update`
BEFORE UPDATE ON `ai_embedding_projection_revisions`
WHEN NEW.`id` IS NOT OLD.`id`
 OR NEW.`embedding_projection_set_id` IS NOT OLD.`embedding_projection_set_id`
 OR NEW.`revision` IS NOT OLD.`revision`
 OR NEW.`subject_key` IS NOT OLD.`subject_key`
 OR NEW.`chunk_projection_set_id` IS NOT OLD.`chunk_projection_set_id`
 OR NEW.`chunk_projection_revision_id` IS NOT OLD.`chunk_projection_revision_id`
 OR NEW.`chunk_projection_input_fingerprint` IS NOT OLD.`chunk_projection_input_fingerprint`
 OR NEW.`chunk_count` IS NOT OLD.`chunk_count`
 OR NEW.`model_config_id` IS NOT OLD.`model_config_id`
 OR NEW.`model_config_revision` IS NOT OLD.`model_config_revision`
 OR NEW.`provider_config_id` IS NOT OLD.`provider_config_id`
 OR NEW.`provider_config_revision` IS NOT OLD.`provider_config_revision`
 OR NEW.`provider_model_id` IS NOT OLD.`provider_model_id`
 OR NEW.`embedding_adapter_key` IS NOT OLD.`embedding_adapter_key`
 OR NEW.`dimensions` IS NOT OLD.`dimensions`
 OR NEW.`vector_codec_key` IS NOT OLD.`vector_codec_key`
 OR NEW.`vector_codec_revision` IS NOT OLD.`vector_codec_revision`
 OR NEW.`vector_index_adapter_key` IS NOT OLD.`vector_index_adapter_key`
 OR NEW.`input_fingerprint` IS NOT OLD.`input_fingerprint`
 OR NEW.`job_id` IS NOT OLD.`job_id`
 OR NEW.`cost_operation_id` IS NOT OLD.`cost_operation_id`
 OR NEW.`started_at` IS NOT OLD.`started_at`
BEGIN
	SELECT RAISE(ABORT, 'Embedding projection revision identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_projection_revisions_lifecycle`
BEFORE UPDATE ON `ai_embedding_projection_revisions`
WHEN (OLD.`status` = 'READY' AND NOT (
	NEW.`status` = 'READY'
	AND OLD.`is_current` = 1
	AND NEW.`is_current` = 0
	AND NEW.`source_cursor` IS OLD.`source_cursor`
	AND NEW.`batch_count` = OLD.`batch_count`
	AND NEW.`vector_count` = OLD.`vector_count`
	AND NEW.`updated_at` = OLD.`updated_at`
	AND NEW.`ready_at` IS OLD.`ready_at`
	AND NEW.`failed_at` IS OLD.`failed_at`
	AND NEW.`safe_error_code` IS OLD.`safe_error_code`
))
OR OLD.`status` = 'FAILED'
OR (OLD.`status` = 'BUILDING' AND NOT (
	(
		NEW.`status` = 'BUILDING'
		AND NEW.`is_current` = 0
		AND NEW.`ready_at` IS NULL
		AND NEW.`failed_at` IS NULL
		AND NEW.`safe_error_code` IS NULL
		AND NEW.`batch_count` >= OLD.`batch_count`
		AND NEW.`vector_count` >= OLD.`vector_count`
		AND NEW.`updated_at` >= OLD.`updated_at`
	)
	OR (
		NEW.`status` = 'READY'
		AND NEW.`is_current` = 1
		AND json_extract(NEW.`source_cursor`, '$.kind') = 'DONE'
		AND NEW.`source_cursor` IS OLD.`source_cursor`
		AND NEW.`batch_count` = OLD.`batch_count`
		AND NEW.`vector_count` = OLD.`vector_count`
		AND NEW.`updated_at` >= OLD.`updated_at`
		AND NEW.`ready_at` IS NOT NULL
		AND NEW.`failed_at` IS NULL
		AND NEW.`safe_error_code` IS NULL
		AND NOT EXISTS (
			SELECT 1
			FROM `ai_retrieval_chunks` AS chunk
			LEFT JOIN `ai_embedding_vectors` AS vector
				ON vector.`embedding_projection_revision_id` = NEW.`id`
				AND vector.`chunk_projection_revision_id` = chunk.`projection_revision_id`
				AND vector.`chunk_id` = chunk.`chunk_id`
			WHERE chunk.`projection_revision_id` = NEW.`chunk_projection_revision_id`
				AND vector.`chunk_id` IS NULL
		)
		AND NOT EXISTS (
			SELECT 1
			FROM `ai_embedding_vectors` AS vector
			LEFT JOIN `ai_retrieval_chunks` AS chunk
				ON chunk.`projection_revision_id` = vector.`chunk_projection_revision_id`
				AND chunk.`chunk_id` = vector.`chunk_id`
			WHERE vector.`embedding_projection_revision_id` = NEW.`id`
				AND vector.`chunk_projection_revision_id` = NEW.`chunk_projection_revision_id`
				AND chunk.`chunk_id` IS NULL
		)
	)
	OR (
		NEW.`status` = 'FAILED'
		AND NEW.`is_current` = 0
		AND NEW.`source_cursor` IS OLD.`source_cursor`
		AND NEW.`batch_count` = OLD.`batch_count`
		AND NEW.`vector_count` = OLD.`vector_count`
		AND NEW.`updated_at` >= OLD.`updated_at`
		AND NEW.`ready_at` IS NULL
		AND NEW.`failed_at` IS NOT NULL
		AND NEW.`safe_error_code` IS NOT NULL
	)
))
BEGIN
	SELECT RAISE(ABORT, 'Invalid embedding projection revision lifecycle transition');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_vectors_owner_insert`
BEFORE INSERT ON `ai_embedding_vectors`
WHEN NOT EXISTS (
	SELECT 1
	FROM `ai_embedding_projection_revisions` AS revision
	JOIN `ai_retrieval_chunks` AS chunk
		ON chunk.`projection_revision_id` = NEW.`chunk_projection_revision_id`
		AND chunk.`chunk_id` = NEW.`chunk_id`
	WHERE revision.`id` = NEW.`embedding_projection_revision_id`
		AND revision.`status` = 'BUILDING'
		AND revision.`subject_key` = NEW.`subject_key`
		AND revision.`chunk_projection_revision_id` = NEW.`chunk_projection_revision_id`
		AND revision.`dimensions` = NEW.`dimensions`
		AND chunk.`subject_key` = NEW.`subject_key`
)
BEGIN
	SELECT RAISE(ABORT, 'Embedding vector ownership does not match its projection');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_vectors_no_update`
BEFORE UPDATE ON `ai_embedding_vectors`
BEGIN
	SELECT RAISE(ABORT, 'Embedding vectors are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_embedding_vectors_ready_no_delete`
BEFORE DELETE ON `ai_embedding_vectors`
WHEN EXISTS (
	SELECT 1
	FROM `ai_embedding_projection_revisions` AS revision
	WHERE revision.`id` = OLD.`embedding_projection_revision_id`
		AND revision.`status` = 'READY'
)
BEGIN
	SELECT RAISE(ABORT, 'READY embedding vectors are immutable');
END;
