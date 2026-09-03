DROP TRIGGER IF EXISTS `ai_eval_case_results_insert_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_case_results_insert_valid`
BEFORE INSERT ON `ai_eval_case_results`
WHEN NOT EXISTS (
  SELECT 1
  FROM `ai_eval_runs` AS run
  JOIN `ai_eval_suite_revisions` AS suite_revision
    ON suite_revision.`suite_id` = run.`suite_id`
   AND suite_revision.`revision` = run.`suite_revision`
   AND suite_revision.`manifest_sealed` = 1
  JOIN `ai_eval_suite_case_refs` AS manifest
    ON manifest.`suite_revision_id` = suite_revision.`id`
   AND manifest.`case_id` = NEW.`case_id`
   AND manifest.`case_revision` = NEW.`case_revision`
   AND manifest.`ordinal` = NEW.`ordinal`
  JOIN `ai_eval_case_revisions` AS case_revision
    ON case_revision.`case_id` = NEW.`case_id`
   AND case_revision.`revision` = NEW.`case_revision`
  WHERE run.`id` = NEW.`run_id`
    AND run.`status` = 'RUNNING'
    AND case_revision.`subject_key` = NEW.`observed_subject_key`
    AND case_revision.`privacy_class` = NEW.`privacy_class`
    AND (NEW.`cost_operation_id` IS NULL OR EXISTS (
      SELECT 1 FROM `ai_cost_operations` AS operation
      WHERE operation.`id` = NEW.`cost_operation_id`
        AND operation.`eval_run_id` = NEW.`run_id`
        AND operation.`cost_center` = 'EVALS'
    ))
)
BEGIN
  SELECT RAISE(ABORT, 'Eval Case results are accepted only while a Run is RUNNING');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_eval_grader_results_insert_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_grader_results_insert_valid`
BEFORE INSERT ON `ai_eval_grader_results`
WHEN NOT EXISTS (
  SELECT 1
  FROM `ai_eval_case_results` AS result
  JOIN `ai_eval_runs` AS run ON run.`id` = result.`run_id`
  JOIN `ai_eval_suite_revisions` AS suite_revision
    ON suite_revision.`suite_id` = run.`suite_id`
   AND suite_revision.`revision` = run.`suite_revision`
   AND suite_revision.`manifest_sealed` = 1
  WHERE result.`id` = NEW.`case_result_id`
    AND run.`status` = 'RUNNING'
    AND EXISTS (
      SELECT 1
      FROM json_each(suite_revision.`grader_configs`) AS configured
      WHERE json_extract(configured.`value`, '$.graderKey') = NEW.`grader_key`
        AND json_extract(configured.`value`, '$.graderRevision') = NEW.`grader_revision`
        AND json_extract(configured.`value`, '$.dimension') = NEW.`dimension`
    )
    AND EXISTS (
      SELECT 1
      FROM json_each(suite_revision.`required_dimensions`) AS dimension
      WHERE json_extract(dimension.`value`, '$.dimension') = NEW.`dimension`
        AND json_extract(dimension.`value`, '$.mode') = 'DETERMINISTICALLY_GRADED'
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Eval grader is not configured as a deterministic Suite grader');
END;
