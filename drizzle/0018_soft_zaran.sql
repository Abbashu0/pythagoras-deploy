CREATE TABLE `ai_conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`is_partial` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_conversation_messages_ordinal_positive" CHECK("ai_conversation_messages"."ordinal" >= 1),
	CONSTRAINT "ai_conversation_messages_role_valid" CHECK("ai_conversation_messages"."role" in ('USER','ASSISTANT')),
	CONSTRAINT "ai_conversation_messages_content_valid" CHECK(length(cast("ai_conversation_messages"."content" as blob)) between 1 and 524288),
	CONSTRAINT "ai_conversation_messages_partial_boolean" CHECK("ai_conversation_messages"."is_partial" in (0,1)),
	CONSTRAINT "ai_conversation_messages_created_nonnegative" CHECK("ai_conversation_messages"."created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_conversation_messages_ordinal_unique` ON `ai_conversation_messages` (`conversation_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `ai_conversation_messages_conversation_index` ON `ai_conversation_messages` (`conversation_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `ai_conversation_response_chunks` (
	`response_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`text` text NOT NULL,
	`text_hash` text NOT NULL,
	`byte_length` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`response_id`, `sequence`),
	FOREIGN KEY (`response_id`) REFERENCES `ai_conversation_responses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_conversation_response_chunks_sequence_valid" CHECK("ai_conversation_response_chunks"."sequence" between 0 and 100000000),
	CONSTRAINT "ai_conversation_response_chunks_text_valid" CHECK(length(cast("ai_conversation_response_chunks"."text" as blob)) between 1 and 16384),
	CONSTRAINT "ai_conversation_response_chunks_hash_valid" CHECK(length("ai_conversation_response_chunks"."text_hash") = 64 and "ai_conversation_response_chunks"."text_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_conversation_response_chunks_byte_length_valid" CHECK("ai_conversation_response_chunks"."byte_length" = length(cast("ai_conversation_response_chunks"."text" as blob)) and "ai_conversation_response_chunks"."byte_length" between 1 and 16384),
	CONSTRAINT "ai_conversation_response_chunks_created_nonnegative" CHECK("ai_conversation_response_chunks"."created_at" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ai_conversation_response_chunks_response_index` ON `ai_conversation_response_chunks` (`response_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `ai_conversation_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`principal_ref` text NOT NULL,
	`idempotency_key` text,
	`request_fingerprint` text,
	`request_message_id` text,
	`assistant_message_id` text,
	`status` text NOT NULL,
	`next_chunk_sequence` integer DEFAULT 0 NOT NULL,
	`output_bytes` integer DEFAULT 0 NOT NULL,
	`finish_reason` text,
	`safe_error_code` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`request_message_id`) REFERENCES `ai_conversation_messages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `ai_conversation_messages`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`,`principal_ref`) REFERENCES `ai_conversations`(`id`,`principal_ref`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_conversation_responses_principal_valid" CHECK(length(trim("ai_conversation_responses"."principal_ref")) between 1 and 200 and "ai_conversation_responses"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_conversation_responses_idempotency_valid" CHECK("ai_conversation_responses"."idempotency_key" is null or length(trim("ai_conversation_responses"."idempotency_key")) between 1 and 200),
	CONSTRAINT "ai_conversation_responses_fingerprint_valid" CHECK("ai_conversation_responses"."request_fingerprint" is null or (length("ai_conversation_responses"."request_fingerprint") = 64 and "ai_conversation_responses"."request_fingerprint" not glob '*[^0-9a-f]*')),
	CONSTRAINT "ai_conversation_responses_status_valid" CHECK("ai_conversation_responses"."status" in ('PENDING','STREAMING','COMPLETED','FAILED','CANCELLED')),
	CONSTRAINT "ai_conversation_responses_sequence_valid" CHECK("ai_conversation_responses"."next_chunk_sequence" between 0 and 100000000),
	CONSTRAINT "ai_conversation_responses_output_bytes_valid" CHECK("ai_conversation_responses"."output_bytes" between 0 and 524288),
	CONSTRAINT "ai_conversation_responses_finish_reason_valid" CHECK("ai_conversation_responses"."finish_reason" is null or "ai_conversation_responses"."finish_reason" in ('STOP','LENGTH','CONTENT_FILTER','OTHER','FAILED','CANCELLED')),
	CONSTRAINT "ai_conversation_responses_error_code_valid" CHECK("ai_conversation_responses"."safe_error_code" is null or "ai_conversation_responses"."safe_error_code" in ('AI_CONVERSATION_RESPONSE_INVALID','AI_CONVERSATION_STREAM_CONFLICT','AI_CONVERSATION_CANCELLED','AI_CONVERSATION_DELETED','AI_CONVERSATION_INTERNAL')),
	CONSTRAINT "ai_conversation_responses_created_nonnegative" CHECK("ai_conversation_responses"."created_at" >= 0),
	CONSTRAINT "ai_conversation_responses_updated_ordered" CHECK("ai_conversation_responses"."updated_at" >= "ai_conversation_responses"."created_at"),
	CONSTRAINT "ai_conversation_responses_started_ordered" CHECK("ai_conversation_responses"."started_at" is null or "ai_conversation_responses"."started_at" >= "ai_conversation_responses"."created_at"),
	CONSTRAINT "ai_conversation_responses_completed_ordered" CHECK("ai_conversation_responses"."completed_at" is null or "ai_conversation_responses"."completed_at" >= "ai_conversation_responses"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_conversation_responses_principal_idempotency_unique` ON `ai_conversation_responses` (`principal_ref`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_conversation_responses_one_active_unique` ON `ai_conversation_responses` (`conversation_id`) WHERE "ai_conversation_responses"."status" in ('PENDING','STREAMING');--> statement-breakpoint
CREATE INDEX `ai_conversation_responses_conversation_index` ON `ai_conversation_responses` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_conversation_responses_principal_index` ON `ai_conversation_responses` (`principal_ref`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_ref` text NOT NULL,
	`subject_key` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`deleted_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`subject_key`) REFERENCES `canonical_materials`(`subject_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_conversations_principal_valid" CHECK(length(trim("ai_conversations"."principal_ref")) between 1 and 200 and "ai_conversations"."principal_ref" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "ai_conversations_subject_valid" CHECK(length(trim("ai_conversations"."subject_key")) between 1 and 80 and "ai_conversations"."subject_key" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "ai_conversations_status_valid" CHECK("ai_conversations"."status" in ('ACTIVE','DELETED')),
	CONSTRAINT "ai_conversations_revision_positive" CHECK("ai_conversations"."revision" >= 1),
	CONSTRAINT "ai_conversations_created_nonnegative" CHECK("ai_conversations"."created_at" >= 0),
	CONSTRAINT "ai_conversations_updated_ordered" CHECK("ai_conversations"."updated_at" >= "ai_conversations"."created_at"),
	CONSTRAINT "ai_conversations_activity_ordered" CHECK("ai_conversations"."last_activity_at" >= "ai_conversations"."created_at"),
	CONSTRAINT "ai_conversations_deleted_consistent" CHECK(("ai_conversations"."status" = 'ACTIVE' and "ai_conversations"."deleted_at" is null) or ("ai_conversations"."status" = 'DELETED' and "ai_conversations"."deleted_at" is not null and "ai_conversations"."deleted_at" >= "ai_conversations"."created_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_conversations_identity_unique` ON `ai_conversations` (`id`,`principal_ref`);--> statement-breakpoint
CREATE INDEX `ai_conversations_principal_activity_index` ON `ai_conversations` (`principal_ref`,`status`,`last_activity_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_conversations_subject_index` ON `ai_conversations` (`subject_key`,`status`,`last_activity_at`);
--> statement-breakpoint
CREATE TRIGGER `ai_conversations_identity_immutable`
BEFORE UPDATE OF `principal_ref`, `subject_key` ON `ai_conversations`
WHEN NEW.`principal_ref` <> OLD.`principal_ref` OR NEW.`subject_key` <> OLD.`subject_key`
BEGIN
	SELECT RAISE(ABORT, 'AI conversation identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_conversation_messages_immutable`
BEFORE UPDATE ON `ai_conversation_messages`
BEGIN
	SELECT RAISE(ABORT, 'AI conversation messages are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_conversation_responses_identity_immutable`
BEFORE UPDATE OF `conversation_id`, `principal_ref` ON `ai_conversation_responses`
WHEN NEW.`conversation_id` <> OLD.`conversation_id` OR NEW.`principal_ref` <> OLD.`principal_ref`
BEGIN
	SELECT RAISE(ABORT, 'AI conversation response identity is immutable');
END;
