CREATE TABLE `ai_agent_instruction_conformance` (
	`id` text PRIMARY KEY NOT NULL,
	`model_config_id` text NOT NULL,
	`model_revision` integer NOT NULL,
	`provider_id` text NOT NULL,
	`provider_revision` integer NOT NULL,
	`adapter_key` text NOT NULL,
	`api_format` text NOT NULL,
	`channel` text NOT NULL,
	`transport_fingerprint` text NOT NULL,
	`classifier_version` integer NOT NULL,
	`conformance_version` integer NOT NULL,
	`framework_version` integer NOT NULL,
	`framework_hash` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`source` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`model_config_id`) REFERENCES `ai_model_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_provider_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_agent_conformance_status_valid" CHECK("ai_agent_instruction_conformance"."status" in ('PASS','FAIL','ERROR')),
	CONSTRAINT "ai_agent_conformance_source_valid" CHECK("ai_agent_instruction_conformance"."source" in ('LIVE_PROBE','STATIC_ANALYSIS')),
	CONSTRAINT "ai_agent_conformance_versions_positive" CHECK("ai_agent_instruction_conformance"."model_revision" > 0 and "ai_agent_instruction_conformance"."provider_revision" > 0 and "ai_agent_instruction_conformance"."conformance_version" > 0 and "ai_agent_instruction_conformance"."framework_version" > 0 and "ai_agent_instruction_conformance"."classifier_version" > 0),
	CONSTRAINT "ai_agent_conformance_created_nonnegative" CHECK("ai_agent_instruction_conformance"."created_at" >= 0),
	CONSTRAINT "ai_agent_conformance_hashes_valid" CHECK(length("ai_agent_instruction_conformance"."transport_fingerprint") = 64 and length("ai_agent_instruction_conformance"."framework_hash") = 64),
	CONSTRAINT "ai_agent_conformance_evidence_json" CHECK(json_valid("ai_agent_instruction_conformance"."evidence") and json_array_length("ai_agent_instruction_conformance"."evidence") = 3),
	CONSTRAINT "ai_agent_conformance_pass_live" CHECK("ai_agent_instruction_conformance"."status" != 'PASS' or ("ai_agent_instruction_conformance"."source" = 'LIVE_PROBE' and "ai_agent_instruction_conformance"."reason" is null))
);
--> statement-breakpoint
CREATE INDEX `ai_agent_conformance_model_latest` ON `ai_agent_instruction_conformance` (`model_config_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `ai_agent_conformance_immutable_update`
BEFORE UPDATE ON `ai_agent_instruction_conformance`
BEGIN
  SELECT RAISE(ABORT, 'Agent instruction conformance evidence is immutable');
END;
