ALTER TABLE `ai_instruction_policy_revisions` ADD `sections_json` text;--> statement-breakpoint
ALTER TABLE `ai_instruction_policy_revisions` ADD `compiler_version` integer;--> statement-breakpoint
ALTER TABLE `ai_instruction_policy_revisions` ADD `compiled_hash` text;--> statement-breakpoint
-- Legacy rows remain null and byte-for-byte unchanged. Existing immutable triggers remain.
CREATE TRIGGER ai_instruction_revision_authoring_insert
BEFORE INSERT ON ai_instruction_policy_revisions
WHEN CASE WHEN (
  (NEW.sections_json IS NULL AND NEW.compiler_version IS NULL AND NEW.compiled_hash IS NULL)
  OR (NEW.sections_json IS NOT NULL AND json_valid(NEW.sections_json)
    AND json_type(NEW.sections_json) = 'array' AND NEW.compiler_version = 1
    AND NEW.compiled_hash IS NOT NULL AND length(NEW.compiled_hash) = 64
    AND NEW.compiled_hash NOT GLOB '*[^0-9a-f]*')
) THEN 0 ELSE 1 END
BEGIN SELECT RAISE(ABORT, 'invalid instruction authoring metadata'); END;
