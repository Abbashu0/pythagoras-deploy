ALTER TABLE `ai_eval_case_executions` ADD COLUMN `admission_attempt` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `ai_eval_target_cleanups` (
	`id` text PRIMARY KEY NOT NULL,
	`case_execution_id` text NOT NULL,
	`synthetic_conversation_id` text NOT NULL,
	`status` text NOT NULL,
	`safe_failure_code` text,
	`created_at` integer NOT NULL,
	`cleaned_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`case_execution_id`) REFERENCES `ai_eval_case_executions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`synthetic_conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_target_cleanups_status_valid" CHECK("ai_eval_target_cleanups"."status" in ('PENDING','CLEANED')),
	CONSTRAINT "ai_eval_target_cleanups_timestamps_valid" CHECK("ai_eval_target_cleanups"."created_at" >= 0 and "ai_eval_target_cleanups"."updated_at" >= "ai_eval_target_cleanups"."created_at" and ("ai_eval_target_cleanups"."cleaned_at" is null or "ai_eval_target_cleanups"."cleaned_at" >= "ai_eval_target_cleanups"."created_at")),
	CONSTRAINT "ai_eval_target_cleanups_error_valid" CHECK("ai_eval_target_cleanups"."safe_failure_code" is null or (length(trim("ai_eval_target_cleanups"."safe_failure_code")) between 1 and 120 and "ai_eval_target_cleanups"."safe_failure_code" not glob '*[^A-Z0-9_.-]*'))
);
--> statement-breakpoint
CREATE INDEX `ai_eval_target_cleanups_execution_index` ON `ai_eval_target_cleanups` (`case_execution_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_eval_target_cleanups_conversation_unique` ON `ai_eval_target_cleanups` (`synthetic_conversation_id`);
--> statement-breakpoint
CREATE INDEX `ai_eval_target_cleanups_status_index` ON `ai_eval_target_cleanups` (`status`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_admission_attempt_insert_valid`
BEFORE INSERT ON `ai_eval_case_executions`
WHEN NEW.`admission_attempt` <> 0
BEGIN SELECT RAISE(ABORT, 'Eval target admission attempt must begin at zero'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_admission_attempt_update_valid`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN NEW.`admission_attempt` < 0 OR NEW.`admission_attempt` > 100
 OR (NEW.`admission_attempt` IS NOT OLD.`admission_attempt` AND NOT (
   OLD.`status` = 'RUNNING' AND NEW.`status` = 'PENDING'
   AND OLD.`provider_invocation_state` = 'NOT_INVOKED' AND NEW.`provider_invocation_state` = 'NOT_INVOKED'
   AND OLD.`provider_invoked` = 0 AND NEW.`provider_invoked` = 0
   AND NEW.`budget_reservation_id` IS NULL
 ))
BEGIN SELECT RAISE(ABORT, 'Eval target admission attempts are immutable outside a retry'); END;
--> statement-breakpoint
DROP TRIGGER `ai_eval_case_executions_lifecycle_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_lifecycle_valid`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN (OLD.`status` = 'PENDING' AND NEW.`status` NOT IN ('PENDING','RUNNING','FAILED','CANCELLED','AMBIGUOUS'))
 OR (OLD.`status` = 'RUNNING' AND NEW.`status` NOT IN ('RUNNING','COMPLETED','BLOCKED','FAILED','CANCELLED','AMBIGUOUS','PENDING'))
 OR (OLD.`status` = 'RUNNING' AND NEW.`status` = 'PENDING' AND (
   NEW.`provider_invocation_state` <> 'NOT_INVOKED'
   OR NEW.`provider_invoked` <> 0
   OR NEW.`budget_reservation_id` IS NOT NULL
   OR NEW.`completed_at` IS NOT NULL
   OR NEW.`target_cost_operation_id` IS NULL
   OR NOT EXISTS (SELECT 1 FROM `ai_cost_operations` operation WHERE operation.`id` = NEW.`target_cost_operation_id` AND operation.`status` = 'OPEN')
 ))
 OR (OLD.`status` IN ('COMPLETED','BLOCKED','FAILED','CANCELLED','AMBIGUOUS') AND NEW.`status` IS NOT OLD.`status`)
 OR (OLD.`status` IN ('COMPLETED','BLOCKED','FAILED','CANCELLED','AMBIGUOUS') AND (
   NEW.`target_cost_operation_id` IS NOT OLD.`target_cost_operation_id`
   OR NEW.`budget_reservation_id` IS NOT OLD.`budget_reservation_id`
   OR NEW.`job_id` IS NOT OLD.`job_id`
   OR NEW.`provider_invocation_state` IS NOT OLD.`provider_invocation_state`
   OR NEW.`provider_invoked` IS NOT OLD.`provider_invoked`
   OR NEW.`output_sha256` IS NOT OLD.`output_sha256`
   OR NEW.`output_byte_size` IS NOT OLD.`output_byte_size`
   OR NEW.`finish_reason` IS NOT OLD.`finish_reason`
   OR NEW.`retrieval_status` IS NOT OLD.`retrieval_status`
   OR NEW.`plan_fingerprint` IS NOT OLD.`plan_fingerprint`
   OR NEW.`safe_failure_code` IS NOT OLD.`safe_failure_code`
   OR NEW.`admission_attempt` IS NOT OLD.`admission_attempt`
   OR NEW.`completed_at` IS NOT OLD.`completed_at`
   OR NEW.`updated_at` IS NOT OLD.`updated_at`
 ))
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution lifecycle is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_target_cleanups_insert_valid`
BEFORE INSERT ON `ai_eval_target_cleanups`
WHEN NEW.`status` <> 'PENDING'
 OR NEW.`safe_failure_code` IS NOT NULL
 OR NEW.`cleaned_at` IS NOT NULL
 OR NEW.`created_at` < 0
 OR NEW.`updated_at` <> NEW.`created_at`
 OR NOT EXISTS (
   SELECT 1
   FROM `ai_eval_case_executions` execution
   JOIN `ai_conversations` conversation ON conversation.`id` = NEW.`synthetic_conversation_id`
   WHERE execution.`id` = NEW.`case_execution_id`
   AND execution.`status` IN ('PENDING','RUNNING')
   AND execution.`cleanup_protocol_key` = 'synthetic-c4-cleanup-v1'
   AND execution.`cleanup_protocol_revision` = 1
   AND conversation.`status` = 'ACTIVE'
   AND conversation.`principal_ref` = 'eval-target-' || replace(execution.`id`, '-', '')
   AND conversation.`subject_key` = execution.`subject_key`
 )
BEGIN SELECT RAISE(ABORT, 'Eval target cleanup ownership is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_target_cleanups_update_valid`
BEFORE UPDATE ON `ai_eval_target_cleanups`
WHEN NEW.`id` IS NOT OLD.`id`
 OR NEW.`case_execution_id` IS NOT OLD.`case_execution_id`
 OR NEW.`synthetic_conversation_id` IS NOT OLD.`synthetic_conversation_id`
 OR NEW.`created_at` IS NOT OLD.`created_at`
 OR OLD.`status` = 'CLEANED'
 OR NEW.`status` NOT IN ('PENDING','CLEANED')
 OR NEW.`updated_at` < OLD.`updated_at`
 OR (NEW.`status` = 'PENDING' AND NEW.`cleaned_at` IS NOT NULL)
 OR (NEW.`status` = 'CLEANED' AND (NEW.`cleaned_at` IS NULL OR NEW.`safe_failure_code` IS NOT NULL OR NEW.`cleaned_at` < NEW.`created_at` OR NOT EXISTS (SELECT 1 FROM `ai_conversations` conversation WHERE conversation.`id` = NEW.`synthetic_conversation_id` AND conversation.`status` = 'DELETED')))
BEGIN SELECT RAISE(ABORT, 'Eval target cleanup lifecycle is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_target_cleanups_delete_blocked`
BEFORE DELETE ON `ai_eval_target_cleanups`
BEGIN SELECT RAISE(ABORT, 'Eval target cleanup history is append-only'); END;
