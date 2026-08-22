import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ContentDatabase } from "../content/database";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

export async function createPreCutoverBackup(database: ContentDatabase): Promise<void> {
  const directory = path.join(database.paths.backupsDirectory, `pre-cutover-${timestamp()}`);
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, "pythagoras.sqlite");
  await database.client.backup(target);
  const verification = new Database(target, { readonly: true, fileMustExist: true });
  try {
    const result = String(verification.pragma("quick_check", { simple: true }));
    if (result !== "ok") throw new Error("PRE_CUTOVER_BACKUP_INTEGRITY_FAILED");
  } finally {
    verification.close();
  }
}
