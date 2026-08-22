import { getAssetService, type AssetService } from "../assets";
import { getContentDatabase, type ContentDatabase } from "../content";
import { LegacyMigrationService } from "./legacy-migration-service";
import { SQLiteLegacyMigrationRepository } from "./sqlite-legacy-migration-repository";

export function createLegacyMigrationService(database: ContentDatabase, assets: AssetService): LegacyMigrationService {
  return new LegacyMigrationService(new SQLiteLegacyMigrationRepository(database), assets);
}

type LegacyGlobal = typeof globalThis & { __pythagorasLegacyMigrationService?: LegacyMigrationService };
export function getLegacyMigrationService(): LegacyMigrationService {
  const global = globalThis as LegacyGlobal;
  if (!global.__pythagorasLegacyMigrationService) global.__pythagorasLegacyMigrationService = createLegacyMigrationService(getContentDatabase(), getAssetService());
  return global.__pythagorasLegacyMigrationService;
}
