import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  ensurePythagorasDataDirectories,
  resolvePythagorasDataDirectory,
  type PythagorasDataPaths,
} from "./data-directory";
import { ContentFoundationError } from "./errors";
import * as schema from "./schema";

export interface OpenContentDatabaseOptions {
  dataDirectory?: string;
  migrationsDirectory?: string;
}

export interface ContentDatabase {
  client: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  paths: PythagorasDataPaths;
  close(): void;
}

export interface ContentDatabaseStatus {
  database: "sqlite";
  journalMode: string;
  migrationsApplied: number;
  configuredDataDirectory: boolean;
}

export function openContentDatabase(
  options: OpenContentDatabaseOptions = {},
): ContentDatabase {
  const dataDirectory = options.dataDirectory ?? resolvePythagorasDataDirectory();
  const migrationsDirectory =
    options.migrationsDirectory ?? path.join(process.cwd(), "drizzle");

  let client: Database.Database | undefined;

  try {
    const paths = ensurePythagorasDataDirectories(dataDirectory);
    client = new Database(paths.databaseFile);
    client.pragma("foreign_keys = ON");
    client.pragma("busy_timeout = 5000");
    client.pragma("journal_mode = WAL");
    client.pragma("synchronous = NORMAL");

    const db = drizzle(client, { schema });
    migrate(db, { migrationsFolder: migrationsDirectory });

    return {
      client,
      db,
      paths,
      close: () => client?.close(),
    };
  } catch (error) {
    client?.close();
    throw new ContentFoundationError(
      "CONTENT_STORAGE_UNAVAILABLE",
      "The local content database could not be initialized.",
      error,
    );
  }
}

type ContentDatabaseGlobal = typeof globalThis & {
  __pythagorasContentDatabase?: ContentDatabase;
};

export function getContentDatabase(): ContentDatabase {
  const contentGlobal = globalThis as ContentDatabaseGlobal;
  if (!contentGlobal.__pythagorasContentDatabase) {
    contentGlobal.__pythagorasContentDatabase = openContentDatabase();
  }
  return contentGlobal.__pythagorasContentDatabase;
}

export function getContentDatabaseStatus(
  database = getContentDatabase(),
): ContentDatabaseStatus {
  const migrationRow = database.client
    .prepare("select count(*) as count from __drizzle_migrations")
    .get() as { count: number };
  const journalRow = database.client.pragma("journal_mode", { simple: true });

  return {
    database: "sqlite",
    journalMode: String(journalRow),
    migrationsApplied: migrationRow.count,
    configuredDataDirectory: Boolean(process.env.PYTHAGORAS_DATA_DIR?.trim()),
  };
}
