import type { AdminActor } from "./contracts";
import { AdminAuthorizationError } from "./errors";
import type { ContentDatabase } from "../content/database";

export const LOCAL_ADMIN_OPERATOR_ID = "local-admin-operator";

const LOCAL_ADMIN_OPERATOR_EMAIL = "local-admin-operator@invalid.local";
const LOCAL_ADMIN_OPERATOR_NAME = "Local Admin Operator";
const DISABLED_PASSWORD_HASH = "$argon2id$local-operator-disabled";

/**
 * Creates the attribution-only identity required by legacy FK contracts.
 * It is deliberately disabled and has no valid password; it is never a login
 * account and is never returned to the browser.
 */
export function getLocalAdminActor(database: ContentDatabase): AdminActor {
  const resolve = database.client.transaction(() => {
    const existing = database.client
      .prepare(
        "select id, email, display_name as displayName, password_hash as passwordHash, role, enabled from admin_users where id = ?",
      )
      .get(LOCAL_ADMIN_OPERATOR_ID) as
      | {
          id: string;
          email: string;
          displayName: string;
          passwordHash: string;
          role: string;
          enabled: number;
        }
      | undefined;

    if (!existing) {
      database.client
        .prepare(
          `insert into admin_users
            (id, email, display_name, password_hash, role, enabled, created_at,
             updated_at, password_changed_at, revision)
           values (?, ?, ?, ?, 'ADMIN', 0, 0, 0, 0, 1)`,
        )
        .run(
          LOCAL_ADMIN_OPERATOR_ID,
          LOCAL_ADMIN_OPERATOR_EMAIL,
          LOCAL_ADMIN_OPERATOR_NAME,
          DISABLED_PASSWORD_HASH,
        );
    }

    const row = database.client
      .prepare(
        "select id, email, display_name as displayName, password_hash as passwordHash, role, enabled from admin_users where id = ?",
      )
      .get(LOCAL_ADMIN_OPERATOR_ID) as typeof existing;

    if (
      !row ||
      row.email !== LOCAL_ADMIN_OPERATOR_EMAIL ||
      row.displayName !== LOCAL_ADMIN_OPERATOR_NAME ||
      row.passwordHash !== DISABLED_PASSWORD_HASH ||
      row.role !== "ADMIN" ||
      row.enabled !== 0
    ) {
      throw new AdminAuthorizationError("ADMIN_FORBIDDEN");
    }

    return { actorUserId: LOCAL_ADMIN_OPERATOR_ID, actorRole: "ADMIN" as const };
  });

  return resolve.immediate();
}
