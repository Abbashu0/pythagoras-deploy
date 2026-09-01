CREATE TABLE `ai_model_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`model_key` text NOT NULL,
	`display_name` text NOT NULL,
	`provider_config_id` text NOT NULL,
	`provider_model_id` text NOT NULL,
	`capability` text NOT NULL,
	`adapter_key` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`context_window_tokens` integer,
	`max_output_tokens` integer,
	`embedding_dimensions` integer,
	`supports_streaming` integer DEFAULT false NOT NULL,
	`supports_reasoning` integer DEFAULT false NOT NULL,
	`supports_structured_output` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_model_configs_key_valid" CHECK(length(trim("ai_model_configs"."model_key")) between 1 and 120 and "ai_model_configs"."model_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_model_configs_display_name_valid" CHECK(length(trim("ai_model_configs"."display_name")) between 1 and 200),
	CONSTRAINT "ai_model_configs_provider_model_id_valid" CHECK(length(trim("ai_model_configs"."provider_model_id")) between 1 and 200),
	CONSTRAINT "ai_model_configs_capability_valid" CHECK("ai_model_configs"."capability" in ('GENERATION','EMBEDDING','RERANK')),
	CONSTRAINT "ai_model_configs_adapter_key_valid" CHECK(length(trim("ai_model_configs"."adapter_key")) between 1 and 120 and "ai_model_configs"."adapter_key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_model_configs_enabled_boolean" CHECK("ai_model_configs"."enabled" in (0,1)),
	CONSTRAINT "ai_model_configs_context_window_positive" CHECK("ai_model_configs"."context_window_tokens" is null or "ai_model_configs"."context_window_tokens" >= 1),
	CONSTRAINT "ai_model_configs_max_output_positive" CHECK("ai_model_configs"."max_output_tokens" is null or "ai_model_configs"."max_output_tokens" >= 1),
	CONSTRAINT "ai_model_configs_embedding_dimensions_positive" CHECK("ai_model_configs"."embedding_dimensions" is null or "ai_model_configs"."embedding_dimensions" >= 1),
	CONSTRAINT "ai_model_configs_generation_limits_ordered" CHECK("ai_model_configs"."context_window_tokens" is null or "ai_model_configs"."max_output_tokens" is null or "ai_model_configs"."max_output_tokens" <= "ai_model_configs"."context_window_tokens"),
	CONSTRAINT "ai_model_configs_capability_fields_valid" CHECK((
        ("ai_model_configs"."capability" = 'GENERATION') or
        ("ai_model_configs"."context_window_tokens" is null and "ai_model_configs"."max_output_tokens" is null and "ai_model_configs"."supports_streaming" = 0 and "ai_model_configs"."supports_reasoning" = 0 and "ai_model_configs"."supports_structured_output" = 0)
      ) and (
        ("ai_model_configs"."capability" = 'EMBEDDING') or "ai_model_configs"."embedding_dimensions" is null
      )),
	CONSTRAINT "ai_model_configs_streaming_boolean" CHECK("ai_model_configs"."supports_streaming" in (0,1)),
	CONSTRAINT "ai_model_configs_reasoning_boolean" CHECK("ai_model_configs"."supports_reasoning" in (0,1)),
	CONSTRAINT "ai_model_configs_structured_output_boolean" CHECK("ai_model_configs"."supports_structured_output" in (0,1)),
	CONSTRAINT "ai_model_configs_revision_positive" CHECK("ai_model_configs"."revision" >= 1),
	CONSTRAINT "ai_model_configs_timestamps_ordered" CHECK("ai_model_configs"."updated_at" >= "ai_model_configs"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_model_configs_key_unique` ON `ai_model_configs` (`model_key`);--> statement-breakpoint
CREATE INDEX `ai_model_configs_provider_index` ON `ai_model_configs` (`provider_config_id`);--> statement-breakpoint
CREATE INDEX `ai_model_configs_capability_index` ON `ai_model_configs` (`capability`);--> statement-breakpoint
CREATE INDEX `ai_model_configs_enabled_index` ON `ai_model_configs` (`enabled`);--> statement-breakpoint
CREATE INDEX `ai_model_configs_adapter_index` ON `ai_model_configs` (`adapter_key`);