CREATE UNIQUE INDEX `ai_retrieval_projection_revisions_building_identity_unique` ON `ai_retrieval_projection_revisions` (`projection_set_id`,`input_fingerprint`,`strategy_key`,`strategy_revision`,`normalizer_key`,`normalizer_revision`) WHERE "ai_retrieval_projection_revisions"."status" = 'BUILDING';
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_projection_sets_identity_no_update`
BEFORE UPDATE ON `ai_retrieval_projection_sets`
WHEN NEW.`id` IS NOT OLD.`id`
 OR NEW.`subject_key` IS NOT OLD.`subject_key`
 OR NEW.`origin_kind` IS NOT OLD.`origin_kind`
 OR NEW.`origin_id` IS NOT OLD.`origin_id`
 OR NEW.`strategy_key` IS NOT OLD.`strategy_key`
 OR NEW.`normalizer_key` IS NOT OLD.`normalizer_key`
 OR NEW.`created_at` IS NOT OLD.`created_at`
 OR NEW.`updated_at` IS NOT OLD.`updated_at`
BEGIN
	SELECT RAISE(ABORT, 'Retrieval projection set identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_projection_revisions_identity_no_update`
BEFORE UPDATE ON `ai_retrieval_projection_revisions`
WHEN NEW.`id` IS NOT OLD.`id`
 OR NEW.`projection_set_id` IS NOT OLD.`projection_set_id`
 OR NEW.`revision` IS NOT OLD.`revision`
 OR NEW.`input_fingerprint` IS NOT OLD.`input_fingerprint`
 OR NEW.`strategy_key` IS NOT OLD.`strategy_key`
 OR NEW.`strategy_revision` IS NOT OLD.`strategy_revision`
 OR NEW.`normalizer_key` IS NOT OLD.`normalizer_key`
 OR NEW.`normalizer_revision` IS NOT OLD.`normalizer_revision`
 OR NEW.`started_at` IS NOT OLD.`started_at`
BEGIN
	SELECT RAISE(ABORT, 'Retrieval projection revision identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_projection_revisions_lifecycle`
BEFORE UPDATE ON `ai_retrieval_projection_revisions`
WHEN (OLD.`status` = 'READY' AND NOT (
	NEW.`status` = 'READY'
	AND OLD.`is_current` = 1
	AND NEW.`is_current` = 0
	AND NEW.`source_cursor` IS OLD.`source_cursor`
	AND NEW.`batch_count` = OLD.`batch_count`
	AND NEW.`chunk_count` = OLD.`chunk_count`
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
		AND NEW.`chunk_count` >= OLD.`chunk_count`
		AND NEW.`updated_at` >= OLD.`updated_at`
	)
	OR (
		NEW.`status` = 'READY'
		AND NEW.`is_current` = 1
		AND json_extract(NEW.`source_cursor`, '$.kind') = 'DONE'
		AND NEW.`source_cursor` IS OLD.`source_cursor`
		AND NEW.`batch_count` = OLD.`batch_count`
		AND NEW.`chunk_count` = OLD.`chunk_count`
		AND NEW.`updated_at` >= OLD.`updated_at`
		AND NEW.`ready_at` IS NOT NULL
		AND NEW.`failed_at` IS NULL
		AND NEW.`safe_error_code` IS NULL
	)
	OR (
		NEW.`status` = 'FAILED'
		AND NEW.`is_current` = 0
		AND NEW.`source_cursor` IS OLD.`source_cursor`
		AND NEW.`batch_count` = OLD.`batch_count`
		AND NEW.`chunk_count` = OLD.`chunk_count`
		AND NEW.`updated_at` >= OLD.`updated_at`
		AND NEW.`ready_at` IS NULL
		AND NEW.`failed_at` IS NOT NULL
		AND NEW.`safe_error_code` IS NOT NULL
	)
))
BEGIN
	SELECT RAISE(ABORT, 'Invalid retrieval projection revision lifecycle transition');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_chunks_owner_insert`
BEFORE INSERT ON `ai_retrieval_chunks`
WHEN NOT EXISTS (
	SELECT 1
	FROM `ai_retrieval_projection_revisions` AS revision
	JOIN `ai_retrieval_projection_sets` AS projection_set
		ON projection_set.`id` = revision.`projection_set_id`
	WHERE revision.`id` = NEW.`projection_revision_id`
		AND projection_set.`subject_key` = NEW.`subject_key`
		AND projection_set.`origin_kind` = NEW.`origin_kind`
		AND projection_set.`origin_id` = NEW.`origin_id`
		AND revision.`strategy_key` = NEW.`strategy_key`
		AND revision.`strategy_revision` = NEW.`strategy_revision`
		AND revision.`normalizer_key` = NEW.`normalizer_key`
		AND revision.`normalizer_revision` = NEW.`normalizer_revision`
)
BEGIN
	SELECT RAISE(ABORT, 'Retrieval chunk ownership does not match its projection');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_chunks_no_update`
BEFORE UPDATE ON `ai_retrieval_chunks`
BEGIN
	SELECT RAISE(ABORT, 'Retrieval chunks are immutable');
END;
