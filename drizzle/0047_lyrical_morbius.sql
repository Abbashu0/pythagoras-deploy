ALTER TABLE `canonical_banners` ADD `starts_at` integer;--> statement-breakpoint
ALTER TABLE `canonical_banners` ADD `ends_at` integer;--> statement-breakpoint
CREATE TRIGGER `canonical_banners_schedule_insert_valid`
BEFORE INSERT ON `canonical_banners`
WHEN NOT (
  (NEW.`starts_at` IS NULL OR (typeof(NEW.`starts_at`) = 'integer' AND NEW.`starts_at` >= 0))
  AND (NEW.`ends_at` IS NULL OR (typeof(NEW.`ends_at`) = 'integer' AND NEW.`ends_at` >= 0))
  AND (NEW.`starts_at` IS NULL OR NEW.`ends_at` IS NULL OR NEW.`ends_at` > NEW.`starts_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'Canonical banner schedule is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `canonical_banners_schedule_update_valid`
BEFORE UPDATE OF `starts_at`, `ends_at` ON `canonical_banners`
WHEN NOT (
  (NEW.`starts_at` IS NULL OR (typeof(NEW.`starts_at`) = 'integer' AND NEW.`starts_at` >= 0))
  AND (NEW.`ends_at` IS NULL OR (typeof(NEW.`ends_at`) = 'integer' AND NEW.`ends_at` >= 0))
  AND (NEW.`starts_at` IS NULL OR NEW.`ends_at` IS NULL OR NEW.`ends_at` > NEW.`starts_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'Canonical banner schedule is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `canonical_banners_image_asset_insert_valid`
BEFORE INSERT ON `canonical_banners`
WHEN NEW.`asset_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `assets`
    WHERE `assets`.`id` = NEW.`asset_id`
      AND `assets`.`media_kind` = 'image'
      AND `assets`.`mime_type` LIKE 'image/%'
  )
BEGIN
  SELECT RAISE(ABORT, 'Canonical banners require a validated image Asset');
END;--> statement-breakpoint
CREATE TRIGGER `canonical_banners_image_asset_update_valid`
BEFORE UPDATE OF `asset_id` ON `canonical_banners`
WHEN NEW.`asset_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `assets`
    WHERE `assets`.`id` = NEW.`asset_id`
      AND `assets`.`media_kind` = 'image'
      AND `assets`.`mime_type` LIKE 'image/%'
  )
BEGIN
  SELECT RAISE(ABORT, 'Canonical banners require a validated image Asset');
END;
