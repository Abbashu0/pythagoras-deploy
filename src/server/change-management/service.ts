import { getContentDatabase, type ContentDatabase } from "../content/database";
import { createDefaultChangeResourceRegistry, type ChangeResourceAdapterRegistry } from "./adapter-registry";
import { ChangeManagementService } from "./change-management-service";
import { SQLiteChangeEventRepository } from "./sqlite-change-event-repository";
import { SQLiteChangeSetRepository } from "./sqlite-change-set-repository";
import { SQLitePublicationRepository } from "./sqlite-publication-repository";

export function createChangeManagementService(
  database: ContentDatabase,
  registry: ChangeResourceAdapterRegistry = createDefaultChangeResourceRegistry(),
): ChangeManagementService {
  return new ChangeManagementService(
    database,
    new SQLiteChangeSetRepository(database),
    new SQLiteChangeEventRepository(database),
    new SQLitePublicationRepository(database),
    registry,
  );
}

type ChangeManagementGlobal = typeof globalThis & {
  __pythagorasChangeManagementService?: ChangeManagementService;
};

export function getChangeManagementService(): ChangeManagementService {
  const changeGlobal = globalThis as ChangeManagementGlobal;
  if (!changeGlobal.__pythagorasChangeManagementService) {
    changeGlobal.__pythagorasChangeManagementService = createChangeManagementService(getContentDatabase());
  }
  return changeGlobal.__pythagorasChangeManagementService;
}
