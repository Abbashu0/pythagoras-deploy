CREATE TABLE `question_search_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`package_id` text NOT NULL,
	`segment_type` text NOT NULL,
	`variant_id` text,
	`occurrence_id` text,
	`source_ref_id` text,
	`normalized_text` text NOT NULL,
	`display_text` text NOT NULL,
	`index_version` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_id`) REFERENCES `question_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `question_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`occurrence_id`) REFERENCES `question_occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "question_search_documents_segment_valid" CHECK("question_search_documents"."segment_type" in ('PRIMARY_VARIANT','ALTERNATE_VARIANT','ANSWER','TAXONOMY','PROVENANCE')),
	CONSTRAINT "question_search_documents_version_positive" CHECK("question_search_documents"."index_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `question_search_documents_question_index` ON `question_search_documents` (`question_id`,`index_version`);--> statement-breakpoint
CREATE INDEX `question_search_documents_package_index` ON `question_search_documents` (`package_id`,`index_version`);--> statement-breakpoint
CREATE INDEX `question_search_documents_segment_index` ON `question_search_documents` (`segment_type`,`variant_id`,`occurrence_id`);
--> statement-breakpoint
-- Rebuildable FTS5 projection. Canonical Question content remains in relational
-- tables; this virtual table is deliberately empty after migration.
CREATE VIRTUAL TABLE `question_search_fts` USING fts5(
  `document_id` UNINDEXED,
  `normalized_text`,
  tokenize = 'unicode61 remove_diacritics 0'
);
