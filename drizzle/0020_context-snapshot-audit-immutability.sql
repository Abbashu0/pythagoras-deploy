CREATE TRIGGER `ai_context_snapshots_no_delete`
BEFORE DELETE ON `ai_context_snapshots`
BEGIN
	SELECT RAISE(ABORT, 'AI Context Snapshots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `ai_context_snapshot_items_no_delete`
BEFORE DELETE ON `ai_context_snapshot_items`
BEGIN
	SELECT RAISE(ABORT, 'AI Context Snapshot items are immutable');
END;
