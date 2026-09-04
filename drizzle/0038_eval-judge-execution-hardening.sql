DROP TRIGGER IF EXISTS `ai_eval_judge_results_insert_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_judge_results_insert_valid`
BEFORE INSERT ON `ai_eval_judge_results`
WHEN NEW.`dimension` = 'SECURITY'
  OR EXISTS (
    SELECT 1 FROM `ai_eval_runs` run
    WHERE run.`id` = NEW.`run_id`
    AND json_extract(run.`candidate_snapshot`, '$.generationModel.id') = NEW.`judge_model_config_id`
    AND json_extract(run.`candidate_snapshot`, '$.generationModel.revision') = NEW.`judge_model_config_revision`
  )
  OR NOT EXISTS (
    SELECT 1 FROM `ai_eval_runs` run
    JOIN `ai_eval_suite_revisions` suite_revision ON suite_revision.`suite_id` = run.`suite_id` AND suite_revision.`revision` = run.`suite_revision`
    JOIN `ai_eval_case_results` case_result ON case_result.`id` = NEW.`case_result_id` AND case_result.`run_id` = run.`id` AND case_result.`case_id` = NEW.`case_id` AND case_result.`case_revision` = NEW.`case_revision`
    JOIN `ai_eval_judge_executions` execution ON execution.`id` = NEW.`judge_execution_id` AND execution.`run_id` = run.`id` AND execution.`case_id` = NEW.`case_id` AND execution.`case_revision` = NEW.`case_revision`
    WHERE run.`id` = NEW.`run_id`
    AND run.`status` = 'RUNNING'
    AND execution.`judge_config_id` = NEW.`judge_config_id`
    AND execution.`judge_config_revision` = NEW.`judge_config_revision`
    AND execution.`protocol_key` = NEW.`protocol_key`
    AND execution.`protocol_revision` = NEW.`protocol_revision`
    AND execution.`judge_model_config_id` = NEW.`judge_model_config_id`
    AND execution.`judge_model_config_revision` = NEW.`judge_model_config_revision`
    AND execution.`judge_provider_config_id` = NEW.`judge_provider_config_id`
    AND execution.`judge_provider_config_revision` = NEW.`judge_provider_config_revision`
    AND execution.`provider_invoked` = 1
    AND execution.`provider_invocation_state` = 'INVOKED_WITH_ACCOUNTING'
    AND execution.`judge_cost_operation_id` IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM json_each(suite_revision.`required_dimensions`) d
      WHERE json_extract(d.value, '$.dimension') = NEW.`dimension`
      AND json_extract(d.value, '$.mode') = 'JUDGE_REQUIRED'
    )
  )
  OR NOT (
    (NEW.`rubric_band` = 'EXCELLENT' AND NEW.`score_units` BETWEEN 900000 AND 1000000) OR
    (NEW.`rubric_band` = 'PASS' AND NEW.`score_units` BETWEEN 700000 AND 899999) OR
    (NEW.`rubric_band` = 'MARGINAL' AND NEW.`score_units` BETWEEN 500000 AND 699999) OR
    (NEW.`rubric_band` = 'FAIL' AND NEW.`score_units` BETWEEN 0 AND 499999)
  )
BEGIN SELECT RAISE(ABORT, 'Eval Judge Result is invalid, unproven, or dimension is not configured as JUDGE_REQUIRED'); END;
