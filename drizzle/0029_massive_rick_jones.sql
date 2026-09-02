ALTER TABLE `ai_tutor_response_traces` ADD `refs_sealed` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_traces_refs_sealed_insert_valid`
BEFORE INSERT ON `ai_tutor_response_traces`
WHEN NEW.`refs_sealed` NOT IN (0,1)
 OR (NEW.`refs_sealed` = 0 AND NEW.`status` IS NOT 'PLANNED')
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Trace reference seal is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_traces_refs_sealed_state`
BEFORE UPDATE ON `ai_tutor_response_traces`
WHEN NEW.`refs_sealed` NOT IN (0,1)
 OR (OLD.`refs_sealed` = 1 AND NEW.`refs_sealed` <> 1)
 OR (OLD.`refs_sealed` = 0 AND NEW.`refs_sealed` = 1 AND (OLD.`status` IS NOT 'PLANNED' OR NEW.`status` IS NOT 'PLANNED'))
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Trace reference seal is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_traces_requires_sealed_refs`
BEFORE UPDATE ON `ai_tutor_response_traces`
WHEN OLD.`status` = 'PLANNED' AND NEW.`status` IS NOT 'PLANNED' AND NEW.`refs_sealed` <> 1
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Trace references must be sealed first');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_trace_projection_refs_sealed_insert`
BEFORE INSERT ON `ai_tutor_trace_projection_refs`
WHEN NOT EXISTS (
  SELECT 1
  FROM `ai_tutor_response_traces` AS trace
  WHERE trace.`id` = NEW.`trace_id`
    AND trace.`status` = 'PLANNED'
    AND trace.`refs_sealed` = 0
)
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Trace projection references are sealed');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_trace_evidence_refs_sealed_insert`
BEFORE INSERT ON `ai_tutor_trace_evidence_refs`
WHEN NOT EXISTS (
  SELECT 1
  FROM `ai_tutor_response_traces` AS trace
  WHERE trace.`id` = NEW.`trace_id`
    AND trace.`status` = 'PLANNED'
    AND trace.`refs_sealed` = 0
)
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Trace evidence references are sealed');
END;
