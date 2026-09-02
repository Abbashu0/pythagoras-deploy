-- Custom SQL migration file, put your code below! --
DROP TRIGGER IF EXISTS `ai_tutor_response_traces_refs_sealed_insert_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_tutor_response_traces_refs_sealed_insert_valid`
BEFORE INSERT ON `ai_tutor_response_traces`
WHEN NEW.`refs_sealed` IS NOT 0
 OR NEW.`status` IS NOT 'PLANNED'
BEGIN
  SELECT RAISE(ABORT, 'Tutor Response Traces must start unsealed and PLANNED');
END;
