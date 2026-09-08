ALTER TABLE `ai_tutor_config_revisions`
ADD COLUMN `fallback_generation_model_config_ids` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_config_revisions_fallback_models_insert_valid`
BEFORE INSERT ON `ai_tutor_config_revisions`
WHEN NOT (
  json_valid(NEW.`fallback_generation_model_config_ids`)
  AND json_type(NEW.`fallback_generation_model_config_ids`) = 'array'
  AND json_array_length(NEW.`fallback_generation_model_config_ids`) BETWEEN 0 AND 3
)
BEGIN
  SELECT RAISE(ABORT, 'AI Tutor fallback Models must be a bounded JSON array');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_config_revisions_fallback_models_update_valid`
BEFORE UPDATE OF `fallback_generation_model_config_ids` ON `ai_tutor_config_revisions`
WHEN NOT (
  json_valid(NEW.`fallback_generation_model_config_ids`)
  AND json_type(NEW.`fallback_generation_model_config_ids`) = 'array'
  AND json_array_length(NEW.`fallback_generation_model_config_ids`) BETWEEN 0 AND 3
)
BEGIN
  SELECT RAISE(ABORT, 'AI Tutor fallback Models must be a bounded JSON array');
END;
