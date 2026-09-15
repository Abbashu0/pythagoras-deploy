ALTER TABLE `ai_provider_configs`
  ADD COLUMN `api_format` text NOT NULL DEFAULT 'OPENAI_CHAT_COMPLETIONS';--> statement-breakpoint
ALTER TABLE `ai_model_configs`
  ADD COLUMN `input_modalities` text NOT NULL DEFAULT '["TEXT"]';--> statement-breakpoint
ALTER TABLE `ai_model_configs`
  ADD COLUMN `output_modalities` text NOT NULL DEFAULT '["TEXT"]';--> statement-breakpoint

CREATE TRIGGER `ai_provider_configs_api_format_insert_valid`
BEFORE INSERT ON `ai_provider_configs`
WHEN NEW.`api_format` NOT IN ('OPENAI_CHAT_COMPLETIONS','OPENAI_RESPONSES','ANTHROPIC_MESSAGES')
BEGIN
  SELECT RAISE(ABORT, 'AI Provider API format is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `ai_provider_configs_api_format_update_valid`
BEFORE UPDATE OF `api_format` ON `ai_provider_configs`
WHEN NEW.`api_format` NOT IN ('OPENAI_CHAT_COMPLETIONS','OPENAI_RESPONSES','ANTHROPIC_MESSAGES')
BEGIN
  SELECT RAISE(ABORT, 'AI Provider API format is invalid');
END;--> statement-breakpoint

CREATE TRIGGER `ai_model_configs_modalities_insert_valid`
BEFORE INSERT ON `ai_model_configs`
WHEN NOT (
  json_valid(NEW.`input_modalities`)
  AND json_type(NEW.`input_modalities`) = 'array'
  AND json_array_length(NEW.`input_modalities`) BETWEEN 1 AND 4
  AND EXISTS (SELECT 1 FROM json_each(NEW.`input_modalities`) WHERE value = 'TEXT')
  AND NOT EXISTS (SELECT 1 FROM json_each(NEW.`input_modalities`) WHERE type IS NOT 'text' OR value NOT IN ('TEXT','IMAGE','VIDEO','PDF'))
  AND (SELECT count(*) FROM json_each(NEW.`input_modalities`)) = (SELECT count(DISTINCT value) FROM json_each(NEW.`input_modalities`))
  AND json_valid(NEW.`output_modalities`)
  AND json_type(NEW.`output_modalities`) = 'array'
  AND json_array_length(NEW.`output_modalities`) = 1
  AND json_extract(NEW.`output_modalities`, '$[0]') = 'TEXT'
)
BEGIN
  SELECT RAISE(ABORT, 'AI Model modalities are invalid');
END;--> statement-breakpoint
CREATE TRIGGER `ai_model_configs_modalities_update_valid`
BEFORE UPDATE OF `input_modalities`, `output_modalities` ON `ai_model_configs`
WHEN NOT (
  json_valid(NEW.`input_modalities`)
  AND json_type(NEW.`input_modalities`) = 'array'
  AND json_array_length(NEW.`input_modalities`) BETWEEN 1 AND 4
  AND EXISTS (SELECT 1 FROM json_each(NEW.`input_modalities`) WHERE value = 'TEXT')
  AND NOT EXISTS (SELECT 1 FROM json_each(NEW.`input_modalities`) WHERE type IS NOT 'text' OR value NOT IN ('TEXT','IMAGE','VIDEO','PDF'))
  AND (SELECT count(*) FROM json_each(NEW.`input_modalities`)) = (SELECT count(DISTINCT value) FROM json_each(NEW.`input_modalities`))
  AND json_valid(NEW.`output_modalities`)
  AND json_type(NEW.`output_modalities`) = 'array'
  AND json_array_length(NEW.`output_modalities`) = 1
  AND json_extract(NEW.`output_modalities`, '$[0]') = 'TEXT'
)
BEGIN
  SELECT RAISE(ABORT, 'AI Model modalities are invalid');
END;
