ALTER TABLE `ai_memory_policies` ADD `m10a2_mutation_authority` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policies_m10a2_authority_valid`
BEFORE INSERT ON `ai_memory_policies`
WHEN NEW.`m10a2_mutation_authority` NOT IN (0,1)
BEGIN
  SELECT RAISE(ABORT, 'AI Memory Policy mutation authority is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memory_policies_m10a2_authority_immutable`
BEFORE UPDATE OF `m10a2_mutation_authority` ON `ai_memory_policies`
WHEN NEW.`m10a2_mutation_authority` <> OLD.`m10a2_mutation_authority`
BEGIN
  SELECT RAISE(ABORT, 'AI Memory Policy mutation authority is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_current_policy_insert_valid`
BEFORE INSERT ON `ai_memories`
WHEN NEW.`creation_origin` IN ('EXPLICIT','INFERRED')
 AND (
   NOT EXISTS (
     SELECT 1
     FROM `ai_memory_policies` policy
     JOIN `ai_memory_policy_revisions` revision
       ON revision.`memory_policy_id` = policy.`id`
      AND revision.`revision` = policy.`current_revision`
     WHERE policy.`id` = NEW.`memory_policy_id`
       AND policy.`m10a2_mutation_authority` = 1
       AND NEW.`memory_policy_revision` = policy.`current_revision`
       AND policy.`scope` = NEW.`scope`
       AND policy.`subject_key` IS NEW.`subject_key`
       AND revision.`enabled` = 1
       AND revision.`mutation_enabled` = 1
       AND EXISTS (SELECT 1 FROM json_each(revision.`allowed_kinds`) kind WHERE kind.`value` = NEW.`kind`)
       AND (NEW.`status` <> 'ACTIVE' OR NEW.`creation_origin` <> 'INFERRED' OR revision.`candidate_review_required` = 0)
       AND (
         NEW.`status` = 'PROPOSED'
         OR (NEW.`status` = 'ACTIVE' AND (
           (NEW.`creation_origin` = 'EXPLICIT' AND NEW.`confidence_units` >= revision.`explicit_min_confidence_units`)
           OR (NEW.`creation_origin` = 'INFERRED' AND NEW.`confidence_units` >= revision.`inferred_min_confidence_units`)
         ))
       )
   )
   OR (NEW.`creation_origin` = 'INFERRED' AND NEW.`scope` = 'GLOBAL' AND NEW.`kind` IN ('PREFERRED_NAME','FORM_OF_ADDRESS'))
 )
BEGIN
  SELECT RAISE(ABORT, 'AI Memory mutation scope or current authorized Policy constraint is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_current_policy_update_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`status` IN ('PROPOSED','ACTIVE')
 AND NEW.`creation_origin` IN ('EXPLICIT','INFERRED')
 AND NOT (OLD.`status` = 'PROPOSED' AND NEW.`status` = 'ACTIVE' AND NEW.`safe_review_code` = 'STUDENT_APPROVED')
 AND (
   NOT EXISTS (
     SELECT 1
     FROM `ai_memory_policies` policy
     JOIN `ai_memory_policy_revisions` revision
       ON revision.`memory_policy_id` = policy.`id`
      AND revision.`revision` = policy.`current_revision`
     WHERE policy.`id` = NEW.`memory_policy_id`
       AND policy.`m10a2_mutation_authority` = 1
       AND NEW.`memory_policy_revision` = policy.`current_revision`
       AND policy.`scope` = NEW.`scope`
       AND policy.`subject_key` IS NEW.`subject_key`
       AND revision.`enabled` = 1
       AND revision.`mutation_enabled` = 1
       AND EXISTS (SELECT 1 FROM json_each(revision.`allowed_kinds`) kind WHERE kind.`value` = NEW.`kind`)
       AND (NEW.`status` <> 'ACTIVE' OR NEW.`creation_origin` <> 'INFERRED' OR revision.`candidate_review_required` = 0)
       AND (
         NEW.`status` = 'PROPOSED'
         OR (NEW.`status` = 'ACTIVE' AND (
           (NEW.`creation_origin` = 'EXPLICIT' AND NEW.`confidence_units` >= revision.`explicit_min_confidence_units`)
           OR (NEW.`creation_origin` = 'INFERRED' AND NEW.`confidence_units` >= revision.`inferred_min_confidence_units`)
         ))
       )
   )
   OR (NEW.`creation_origin` = 'INFERRED' AND NEW.`scope` = 'GLOBAL' AND NEW.`kind` IN ('PREFERRED_NAME','FORM_OF_ADDRESS'))
 )
BEGIN
  SELECT RAISE(ABORT, 'AI Memory mutation scope or current authorized Policy constraint is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_current_inferred_evidence_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`status` = 'ACTIVE'
 AND NEW.`creation_origin` = 'INFERRED'
 AND NEW.`safe_review_code` IN ('INFERRED_ACTIVATED','SYSTEM_AUTO_APPROVED')
 AND (
   SELECT COUNT(DISTINCT evidence.`response_id`)
   FROM `ai_memory_provenance` evidence
   WHERE evidence.`memory_id` = NEW.`id`
     AND evidence.`memory_revision` IN (OLD.`revision`, NEW.`revision`)
     AND evidence.`source_state` = 'ACTIVE'
 ) < COALESCE((
   SELECT revision.`inferred_min_distinct_evidence_turns`
   FROM `ai_memory_policies` policy
   JOIN `ai_memory_policy_revisions` revision
     ON revision.`memory_policy_id` = policy.`id`
    AND revision.`revision` = policy.`current_revision`
   WHERE policy.`id` = NEW.`memory_policy_id`
     AND NEW.`memory_policy_revision` = policy.`current_revision`
 ), 2)
BEGIN
  SELECT RAISE(ABORT, 'AI inferred Memory requires current Policy evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_inferred_global_kind_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`creation_origin` = 'INFERRED'
 AND NEW.`scope` = 'GLOBAL'
 AND NEW.`kind` IN ('PREFERRED_NAME','FORM_OF_ADDRESS')
BEGIN
  SELECT RAISE(ABORT, 'AI inferred Global Memory kind is not allowed');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_quota_valid`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_update_quota_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_current_quota_valid`
BEFORE INSERT ON `ai_memories`
WHEN (
  NEW.`status` = 'ACTIVE'
  AND (SELECT COUNT(*) FROM `ai_memories` existing WHERE existing.`principal_ref` = NEW.`principal_ref` AND existing.`scope` = NEW.`scope` AND existing.`subject_key` IS NEW.`subject_key` AND existing.`status` = 'ACTIVE') >= COALESCE((
    SELECT revision.`hard_active_maximum`
    FROM `ai_memory_policies` policy
    JOIN `ai_memory_policy_revisions` revision ON revision.`memory_policy_id` = policy.`id` AND revision.`revision` = policy.`current_revision`
    WHERE policy.`id` = NEW.`memory_policy_id`
  ), 0)
 ) OR (
  NEW.`status` = 'PROPOSED'
  AND (SELECT COUNT(*) FROM `ai_memories` existing WHERE existing.`principal_ref` = NEW.`principal_ref` AND existing.`scope` = NEW.`scope` AND existing.`subject_key` IS NEW.`subject_key` AND existing.`status` = 'PROPOSED') >= COALESCE((
    SELECT revision.`proposed_hard_maximum`
    FROM `ai_memory_policies` policy
    JOIN `ai_memory_policy_revisions` revision ON revision.`memory_policy_id` = policy.`id` AND revision.`revision` = policy.`current_revision`
    WHERE policy.`id` = NEW.`memory_policy_id`
  ), 0)
 )
BEGIN
  SELECT RAISE(ABORT, 'AI Memory current Policy quota has been reached');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_current_update_quota_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`status` = 'ACTIVE'
 AND OLD.`status` <> 'ACTIVE'
 AND (SELECT COUNT(*) FROM `ai_memories` existing WHERE existing.`principal_ref` = NEW.`principal_ref` AND existing.`scope` = NEW.`scope` AND existing.`subject_key` IS NEW.`subject_key` AND existing.`status` = 'ACTIVE') >= COALESCE((
   SELECT revision.`hard_active_maximum`
   FROM `ai_memory_policies` policy
   JOIN `ai_memory_policy_revisions` revision ON revision.`memory_policy_id` = policy.`id` AND revision.`revision` = policy.`current_revision`
   WHERE policy.`id` = NEW.`memory_policy_id`
 ), 0)
BEGIN
  SELECT RAISE(ABORT, 'AI Memory current Policy quota has been reached');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `ai_memories_update_text_bound_valid`;
--> statement-breakpoint
CREATE TRIGGER `ai_memories_current_text_bound_valid`
BEFORE UPDATE ON `ai_memories`
WHEN NEW.`memory_text` IS NOT NULL
 AND NOT (OLD.`status` = 'PROPOSED' AND NEW.`status` = 'ACTIVE' AND NEW.`safe_review_code` = 'STUDENT_APPROVED')
 AND length(cast(NEW.`memory_text` AS blob)) > COALESCE((
   SELECT revision.`per_memory_max_bytes`
   FROM `ai_memory_policies` policy
   JOIN `ai_memory_policy_revisions` revision ON revision.`memory_policy_id` = policy.`id` AND revision.`revision` = policy.`current_revision`
   WHERE policy.`id` = NEW.`memory_policy_id`
 ), 0)
BEGIN
  SELECT RAISE(ABORT, 'AI Memory text exceeds current Policy bound');
END;
