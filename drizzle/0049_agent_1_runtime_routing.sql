CREATE TABLE `ai_agent_runtime_configs` (
	`config_key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`primary_model_config_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`primary_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_agent_runtime_configs_singleton_key" CHECK("ai_agent_runtime_configs"."config_key" = 'agent-1'),
	CONSTRAINT "ai_agent_runtime_configs_enabled_boolean" CHECK("ai_agent_runtime_configs"."enabled" in (0,1)),
	CONSTRAINT "ai_agent_runtime_configs_revision_positive" CHECK("ai_agent_runtime_configs"."revision" >= 1),
	CONSTRAINT "ai_agent_runtime_configs_created_nonnegative" CHECK("ai_agent_runtime_configs"."created_at" >= 0),
	CONSTRAINT "ai_agent_runtime_configs_timestamps_ordered" CHECK("ai_agent_runtime_configs"."updated_at" >= "ai_agent_runtime_configs"."created_at")
);
--> statement-breakpoint
CREATE INDEX `ai_agent_runtime_configs_primary_model_index` ON `ai_agent_runtime_configs` (`primary_model_config_id`);--> statement-breakpoint
CREATE TABLE `ai_agent_runtime_fallback_models` (
	`config_key` text NOT NULL,
	`model_config_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`config_key`, `position`),
	FOREIGN KEY (`config_key`) REFERENCES `ai_agent_runtime_configs`(`config_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_agent_runtime_fallback_position_valid" CHECK("ai_agent_runtime_fallback_models"."position" between 1 and 3),
	CONSTRAINT "ai_agent_runtime_fallback_created_nonnegative" CHECK("ai_agent_runtime_fallback_models"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_agent_runtime_fallback_model_unique` ON `ai_agent_runtime_fallback_models` (`config_key`,`model_config_id`);--> statement-breakpoint
CREATE INDEX `ai_agent_runtime_fallback_model_index` ON `ai_agent_runtime_fallback_models` (`model_config_id`);--> statement-breakpoint

CREATE TRIGGER `ai_agent_runtime_primary_generation_insert`
BEFORE INSERT ON `ai_agent_runtime_configs`
WHEN NEW.`primary_model_config_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `ai_model_configs`
    WHERE `id` = NEW.`primary_model_config_id` AND `capability` = 'GENERATION'
  )
BEGIN
  SELECT RAISE(ABORT, 'Agent 1 primary model must have GENERATION capability');
END;--> statement-breakpoint

CREATE TRIGGER `ai_agent_runtime_primary_generation_update`
BEFORE UPDATE OF `primary_model_config_id` ON `ai_agent_runtime_configs`
WHEN NEW.`primary_model_config_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `ai_model_configs`
    WHERE `id` = NEW.`primary_model_config_id` AND `capability` = 'GENERATION'
  )
BEGIN
  SELECT RAISE(ABORT, 'Agent 1 primary model must have GENERATION capability');
END;--> statement-breakpoint

CREATE TRIGGER `ai_agent_runtime_enabled_primary_insert`
BEFORE INSERT ON `ai_agent_runtime_configs`
WHEN NEW.`enabled` = 1 AND NEW.`primary_model_config_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Enabled Agent 1 requires a primary model');
END;--> statement-breakpoint

CREATE TRIGGER `ai_agent_runtime_enabled_primary_update`
BEFORE UPDATE OF `enabled`, `primary_model_config_id` ON `ai_agent_runtime_configs`
WHEN NEW.`enabled` = 1 AND NEW.`primary_model_config_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Enabled Agent 1 requires a primary model');
END;--> statement-breakpoint

CREATE TRIGGER `ai_agent_runtime_primary_not_fallback_update`
BEFORE UPDATE OF `primary_model_config_id` ON `ai_agent_runtime_configs`
WHEN NEW.`primary_model_config_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `ai_agent_runtime_fallback_models`
    WHERE `config_key` = NEW.`config_key`
      AND `model_config_id` = NEW.`primary_model_config_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'Agent 1 primary model cannot also be a fallback');
END;--> statement-breakpoint

CREATE TRIGGER `ai_agent_runtime_fallback_generation_insert`
BEFORE INSERT ON `ai_agent_runtime_fallback_models`
WHEN NOT EXISTS (
    SELECT 1 FROM `ai_model_configs`
    WHERE `id` = NEW.`model_config_id` AND `capability` = 'GENERATION'
  )
  OR (SELECT `primary_model_config_id` FROM `ai_agent_runtime_configs`
      WHERE `config_key` = NEW.`config_key`) = NEW.`model_config_id`
BEGIN
  SELECT RAISE(ABORT, 'Agent 1 fallback must be a distinct GENERATION model');
END;--> statement-breakpoint

CREATE TRIGGER `ai_agent_runtime_fallback_generation_update`
BEFORE UPDATE OF `config_key`, `model_config_id` ON `ai_agent_runtime_fallback_models`
WHEN NOT EXISTS (
    SELECT 1 FROM `ai_model_configs`
    WHERE `id` = NEW.`model_config_id` AND `capability` = 'GENERATION'
  )
  OR (SELECT `primary_model_config_id` FROM `ai_agent_runtime_configs`
      WHERE `config_key` = NEW.`config_key`) = NEW.`model_config_id`
BEGIN
  SELECT RAISE(ABORT, 'Agent 1 fallback must be a distinct GENERATION model');
END;--> statement-breakpoint

CREATE TRIGGER `ai_agent_runtime_model_capability_update`
BEFORE UPDATE OF `capability` ON `ai_model_configs`
WHEN NEW.`capability` <> 'GENERATION'
  AND (
    EXISTS (SELECT 1 FROM `ai_agent_runtime_configs`
      WHERE `primary_model_config_id` = NEW.`id`)
    OR EXISTS (SELECT 1 FROM `ai_agent_runtime_fallback_models`
      WHERE `model_config_id` = NEW.`id`)
  )
BEGIN
  SELECT RAISE(ABORT, 'Model is referenced by Agent 1 and must remain GENERATION');
END;
