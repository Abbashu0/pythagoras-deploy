import { and, eq, isNull, lte } from "drizzle-orm";
import { adminSessions, adminUsers, type AdminSessionRow } from "../content/schema";
import type { ContentDatabase } from "../content/database";
import type {
  AdminSession,
  AdminSessionRepository,
  AdminSessionWithUser,
  CreateAdminSessionRecord,
} from "./contracts";
import { AdminSessionCollisionError } from "./errors";

function toAdminSession(row: AdminSessionRow): AdminSession {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = String((error as Error & { code?: unknown }).code);
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

export class SQLiteAdminSessionRepository implements AdminSessionRepository {
  constructor(private readonly database: ContentDatabase) {}

  create(input: CreateAdminSessionRecord): AdminSession {
    try {
      const row = this.database.db
        .insert(adminSessions)
        .values({
          ...input,
          lastSeenAt: input.createdAt,
          revokedAt: null,
        })
        .returning()
        .get();
      return toAdminSession(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AdminSessionCollisionError(error);
      }
      throw error;
    }
  }

  findByTokenHash(tokenHash: string): AdminSessionWithUser | null {
    const row = this.database.db
      .select({ session: adminSessions, user: adminUsers })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminSessions.userId, adminUsers.id))
      .where(eq(adminSessions.tokenHash, tokenHash))
      .get();

    if (!row) return null;
    return {
      session: toAdminSession(row.session),
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        passwordHash: row.user.passwordHash,
        role: row.user.role,
        enabled: row.user.enabled,
        createdAt: row.user.createdAt,
        updatedAt: row.user.updatedAt,
        lastLoginAt: row.user.lastLoginAt,
        passwordChangedAt: row.user.passwordChangedAt,
        revision: row.user.revision,
      },
    };
  }

  touchIfDue(sessionId: string, seenAt: number, dueBefore: number): void {
    this.database.db
      .update(adminSessions)
      .set({ lastSeenAt: seenAt })
      .where(
        and(
          eq(adminSessions.id, sessionId),
          lte(adminSessions.lastSeenAt, dueBefore),
          isNull(adminSessions.revokedAt),
        ),
      )
      .run();
  }

  revokeByTokenHash(tokenHash: string, revokedAt: number): boolean {
    const result = this.database.db
      .update(adminSessions)
      .set({ revokedAt })
      .where(
        and(
          eq(adminSessions.tokenHash, tokenHash),
          isNull(adminSessions.revokedAt),
        ),
      )
      .run();
    return result.changes > 0;
  }
}
