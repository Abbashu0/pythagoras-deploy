import { getContentDatabase, type ContentDatabase } from "../content/database";
import { SQLiteCanonicalContentRepository } from "./sqlite-canonical-content-repository";

type CanonicalGlobal = typeof globalThis & { __pythagorasCanonicalContentRepository?: SQLiteCanonicalContentRepository };

export function createCanonicalContentRepository(database: ContentDatabase): SQLiteCanonicalContentRepository {
  const repository = new SQLiteCanonicalContentRepository(database);
  repository.bootstrap();
  return repository;
}

export function getCanonicalContentRepository(): SQLiteCanonicalContentRepository {
  const target = globalThis as CanonicalGlobal;
  if (!target.__pythagorasCanonicalContentRepository) {
    target.__pythagorasCanonicalContentRepository = createCanonicalContentRepository(getContentDatabase());
  }
  return target.__pythagorasCanonicalContentRepository;
}
