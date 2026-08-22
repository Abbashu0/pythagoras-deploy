import { and, eq, isNull, sql } from "drizzle-orm";
import { adminSessions, adminUsers, type AdminUserRow } from "../content/schema";
import type {
  AdminIdentityRepository,
  AdminUser,
  CreateAdminUserRecord,
} from "./contracts";
import {
  AdminIdentityConflictError,
  AdminSetupUnavailableError,
} from "./errors";
import type { ContentDatabase } from "../content/database";

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    role: row.role,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
    passwordChangedAt: row.passwordChangedAt,
    revision: row.revision,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = String((error as Error & { code?: unknown }).code);
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

export class SQLiteAdminIdentityRepository implements AdminIdentityRepository {
  constructor(private readonly database: ContentDatabase) {}

  hasOwner(): boolean {
    return Boolean(
      this.database.db
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(eq(adminUsers.role, "OWNER"))
        .limit(1)
        .get(),
    );
  }

  findById(id: string): AdminUser | null {
    const row = this.database.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .get();
    return row ? toAdminUser(row) : null;
  }

  findByEmail(normalizedEmail: string): AdminUser | null {
    const row = this.database.db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, normalizedEmail))
      .get();
    return row ? toAdminUser(row) : null;
  }

  createInitialOwner(input: CreateAdminUserRecord): AdminUser {
    try {
      const row = this.database.db.transaction((transaction) =>
        transaction
          .insert(adminUsers)
          .values({
            ...input,
            role: "OWNER",
            enabled: true,
            updatedAt: input.createdAt,
            passwordChangedAt: input.createdAt,
            revision: 1,
          })
          .returning()
          .get(),
      );
      return toAdminUser(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        if (this.hasOwner()) throw new AdminSetupUnavailableError(error);
        throw new AdminIdentityConflictError(error);
      }
      throw error;
    }
  }

  createAdmin(input: CreateAdminUserRecord): AdminUser {
    try {
      const row = this.database.db
        .insert(adminUsers)
        .values({
          ...input,
          role: "ADMIN",
          enabled: true,
          updatedAt: input.createdAt,
          passwordChangedAt: input.createdAt,
          revision: 1,
        })
        .returning()
        .get();
      return toAdminUser(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AdminIdentityConflictError(error);
      }
      throw error;
    }
  }

  recordSuccessfulLogin(userId: string, loggedInAt: number): void {
    this.database.db
      .update(adminUsers)
      .set({ lastLoginAt: loggedInAt })
      .where(eq(adminUsers.id, userId))
      .run();
  }

  setEnabled(
    userId: string,
    enabled: boolean,
    expectedRevision: number,
    now: number,
  ): AdminUser {
    return this.database.db.transaction((transaction) => {
      const updated = transaction
        .update(adminUsers)
        .set({
          enabled,
          updatedAt: now,
          revision: sql`${adminUsers.revision} + 1`,
        })
        .where(
          and(
            eq(adminUsers.id, userId),
            eq(adminUsers.revision, expectedRevision),
          ),
        )
        .returning()
        .get();

      if (!updated) {
        throw new AdminIdentityConflictError();
      }

      if (!enabled) {
        transaction
          .update(adminSessions)
          .set({ revokedAt: now })
          .where(
            and(
              eq(adminSessions.userId, userId),
              isNull(adminSessions.revokedAt),
            ),
          )
          .run();
      }

      return toAdminUser(updated);
    });
  }
}
