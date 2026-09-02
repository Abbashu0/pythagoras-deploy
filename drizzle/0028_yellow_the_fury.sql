CREATE TABLE `ai_tutor_config_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tutor_config_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer NOT NULL,
	`generation_model_config_id` text NOT NULL,
	`context_policy_id` text NOT NULL,
	`retrieval_config_id` text NOT NULL,
	`budget_policy_id` text NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`max_output_tokens` integer NOT NULL,
	`grounding_protocol_key` text DEFAULT 'evidence-grounded-v1' NOT NULL,
	`grounding_protocol_revision` integer DEFAULT 1 NOT NULL,
	`citation_protocol_key` text DEFAULT 'evidence-ref-v1' NOT NULL,
	`citation_protocol_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`tutor_config_id`) REFERENCES `ai_tutor_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_policy_id`) REFERENCES `ai_context_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retrieval_config_id`) REFERENCES `ai_retrieval_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_policy_id`) REFERENCES `ai_budget_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_tutor_config_revisions_revision_positive" CHECK("ai_tutor_config_revisions"."revision" >= 1),
	CONSTRAINT "ai_tutor_config_revisions_display_name_valid" CHECK(length(trim("ai_tutor_config_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_tutor_config_revisions_enabled_boolean" CHECK("ai_tutor_config_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_tutor_config_revisions_max_output_valid" CHECK("ai_tutor_config_revisions"."max_output_tokens" between 1 and 1000000),
	CONSTRAINT "ai_tutor_config_revisions_grounding_protocol_valid" CHECK("ai_tutor_config_revisions"."grounding_protocol_key" = 'evidence-grounded-v1' and "ai_tutor_config_revisions"."grounding_protocol_revision" = 1),
	CONSTRAINT "ai_tutor_config_revisions_citation_protocol_valid" CHECK("ai_tutor_config_revisions"."citation_protocol_key" = 'evidence-ref-v1' and "ai_tutor_config_revisions"."citation_protocol_revision" = 1),
	CONSTRAINT "ai_tutor_config_revisions_created_nonnegative" CHECK("ai_tutor_config_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tutor_config_revisions_identity_unique` ON `ai_tutor_config_revisions` (`tutor_config_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_tutor_config_revisions_config_index` ON `ai_tutor_config_revisions` (`tutor_config_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_tutor_config_revisions_enabled_index` ON `ai_tutor_config_revisions` (`enabled`);--> statement-breakpoint
CREATE TABLE `ai_tutor_configs` (
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
	CONSTRAINT "ai_tutor_configs_key_valid" CHECK(length(trim("ai_tutor_configs"."key")) between 1 and 120 and "ai_tutor_configs"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_tutor_configs_subject_valid" CHECK(length(trim("ai_tutor_configs"."subject_key")) between 1 and 80 and "ai_tutor_configs"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_tutor_configs_revision_positive" CHECK("ai_tutor_configs"."current_revision" >= 1),
	CONSTRAINT "ai_tutor_configs_created_nonnegative" CHECK("ai_tutor_configs"."created_at" >= 0),
	CONSTRAINT "ai_tutor_configs_timestamps_ordered" CHECK("ai_tutor_configs"."updated_at" >= "ai_tutor_configs"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tutor_configs_key_unique` ON `ai_tutor_configs` (`key`);--> statement-breakpoint
CREATE INDEX `ai_tutor_configs_subject_index` ON `ai_tutor_configs` (`subject_key`);--> statement-breakpoint
CREATE TABLE `ai_tutor_response_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`response_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`principal_ref` text NOT NULL,
	`subject_key` text NOT NULL,
	`tutor_config_id` text NOT NULL,
	`tutor_config_revision` integer NOT NULL,
	`context_snapshot_id` text NOT NULL,
	`context_snapshot_fingerprint` text NOT NULL,
	`retrieval_config_id` text NOT NULL,
	`retrieval_config_revision` integer NOT NULL,
	`fusion_algorithm_key` text NOT NULL,
	`fusion_algorithm_revision` integer NOT NULL,
	`generation_model_config_id` text NOT NULL,
	`generation_model_config_revision` integer NOT NULL,
	`generation_provider_config_id` text NOT NULL,
	`generation_provider_config_revision` integer NOT NULL,
	`provider_model_id` text NOT NULL,
	`adapter_key` text NOT NULL,
	`grounding_protocol_key` text NOT NULL,
	`grounding_protocol_revision` integer NOT NULL,
	`citation_protocol_key` text NOT NULL,
	`citation_protocol_revision` integer NOT NULL,
	`cost_operation_id` text NOT NULL,
	`budget_reservation_id` text NOT NULL,
	`budget_policy_id` text NOT NULL,
	`budget_policy_revision` integer NOT NULL,
	`rate_limit_policy_id` text NOT NULL,
	`rate_limit_policy_revision` integer NOT NULL,
	`plan_fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`safe_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tutor_config_id`) REFERENCES `ai_tutor_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_snapshot_id`) REFERENCES `ai_context_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retrieval_config_id`) REFERENCES `ai_retrieval_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_provider_config_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`cost_operation_id`) REFERENCES `ai_cost_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_reservation_id`) REFERENCES `ai_budget_reservations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`budget_policy_id`) REFERENCES `ai_budget_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rate_limit_policy_id`) REFERENCES `ai_rate_limit_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_tutor_response_traces_principal_valid" CHECK(length(trim("ai_tutor_response_traces"."principal_ref")) between 1 and 200 and "ai_tutor_response_traces"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_tutor_response_traces_subject_valid" CHECK(length(trim("ai_tutor_response_traces"."subject_key")) between 1 and 80 and "ai_tutor_response_traces"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_tutor_response_traces_revisions_positive" CHECK("ai_tutor_response_traces"."tutor_config_revision" >= 1 and "ai_tutor_response_traces"."retrieval_config_revision" >= 1 and "ai_tutor_response_traces"."fusion_algorithm_revision" >= 1 and "ai_tutor_response_traces"."generation_model_config_revision" >= 1 and "ai_tutor_response_traces"."generation_provider_config_revision" >= 1 and "ai_tutor_response_traces"."budget_policy_revision" >= 1 and "ai_tutor_response_traces"."rate_limit_policy_revision" >= 1 and "ai_tutor_response_traces"."grounding_protocol_revision" >= 1 and "ai_tutor_response_traces"."citation_protocol_revision" >= 1),
	CONSTRAINT "ai_tutor_response_traces_hashes_valid" CHECK(length("ai_tutor_response_traces"."context_snapshot_fingerprint") = 64 and "ai_tutor_response_traces"."context_snapshot_fingerprint" not glob '*[^0-9a-f]*' and length("ai_tutor_response_traces"."plan_fingerprint") = 64 and "ai_tutor_response_traces"."plan_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_tutor_response_traces_algorithm_valid" CHECK("ai_tutor_response_traces"."fusion_algorithm_key" = 'weighted-rrf-v1' and "ai_tutor_response_traces"."fusion_algorithm_revision" = 1),
	CONSTRAINT "ai_tutor_response_traces_protocols_valid" CHECK("ai_tutor_response_traces"."grounding_protocol_key" = 'evidence-grounded-v1' and "ai_tutor_response_traces"."grounding_protocol_revision" = 1 and "ai_tutor_response_traces"."citation_protocol_key" = 'evidence-ref-v1' and "ai_tutor_response_traces"."citation_protocol_revision" = 1),
	CONSTRAINT "ai_tutor_response_traces_status_valid" CHECK("ai_tutor_response_traces"."status" in ('PLANNED','STREAMING','COMPLETED','FAILED','CANCELLED','BLOCKED')),
	CONSTRAINT "ai_tutor_response_traces_error_consistency" CHECK(("ai_tutor_response_traces"."status" in ('PLANNED','STREAMING','COMPLETED') and "ai_tutor_response_traces"."safe_error_code" is null) or ("ai_tutor_response_traces"."status" in ('FAILED','CANCELLED','BLOCKED') and "ai_tutor_response_traces"."safe_error_code" is not null)),
	CONSTRAINT "ai_tutor_response_traces_safe_error_valid" CHECK("ai_tutor_response_traces"."safe_error_code" is null or "ai_tutor_response_traces"."safe_error_code" in ('AI_TUTOR_TRACE_INVALID','AI_TUTOR_TRACE_BLOCKED','AI_TUTOR_TRACE_FAILED','AI_TUTOR_TRACE_CANCELLED')),
	CONSTRAINT "ai_tutor_response_traces_timestamps_valid" CHECK("ai_tutor_response_traces"."updated_at" >= "ai_tutor_response_traces"."created_at" and (("ai_tutor_response_traces"."status" in ('PLANNED','STREAMING') and "ai_tutor_response_traces"."completed_at" is null) or ("ai_tutor_response_traces"."status" in ('COMPLETED','FAILED','CANCELLED','BLOCKED') and "ai_tutor_response_traces"."completed_at" is not null and "ai_tutor_response_traces"."completed_at" >= "ai_tutor_response_traces"."created_at"))),
	CONSTRAINT "ai_tutor_response_traces_created_nonnegative" CHECK("ai_tutor_response_traces"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tutor_response_traces_response_unique` ON `ai_tutor_response_traces` (`response_id`);--> statement-breakpoint
CREATE INDEX `ai_tutor_response_traces_principal_index` ON `ai_tutor_response_traces` (`principal_ref`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_tutor_trace_evidence_refs` (
	`trace_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`citation_label` text NOT NULL,
	`chunk_id` text NOT NULL,
	`m7a_projection_revision_id` text NOT NULL,
	`m7b_embedding_projection_revision_id` text,
	`origin_kind` text NOT NULL,
	`origin_id` text NOT NULL,
	`question_id` text,
	`question_revision` integer,
	PRIMARY KEY(`trace_id`, `ordinal`),
	FOREIGN KEY (`trace_id`) REFERENCES `ai_tutor_response_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_tutor_trace_evidence_refs_ordinal_valid" CHECK("ai_tutor_trace_evidence_refs"."ordinal" between 1 and 50),
	CONSTRAINT "ai_tutor_trace_evidence_refs_label_valid" CHECK("ai_tutor_trace_evidence_refs"."citation_label" = '[E' || "ai_tutor_trace_evidence_refs"."ordinal" || ']'),
	CONSTRAINT "ai_tutor_trace_evidence_refs_ids_valid" CHECK(length(trim("ai_tutor_trace_evidence_refs"."chunk_id")) between 1 and 240 and length(trim("ai_tutor_trace_evidence_refs"."m7a_projection_revision_id")) between 1 and 240 and ("ai_tutor_trace_evidence_refs"."m7b_embedding_projection_revision_id" is null or length(trim("ai_tutor_trace_evidence_refs"."m7b_embedding_projection_revision_id")) between 1 and 240) and length(trim("ai_tutor_trace_evidence_refs"."origin_id")) between 1 and 240),
	CONSTRAINT "ai_tutor_trace_evidence_refs_origin_valid" CHECK("ai_tutor_trace_evidence_refs"."origin_kind" in ('KNOWLEDGE_PACKAGE','QUESTION_PACKAGE')),
	CONSTRAINT "ai_tutor_trace_evidence_refs_question_valid" CHECK(("ai_tutor_trace_evidence_refs"."question_id" is null and "ai_tutor_trace_evidence_refs"."question_revision" is null) or ("ai_tutor_trace_evidence_refs"."question_id" is not null and "ai_tutor_trace_evidence_refs"."question_revision" is not null and "ai_tutor_trace_evidence_refs"."question_revision" >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tutor_trace_evidence_refs_label_unique` ON `ai_tutor_trace_evidence_refs` (`trace_id`,`citation_label`);--> statement-breakpoint
CREATE INDEX `ai_tutor_trace_evidence_refs_trace_index` ON `ai_tutor_trace_evidence_refs` (`trace_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `ai_tutor_trace_projection_refs` (
	`trace_id` text NOT NULL,
	`projection_kind` text NOT NULL,
	`projection_revision_id` text NOT NULL,
	PRIMARY KEY(`trace_id`, `projection_kind`, `projection_revision_id`),
	FOREIGN KEY (`trace_id`) REFERENCES `ai_tutor_response_traces`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_tutor_trace_projection_refs_kind_valid" CHECK("ai_tutor_trace_projection_refs"."projection_kind" in ('M7A','M7B')),
	CONSTRAINT "ai_tutor_trace_projection_refs_id_valid" CHECK(length(trim("ai_tutor_trace_projection_refs"."projection_revision_id")) between 1 and 240)
);
--> statement-breakpoint
CREATE INDEX `ai_tutor_trace_projection_refs_trace_index` ON `ai_tutor_trace_projection_refs` (`trace_id`);
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_configs_initial_revision`
BEFORE INSERT ON `ai_tutor_configs`
WHEN NEW.`current_revision` <> 1
BEGIN
  SELECT RAISE(ABORT, 'Tutor Configs must start at revision 1');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_configs_identity_no_update`
BEFORE UPDATE ON `ai_tutor_configs`
WHEN NEW.`id` IS NOT OLD.`id`
 OR NEW.`key` IS NOT OLD.`key`
 OR NEW.`subject_key` IS NOT OLD.`subject_key`
 OR NEW.`created_at` IS NOT OLD.`created_at`
 OR NEW.`created_by` IS NOT OLD.`created_by`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Config identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_configs_revision_pointer`
BEFORE UPDATE ON `ai_tutor_configs`
WHEN NOT (
  NEW.`current_revision` IS OLD.`current_revision`
  OR (
    NEW.`current_revision` = OLD.`current_revision` + 1
    AND EXISTS (
      SELECT 1
      FROM `ai_tutor_config_revisions` AS revision
      WHERE revision.`tutor_config_id` = OLD.`id`
        AND revision.`revision` = NEW.`current_revision`
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Tutor Config revisions must advance one step');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_configs_no_delete`
BEFORE DELETE ON `ai_tutor_configs`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Config identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_config_revisions_insert_integrity`
BEFORE INSERT ON `ai_tutor_config_revisions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `ai_tutor_configs` AS tutor
  WHERE tutor.`id` = NEW.`tutor_config_id`
    AND (
      (NEW.`revision` = 1 AND tutor.`current_revision` = 1)
      OR NEW.`revision` = tutor.`current_revision` + 1
    )
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_model_configs` AS model
  JOIN `ai_provider_configs` AS provider ON provider.`id` = model.`provider_config_id`
  WHERE model.`id` = NEW.`generation_model_config_id`
    AND model.`capability` = 'GENERATION'
    AND model.`enabled` = 1
    AND model.`supports_streaming` = 1
    AND model.`context_window_tokens` IS NOT NULL
    AND model.`max_output_tokens` IS NOT NULL
    AND NEW.`max_output_tokens` <= model.`max_output_tokens`
    AND provider.`enabled` = 1
    AND provider.`credential_ref` IS NOT NULL
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_context_policies` AS policy
  JOIN `ai_context_policy_revisions` AS revision
    ON revision.`context_policy_id` = policy.`id`
   AND revision.`revision` = policy.`current_revision`
  WHERE policy.`id` = NEW.`context_policy_id`
    AND revision.`enabled` = 1
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_retrieval_configs` AS config
  JOIN `ai_retrieval_config_revisions` AS revision
    ON revision.`retrieval_config_id` = config.`id`
   AND revision.`revision` = config.`current_revision`
  JOIN `ai_tutor_configs` AS tutor
    ON tutor.`id` = NEW.`tutor_config_id`
  WHERE config.`id` = NEW.`retrieval_config_id`
    AND config.`subject_key` = tutor.`subject_key`
    AND revision.`enabled` = 1
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_budget_policies` AS policy
  JOIN `ai_budget_policy_revisions` AS revision
    ON revision.`budget_policy_id` = policy.`id`
   AND revision.`revision` = policy.`current_revision`
  WHERE policy.`id` = NEW.`budget_policy_id`
    AND revision.`enabled` = 1
    AND revision.`cost_center` = 'STUDENT_GENERATION'
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_rate_limit_policies` AS policy
  JOIN `ai_rate_limit_policy_revisions` AS revision
    ON revision.`rate_limit_policy_id` = policy.`id`
   AND revision.`revision` = policy.`current_revision`
  WHERE policy.`id` = NEW.`rate_limit_policy_id`
    AND revision.`enabled` = 1
)
 OR NEW.`grounding_protocol_key` IS NOT 'evidence-grounded-v1'
 OR NEW.`grounding_protocol_revision` IS NOT 1
 OR NEW.`citation_protocol_key` IS NOT 'evidence-ref-v1'
 OR NEW.`citation_protocol_revision` IS NOT 1
BEGIN
  SELECT RAISE(ABORT, 'Tutor Config revision integrity is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_config_revisions_no_update`
BEFORE UPDATE ON `ai_tutor_config_revisions`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Config revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_config_revisions_no_delete`
BEFORE DELETE ON `ai_tutor_config_revisions`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Config revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_traces_insert_integrity`
BEFORE INSERT ON `ai_tutor_response_traces`
WHEN NEW.`status` IS NOT 'PLANNED'
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_conversation_responses` AS response
  JOIN `ai_conversations` AS conversation
    ON conversation.`id` = response.`conversation_id`
  WHERE response.`id` = NEW.`response_id`
    AND response.`conversation_id` = NEW.`conversation_id`
    AND response.`principal_ref` = NEW.`principal_ref`
    AND conversation.`id` = NEW.`conversation_id`
    AND conversation.`principal_ref` = NEW.`principal_ref`
    AND conversation.`subject_key` = NEW.`subject_key`
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_tutor_configs` AS tutor
  JOIN `ai_tutor_config_revisions` AS revision
    ON revision.`tutor_config_id` = tutor.`id`
   AND revision.`revision` = NEW.`tutor_config_revision`
  JOIN `ai_context_snapshots` AS snapshot
    ON snapshot.`id` = NEW.`context_snapshot_id`
  WHERE tutor.`id` = NEW.`tutor_config_id`
    AND tutor.`subject_key` = NEW.`subject_key`
    AND revision.`generation_model_config_id` = NEW.`generation_model_config_id`
    AND revision.`context_policy_id` = snapshot.`context_policy_id`
    AND revision.`retrieval_config_id` = NEW.`retrieval_config_id`
    AND revision.`budget_policy_id` = NEW.`budget_policy_id`
    AND revision.`rate_limit_policy_id` = NEW.`rate_limit_policy_id`
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_context_snapshots` AS snapshot
  WHERE snapshot.`id` = NEW.`context_snapshot_id`
    AND snapshot.`response_id` = NEW.`response_id`
    AND snapshot.`conversation_id` = NEW.`conversation_id`
    AND snapshot.`principal_ref` = NEW.`principal_ref`
    AND snapshot.`subject_key` = NEW.`subject_key`
    AND snapshot.`fingerprint` = NEW.`context_snapshot_fingerprint`
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_retrieval_configs` AS config
  JOIN `ai_retrieval_config_revisions` AS revision
    ON revision.`retrieval_config_id` = config.`id`
   AND revision.`revision` = NEW.`retrieval_config_revision`
  WHERE config.`id` = NEW.`retrieval_config_id`
    AND config.`subject_key` = NEW.`subject_key`
    AND revision.`fusion_algorithm_key` = NEW.`fusion_algorithm_key`
    AND revision.`fusion_algorithm_revision` = NEW.`fusion_algorithm_revision`
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_model_configs` AS model
  WHERE model.`id` = NEW.`generation_model_config_id`
    AND model.`revision` = NEW.`generation_model_config_revision`
    AND model.`provider_config_id` = NEW.`generation_provider_config_id`
    AND model.`provider_model_id` = NEW.`provider_model_id`
    AND model.`adapter_key` = NEW.`adapter_key`
    AND model.`capability` = 'GENERATION'
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_provider_configs` AS provider
  WHERE provider.`id` = NEW.`generation_provider_config_id`
    AND provider.`revision` = NEW.`generation_provider_config_revision`
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_cost_operations` AS operation
  WHERE operation.`id` = NEW.`cost_operation_id`
    AND operation.`cost_center` = 'STUDENT_GENERATION'
    AND operation.`opaque_principal_ref` = NEW.`principal_ref`
    AND operation.`subject_key` = NEW.`subject_key`
    AND operation.`conversation_id` = NEW.`conversation_id`
    AND operation.`response_id` = NEW.`response_id`
)
 OR NOT EXISTS (
  SELECT 1
  FROM `ai_budget_reservations` AS reservation
  JOIN `ai_budget_accounts` AS account ON account.`id` = reservation.`budget_account_id`
  JOIN `ai_budget_policy_revisions` AS budget_revision
    ON budget_revision.`budget_policy_id` = account.`budget_policy_id`
   AND budget_revision.`revision` = account.`budget_policy_revision`
  WHERE reservation.`id` = NEW.`budget_reservation_id`
    AND reservation.`operation_id` = NEW.`cost_operation_id`
    AND reservation.`principal_ref` = NEW.`principal_ref`
    AND account.`principal_ref` = NEW.`principal_ref`
    AND account.`budget_policy_id` = NEW.`budget_policy_id`
    AND account.`budget_policy_revision` = NEW.`budget_policy_revision`
    AND budget_revision.`budget_policy_id` = NEW.`budget_policy_id`
    AND reservation.`rate_limit_policy_id` = NEW.`rate_limit_policy_id`
    AND reservation.`rate_limit_policy_revision` = NEW.`rate_limit_policy_revision`
)
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Trace ownership is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_traces_identity_no_update`
BEFORE UPDATE ON `ai_tutor_response_traces`
WHEN NEW.`id` IS NOT OLD.`id`
 OR NEW.`response_id` IS NOT OLD.`response_id`
 OR NEW.`conversation_id` IS NOT OLD.`conversation_id`
 OR NEW.`principal_ref` IS NOT OLD.`principal_ref`
 OR NEW.`subject_key` IS NOT OLD.`subject_key`
 OR NEW.`tutor_config_id` IS NOT OLD.`tutor_config_id`
 OR NEW.`tutor_config_revision` IS NOT OLD.`tutor_config_revision`
 OR NEW.`context_snapshot_id` IS NOT OLD.`context_snapshot_id`
 OR NEW.`context_snapshot_fingerprint` IS NOT OLD.`context_snapshot_fingerprint`
 OR NEW.`retrieval_config_id` IS NOT OLD.`retrieval_config_id`
 OR NEW.`retrieval_config_revision` IS NOT OLD.`retrieval_config_revision`
 OR NEW.`fusion_algorithm_key` IS NOT OLD.`fusion_algorithm_key`
 OR NEW.`fusion_algorithm_revision` IS NOT OLD.`fusion_algorithm_revision`
 OR NEW.`generation_model_config_id` IS NOT OLD.`generation_model_config_id`
 OR NEW.`generation_model_config_revision` IS NOT OLD.`generation_model_config_revision`
 OR NEW.`generation_provider_config_id` IS NOT OLD.`generation_provider_config_id`
 OR NEW.`generation_provider_config_revision` IS NOT OLD.`generation_provider_config_revision`
 OR NEW.`provider_model_id` IS NOT OLD.`provider_model_id`
 OR NEW.`adapter_key` IS NOT OLD.`adapter_key`
 OR NEW.`grounding_protocol_key` IS NOT OLD.`grounding_protocol_key`
 OR NEW.`grounding_protocol_revision` IS NOT OLD.`grounding_protocol_revision`
 OR NEW.`citation_protocol_key` IS NOT OLD.`citation_protocol_key`
 OR NEW.`citation_protocol_revision` IS NOT OLD.`citation_protocol_revision`
 OR NEW.`cost_operation_id` IS NOT OLD.`cost_operation_id`
 OR NEW.`budget_reservation_id` IS NOT OLD.`budget_reservation_id`
 OR NEW.`budget_policy_id` IS NOT OLD.`budget_policy_id`
 OR NEW.`budget_policy_revision` IS NOT OLD.`budget_policy_revision`
 OR NEW.`rate_limit_policy_id` IS NOT OLD.`rate_limit_policy_id`
 OR NEW.`rate_limit_policy_revision` IS NOT OLD.`rate_limit_policy_revision`
 OR NEW.`plan_fingerprint` IS NOT OLD.`plan_fingerprint`
 OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Trace identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_traces_lifecycle`
BEFORE UPDATE ON `ai_tutor_response_traces`
WHEN (OLD.`status` = 'PLANNED' AND NEW.`status` NOT IN ('PLANNED','STREAMING','BLOCKED','FAILED','CANCELLED'))
 OR (OLD.`status` = 'STREAMING' AND NEW.`status` NOT IN ('STREAMING','COMPLETED','FAILED','CANCELLED'))
 OR (OLD.`status` IN ('COMPLETED','FAILED','CANCELLED','BLOCKED') AND (
   NEW.`status` IS NOT OLD.`status`
   OR NEW.`safe_error_code` IS NOT OLD.`safe_error_code`
   OR NEW.`completed_at` IS NOT OLD.`completed_at`
   OR NEW.`updated_at` IS NOT OLD.`updated_at`
 ))
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Trace lifecycle transition is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_traces_no_delete`
BEFORE DELETE ON `ai_tutor_response_traces`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Traces are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_trace_projection_refs_insert_integrity`
BEFORE INSERT ON `ai_tutor_trace_projection_refs`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_tutor_response_traces` AS trace WHERE trace.`id` = NEW.`trace_id`
)
 OR (NEW.`projection_kind` = 'M7A' AND NOT EXISTS (
  SELECT 1
  FROM `ai_retrieval_projection_revisions` AS revision
  JOIN `ai_retrieval_projection_sets` AS projection_set ON projection_set.`id` = revision.`projection_set_id`
  JOIN `ai_tutor_response_traces` AS trace ON trace.`id` = NEW.`trace_id`
  WHERE revision.`id` = NEW.`projection_revision_id`
    AND projection_set.`subject_key` = trace.`subject_key`
 ))
 OR (NEW.`projection_kind` = 'M7B' AND NOT EXISTS (
  SELECT 1
  FROM `ai_embedding_projection_revisions` AS revision
  JOIN `ai_embedding_projection_sets` AS projection_set ON projection_set.`id` = revision.`embedding_projection_set_id`
  JOIN `ai_tutor_response_traces` AS trace ON trace.`id` = NEW.`trace_id`
  WHERE revision.`id` = NEW.`projection_revision_id`
    AND projection_set.`subject_key` = trace.`subject_key`
 ))
BEGIN
  SELECT RAISE(ABORT, 'Tutor Trace projection reference is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_trace_projection_refs_no_update`
BEFORE UPDATE ON `ai_tutor_trace_projection_refs`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Trace projection references are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_trace_projection_refs_no_delete`
BEFORE DELETE ON `ai_tutor_trace_projection_refs`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Trace projection references are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_trace_evidence_refs_insert_integrity`
BEFORE INSERT ON `ai_tutor_trace_evidence_refs`
WHEN NOT EXISTS (
  SELECT 1
  FROM `ai_tutor_response_traces` AS trace
  JOIN `ai_retrieval_chunks` AS chunk
    ON chunk.`projection_revision_id` = NEW.`m7a_projection_revision_id`
   AND chunk.`chunk_id` = NEW.`chunk_id`
  WHERE trace.`id` = NEW.`trace_id`
    AND chunk.`subject_key` = trace.`subject_key`
    AND chunk.`origin_kind` = NEW.`origin_kind`
    AND chunk.`origin_id` = NEW.`origin_id`
    AND (chunk.`question_id` IS NEW.`question_id`)
    AND (chunk.`question_revision` IS NEW.`question_revision`)
)
 OR (NEW.`m7b_embedding_projection_revision_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM `ai_embedding_projection_revisions` AS revision
  JOIN `ai_retrieval_chunks` AS chunk
    ON chunk.`projection_revision_id` = NEW.`m7a_projection_revision_id`
   AND chunk.`chunk_id` = NEW.`chunk_id`
  WHERE revision.`id` = NEW.`m7b_embedding_projection_revision_id`
    AND revision.`chunk_projection_revision_id` = chunk.`projection_revision_id`
 ))
BEGIN
  SELECT RAISE(ABORT, 'Tutor Trace Evidence reference is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_trace_evidence_refs_no_update`
BEFORE UPDATE ON `ai_tutor_trace_evidence_refs`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Trace Evidence references are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_trace_evidence_refs_no_delete`
BEFORE DELETE ON `ai_tutor_trace_evidence_refs`
BEGIN
  SELECT RAISE(ABORT, 'Tutor Trace Evidence references are immutable');
END;
