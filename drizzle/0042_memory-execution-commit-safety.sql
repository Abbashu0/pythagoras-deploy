-- M10B result-commit and automatic-review trust hardening.
DROP TRIGGER IF EXISTS `ai_memory_execution_memory_links_exact_owner`;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_execution_memory_links_exact_owner`
BEFORE INSERT ON `ai_memory_execution_memory_links`
WHEN NOT EXISTS (
	SELECT 1
	FROM `ai_memory_execution_memory_links` existing_link
	WHERE existing_link.`execution_id` = NEW.`execution_id`
	AND existing_link.`ordinal` = NEW.`ordinal`
)
AND NOT EXISTS (
	SELECT 1
	FROM `ai_memory_executions` execution
	JOIN `ai_memories` memory ON memory.`id` = NEW.`memory_id`
	WHERE execution.`id` = NEW.`execution_id`
	AND execution.`execution_kind` = 'EXTRACTION'
	AND execution.`status` = 'RUNNING'
	AND execution.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING'
	AND execution.`provider_invoked` = 1
	AND execution.`cost_operation_id` IS NOT NULL
	AND execution.`budget_reservation_id` IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM `ai_cost_operations` operation
		WHERE operation.`id` = execution.`cost_operation_id`
		AND operation.`cost_center` = 'STUDENT_GENERATION'
		AND operation.`opaque_principal_ref` = execution.`principal_ref`
		AND operation.`subject_key` = execution.`subject_key`
		AND operation.`conversation_id` = execution.`conversation_id`
		AND operation.`response_id` = execution.`response_id`
		AND operation.`status` = 'OPEN'
	)
	AND EXISTS (
		SELECT 1 FROM `ai_budget_reservations` reservation
		WHERE reservation.`id` = execution.`budget_reservation_id`
		AND reservation.`operation_id` = execution.`cost_operation_id`
		AND reservation.`status` = 'EXECUTING'
	)
	AND EXISTS (
		SELECT 1 FROM `ai_usage_cost_records` usage_record
		WHERE usage_record.`operation_id` = execution.`cost_operation_id`
		AND usage_record.`capability` = 'GENERATION'
	)
	AND execution.`memory_policy_id` = memory.`memory_policy_id`
	AND execution.`memory_policy_revision` = memory.`memory_policy_revision`
	AND memory.`principal_ref` = execution.`principal_ref`
	AND memory.`subject_key` = execution.`subject_key`
	AND memory.`source_conversation_id` = execution.`conversation_id`
	AND memory.`source_start_ordinal` = execution.`request_ordinal`
	AND memory.`source_end_ordinal` = execution.`assistant_ordinal`
	AND memory.`status` = 'CANDIDATE'
)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution result Policy ownership is invalid');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_system_auto_approved_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_system_auto_approved_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`status` = 'APPROVED'
AND NEW.`safe_review_code` = 'SYSTEM_AUTO_APPROVED'
AND NOT EXISTS (
	SELECT 1
	FROM `ai_memory_execution_memory_links` result_link
	JOIN `ai_memory_executions` execution ON execution.`id` = result_link.`execution_id`
	JOIN `ai_memory_execution_config_revisions` execution_config
	ON execution_config.`memory_execution_config_id` = execution.`execution_config_id`
	AND execution_config.`revision` = execution.`execution_config_revision`
	JOIN `ai_memory_policy_revisions` memory_policy
	ON memory_policy.`memory_policy_id` = execution.`memory_policy_id`
	AND memory_policy.`revision` = execution.`memory_policy_revision`
	JOIN `ai_memory_policies` memory_policy_identity
	ON memory_policy_identity.`id` = execution.`memory_policy_id`
	WHERE result_link.`memory_id` = NEW.`id`
	AND execution.`execution_kind` = 'EXTRACTION'
	AND execution.`status` = 'RUNNING'
	AND execution.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING'
	AND execution.`provider_invoked` = 1
	AND execution.`cost_operation_id` IS NOT NULL
	AND execution.`budget_reservation_id` IS NOT NULL
	AND execution.`principal_ref` = NEW.`principal_ref`
	AND execution.`subject_key` = NEW.`subject_key`
	AND execution.`conversation_id` = NEW.`source_conversation_id`
	AND execution.`request_ordinal` = NEW.`source_start_ordinal`
	AND execution.`assistant_ordinal` = NEW.`source_end_ordinal`
	AND execution.`memory_policy_id` = NEW.`memory_policy_id`
	AND execution.`memory_policy_revision` = NEW.`memory_policy_revision`
	AND EXISTS (
		SELECT 1 FROM `ai_cost_operations` operation
		WHERE operation.`id` = execution.`cost_operation_id`
		AND operation.`cost_center` = 'STUDENT_GENERATION'
		AND operation.`opaque_principal_ref` = execution.`principal_ref`
		AND operation.`subject_key` = execution.`subject_key`
		AND operation.`conversation_id` = execution.`conversation_id`
		AND operation.`response_id` = execution.`response_id`
		AND operation.`status` = 'OPEN'
	)
	AND EXISTS (
		SELECT 1 FROM `ai_budget_reservations` reservation
		WHERE reservation.`id` = execution.`budget_reservation_id`
		AND reservation.`operation_id` = execution.`cost_operation_id`
		AND reservation.`status` = 'EXECUTING'
	)
	AND EXISTS (
		SELECT 1 FROM `ai_usage_cost_records` usage_record
		WHERE usage_record.`operation_id` = execution.`cost_operation_id`
		AND usage_record.`capability` = 'GENERATION'
	)
	AND execution_config.`auto_approval_min_confidence_units` <= NEW.`confidence_units`
	AND execution_config.`enabled` = 1
	AND memory_policy_identity.`subject_key` = NEW.`subject_key`
	AND memory_policy.`enabled` = 1
	AND memory_policy.`candidate_review_required` = 0
)
BEGIN
	SELECT RAISE(ABORT, 'AI automatic Memory approval lacks exact execution proof');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_executions_result_commit_valid`
BEFORE UPDATE ON `ai_memory_executions`
WHEN NEW.`status` = 'COMPLETED'
AND (
	OLD.`status` <> 'RUNNING'
	OR OLD.`provider_invocation_state` <> 'INVOKED_WITH_ACCOUNTING'
	OR OLD.`provider_invoked` <> 1
	OR NEW.`provider_invocation_state` <> 'INVOKED_WITH_ACCOUNTING'
	OR NEW.`provider_invoked` <> 1
	OR NEW.`cost_operation_id` IS NULL
	OR NEW.`budget_reservation_id` IS NULL
	OR NEW.`result_sha256` IS NULL
	OR NEW.`result_byte_size` IS NULL
	OR NOT EXISTS (
		SELECT 1 FROM `ai_cost_operations` operation
		WHERE operation.`id` = NEW.`cost_operation_id`
		AND operation.`cost_center` = 'STUDENT_GENERATION'
		AND operation.`opaque_principal_ref` = NEW.`principal_ref`
		AND operation.`subject_key` = NEW.`subject_key`
		AND operation.`conversation_id` = NEW.`conversation_id`
		AND operation.`response_id` = NEW.`response_id`
		AND operation.`status` = 'OPEN'
	)
	OR NOT EXISTS (
		SELECT 1 FROM `ai_budget_reservations` reservation
		WHERE reservation.`id` = NEW.`budget_reservation_id`
		AND reservation.`operation_id` = NEW.`cost_operation_id`
		AND reservation.`status` = 'EXECUTING'
	)
	OR NOT EXISTS (
		SELECT 1 FROM `ai_usage_cost_records` usage_record
		WHERE usage_record.`operation_id` = NEW.`cost_operation_id`
		AND usage_record.`capability` = 'GENERATION'
	)
	OR (NEW.`execution_kind` = 'EXTRACTION' AND (
		NEW.`result_summary_id` IS NOT NULL
		OR NEW.`result_summary_revision` IS NOT NULL
		OR (SELECT COUNT(*) FROM `ai_memory_execution_memory_links` result_link WHERE result_link.`execution_id` = NEW.`id`) <> NEW.`result_count`
	))
	OR (NEW.`execution_kind` = 'COMPACTION' AND NOT EXISTS (
		SELECT 1 FROM `ai_conversation_summary_revisions` summary
		WHERE summary.`id` = NEW.`result_summary_id`
		AND summary.`conversation_id` = NEW.`conversation_id`
		AND summary.`principal_ref` = NEW.`principal_ref`
		AND summary.`subject_key` = NEW.`subject_key`
		AND summary.`revision` = NEW.`result_summary_revision`
		AND summary.`status` = 'ACTIVE'
		AND summary.`summary_text` IS NOT NULL
	))
)
BEGIN
	SELECT RAISE(ABORT, 'AI Memory execution completion requires proven Provider accounting');
END;
