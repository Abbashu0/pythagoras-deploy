PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_eval_gate_results` (
	`run_id` text NOT NULL,
	`gate_key` text NOT NULL,
	`verdict` text NOT NULL,
	`observed_value` integer,
	`threshold_value` integer,
	`safe_reason_code` text NOT NULL,
	`accounting_basis` text,
	PRIMARY KEY(`run_id`, `gate_key`),
	FOREIGN KEY (`run_id`) REFERENCES `ai_eval_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_eval_gate_results_key_valid" CHECK(length(trim("__new_ai_eval_gate_results"."gate_key")) between 1 and 160 and "__new_ai_eval_gate_results"."gate_key" not glob '*[^A-Z0-9_-]*'),
	CONSTRAINT "ai_eval_gate_results_verdict_valid" CHECK("__new_ai_eval_gate_results"."verdict" in ('PASS','BLOCKED','INCOMPLETE')),
	CONSTRAINT "ai_eval_gate_results_values_valid" CHECK("__new_ai_eval_gate_results"."observed_value" is null or "__new_ai_eval_gate_results"."observed_value" >= 0),
	CONSTRAINT "ai_eval_gate_results_threshold_valid" CHECK("__new_ai_eval_gate_results"."threshold_value" is null or "__new_ai_eval_gate_results"."threshold_value" >= 0),
	CONSTRAINT "ai_eval_gate_results_reason_valid" CHECK(length(trim("__new_ai_eval_gate_results"."safe_reason_code")) between 1 and 160 and "__new_ai_eval_gate_results"."safe_reason_code" not glob '*[^A-Z0-9_-]*'),
	CONSTRAINT "ai_eval_gate_results_accounting_basis_valid" CHECK("__new_ai_eval_gate_results"."accounting_basis" is null or (json_valid("__new_ai_eval_gate_results"."accounting_basis") and json_type("__new_ai_eval_gate_results"."accounting_basis") = 'object' and length(cast("__new_ai_eval_gate_results"."accounting_basis" as blob)) <= 1048576))
);
--> statement-breakpoint
INSERT INTO `__new_ai_eval_gate_results`("run_id", "gate_key", "verdict", "observed_value", "threshold_value", "safe_reason_code", "accounting_basis") SELECT "run_id", "gate_key", "verdict", "observed_value", "threshold_value", "safe_reason_code", NULL FROM `ai_eval_gate_results`;--> statement-breakpoint
DROP TABLE `ai_eval_gate_results`;--> statement-breakpoint
ALTER TABLE `__new_ai_eval_gate_results` RENAME TO `ai_eval_gate_results`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TRIGGER `ai_usage_cost_records_operation_open`
BEFORE INSERT ON `ai_usage_cost_records`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_cost_operations` AS operation
  WHERE operation.`id` = NEW.`operation_id` AND operation.`status` = 'OPEN'
)
BEGIN
  SELECT RAISE(ABORT, 'Usage cost records require an OPEN cost operation');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_usage_cost_records_update_blocked`
BEFORE UPDATE ON `ai_usage_cost_records`
BEGIN
  SELECT RAISE(ABORT, 'Usage cost records are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_usage_cost_records_delete_blocked`
BEFORE DELETE ON `ai_usage_cost_records`
BEGIN
  SELECT RAISE(ABORT, 'Usage cost records are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_cost_corrections_update_blocked`
BEFORE UPDATE ON `ai_cost_corrections`
BEGIN
  SELECT RAISE(ABORT, 'Cost corrections are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_cost_corrections_delete_blocked`
BEFORE DELETE ON `ai_cost_corrections`
BEGIN
  SELECT RAISE(ABORT, 'Cost corrections are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_gate_results_insert_valid`
BEFORE INSERT ON `ai_eval_gate_results`
WHEN NOT EXISTS (
  SELECT 1 FROM `ai_eval_runs` AS run
  WHERE run.`id` = NEW.`run_id` AND run.`status` = 'SCORING'
)
BEGIN
  SELECT RAISE(ABORT, 'Eval gates require a SCORING Run');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_gate_results_accounting_basis_scope`
BEFORE INSERT ON `ai_eval_gate_results`
WHEN (NEW.`accounting_basis` IS NOT NULL AND NEW.`gate_key` <> 'MAX_COST_NANO')
 OR (NEW.`gate_key` = 'MAX_COST_NANO' AND NEW.`verdict` IN ('PASS','BLOCKED') AND NEW.`accounting_basis` IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Eval cost gate accounting basis is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_gate_results_update_blocked`
BEFORE UPDATE ON `ai_eval_gate_results`
BEGIN
  SELECT RAISE(ABORT, 'Eval gate results are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_eval_gate_results_delete_blocked`
BEFORE DELETE ON `ai_eval_gate_results`
BEGIN
  SELECT RAISE(ABORT, 'Eval gate results are append-only');
END;
