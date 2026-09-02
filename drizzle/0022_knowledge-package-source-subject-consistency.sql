CREATE TRIGGER `ai_knowledge_package_revisions_source_subject_consistency`
BEFORE INSERT ON `ai_knowledge_package_revisions`
BEGIN
	SELECT RAISE(ABORT, 'AI Knowledge Package and Source subjects must match')
	WHERE NOT EXISTS (
		SELECT 1
		FROM `ai_knowledge_packages` AS p
		JOIN `ai_knowledge_source_revisions` AS sr
			ON sr.`source_id` = NEW.`source_id`
			AND sr.`revision` = NEW.`source_revision`
		JOIN `ai_knowledge_sources` AS s
			ON s.`id` = sr.`source_id`
		WHERE p.`id` = NEW.`package_id`
			AND p.`subject_key` = s.`subject_key`
	);
END;
