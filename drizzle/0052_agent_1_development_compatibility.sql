PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_agent_instruction_conformance` (
	`id` text PRIMARY KEY NOT NULL,
	`model_config_id` text NOT NULL,
	`model_revision` integer NOT NULL,
	`provider_id` text NOT NULL,
	`provider_revision` integer NOT NULL,
	`adapter_key` text NOT NULL,
	`api_format` text NOT NULL,
	`channel` text NOT NULL,
	`assurance_tier` text DEFAULT 'STRICT' NOT NULL,
	`framing_version` integer DEFAULT 0 NOT NULL,
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
	CONSTRAINT "ai_agent_conformance_status_valid" CHECK("__new_ai_agent_instruction_conformance"."status" in ('PASS','FAIL','ERROR')),
	CONSTRAINT "ai_agent_conformance_source_valid" CHECK("__new_ai_agent_instruction_conformance"."source" in ('LIVE_PROBE','STATIC_ANALYSIS')),
	CONSTRAINT "ai_agent_conformance_versions_positive" CHECK("__new_ai_agent_instruction_conformance"."model_revision" > 0 and "__new_ai_agent_instruction_conformance"."provider_revision" > 0 and "__new_ai_agent_instruction_conformance"."conformance_version" > 0 and "__new_ai_agent_instruction_conformance"."framework_version" > 0 and "__new_ai_agent_instruction_conformance"."classifier_version" > 0),
	CONSTRAINT "ai_agent_conformance_created_nonnegative" CHECK("__new_ai_agent_instruction_conformance"."created_at" >= 0),
	CONSTRAINT "ai_agent_conformance_hashes_valid" CHECK(length("__new_ai_agent_instruction_conformance"."transport_fingerprint") = 64 and length("__new_ai_agent_instruction_conformance"."framework_hash") = 64),
	CONSTRAINT "ai_agent_conformance_evidence_json" CHECK(json_valid("__new_ai_agent_instruction_conformance"."evidence") and (("__new_ai_agent_instruction_conformance"."assurance_tier" = 'STRICT' and json_array_length("__new_ai_agent_instruction_conformance"."evidence") = 3 and "__new_ai_agent_instruction_conformance"."framing_version" = 0) or ("__new_ai_agent_instruction_conformance"."assurance_tier" = 'DEVELOPMENT_FLATTENED' and json_array_length("__new_ai_agent_instruction_conformance"."evidence") = 4 and "__new_ai_agent_instruction_conformance"."framing_version" > 0))),
	CONSTRAINT "ai_agent_conformance_pass_live" CHECK("__new_ai_agent_instruction_conformance"."status" != 'PASS' or ("__new_ai_agent_instruction_conformance"."source" = 'LIVE_PROBE' and "__new_ai_agent_instruction_conformance"."reason" is null))
);
--> statement-breakpoint
-- New fields deliberately use STRICT/0 defaults; historical evidence bytes are copied unchanged.
INSERT INTO `__new_ai_agent_instruction_conformance`("id", "model_config_id", "model_revision", "provider_id", "provider_revision", "adapter_key", "api_format", "channel", "transport_fingerprint", "classifier_version", "conformance_version", "framework_version", "framework_hash", "status", "reason", "source", "evidence", "created_at", "created_by") SELECT "id", "model_config_id", "model_revision", "provider_id", "provider_revision", "adapter_key", "api_format", "channel", "transport_fingerprint", "classifier_version", "conformance_version", "framework_version", "framework_hash", "status", "reason", "source", "evidence", "created_at", "created_by" FROM `ai_agent_instruction_conformance`;--> statement-breakpoint
DROP TABLE `ai_agent_instruction_conformance`;--> statement-breakpoint
ALTER TABLE `__new_ai_agent_instruction_conformance` RENAME TO `ai_agent_instruction_conformance`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_agent_conformance_model_latest` ON `ai_agent_instruction_conformance` (`model_config_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `ai_agent_conformance_immutable_update`
BEFORE UPDATE ON `ai_agent_instruction_conformance`
BEGIN
  SELECT RAISE(ABORT, 'Agent instruction conformance evidence is immutable');
END;
