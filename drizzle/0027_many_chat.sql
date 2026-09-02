ALTER TABLE `ai_retrieval_config_revisions` ADD `fusion_algorithm_key` text DEFAULT 'weighted-rrf-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_retrieval_config_revisions` ADD `fusion_algorithm_revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_configs_initial_revision`
BEFORE INSERT ON `ai_retrieval_configs`
WHEN NEW.`current_revision` <> 1
BEGIN
	SELECT RAISE(ABORT, 'Retrieval Configs must start at revision 1');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_configs_identity_no_update`
BEFORE UPDATE ON `ai_retrieval_configs`
WHEN NEW.`id` IS NOT OLD.`id`
 OR NEW.`key` IS NOT OLD.`key`
 OR NEW.`subject_key` IS NOT OLD.`subject_key`
 OR NEW.`created_at` IS NOT OLD.`created_at`
 OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN
	SELECT RAISE(ABORT, 'Retrieval Config identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_configs_revision_pointer`
BEFORE UPDATE ON `ai_retrieval_configs`
WHEN NOT (
	NEW.`current_revision` IS OLD.`current_revision`
	OR (
		NEW.`current_revision` = OLD.`current_revision` + 1
		AND EXISTS (
			SELECT 1
			FROM `ai_retrieval_config_revisions` AS revision
			WHERE revision.`retrieval_config_id` = OLD.`id`
				AND revision.`revision` = NEW.`current_revision`
		)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'Retrieval Config revisions must advance one step');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_config_revisions_insert_integrity`
BEFORE INSERT ON `ai_retrieval_config_revisions`
WHEN NOT EXISTS (
	SELECT 1
	FROM `ai_retrieval_configs` AS config
	WHERE config.`id` = NEW.`retrieval_config_id`
		AND (
			(NEW.`revision` = 1 AND config.`current_revision` = 1)
			OR NEW.`revision` = config.`current_revision` + 1
		)
)
 OR NOT EXISTS (
	SELECT 1
	FROM `ai_model_configs` AS model
	WHERE model.`id` = NEW.`embedding_model_config_id`
		AND model.`capability` = 'EMBEDDING'
)
 OR (
	NEW.`rerank_model_config_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `ai_model_configs` AS model
		WHERE model.`id` = NEW.`rerank_model_config_id`
			AND model.`capability` = 'RERANK'
	)
)
 OR NEW.`fusion_algorithm_key` IS NOT 'weighted-rrf-v1'
 OR NEW.`fusion_algorithm_revision` IS NOT 1
 OR NOT json_valid(NEW.`allowed_trust_tiers`)
 OR json_type(NEW.`allowed_trust_tiers`) <> 'array'
 OR json_array_length(NEW.`allowed_trust_tiers`) < 1
 OR json_array_length(NEW.`allowed_trust_tiers`) > 4
 OR EXISTS (
	SELECT 1
	FROM json_each(NEW.`allowed_trust_tiers`) AS tier
	WHERE tier.`type` <> 'text'
		OR tier.`value` NOT IN ('OFFICIAL', 'PYTHAGORAS_APPROVED', 'TEACHER_REVIEWED', 'OTHER_APPROVED')
)
 OR (
	SELECT count(*) FROM json_each(NEW.`allowed_trust_tiers`)
) <> (
	SELECT count(DISTINCT tier.`value`) FROM json_each(NEW.`allowed_trust_tiers`) AS tier
)
BEGIN
	SELECT RAISE(ABORT, 'Retrieval Config revision integrity is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_config_revisions_no_update`
BEFORE UPDATE ON `ai_retrieval_config_revisions`
BEGIN
	SELECT RAISE(ABORT, 'Retrieval Config revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_config_revisions_no_delete`
BEFORE DELETE ON `ai_retrieval_config_revisions`
BEGIN
	SELECT RAISE(ABORT, 'Retrieval Config revisions are immutable');
END;
