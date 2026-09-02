CREATE TABLE `ai_context_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_context_policies_key_valid" CHECK(length(trim("ai_context_policies"."key")) between 1 and 120 and "ai_context_policies"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_context_policies_revision_positive" CHECK("ai_context_policies"."current_revision" >= 1),
	CONSTRAINT "ai_context_policies_created_nonnegative" CHECK("ai_context_policies"."created_at" >= 0),
	CONSTRAINT "ai_context_policies_updated_ordered" CHECK("ai_context_policies"."updated_at" >= "ai_context_policies"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_context_policies_key_unique` ON `ai_context_policies` (`key`);--> statement-breakpoint
CREATE TABLE `ai_context_policy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`context_policy_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`soft_input_budget_tokens` integer NOT NULL,
	`hard_input_budget_tokens` integer NOT NULL,
	`output_reserve_tokens` integer NOT NULL,
	`policy_budget_tokens` integer NOT NULL,
	`summary_budget_tokens` integer NOT NULL,
	`recent_turns_budget_tokens` integer NOT NULL,
	`memory_budget_tokens` integer NOT NULL,
	`evidence_budget_tokens` integer NOT NULL,
	`max_recent_turns` integer NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`context_policy_id`) REFERENCES `ai_context_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_context_policy_revisions_revision_positive" CHECK("ai_context_policy_revisions"."revision" >= 1),
	CONSTRAINT "ai_context_policy_revisions_display_name_valid" CHECK(length(trim("ai_context_policy_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_context_policy_revisions_budget_bounds" CHECK("ai_context_policy_revisions"."soft_input_budget_tokens" > 0 and "ai_context_policy_revisions"."hard_input_budget_tokens" >= "ai_context_policy_revisions"."soft_input_budget_tokens" and "ai_context_policy_revisions"."output_reserve_tokens" > 0 and "ai_context_policy_revisions"."policy_budget_tokens" between 0 and 10000000 and "ai_context_policy_revisions"."summary_budget_tokens" between 0 and 10000000 and "ai_context_policy_revisions"."recent_turns_budget_tokens" between 0 and 10000000 and "ai_context_policy_revisions"."memory_budget_tokens" between 0 and 10000000 and "ai_context_policy_revisions"."evidence_budget_tokens" between 0 and 10000000 and "ai_context_policy_revisions"."hard_input_budget_tokens" between 1 and 10000000),
	CONSTRAINT "ai_context_policy_revisions_component_budget_bounds" CHECK("ai_context_policy_revisions"."policy_budget_tokens" <= "ai_context_policy_revisions"."hard_input_budget_tokens" and "ai_context_policy_revisions"."summary_budget_tokens" <= "ai_context_policy_revisions"."hard_input_budget_tokens" and "ai_context_policy_revisions"."recent_turns_budget_tokens" <= "ai_context_policy_revisions"."hard_input_budget_tokens" and "ai_context_policy_revisions"."memory_budget_tokens" <= "ai_context_policy_revisions"."hard_input_budget_tokens" and "ai_context_policy_revisions"."evidence_budget_tokens" <= "ai_context_policy_revisions"."hard_input_budget_tokens" and "ai_context_policy_revisions"."output_reserve_tokens" <= 10000000),
	CONSTRAINT "ai_context_policy_revisions_recent_turns_valid" CHECK("ai_context_policy_revisions"."max_recent_turns" between 1 and 100),
	CONSTRAINT "ai_context_policy_revisions_enabled_boolean" CHECK("ai_context_policy_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_context_policy_revisions_created_nonnegative" CHECK("ai_context_policy_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_context_policy_revisions_identity_unique` ON `ai_context_policy_revisions` (`context_policy_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_context_policy_revisions_policy_index` ON `ai_context_policy_revisions` (`context_policy_id`,`revision`);--> statement-breakpoint
CREATE TABLE `ai_context_snapshot_items` (
	`snapshot_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`source_id` text,
	`source_revision` integer,
	`estimated_tokens` integer NOT NULL,
	`decision` text NOT NULL,
	`decision_reason` text,
	PRIMARY KEY(`snapshot_id`, `ordinal`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `ai_context_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_context_snapshot_items_ordinal_positive" CHECK("ai_context_snapshot_items"."ordinal" >= 1),
	CONSTRAINT "ai_context_snapshot_items_kind_valid" CHECK("ai_context_snapshot_items"."kind" in ('PRECEDENCE_ENVELOPE','GLOBAL_POLICY','SUBJECT_POLICY','CONVERSATION_SUMMARY','RECENT_MESSAGE','CURRENT_MESSAGE','MEMORY','EVIDENCE')),
	CONSTRAINT "ai_context_snapshot_items_source_valid" CHECK("ai_context_snapshot_items"."source_id" is null or length(trim("ai_context_snapshot_items"."source_id")) between 1 and 200),
	CONSTRAINT "ai_context_snapshot_items_revision_valid" CHECK("ai_context_snapshot_items"."source_revision" is null or "ai_context_snapshot_items"."source_revision" >= 1),
	CONSTRAINT "ai_context_snapshot_items_tokens_valid" CHECK("ai_context_snapshot_items"."estimated_tokens" between 0 and 10000000),
	CONSTRAINT "ai_context_snapshot_items_decision_valid" CHECK("ai_context_snapshot_items"."decision" in ('INCLUDED','OMITTED')),
	CONSTRAINT "ai_context_snapshot_items_reason_valid" CHECK("ai_context_snapshot_items"."decision_reason" is null or length(trim("ai_context_snapshot_items"."decision_reason")) between 1 and 200)
);
--> statement-breakpoint
CREATE INDEX `ai_context_snapshot_items_snapshot_index` ON `ai_context_snapshot_items` (`snapshot_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `ai_context_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`response_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`principal_ref` text NOT NULL,
	`subject_key` text NOT NULL,
	`global_policy_id` text NOT NULL,
	`global_policy_revision` integer NOT NULL,
	`subject_policy_id` text NOT NULL,
	`subject_policy_revision` integer NOT NULL,
	`context_policy_id` text NOT NULL,
	`context_policy_revision` integer NOT NULL,
	`precedence_envelope_version` integer NOT NULL,
	`estimator_key` text NOT NULL,
	`soft_input_budget_tokens` integer NOT NULL,
	`hard_input_budget_tokens` integer NOT NULL,
	`output_reserve_tokens` integer NOT NULL,
	`global_policy_tokens` integer NOT NULL,
	`subject_policy_tokens` integer NOT NULL,
	`precedence_envelope_tokens` integer NOT NULL,
	`summary_tokens` integer NOT NULL,
	`recent_turns_tokens` integer NOT NULL,
	`current_message_tokens` integer NOT NULL,
	`reserved_memory_budget_tokens` integer NOT NULL,
	`reserved_evidence_budget_tokens` integer NOT NULL,
	`total_input_tokens` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`global_policy_id`) REFERENCES `ai_instruction_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subject_policy_id`) REFERENCES `ai_instruction_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_policy_id`) REFERENCES `ai_context_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_context_snapshots_principal_valid" CHECK(length(trim("ai_context_snapshots"."principal_ref")) between 1 and 200 and "ai_context_snapshots"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_context_snapshots_subject_valid" CHECK(length(trim("ai_context_snapshots"."subject_key")) between 1 and 80 and "ai_context_snapshots"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_context_snapshots_revisions_positive" CHECK("ai_context_snapshots"."global_policy_revision" >= 1 and "ai_context_snapshots"."subject_policy_revision" >= 1 and "ai_context_snapshots"."context_policy_revision" >= 1),
	CONSTRAINT "ai_context_snapshots_envelope_valid" CHECK("ai_context_snapshots"."precedence_envelope_version" = 1),
	CONSTRAINT "ai_context_snapshots_estimator_valid" CHECK(length(trim("ai_context_snapshots"."estimator_key")) between 1 and 120 and "ai_context_snapshots"."estimator_key" not glob '*[^A-Za-z0-9._-]*'),
	CONSTRAINT "ai_context_snapshots_budget_valid" CHECK("ai_context_snapshots"."soft_input_budget_tokens" > 0 and "ai_context_snapshots"."hard_input_budget_tokens" >= "ai_context_snapshots"."soft_input_budget_tokens" and "ai_context_snapshots"."output_reserve_tokens" > 0),
	CONSTRAINT "ai_context_snapshots_token_counts_valid" CHECK("ai_context_snapshots"."global_policy_tokens" >= 0 and "ai_context_snapshots"."subject_policy_tokens" >= 0 and "ai_context_snapshots"."precedence_envelope_tokens" >= 0 and "ai_context_snapshots"."summary_tokens" >= 0 and "ai_context_snapshots"."recent_turns_tokens" >= 0 and "ai_context_snapshots"."current_message_tokens" >= 0 and "ai_context_snapshots"."reserved_memory_budget_tokens" >= 0 and "ai_context_snapshots"."reserved_evidence_budget_tokens" >= 0 and "ai_context_snapshots"."total_input_tokens" >= 0 and "ai_context_snapshots"."total_input_tokens" <= "ai_context_snapshots"."hard_input_budget_tokens"),
	CONSTRAINT "ai_context_snapshots_fingerprint_valid" CHECK(length("ai_context_snapshots"."fingerprint") = 64 and "ai_context_snapshots"."fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_context_snapshots_created_nonnegative" CHECK("ai_context_snapshots"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_context_snapshots_response_unique` ON `ai_context_snapshots` (`response_id`);--> statement-breakpoint
CREATE INDEX `ai_context_snapshots_principal_index` ON `ai_context_snapshots` (`principal_ref`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_context_snapshots_conversation_index` ON `ai_context_snapshots` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_instruction_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`scope` text NOT NULL,
	`subject_key` text,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_instruction_policies_key_valid" CHECK(length(trim("ai_instruction_policies"."key")) between 1 and 120 and "ai_instruction_policies"."key" not glob '*[^a-z0-9.-]*'),
	CONSTRAINT "ai_instruction_policies_scope_valid" CHECK("ai_instruction_policies"."scope" in ('GLOBAL','SUBJECT')),
	CONSTRAINT "ai_instruction_policies_scope_subject_consistent" CHECK(("ai_instruction_policies"."scope" = 'GLOBAL' and "ai_instruction_policies"."subject_key" is null) or ("ai_instruction_policies"."scope" = 'SUBJECT' and "ai_instruction_policies"."subject_key" is not null)),
	CONSTRAINT "ai_instruction_policies_subject_valid" CHECK("ai_instruction_policies"."subject_key" is null or (length(trim("ai_instruction_policies"."subject_key")) between 1 and 80 and "ai_instruction_policies"."subject_key" not glob '*[^a-z0-9-]*')),
	CONSTRAINT "ai_instruction_policies_revision_positive" CHECK("ai_instruction_policies"."current_revision" >= 1),
	CONSTRAINT "ai_instruction_policies_created_nonnegative" CHECK("ai_instruction_policies"."created_at" >= 0),
	CONSTRAINT "ai_instruction_policies_updated_ordered" CHECK("ai_instruction_policies"."updated_at" >= "ai_instruction_policies"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_instruction_policies_key_unique` ON `ai_instruction_policies` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_instruction_policies_global_unique` ON `ai_instruction_policies` (`scope`) WHERE "ai_instruction_policies"."scope" = 'GLOBAL';--> statement-breakpoint
CREATE UNIQUE INDEX `ai_instruction_policies_subject_unique` ON `ai_instruction_policies` (`scope`,`subject_key`) WHERE "ai_instruction_policies"."scope" = 'SUBJECT';--> statement-breakpoint
CREATE INDEX `ai_instruction_policies_scope_index` ON `ai_instruction_policies` (`scope`,`subject_key`);--> statement-breakpoint
CREATE TABLE `ai_instruction_policy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text NOT NULL,
	`revision` integer NOT NULL,
	`display_name` text NOT NULL,
	`instructions` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `ai_instruction_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_instruction_policy_revisions_revision_positive" CHECK("ai_instruction_policy_revisions"."revision" >= 1),
	CONSTRAINT "ai_instruction_policy_revisions_display_name_valid" CHECK(length(trim("ai_instruction_policy_revisions"."display_name")) between 1 and 200),
	CONSTRAINT "ai_instruction_policy_revisions_instructions_valid" CHECK(length(cast("ai_instruction_policy_revisions"."instructions" as blob)) between 1 and 32768),
	CONSTRAINT "ai_instruction_policy_revisions_enabled_boolean" CHECK("ai_instruction_policy_revisions"."enabled" in (0,1)),
	CONSTRAINT "ai_instruction_policy_revisions_created_nonnegative" CHECK("ai_instruction_policy_revisions"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_instruction_policy_revisions_identity_unique` ON `ai_instruction_policy_revisions` (`policy_id`,`revision`);--> statement-breakpoint
CREATE INDEX `ai_instruction_policy_revisions_policy_index` ON `ai_instruction_policy_revisions` (`policy_id`,`revision`);
--> statement-breakpoint
CREATE TRIGGER `ai_context_snapshots_scope_consistent`
BEFORE INSERT ON `ai_context_snapshots`
WHEN NOT EXISTS (
	SELECT 1
	FROM `ai_conversation_responses` AS response
	INNER JOIN `ai_conversations` AS conversation ON conversation.`id` = response.`conversation_id`
	INNER JOIN `ai_instruction_policies` AS global_policy ON global_policy.`id` = NEW.`global_policy_id`
	INNER JOIN `ai_instruction_policies` AS subject_policy ON subject_policy.`id` = NEW.`subject_policy_id`
	INNER JOIN `ai_instruction_policy_revisions` AS global_revision ON global_revision.`policy_id` = NEW.`global_policy_id` AND global_revision.`revision` = NEW.`global_policy_revision`
	INNER JOIN `ai_instruction_policy_revisions` AS subject_revision ON subject_revision.`policy_id` = NEW.`subject_policy_id` AND subject_revision.`revision` = NEW.`subject_policy_revision`
	INNER JOIN `ai_context_policy_revisions` AS context_revision ON context_revision.`context_policy_id` = NEW.`context_policy_id` AND context_revision.`revision` = NEW.`context_policy_revision`
	WHERE response.`id` = NEW.`response_id`
	  AND response.`conversation_id` = NEW.`conversation_id`
	  AND response.`principal_ref` = NEW.`principal_ref`
	  AND conversation.`principal_ref` = NEW.`principal_ref`
	  AND conversation.`subject_key` = NEW.`subject_key`
	  AND global_policy.`scope` = 'GLOBAL'
	  AND global_policy.`subject_key` IS NULL
	  AND subject_policy.`scope` = 'SUBJECT'
	  AND subject_policy.`subject_key` = NEW.`subject_key`
)
BEGIN
	SELECT RAISE(ABORT, 'AI Context Snapshot scope is inconsistent');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_instruction_policies_identity_immutable`
BEFORE UPDATE OF `key`, `scope`, `subject_key` ON `ai_instruction_policies`
WHEN NEW.`key` <> OLD.`key` OR NEW.`scope` <> OLD.`scope` OR (NEW.`subject_key` IS NOT OLD.`subject_key`)
BEGIN
	SELECT RAISE(ABORT, 'AI Instruction Policy identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_instruction_policy_revisions_immutable`
BEFORE UPDATE ON `ai_instruction_policy_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Instruction Policy revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_instruction_policy_revisions_no_delete`
BEFORE DELETE ON `ai_instruction_policy_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Instruction Policy revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_context_policies_identity_immutable`
BEFORE UPDATE OF `key` ON `ai_context_policies`
WHEN NEW.`key` <> OLD.`key`
BEGIN
	SELECT RAISE(ABORT, 'AI Context Policy identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_context_policy_revisions_immutable`
BEFORE UPDATE ON `ai_context_policy_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Context Policy revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_context_policy_revisions_no_delete`
BEFORE DELETE ON `ai_context_policy_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Context Policy revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_context_snapshots_immutable`
BEFORE UPDATE ON `ai_context_snapshots`
BEGIN
	SELECT RAISE(ABORT, 'AI Context Snapshots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_context_snapshot_items_immutable`
BEFORE UPDATE ON `ai_context_snapshot_items`
BEGIN
	SELECT RAISE(ABORT, 'AI Context Snapshot items are immutable');
END;
