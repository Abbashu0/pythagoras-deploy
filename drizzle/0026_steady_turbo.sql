CREATE TABLE `ai_retrieval_config_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`retrieval_config_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`embedding_model_config_id` text NOT NULL,
	`rerank_model_config_id` text,
	`lexical_candidate_limit` integer NOT NULL,
	`semantic_candidate_limit` integer NOT NULL,
	`fusion_candidate_limit` integer NOT NULL,
	`rerank_candidate_limit` integer NOT NULL,
	`evidence_item_limit` integer NOT NULL,
	`rrf_constant` integer NOT NULL,
	`lexical_weight_units` integer NOT NULL,
	`semantic_weight_units` integer NOT NULL,
	`minimum_fused_score_units` integer NOT NULL,
	`minimum_evidence_item_count` integer NOT NULL,
	`maximum_evidence_pack_bytes` integer NOT NULL,
	`max_evidence_chunks_per_source_item` integer NOT NULL,
	`allowed_trust_tiers` text NOT NULL,
	`semantic_failure_behavior` text NOT NULL,
	`reranker_failure_behavior` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`retrieval_config_id`) REFERENCES `ai_retrieval_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`embedding_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rerank_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_retrieval_config_revisions_revision_positive" CHECK("ai_retrieval_config_revisions"."revision" >= 1),
	CONSTRAINT "ai_retrieval_config_revisions_display_name_valid" CHECK(length(trim("ai_retrieval_config_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_retrieval_config_revisions_enabled_boolean" CHECK("ai_retrieval_config_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_retrieval_config_revisions_candidate_limits_valid" CHECK("ai_retrieval_config_revisions"."lexical_candidate_limit" between 1 and 50 and "ai_retrieval_config_revisions"."semantic_candidate_limit" between 1 and 50 and "ai_retrieval_config_revisions"."fusion_candidate_limit" between 1 and 100 and "ai_retrieval_config_revisions"."rerank_candidate_limit" between 1 and 50 and "ai_retrieval_config_revisions"."evidence_item_limit" between 1 and 50 and "ai_retrieval_config_revisions"."fusion_candidate_limit" <= "ai_retrieval_config_revisions"."lexical_candidate_limit" + "ai_retrieval_config_revisions"."semantic_candidate_limit" and "ai_retrieval_config_revisions"."rerank_candidate_limit" <= "ai_retrieval_config_revisions"."fusion_candidate_limit" and "ai_retrieval_config_revisions"."evidence_item_limit" <= "ai_retrieval_config_revisions"."rerank_candidate_limit"),
	CONSTRAINT "ai_retrieval_config_revisions_fusion_values_valid" CHECK("ai_retrieval_config_revisions"."rrf_constant" between 1 and 10000 and "ai_retrieval_config_revisions"."lexical_weight_units" between 1 and 10000 and "ai_retrieval_config_revisions"."semantic_weight_units" between 1 and 10000 and "ai_retrieval_config_revisions"."minimum_fused_score_units" between 0 and 9007199254740991),
	CONSTRAINT "ai_retrieval_config_revisions_evidence_values_valid" CHECK("ai_retrieval_config_revisions"."minimum_evidence_item_count" between 0 and "ai_retrieval_config_revisions"."evidence_item_limit" and "ai_retrieval_config_revisions"."maximum_evidence_pack_bytes" between 1 and 65536 and "ai_retrieval_config_revisions"."max_evidence_chunks_per_source_item" between 1 and 20),
	CONSTRAINT "ai_retrieval_config_revisions_trust_tiers_valid" CHECK(json_valid("ai_retrieval_config_revisions"."allowed_trust_tiers") and json_type("ai_retrieval_config_revisions"."allowed_trust_tiers") = 'array' and json_array_length("ai_retrieval_config_revisions"."allowed_trust_tiers") between 1 and 4),
	CONSTRAINT "ai_retrieval_config_revisions_semantic_failure_valid" CHECK("ai_retrieval_config_revisions"."semantic_failure_behavior" in ('LEXICAL_ONLY','FAIL_RETRIEVAL')),
	CONSTRAINT "ai_retrieval_config_revisions_reranker_failure_valid" CHECK("ai_retrieval_config_revisions"."reranker_failure_behavior" in ('USE_FUSION','FAIL_RETRIEVAL')),
	CONSTRAINT "ai_retrieval_config_revisions_created_nonnegative" CHECK("ai_retrieval_config_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_config_revisions_identity_unique` ON `ai_retrieval_config_revisions` (`retrieval_config_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_retrieval_config_revisions_config_index` ON `ai_retrieval_config_revisions` (`retrieval_config_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_retrieval_config_revisions_enabled_index` ON `ai_retrieval_config_revisions` (`enabled`);--> statement-breakpoint
CREATE TABLE `ai_retrieval_configs` (
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
	CONSTRAINT "ai_retrieval_configs_key_valid" CHECK(length(trim("ai_retrieval_configs"."key")) between 1 and 120 and "ai_retrieval_configs"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_retrieval_configs_subject_valid" CHECK(length(trim("ai_retrieval_configs"."subject_key")) between 1 and 80 and "ai_retrieval_configs"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_retrieval_configs_revision_positive" CHECK("ai_retrieval_configs"."current_revision" >= 1),
	CONSTRAINT "ai_retrieval_configs_created_nonnegative" CHECK("ai_retrieval_configs"."created_at" >= 0),
	CONSTRAINT "ai_retrieval_configs_timestamps_ordered" CHECK("ai_retrieval_configs"."updated_at" >= "ai_retrieval_configs"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_configs_key_unique` ON `ai_retrieval_configs` (`key`);--> statement-breakpoint
CREATE INDEX `ai_retrieval_configs_subject_index` ON `ai_retrieval_configs` (`subject_key`);