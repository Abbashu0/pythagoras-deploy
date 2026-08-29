import { Platform } from 'react-native';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { PublicRichDocument } from '@/question-bank/question-bank-api';

export const FAVORITES_DATABASE_NAME = 'pythagoras-favorites.db';
export const FAVORITES_TABLE_NAME = 'question_favorites';

export interface FavoriteRecord {
  subjectKey: string;
  questionId: string;
  bankNodeId: string;
  ordinal: number;
  ministerialCount: number;
  previewText: string;
  previewRich: PublicRichDocument;
  createdAt: number;
}

export interface FavoriteQuestionContext {
  ordinal: number;
  ministerialCount: number;
  previewText: string;
  previewRich: PublicRichDocument;
}

let databasePromise: Promise<SQLiteDatabase> | null = null;

function isWeb() {
  return Platform.OS === 'web';
}

function getDatabase(): Promise<SQLiteDatabase> {
  if (isWeb()) {
    return Promise.reject(new Error('SQLite favorites are unavailable on web.'));
  }

  databasePromise ??= openDatabaseAsync(FAVORITES_DATABASE_NAME).then(async (database) => {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS ${FAVORITES_TABLE_NAME} (
        subject_key TEXT NOT NULL,
        question_id TEXT NOT NULL,
        bank_node_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL DEFAULT 0,
        ministerial_count INTEGER NOT NULL DEFAULT 0,
        preview_text TEXT NOT NULL DEFAULT '',
        preview_rich TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (subject_key, question_id)
      );
    `);
    const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${FAVORITES_TABLE_NAME})`);
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('ordinal')) await database.execAsync(`ALTER TABLE ${FAVORITES_TABLE_NAME} ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0`);
    if (!names.has('ministerial_count')) await database.execAsync(`ALTER TABLE ${FAVORITES_TABLE_NAME} ADD COLUMN ministerial_count INTEGER NOT NULL DEFAULT 0`);
    if (!names.has('preview_text')) await database.execAsync(`ALTER TABLE ${FAVORITES_TABLE_NAME} ADD COLUMN preview_text TEXT NOT NULL DEFAULT ''`);
    if (!names.has('preview_rich')) await database.execAsync(`ALTER TABLE ${FAVORITES_TABLE_NAME} ADD COLUMN preview_rich TEXT NOT NULL DEFAULT '{}'`);
    return database;
  });

  return databasePromise;
}

export async function listFavoriteIds(subjectKey: string): Promise<string[]> {
  if (isWeb()) return [];

  const database = await getDatabase();
  const rows = await database.getAllAsync<{ question_id: string }>(
    `SELECT question_id FROM ${FAVORITES_TABLE_NAME} WHERE subject_key = ? ORDER BY created_at DESC`,
    subjectKey
  );
  return rows.map((row) => row.question_id);
}

export async function isFavorite(subjectKey: string, questionId: string): Promise<boolean> {
  if (isWeb()) return false;

  const database = await getDatabase();
  const row = await database.getFirstAsync<{ question_id: string }>(
    `SELECT question_id FROM ${FAVORITES_TABLE_NAME} WHERE subject_key = ? AND question_id = ? LIMIT 1`,
    subjectKey,
    questionId
  );
  return row !== null;
}

export async function listFavorites(subjectKey: string): Promise<FavoriteRecord[]> {
  if (isWeb()) return [];

  const database = await getDatabase();
  const rows = await database.getAllAsync<{
    subject_key: string;
    question_id: string;
    bank_node_id: string;
    ordinal: number;
    ministerial_count: number;
    preview_text: string;
    preview_rich: string;
    created_at: number;
  }>(
    `SELECT subject_key, question_id, bank_node_id, ordinal, preview_text, preview_rich, created_at
     FROM ${FAVORITES_TABLE_NAME} WHERE subject_key = ? ORDER BY created_at DESC`,
    subjectKey
  );
  return rows.map((row) => ({
    subjectKey: row.subject_key,
    questionId: row.question_id,
    bankNodeId: row.bank_node_id,
    ordinal: row.ordinal,
    ministerialCount: row.ministerial_count,
    previewText: row.preview_text,
    previewRich: parsePreviewRich(row.preview_rich),
    createdAt: row.created_at,
  }));
}

export async function setFavorite(
  subjectKey: string,
  questionId: string,
  bankNodeId: string,
  favorite: boolean,
  context?: FavoriteQuestionContext
): Promise<void> {
  if (isWeb()) return;

  const database = await getDatabase();
  if (favorite) {
    await database.runAsync(
      `INSERT INTO ${FAVORITES_TABLE_NAME} (subject_key, question_id, bank_node_id, ordinal, ministerial_count, preview_text, preview_rich, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(subject_key, question_id) DO UPDATE SET
         bank_node_id = excluded.bank_node_id,
         ordinal = excluded.ordinal,
         ministerial_count = excluded.ministerial_count,
         preview_text = excluded.preview_text,
         preview_rich = excluded.preview_rich,
         created_at = excluded.created_at`,
      subjectKey,
      questionId,
      bankNodeId,
      context?.ordinal ?? 0,
      context?.ministerialCount ?? 0,
      context?.previewText ?? '',
      JSON.stringify(context?.previewRich ?? EMPTY_PREVIEW_RICH),
      Date.now()
    );
    return;
  }

  await database.runAsync(
    `DELETE FROM ${FAVORITES_TABLE_NAME} WHERE subject_key = ? AND question_id = ?`,
    subjectKey,
    questionId
  );
}

export async function toggleFavorite(
  subjectKey: string,
  questionId: string,
  bankNodeId: string,
  context?: FavoriteQuestionContext
): Promise<boolean> {
  const nextValue = !(await isFavorite(subjectKey, questionId));
  await setFavorite(subjectKey, questionId, bankNodeId, nextValue, context);
  return nextValue;
}

const EMPTY_PREVIEW_RICH: PublicRichDocument = { type: 'doc', version: 1, blocks: [] };

function parsePreviewRich(value: string): PublicRichDocument {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { type?: unknown }).type === 'doc' &&
      (parsed as { version?: unknown }).version === 1 &&
      Array.isArray((parsed as { blocks?: unknown }).blocks)
    ) {
      return parsed as PublicRichDocument;
    }
  } catch {
    // An old or interrupted local row should not prevent the Favorites screen from opening.
  }
  return EMPTY_PREVIEW_RICH;
}
