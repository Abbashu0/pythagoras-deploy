CREATE TABLE `ai_analytics_principals` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_ref` text NOT NULL,
	`state` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ai_analytics_principals_id_valid" CHECK(length(trim("ai_analytics_principals"."id")) between 1 and 240 and "ai_analytics_principals"."id" not glob '*[^A-Za-z0-9._:-]*'),
	CONSTRAINT "ai_analytics_principals_principal_valid" CHECK(length(trim("ai_analytics_principals"."principal_ref")) between 1 and 200 and "ai_analytics_principals"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_analytics_principals_state_valid" CHECK("ai_analytics_principals"."state" in ('ACTIVE','PURGING')),
	CONSTRAINT "ai_analytics_principals_timestamps_valid" CHECK("ai_analytics_principals"."created_at" >= 0 and "ai_analytics_principals"."updated_at" >= "ai_analytics_principals"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_analytics_principals_principal_unique` ON `ai_analytics_principals` (`principal_ref`);--> statement-breakpoint
CREATE TABLE `ai_feedback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`feedback_type` text NOT NULL,
	`reason_code` text,
	`source_surface` text NOT NULL,
	`response_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`response_trace_id` text,
	`analytics_principal_id` text NOT NULL,
	`subject_key` text NOT NULL,
	`privacy_class` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_trace_id`) REFERENCES `ai_tutor_response_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`analytics_principal_id`) REFERENCES `ai_analytics_principals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_feedback_events_id_valid" CHECK(length(trim("ai_feedback_events"."id")) between 1 and 240 and "ai_feedback_events"."id" not glob '*[^A-Za-z0-9._:-]*'),
	CONSTRAINT "ai_feedback_events_dedupe_valid" CHECK(length(trim("ai_feedback_events"."dedupe_key")) between 1 and 240 and "ai_feedback_events"."dedupe_key" not glob '*[^A-Za-z0-9._:-]*'),
	CONSTRAINT "ai_feedback_events_type_valid" CHECK("ai_feedback_events"."feedback_type" in ('POSITIVE','NEGATIVE','REPORT')),
	CONSTRAINT "ai_feedback_events_reason_valid" CHECK("ai_feedback_events"."reason_code" is null or "ai_feedback_events"."reason_code" in ('HELPFUL','NOT_HELPFUL','INCORRECT','MISSING_EVIDENCE','UNSAFE','OTHER')),
	CONSTRAINT "ai_feedback_events_surface_valid" CHECK("ai_feedback_events"."source_surface" in ('TUTOR','INTERNAL') and "ai_feedback_events"."privacy_class" = 'DEIDENTIFIED_METADATA'),
	CONSTRAINT "ai_feedback_events_time_valid" CHECK("ai_feedback_events"."occurred_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_feedback_events_dedupe_unique` ON `ai_feedback_events` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_feedback_events_response_type_unique` ON `ai_feedback_events` (`response_id`,`analytics_principal_id`,`feedback_type`);--> statement-breakpoint
CREATE INDEX `ai_feedback_events_principal_time_index` ON `ai_feedback_events` (`analytics_principal_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `ai_retrieval_trace_items` (
	`trace_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`chunk_id` text NOT NULL,
	`origin_kind` text NOT NULL,
	`origin_id` text NOT NULL,
	`m7a_projection_revision_id` text NOT NULL,
	`m7b_embedding_projection_revision_id` text,
	`lexical_rank` integer,
	`semantic_rank` integer,
	`cosine_similarity_units` integer,
	`fusion_score_units` integer NOT NULL,
	`rerank_rank` integer,
	`rerank_score_units` integer,
	PRIMARY KEY(`trace_id`, `ordinal`),
	FOREIGN KEY (`trace_id`) REFERENCES `ai_retrieval_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_retrieval_trace_items_ordinal_valid" CHECK("ai_retrieval_trace_items"."ordinal" between 1 and 50),
	CONSTRAINT "ai_retrieval_trace_items_id_valid" CHECK(length(trim("ai_retrieval_trace_items"."chunk_id")) between 1 and 240 and length(trim("ai_retrieval_trace_items"."origin_id")) between 1 and 240 and length(trim("ai_retrieval_trace_items"."m7a_projection_revision_id")) between 1 and 240 and ("ai_retrieval_trace_items"."m7b_embedding_projection_revision_id" is null or length(trim("ai_retrieval_trace_items"."m7b_embedding_projection_revision_id")) between 1 and 240)),
	CONSTRAINT "ai_retrieval_trace_items_kind_valid" CHECK("ai_retrieval_trace_items"."origin_kind" in ('KNOWLEDGE_PACKAGE','QUESTION_PACKAGE')),
	CONSTRAINT "ai_retrieval_trace_items_rank_valid" CHECK(("ai_retrieval_trace_items"."lexical_rank" is null or "ai_retrieval_trace_items"."lexical_rank" between 1 and 1000000) and ("ai_retrieval_trace_items"."semantic_rank" is null or "ai_retrieval_trace_items"."semantic_rank" between 1 and 1000000) and ("ai_retrieval_trace_items"."rerank_rank" is null or "ai_retrieval_trace_items"."rerank_rank" between 1 and 1000000)),
	CONSTRAINT "ai_retrieval_trace_items_score_valid" CHECK("ai_retrieval_trace_items"."fusion_score_units" between 0 and 1000000000 and ("ai_retrieval_trace_items"."cosine_similarity_units" is null or "ai_retrieval_trace_items"."cosine_similarity_units" between -1000000 and 1000000) and ("ai_retrieval_trace_items"."rerank_score_units" is null or "ai_retrieval_trace_items"."rerank_score_units" between -1000000 and 1000000))
);
--> statement-breakpoint
CREATE TABLE `ai_retrieval_trace_origins` (
	`trace_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`origin_kind` text NOT NULL,
	`origin_id` text NOT NULL,
	`subject_key` text NOT NULL,
	`projection_set_id` text,
	`projection_revision_id` text,
	PRIMARY KEY(`trace_id`, `ordinal`),
	FOREIGN KEY (`trace_id`) REFERENCES `ai_retrieval_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_retrieval_trace_origins_ordinal_valid" CHECK("ai_retrieval_trace_origins"."ordinal" between 1 and 100),
	CONSTRAINT "ai_retrieval_trace_origins_kind_valid" CHECK("ai_retrieval_trace_origins"."origin_kind" in ('KNOWLEDGE_PACKAGE','QUESTION_PACKAGE')),
	CONSTRAINT "ai_retrieval_trace_origins_id_valid" CHECK(length(trim("ai_retrieval_trace_origins"."origin_id")) between 1 and 240),
	CONSTRAINT "ai_retrieval_trace_origins_projection_pair_valid" CHECK(("ai_retrieval_trace_origins"."projection_set_id" is null and "ai_retrieval_trace_origins"."projection_revision_id" is null) or ("ai_retrieval_trace_origins"."projection_set_id" is not null and "ai_retrieval_trace_origins"."projection_revision_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_trace_origins_identity_unique` ON `ai_retrieval_trace_origins` (`trace_id`,`origin_kind`,`origin_id`);--> statement-breakpoint
CREATE TABLE `ai_retrieval_trace_projections` (
	`trace_id` text NOT NULL,
	`projection_kind` text NOT NULL,
	`ordinal` integer NOT NULL,
	`projection_revision_id` text NOT NULL,
	`projection_set_id` text,
	`origin_kind` text,
	`origin_id` text,
	PRIMARY KEY(`trace_id`, `projection_kind`, `ordinal`),
	FOREIGN KEY (`trace_id`) REFERENCES `ai_retrieval_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_retrieval_trace_projections_kind_valid" CHECK("ai_retrieval_trace_projections"."projection_kind" in ('M7A','M7B')),
	CONSTRAINT "ai_retrieval_trace_projections_ordinal_valid" CHECK("ai_retrieval_trace_projections"."ordinal" between 1 and 200),
	CONSTRAINT "ai_retrieval_trace_projections_id_valid" CHECK(length(trim("ai_retrieval_trace_projections"."projection_revision_id")) between 1 and 240),
	CONSTRAINT "ai_retrieval_trace_projections_origin_valid" CHECK(("ai_retrieval_trace_projections"."origin_kind" is null and "ai_retrieval_trace_projections"."origin_id" is null) or ("ai_retrieval_trace_projections"."origin_kind" is not null and "ai_retrieval_trace_projections"."origin_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_trace_projections_identity_unique` ON `ai_retrieval_trace_projections` (`trace_id`,`projection_kind`,`projection_revision_id`);--> statement-breakpoint
CREATE TABLE `ai_retrieval_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`retrieval_request_id` text NOT NULL,
	`analytics_principal_id` text,
	`subject_key` text NOT NULL,
	`conversation_id` text,
	`response_id` text,
	`response_trace_id` text,
	`cost_operation_id` text,
	`retrieval_config_id` text NOT NULL,
	`retrieval_config_revision` integer NOT NULL,
	`fusion_algorithm_key` text NOT NULL,
	`fusion_algorithm_revision` integer NOT NULL,
	`embedding_model_config_id` text,
	`embedding_model_config_revision` integer,
	`embedding_provider_config_id` text,
	`embedding_provider_config_revision` integer,
	`rerank_model_config_id` text,
	`rerank_model_config_revision` integer,
	`rerank_provider_config_id` text,
	`rerank_provider_config_revision` integer,
	`mode` text NOT NULL,
	`degraded` integer NOT NULL,
	`sufficient` integer NOT NULL,
	`status` text NOT NULL,
	`safe_reason` text,
	`lexical_candidate_count` integer NOT NULL,
	`semantic_candidate_count` integer NOT NULL,
	`fused_candidate_count` integer NOT NULL,
	`reranked_candidate_count` integer NOT NULL,
	`evidence_item_count` integer NOT NULL,
	`eligible_origin_count` integer NOT NULL,
	`retrieval_latency_ms` integer NOT NULL,
	`query_embedding_latency_ms` integer,
	`rerank_latency_ms` integer,
	`reranker_used` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`analytics_principal_id`) REFERENCES `ai_analytics_principals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_trace_id`) REFERENCES `ai_tutor_response_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retrieval_config_id`) REFERENCES `ai_retrieval_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`embedding_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`embedding_provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rerank_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rerank_provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_retrieval_traces_id_valid" CHECK(length(trim("ai_retrieval_traces"."id")) between 1 and 240 and "ai_retrieval_traces"."id" not glob '*[^A-Za-z0-9._:-]*'),
	CONSTRAINT "ai_retrieval_traces_request_valid" CHECK(length(trim("ai_retrieval_traces"."retrieval_request_id")) between 1 and 240 and "ai_retrieval_traces"."retrieval_request_id" not glob '*[^A-Za-z0-9._:-]*'),
	CONSTRAINT "ai_retrieval_traces_revision_valid" CHECK("ai_retrieval_traces"."retrieval_config_revision" >= 1 and "ai_retrieval_traces"."fusion_algorithm_revision" >= 1),
	CONSTRAINT "ai_retrieval_traces_algorithm_valid" CHECK("ai_retrieval_traces"."fusion_algorithm_key" = 'weighted-rrf-v1' and "ai_retrieval_traces"."fusion_algorithm_revision" = 1),
	CONSTRAINT "ai_retrieval_traces_mode_valid" CHECK("ai_retrieval_traces"."mode" in ('HYBRID','LEXICAL_ONLY') and "ai_retrieval_traces"."status" in ('SUFFICIENT','INSUFFICIENT') and "ai_retrieval_traces"."sufficient" in (0,1) and "ai_retrieval_traces"."degraded" in (0,1) and "ai_retrieval_traces"."reranker_used" in (0,1)),
	CONSTRAINT "ai_retrieval_traces_reason_valid" CHECK("ai_retrieval_traces"."safe_reason" is null or "ai_retrieval_traces"."safe_reason" in ('NO_CANDIDATES','PROJECTION_NOT_READY','SEMANTIC_COVERAGE_INCOMPLETE','QUERY_EMBEDDING_FAILED','RERANK_FAILED','BELOW_MINIMUM_EVIDENCE','RETRIEVAL_CONFIG_CHANGED','SOURCE_INELIGIBLE','PROJECTION_CHANGED','MODEL_SPACE_CHANGED','EXECUTION_CONTEXT_INVALID','RETRIEVAL_SCOPE_CHANGED')),
	CONSTRAINT "ai_retrieval_traces_counts_valid" CHECK("ai_retrieval_traces"."lexical_candidate_count" between 0 and 1000000 and "ai_retrieval_traces"."semantic_candidate_count" between 0 and 1000000 and "ai_retrieval_traces"."fused_candidate_count" between 0 and 1000000 and "ai_retrieval_traces"."reranked_candidate_count" between 0 and 1000000 and "ai_retrieval_traces"."evidence_item_count" between 0 and 50 and "ai_retrieval_traces"."eligible_origin_count" between 0 and 100),
	CONSTRAINT "ai_retrieval_traces_latency_valid" CHECK("ai_retrieval_traces"."retrieval_latency_ms" between 0 and 8640000000000 and ("ai_retrieval_traces"."query_embedding_latency_ms" is null or "ai_retrieval_traces"."query_embedding_latency_ms" between 0 and 8640000000000) and ("ai_retrieval_traces"."rerank_latency_ms" is null or "ai_retrieval_traces"."rerank_latency_ms" between 0 and 8640000000000)),
	CONSTRAINT "ai_retrieval_traces_fingerprint_valid" CHECK(length("ai_retrieval_traces"."fingerprint") = 64 and "ai_retrieval_traces"."fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_retrieval_traces_time_valid" CHECK("ai_retrieval_traces"."created_at" >= 0 and "ai_retrieval_traces"."completed_at" >= "ai_retrieval_traces"."created_at"),
	CONSTRAINT "ai_retrieval_traces_embedding_identity_valid" CHECK(("ai_retrieval_traces"."embedding_model_config_id" is null and "ai_retrieval_traces"."embedding_model_config_revision" is null and "ai_retrieval_traces"."embedding_provider_config_id" is null and "ai_retrieval_traces"."embedding_provider_config_revision" is null) or ("ai_retrieval_traces"."embedding_model_config_id" is not null and "ai_retrieval_traces"."embedding_model_config_revision" >= 1 and "ai_retrieval_traces"."embedding_provider_config_id" is not null and "ai_retrieval_traces"."embedding_provider_config_revision" >= 1)),
	CONSTRAINT "ai_retrieval_traces_rerank_identity_valid" CHECK(("ai_retrieval_traces"."rerank_model_config_id" is null and "ai_retrieval_traces"."rerank_model_config_revision" is null and "ai_retrieval_traces"."rerank_provider_config_id" is null and "ai_retrieval_traces"."rerank_provider_config_revision" is null) or ("ai_retrieval_traces"."rerank_model_config_id" is not null and "ai_retrieval_traces"."rerank_model_config_revision" >= 1 and "ai_retrieval_traces"."rerank_provider_config_id" is not null and "ai_retrieval_traces"."rerank_provider_config_revision" >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_retrieval_traces_request_unique` ON `ai_retrieval_traces` (`retrieval_request_id`);--> statement-breakpoint
CREATE INDEX `ai_retrieval_traces_principal_time_index` ON `ai_retrieval_traces` (`analytics_principal_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `ai_retrieval_traces_subject_time_index` ON `ai_retrieval_traces` (`subject_key`,`completed_at`);--> statement-breakpoint
CREATE TABLE `ai_telemetry_events` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`event_type` text NOT NULL,
	`event_version` integer DEFAULT 1 NOT NULL,
	`privacy_class` text NOT NULL,
	`analytics_principal_id` text,
	`subject_key` text,
	`conversation_id` text,
	`response_id` text,
	`response_trace_id` text,
	`retrieval_trace_id` text,
	`cost_operation_id` text,
	`model_config_id` text,
	`model_config_revision` integer,
	`provider_config_id` text,
	`provider_config_revision` integer,
	`tutor_config_id` text,
	`tutor_config_revision` integer,
	`context_policy_id` text,
	`context_policy_revision` integer,
	`retrieval_config_id` text,
	`retrieval_config_revision` integer,
	`memory_policy_id` text,
	`memory_policy_revision` integer,
	`memory_id` text,
	`memory_revision` integer,
	`failure_code` text,
	`duration_ms` integer,
	`provider_latency_ms` integer,
	`first_token_latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`known_cost_nano` integer,
	`retrieval_candidate_count` integer,
	`retrieval_selected_evidence_count` integer,
	`retrieval_reranker_used` integer,
	`memory_scope` text,
	`memory_kind` text,
	`memory_origin` text,
	`memory_action` text,
	`occurred_at` integer NOT NULL,
	`utc_day` text NOT NULL,
	`utc_week` text NOT NULL,
	`utc_month` text NOT NULL,
	FOREIGN KEY (`analytics_principal_id`) REFERENCES `ai_analytics_principals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_trace_id`) REFERENCES `ai_tutor_response_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retrieval_trace_id`) REFERENCES `ai_retrieval_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tutor_config_id`) REFERENCES `ai_tutor_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_policy_id`) REFERENCES `ai_context_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retrieval_config_id`) REFERENCES `ai_retrieval_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_policy_id`) REFERENCES `ai_memory_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`memory_id`) REFERENCES `ai_memories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_telemetry_events_id_valid" CHECK(length(trim("ai_telemetry_events"."id")) between 1 and 240 and "ai_telemetry_events"."id" not glob '*[^A-Za-z0-9._:-]*'),
	CONSTRAINT "ai_telemetry_events_dedupe_valid" CHECK(length(trim("ai_telemetry_events"."dedupe_key")) between 1 and 240 and "ai_telemetry_events"."dedupe_key" not glob '*[^A-Za-z0-9._:-]*'),
	CONSTRAINT "ai_telemetry_events_type_valid" CHECK("ai_telemetry_events"."event_type" in ('TUTOR_REQUEST_STARTED','TUTOR_REQUEST_COMPLETED','TUTOR_REQUEST_FAILED','RETRIEVAL_STARTED','RETRIEVAL_COMPLETED','RETRIEVAL_INSUFFICIENT','RETRIEVAL_FAILED','GROUNDING_VALIDATION_PASSED','GROUNDING_VALIDATION_FAILED','MEMORY_MUTATION_APPLIED','MEMORY_MUTATION_REJECTED','COMPACTION_SCHEDULED','COMPACTION_COMPLETED','COMPACTION_FAILED','FEEDBACK_POSITIVE','FEEDBACK_NEGATIVE','FEEDBACK_REPORTED')),
	CONSTRAINT "ai_telemetry_events_version_privacy_valid" CHECK("ai_telemetry_events"."event_version" = 1 and "ai_telemetry_events"."privacy_class" = 'DEIDENTIFIED_METADATA'),
	CONSTRAINT "ai_telemetry_events_failure_valid" CHECK("ai_telemetry_events"."failure_code" is null or "ai_telemetry_events"."failure_code" in ('ADMISSION_REJECTED','RATE_LIMITED','BUDGET_REJECTED','CONCURRENCY_LIMITED','CIRCUIT_OPEN','RETRIEVAL_INSUFFICIENT','RETRIEVAL_FAILED','PROVIDER_ERROR','PROVIDER_TIMEOUT','GROUNDING_INVALID','CITATION_INVALID','INPUT_LOST','CANCELLED','CONFIGURATION_CHANGED','MEMORY_CONFLICT','MEMORY_POLICY_DISABLED','COMPACTION_SOURCE_INVALID','INTERNAL_ERROR')),
	CONSTRAINT "ai_telemetry_events_duration_valid" CHECK(("ai_telemetry_events"."duration_ms" is null or "ai_telemetry_events"."duration_ms" between 0 and 8640000000000) and ("ai_telemetry_events"."provider_latency_ms" is null or "ai_telemetry_events"."provider_latency_ms" between 0 and 8640000000000) and ("ai_telemetry_events"."first_token_latency_ms" is null or "ai_telemetry_events"."first_token_latency_ms" between 0 and 8640000000000)),
	CONSTRAINT "ai_telemetry_events_usage_valid" CHECK(("ai_telemetry_events"."input_tokens" is null or "ai_telemetry_events"."input_tokens" between 0 and 9007199254740991) and ("ai_telemetry_events"."output_tokens" is null or "ai_telemetry_events"."output_tokens" between 0 and 9007199254740991) and ("ai_telemetry_events"."reasoning_tokens" is null or "ai_telemetry_events"."reasoning_tokens" between 0 and 9007199254740991) and ("ai_telemetry_events"."known_cost_nano" is null or "ai_telemetry_events"."known_cost_nano" between 0 and 9007199254740991)),
	CONSTRAINT "ai_telemetry_events_retrieval_valid" CHECK(("ai_telemetry_events"."retrieval_candidate_count" is null or "ai_telemetry_events"."retrieval_candidate_count" between 0 and 1000000) and ("ai_telemetry_events"."retrieval_selected_evidence_count" is null or "ai_telemetry_events"."retrieval_selected_evidence_count" between 0 and 50) and ("ai_telemetry_events"."retrieval_reranker_used" is null or "ai_telemetry_events"."retrieval_reranker_used" in (0,1))),
	CONSTRAINT "ai_telemetry_events_memory_valid" CHECK(("ai_telemetry_events"."memory_scope" is null or "ai_telemetry_events"."memory_scope" in ('GLOBAL','SUBJECT')) and ("ai_telemetry_events"."memory_kind" is null or "ai_telemetry_events"."memory_kind" in ('LEARNING_PREFERENCE','EXPLANATION_PREFERENCE','RESPONSE_DEPTH_PREFERENCE','FORM_OF_ADDRESS','PREFERRED_NAME','LEARNING_DIFFICULTY','STUDY_GOAL','STUDY_PROGRESS','LEARNING_STRATEGY_PREFERENCE')) and ("ai_telemetry_events"."memory_origin" is null or "ai_telemetry_events"."memory_origin" in ('EXPLICIT','INFERRED','LEGACY_SUBJECT')) and ("ai_telemetry_events"."memory_action" is null or "ai_telemetry_events"."memory_action" in ('NOOP','CREATE','UPDATE','ADD_EVIDENCE','ACTIVATE','RESOLVE','DELETE'))),
	CONSTRAINT "ai_telemetry_events_time_buckets_valid" CHECK(length("ai_telemetry_events"."utc_day") = 10 and "ai_telemetry_events"."utc_day" not glob '*[^0-9-]*' and length("ai_telemetry_events"."utc_week") = 8 and substr("ai_telemetry_events"."utc_week",5,2) = '-W' and "ai_telemetry_events"."utc_week" not glob '*[^0-9W-]*' and length("ai_telemetry_events"."utc_month") = 7 and "ai_telemetry_events"."utc_month" not glob '*[^0-9-]*'),
	CONSTRAINT "ai_telemetry_events_time_valid" CHECK("ai_telemetry_events"."occurred_at" >= 0),
	CONSTRAINT "ai_telemetry_events_revision_pairs_valid" CHECK(("ai_telemetry_events"."model_config_id" is null and "ai_telemetry_events"."model_config_revision" is null) or ("ai_telemetry_events"."model_config_id" is not null and "ai_telemetry_events"."model_config_revision" >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_telemetry_events_dedupe_unique` ON `ai_telemetry_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `ai_telemetry_events_time_index` ON `ai_telemetry_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `ai_telemetry_events_principal_time_index` ON `ai_telemetry_events` (`analytics_principal_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ai_telemetry_events_subject_time_index` ON `ai_telemetry_events` (`subject_key`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `ai_telemetry_events_type_time_index` ON `ai_telemetry_events` (`event_type`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `ai_tutor_response_diagnostics` (
	`id` text PRIMARY KEY NOT NULL,
	`response_trace_id` text NOT NULL,
	`response_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`analytics_principal_id` text NOT NULL,
	`subject_key` text NOT NULL,
	`retrieval_trace_id` text,
	`cost_operation_id` text NOT NULL,
	`terminal_status` text NOT NULL,
	`grounding_validation_status` text NOT NULL,
	`citation_validation_status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	`overall_latency_ms` integer NOT NULL,
	`provider_latency_ms` integer,
	`first_token_latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`known_cost_nano` integer,
	`usage_record_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`response_trace_id`) REFERENCES `ai_tutor_response_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`analytics_principal_id`) REFERENCES `ai_analytics_principals`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retrieval_trace_id`) REFERENCES `ai_retrieval_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_tutor_response_diagnostics_id_valid" CHECK(length(trim("ai_tutor_response_diagnostics"."id")) between 1 and 240 and "ai_tutor_response_diagnostics"."id" not glob '*[^A-Za-z0-9._:-]*'),
	CONSTRAINT "ai_tutor_response_diagnostics_status_valid" CHECK("ai_tutor_response_diagnostics"."terminal_status" in ('COMPLETED','BLOCKED','FAILED','CANCELLED') and "ai_tutor_response_diagnostics"."grounding_validation_status" in ('PASSED','FAILED','NOT_RUN') and "ai_tutor_response_diagnostics"."citation_validation_status" in ('PASSED','FAILED','NOT_RUN')),
	CONSTRAINT "ai_tutor_response_diagnostics_latency_valid" CHECK("ai_tutor_response_diagnostics"."overall_latency_ms" between 0 and 8640000000000 and ("ai_tutor_response_diagnostics"."provider_latency_ms" is null or "ai_tutor_response_diagnostics"."provider_latency_ms" between 0 and 8640000000000) and ("ai_tutor_response_diagnostics"."first_token_latency_ms" is null or "ai_tutor_response_diagnostics"."first_token_latency_ms" between 0 and 8640000000000)),
	CONSTRAINT "ai_tutor_response_diagnostics_usage_valid" CHECK(("ai_tutor_response_diagnostics"."input_tokens" is null or "ai_tutor_response_diagnostics"."input_tokens" between 0 and 9007199254740991) and ("ai_tutor_response_diagnostics"."output_tokens" is null or "ai_tutor_response_diagnostics"."output_tokens" between 0 and 9007199254740991) and ("ai_tutor_response_diagnostics"."reasoning_tokens" is null or "ai_tutor_response_diagnostics"."reasoning_tokens" between 0 and 9007199254740991) and ("ai_tutor_response_diagnostics"."known_cost_nano" is null or "ai_tutor_response_diagnostics"."known_cost_nano" between 0 and 9007199254740991) and "ai_tutor_response_diagnostics"."usage_record_count" between 0 and 100),
	CONSTRAINT "ai_tutor_response_diagnostics_time_valid" CHECK("ai_tutor_response_diagnostics"."started_at" >= 0 and "ai_tutor_response_diagnostics"."completed_at" >= "ai_tutor_response_diagnostics"."started_at" and "ai_tutor_response_diagnostics"."created_at" >= "ai_tutor_response_diagnostics"."completed_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tutor_response_diagnostics_trace_unique` ON `ai_tutor_response_diagnostics` (`response_trace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tutor_response_diagnostics_response_unique` ON `ai_tutor_response_diagnostics` (`response_id`);--> statement-breakpoint
CREATE INDEX `ai_tutor_response_diagnostics_principal_time_index` ON `ai_tutor_response_diagnostics` (`analytics_principal_id`,`completed_at`);
--> statement-breakpoint
CREATE TRIGGER `ai_analytics_principals_insert_valid`
BEFORE INSERT ON `ai_analytics_principals`
WHEN NEW.`state` <> 'ACTIVE'
BEGIN
  SELECT RAISE(ABORT, 'Analytics principals must start ACTIVE');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_analytics_principals_lifecycle_valid`
BEFORE UPDATE ON `ai_analytics_principals`
WHEN NEW.`id` <> OLD.`id`
  OR NEW.`principal_ref` <> OLD.`principal_ref`
  OR OLD.`state` = 'PURGING'
  OR (OLD.`state` = 'ACTIVE' AND NEW.`state` <> 'PURGING')
BEGIN
  SELECT RAISE(ABORT, 'Analytics principal identity or lifecycle is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_analytics_principals_delete_valid`
BEFORE DELETE ON `ai_analytics_principals`
WHEN OLD.`state` <> 'PURGING'
BEGIN
  SELECT RAISE(ABORT, 'Analytics principal deletion requires controlled purge');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_telemetry_events_owner_valid`
BEFORE INSERT ON `ai_telemetry_events`
WHEN (NEW.`response_id` IS NOT NULL AND NEW.`analytics_principal_id` IS NULL)
 OR (NEW.`conversation_id` IS NOT NULL AND NEW.`analytics_principal_id` IS NULL)
 OR (NEW.`response_trace_id` IS NOT NULL AND NEW.`analytics_principal_id` IS NULL)
 OR (NEW.`analytics_principal_id` IS NOT NULL
 AND (
   NOT EXISTS (SELECT 1 FROM `ai_analytics_principals` principal WHERE principal.`id` = NEW.`analytics_principal_id` AND principal.`state` = 'ACTIVE')
   OR (NEW.`conversation_id` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_analytics_principals` principal
     JOIN `ai_conversations` conversation ON conversation.`principal_ref` = principal.`principal_ref`
     WHERE principal.`id` = NEW.`analytics_principal_id` AND conversation.`id` = NEW.`conversation_id`
   ))
   OR (NEW.`response_id` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_analytics_principals` principal
     JOIN `ai_conversation_responses` response ON response.`principal_ref` = principal.`principal_ref`
     WHERE principal.`id` = NEW.`analytics_principal_id` AND response.`id` = NEW.`response_id`
   ))
   OR (NEW.`response_trace_id` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_analytics_principals` principal
     JOIN `ai_tutor_response_traces` trace ON trace.`principal_ref` = principal.`principal_ref`
     WHERE principal.`id` = NEW.`analytics_principal_id` AND trace.`id` = NEW.`response_trace_id`
   ))
   OR (NEW.`retrieval_trace_id` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_retrieval_traces` trace
     WHERE trace.`id` = NEW.`retrieval_trace_id` AND trace.`analytics_principal_id` = NEW.`analytics_principal_id`
   ))
   OR (NEW.`conversation_id` IS NOT NULL AND NEW.`subject_key` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_conversations` conversation
     WHERE conversation.`id` = NEW.`conversation_id` AND conversation.`subject_key` = NEW.`subject_key`
   ))
   OR (NEW.`response_id` IS NOT NULL AND NEW.`subject_key` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_conversation_responses` response
     JOIN `ai_conversations` conversation ON conversation.`id` = response.`conversation_id`
     WHERE response.`id` = NEW.`response_id` AND conversation.`subject_key` = NEW.`subject_key`
   ))
   OR (NEW.`response_trace_id` IS NOT NULL AND NEW.`subject_key` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_tutor_response_traces` trace
     WHERE trace.`id` = NEW.`response_trace_id` AND trace.`subject_key` = NEW.`subject_key`
   ))
 ) )
BEGIN
  SELECT RAISE(ABORT, 'Telemetry principal correlation is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_telemetry_events_no_update`
BEFORE UPDATE ON `ai_telemetry_events`
BEGIN
  SELECT RAISE(ABORT, 'Telemetry events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_telemetry_events_delete_purge_only`
BEFORE DELETE ON `ai_telemetry_events`
WHEN OLD.`analytics_principal_id` IS NULL
 OR NOT EXISTS (SELECT 1 FROM `ai_analytics_principals` principal WHERE principal.`id` = OLD.`analytics_principal_id` AND principal.`state` = 'PURGING')
BEGIN
  SELECT RAISE(ABORT, 'Telemetry event deletion requires controlled principal purge');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_traces_owner_valid`
BEFORE INSERT ON `ai_retrieval_traces`
WHEN (NEW.`analytics_principal_id` IS NULL AND (NEW.`conversation_id` IS NOT NULL OR NEW.`response_id` IS NOT NULL OR NEW.`response_trace_id` IS NOT NULL))
 OR (NEW.`analytics_principal_id` IS NOT NULL
 AND (
   NOT EXISTS (SELECT 1 FROM `ai_analytics_principals` principal WHERE principal.`id` = NEW.`analytics_principal_id` AND principal.`state` = 'ACTIVE')
   OR (NEW.`conversation_id` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_analytics_principals` principal
     JOIN `ai_conversations` conversation ON conversation.`principal_ref` = principal.`principal_ref`
     WHERE principal.`id` = NEW.`analytics_principal_id` AND conversation.`id` = NEW.`conversation_id`
   ))
   OR (NEW.`response_id` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_analytics_principals` principal
     JOIN `ai_conversation_responses` response ON response.`principal_ref` = principal.`principal_ref`
     WHERE principal.`id` = NEW.`analytics_principal_id` AND response.`id` = NEW.`response_id`
   ))
   OR (NEW.`response_trace_id` IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM `ai_analytics_principals` principal
     JOIN `ai_tutor_response_traces` trace ON trace.`principal_ref` = principal.`principal_ref`
     WHERE principal.`id` = NEW.`analytics_principal_id` AND trace.`id` = NEW.`response_trace_id`
   ))
 ))
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace analytics ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_traces_scope_valid`
BEFORE INSERT ON `ai_retrieval_traces`
WHEN (NEW.`response_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_conversation_responses` response JOIN `ai_conversations` conversation ON conversation.`id` = response.`conversation_id` WHERE response.`id` = NEW.`response_id` AND response.`conversation_id` = NEW.`conversation_id` AND conversation.`subject_key` = NEW.`subject_key`))
 OR (NEW.`conversation_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_conversations` conversation WHERE conversation.`id` = NEW.`conversation_id` AND conversation.`subject_key` = NEW.`subject_key`))
 OR (NEW.`response_trace_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_tutor_response_traces` trace WHERE trace.`id` = NEW.`response_trace_id` AND trace.`response_id` = NEW.`response_id` AND trace.`subject_key` = NEW.`subject_key`))
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace scope correlation is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_traces_no_update`
BEFORE UPDATE ON `ai_retrieval_traces`
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Traces are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_traces_delete_purge_only`
BEFORE DELETE ON `ai_retrieval_traces`
WHEN OLD.`analytics_principal_id` IS NULL
 OR NOT EXISTS (SELECT 1 FROM `ai_analytics_principals` principal WHERE principal.`id` = OLD.`analytics_principal_id` AND principal.`state` = 'PURGING')
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace deletion requires controlled principal purge');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_origins_owner_valid`
BEFORE INSERT ON `ai_retrieval_trace_origins`
WHEN NOT EXISTS (SELECT 1 FROM `ai_retrieval_traces` trace WHERE trace.`id` = NEW.`trace_id` AND trace.`subject_key` = NEW.`subject_key`)
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace origin ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_origins_no_update`
BEFORE UPDATE ON `ai_retrieval_trace_origins`
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace origins are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_origins_delete_purge_only`
BEFORE DELETE ON `ai_retrieval_trace_origins`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_retrieval_traces` trace
  JOIN `ai_analytics_principals` principal ON principal.`id` = trace.`analytics_principal_id`
  WHERE trace.`id` = OLD.`trace_id` AND principal.`state` = 'PURGING'
)
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace origin deletion requires controlled principal purge');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_projections_owner_valid`
BEFORE INSERT ON `ai_retrieval_trace_projections`
WHEN NOT EXISTS (SELECT 1 FROM `ai_retrieval_traces` trace WHERE trace.`id` = NEW.`trace_id`)
 OR (NEW.`origin_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_retrieval_trace_origins` origin WHERE origin.`trace_id` = NEW.`trace_id` AND origin.`origin_kind` = NEW.`origin_kind` AND origin.`origin_id` = NEW.`origin_id`))
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace projection ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_projections_no_update`
BEFORE UPDATE ON `ai_retrieval_trace_projections`
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace projections are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_projections_delete_purge_only`
BEFORE DELETE ON `ai_retrieval_trace_projections`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_retrieval_traces` trace
  JOIN `ai_analytics_principals` principal ON principal.`id` = trace.`analytics_principal_id`
  WHERE trace.`id` = OLD.`trace_id` AND principal.`state` = 'PURGING'
)
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace projection deletion requires controlled principal purge');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_items_owner_valid`
BEFORE INSERT ON `ai_retrieval_trace_items`
WHEN NOT EXISTS (SELECT 1 FROM `ai_retrieval_trace_origins` origin WHERE origin.`trace_id` = NEW.`trace_id` AND origin.`origin_kind` = NEW.`origin_kind` AND origin.`origin_id` = NEW.`origin_id`)
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace item ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_items_no_update`
BEFORE UPDATE ON `ai_retrieval_trace_items`
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace items are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_retrieval_trace_items_delete_purge_only`
BEFORE DELETE ON `ai_retrieval_trace_items`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_retrieval_traces` trace
  JOIN `ai_analytics_principals` principal ON principal.`id` = trace.`analytics_principal_id`
  WHERE trace.`id` = OLD.`trace_id` AND principal.`state` = 'PURGING'
)
BEGIN
  SELECT RAISE(ABORT, 'Retrieval Trace item deletion requires controlled principal purge');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_diagnostics_owner_valid`
BEFORE INSERT ON `ai_tutor_response_diagnostics`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_tutor_response_traces` trace
  JOIN `ai_analytics_principals` principal ON principal.`principal_ref` = trace.`principal_ref`
  JOIN `ai_conversation_responses` response ON response.`id` = trace.`response_id`
  WHERE trace.`id` = NEW.`response_trace_id`
    AND trace.`response_id` = NEW.`response_id`
    AND trace.`conversation_id` = NEW.`conversation_id`
    AND trace.`subject_key` = NEW.`subject_key`
    AND principal.`id` = NEW.`analytics_principal_id`
    AND response.`conversation_id` = NEW.`conversation_id`
)
 OR (NEW.`retrieval_trace_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_retrieval_traces` trace WHERE trace.`id` = NEW.`retrieval_trace_id` AND trace.`response_id` = NEW.`response_id`))
BEGIN
  SELECT RAISE(ABORT, 'Tutor diagnostics ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_diagnostics_no_update`
BEFORE UPDATE ON `ai_tutor_response_diagnostics`
BEGIN
  SELECT RAISE(ABORT, 'Tutor diagnostics are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_diagnostics_delete_purge_only`
BEFORE DELETE ON `ai_tutor_response_diagnostics`
WHEN NOT EXISTS (SELECT 1 FROM `ai_analytics_principals` principal WHERE principal.`id` = OLD.`analytics_principal_id` AND principal.`state` = 'PURGING')
BEGIN
  SELECT RAISE(ABORT, 'Tutor diagnostics deletion requires controlled principal purge');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_feedback_events_owner_valid`
BEFORE INSERT ON `ai_feedback_events`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_analytics_principals` principal
  JOIN `ai_conversation_responses` response ON response.`principal_ref` = principal.`principal_ref`
  JOIN `ai_conversations` conversation ON conversation.`id` = response.`conversation_id`
  WHERE principal.`id` = NEW.`analytics_principal_id`
    AND response.`id` = NEW.`response_id`
    AND response.`status` = 'COMPLETED'
    AND response.`conversation_id` = NEW.`conversation_id`
    AND conversation.`principal_ref` = principal.`principal_ref`
    AND conversation.`subject_key` = NEW.`subject_key`
    AND conversation.`origin` = 'STUDENT'
)
 OR (NEW.`response_trace_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `ai_tutor_response_traces` trace WHERE trace.`id` = NEW.`response_trace_id` AND trace.`response_id` = NEW.`response_id`))
BEGIN
  SELECT RAISE(ABORT, 'Feedback ownership or completed Response requirement is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_feedback_events_no_update`
BEFORE UPDATE ON `ai_feedback_events`
BEGIN
  SELECT RAISE(ABORT, 'Feedback events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_feedback_events_delete_purge_only`
BEFORE DELETE ON `ai_feedback_events`
WHEN NOT EXISTS (SELECT 1 FROM `ai_analytics_principals` principal WHERE principal.`id` = OLD.`analytics_principal_id` AND principal.`state` = 'PURGING')
BEGIN
  SELECT RAISE(ABORT, 'Feedback deletion requires controlled principal purge');
END;
