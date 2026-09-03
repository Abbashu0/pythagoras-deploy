ALTER TABLE `ai_eval_target_cleanups` ADD `retry_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP TRIGGER `ai_eval_case_executions_identity_immutable`;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_identity_immutable`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`run_id` IS NOT OLD.`run_id` OR NEW.`case_id` IS NOT OLD.`case_id` OR
NEW.`case_revision` IS NOT OLD.`case_revision` OR NEW.`ordinal` IS NOT OLD.`ordinal` OR NEW.`subject_key` IS NOT OLD.`subject_key` OR
NEW.`execution_config_id` IS NOT OLD.`execution_config_id` OR NEW.`execution_config_revision` IS NOT OLD.`execution_config_revision` OR
NEW.`execution_config_fingerprint` IS NOT OLD.`execution_config_fingerprint` OR NEW.`execution_protocol_key` IS NOT OLD.`execution_protocol_key` OR
NEW.`execution_protocol_revision` IS NOT OLD.`execution_protocol_revision` OR NEW.`cleanup_protocol_key` IS NOT OLD.`cleanup_protocol_key` OR
NEW.`cleanup_protocol_revision` IS NOT OLD.`cleanup_protocol_revision` OR NEW.`candidate_fingerprint` IS NOT OLD.`candidate_fingerprint` OR
NEW.`created_at` IS NOT OLD.`created_at` OR
(NEW.`started_at` IS NOT OLD.`started_at` AND NOT (
  OLD.`started_at` IS NULL AND OLD.`status` = 'PENDING' AND NEW.`status` = 'RUNNING'
  AND OLD.`provider_invocation_state` = 'NOT_INVOKED' AND NEW.`provider_invocation_state` = 'NOT_INVOKED'
  AND OLD.`provider_invoked` = 0 AND NEW.`provider_invoked` = 0
  AND OLD.`target_cost_operation_id` IS NULL AND NEW.`target_cost_operation_id` IS NULL
  AND OLD.`budget_reservation_id` IS NULL AND NEW.`budget_reservation_id` IS NULL
  AND OLD.`admission_attempt` = NEW.`admission_attempt`
  AND NEW.`safe_failure_code` IS NULL
  AND NEW.`started_at` IS NOT NULL
) AND NOT (
  OLD.`status` = 'PENDING' AND NEW.`status` = 'RUNNING'
  AND OLD.`safe_failure_code` = 'EVAL_ADMISSION_RETRYABLE' AND NEW.`safe_failure_code` IS NULL
  AND OLD.`provider_invocation_state` = 'NOT_INVOKED' AND NEW.`provider_invocation_state` = 'NOT_INVOKED'
  AND OLD.`provider_invoked` = 0 AND NEW.`provider_invoked` = 0
  AND OLD.`budget_reservation_id` IS NULL AND NEW.`budget_reservation_id` IS NULL
  AND NEW.`target_cost_operation_id` IS OLD.`target_cost_operation_id`
  AND NEW.`admission_attempt` = OLD.`admission_attempt`
  AND NEW.`started_at` IS NOT NULL AND NEW.`started_at` >= OLD.`started_at`
  AND EXISTS (SELECT 1 FROM `ai_cost_operations` operation WHERE operation.`id` = NEW.`target_cost_operation_id` AND operation.`status` = 'OPEN' AND operation.`cost_center` = 'EVALS' AND operation.`eval_run_id` = NEW.`run_id`)
))
BEGIN SELECT RAISE(ABORT, 'Eval Case Execution identity is immutable outside a controlled attempt boundary'); END;
--> statement-breakpoint
DROP TRIGGER `ai_eval_case_executions_admission_attempt_update_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_executions_admission_attempt_update_valid`
BEFORE UPDATE ON `ai_eval_case_executions`
WHEN NEW.`admission_attempt` < 0 OR NEW.`admission_attempt` > 100
 OR (NEW.`admission_attempt` IS NOT OLD.`admission_attempt` AND NOT (
   OLD.`status` = 'RUNNING' AND NEW.`status` = 'PENDING'
   AND NEW.`admission_attempt` = OLD.`admission_attempt` + 1
   AND OLD.`provider_invocation_state` = 'NOT_INVOKED' AND NEW.`provider_invocation_state` = 'NOT_INVOKED'
   AND OLD.`provider_invoked` = 0 AND NEW.`provider_invoked` = 0
   AND NEW.`budget_reservation_id` IS NULL
   AND NEW.`safe_failure_code` = 'EVAL_ADMISSION_RETRYABLE'
   AND NEW.`target_cost_operation_id` IS OLD.`target_cost_operation_id`
   AND EXISTS (SELECT 1 FROM `ai_cost_operations` operation WHERE operation.`id` = NEW.`target_cost_operation_id` AND operation.`status` = 'OPEN' AND operation.`cost_center` = 'EVALS' AND operation.`eval_run_id` = NEW.`run_id`)
 ))
BEGIN SELECT RAISE(ABORT, 'Eval target admission attempt must advance exactly once per retry'); END;
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
   OR NEW.`admission_attempt` <> OLD.`admission_attempt` + 1
   OR NEW.`safe_failure_code` IS NOT 'EVAL_ADMISSION_RETRYABLE'
   OR NOT EXISTS (SELECT 1 FROM `ai_cost_operations` operation WHERE operation.`id` = NEW.`target_cost_operation_id` AND operation.`status` = 'OPEN' AND operation.`cost_center` = 'EVALS' AND operation.`eval_run_id` = NEW.`run_id`)
 ))
 OR (OLD.`status` = 'PENDING' AND NEW.`status` = 'RUNNING' AND OLD.`safe_failure_code` = 'EVAL_ADMISSION_RETRYABLE' AND NEW.`started_at` IS OLD.`started_at`)
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
DROP TRIGGER `ai_eval_target_cleanups_update_valid`;
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
 OR (NEW.`status` = 'PENDING' AND (NEW.`cleaned_at` IS NOT NULL OR NEW.`retry_count` <> OLD.`retry_count` + 1 OR NEW.`safe_failure_code` IS NULL))
 OR (NEW.`status` = 'CLEANED' AND (NEW.`retry_count` IS NOT OLD.`retry_count` OR NEW.`cleaned_at` IS NULL OR NEW.`safe_failure_code` IS NOT NULL OR NEW.`cleaned_at` < NEW.`created_at` OR NOT EXISTS (SELECT 1 FROM `ai_conversations` conversation WHERE conversation.`id` = NEW.`synthetic_conversation_id` AND conversation.`status` = 'DELETED')))
BEGIN SELECT RAISE(ABORT, 'Eval target cleanup lifecycle is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_target_cleanups_retry_count_insert_valid`
BEFORE INSERT ON `ai_eval_target_cleanups`
WHEN NEW.`retry_count` <> 0
BEGIN SELECT RAISE(ABORT, 'Eval target cleanup retry count must begin at zero'); END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_target_cleanups_retry_count_update_valid`
BEFORE UPDATE ON `ai_eval_target_cleanups`
WHEN NEW.`retry_count` < 0 OR NEW.`retry_count` > 2147483647
 OR (NEW.`retry_count` IS NOT OLD.`retry_count` AND NOT (OLD.`status` = 'PENDING' AND NEW.`status` = 'PENDING' AND NEW.`retry_count` = OLD.`retry_count` + 1))
BEGIN SELECT RAISE(ABORT, 'Eval target cleanup retry position is invalid'); END;
