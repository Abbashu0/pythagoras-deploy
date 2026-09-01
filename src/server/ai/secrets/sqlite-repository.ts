import { and, asc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type {
  AISecretActor,
  AISecretAuditEvent,
  AISecretMetadata,
  AISecretMetadataRepository,
} from "./contracts";
import { AISecretStoreError } from "./errors";
import type { ContentDatabase } from "../../content/database";
import {
  aiSecretAuditEvents,
  aiSecretRefs,
  type AISecretAuditEventRow,
  type AISecretRefRow,
} from "../../content/schema";

export class SQLiteAISecretMetadataRepository
  implements AISecretMetadataRepository
{
  constructor(private readonly database: ContentDatabase) {}

  get(credentialRef: string): AISecretMetadata | null {
    const row = this.database.db
      .select()
      .from(aiSecretRefs)
      .where(eq(aiSecretRefs.credentialRef, credentialRef))
      .get();
    return row ? metadataFromRow(row) : null;
  }

  create(input: {
    metadata: AISecretMetadata;
    actor: AISecretActor;
  }): AISecretMetadata {
    return this.database.db.transaction((transaction) => {
      transaction
        .insert(aiSecretRefs)
        .values({
          credentialRef: input.metadata.credentialRef,
          status: input.metadata.status,
          secretVersion: input.metadata.secretVersion,
          createdAt: input.metadata.createdAt,
          updatedAt: input.metadata.updatedAt,
          rotatedAt: input.metadata.rotatedAt,
          revokedAt: input.metadata.revokedAt,
          revision: input.metadata.revision,
        })
        .run();
      insertAudit(transaction, {
        credentialRef: input.metadata.credentialRef,
        eventType: "CREATED",
        secretVersion: input.metadata.secretVersion,
        actor: input.actor,
        outcome: "SUCCESS",
        createdAt: input.metadata.createdAt,
      });
      return input.metadata;
    });
  }

  rotate(input: {
    credentialRef: string;
    expectedVersion: number;
    rotatedAt: number;
    actor: AISecretActor;
  }): AISecretMetadata {
    return this.database.db.transaction((transaction) => {
      const updated = transaction
        .update(aiSecretRefs)
        .set({
          secretVersion: input.expectedVersion + 1,
          updatedAt: input.rotatedAt,
          rotatedAt: input.rotatedAt,
          revision: sql`${aiSecretRefs.revision} + 1`,
        })
        .where(
          and(
            eq(aiSecretRefs.credentialRef, input.credentialRef),
            eq(aiSecretRefs.secretVersion, input.expectedVersion),
            eq(aiSecretRefs.status, "ACTIVE"),
          ),
        )
        .returning()
        .get();
      if (!updated) {
        throw new AISecretStoreError(
          "AI_SECRET_CONFLICT",
          "The AI secret changed before rotation completed.",
        );
      }
      insertAudit(transaction, {
        credentialRef: input.credentialRef,
        eventType: "ROTATED",
        secretVersion: updated.secretVersion,
        actor: input.actor,
        outcome: "SUCCESS",
        createdAt: input.rotatedAt,
      });
      return metadataFromRow(updated);
    });
  }

  revoke(input: {
    credentialRef: string;
    expectedVersion: number;
    revokedAt: number;
    actor: AISecretActor;
  }): AISecretMetadata {
    return this.database.db.transaction((transaction) => {
      const updated = transaction
        .update(aiSecretRefs)
        .set({
          status: "REVOKED",
          updatedAt: input.revokedAt,
          revokedAt: input.revokedAt,
          revision: sql`${aiSecretRefs.revision} + 1`,
        })
        .where(
          and(
            eq(aiSecretRefs.credentialRef, input.credentialRef),
            eq(aiSecretRefs.secretVersion, input.expectedVersion),
            eq(aiSecretRefs.status, "ACTIVE"),
          ),
        )
        .returning()
        .get();
      if (!updated) {
        throw new AISecretStoreError(
          "AI_SECRET_CONFLICT",
          "The AI secret changed before revocation completed.",
        );
      }
      insertAudit(transaction, {
        credentialRef: input.credentialRef,
        eventType: "REVOKED",
        secretVersion: updated.secretVersion,
        actor: input.actor,
        outcome: "SUCCESS",
        createdAt: input.revokedAt,
      });
      return metadataFromRow(updated);
    });
  }

  appendAudit(input: {
    credentialRef: string;
    eventType: "CREATED" | "RESOLVED" | "ROTATED" | "REVOKED" | "RESOLVE_FAILED";
    secretVersion: number | null;
    actor: AISecretActor;
    outcome: "SUCCESS" | "FAILURE";
    errorCode?: string | null;
    createdAt: number;
  }): AISecretAuditEvent {
    try {
      const row = insertAudit(this.database.db, input);
      return auditFromRow(row);
    } catch (error) {
      if (error instanceof AISecretStoreError) throw error;
      throw new AISecretStoreError(
        "AI_SECRET_STORE_UNAVAILABLE",
        "The AI secret audit store is unavailable.",
        error,
      );
    }
  }

  listAudit(credentialRef: string): AISecretAuditEvent[] {
    return this.database.db
      .select()
      .from(aiSecretAuditEvents)
      .where(eq(aiSecretAuditEvents.credentialRef, credentialRef))
      .orderBy(asc(aiSecretAuditEvents.createdAt), asc(aiSecretAuditEvents.id))
      .all()
      .map(auditFromRow);
  }
}

function metadataFromRow(row: AISecretRefRow): AISecretMetadata {
  return {
    credentialRef: row.credentialRef,
    status: row.status,
    secretVersion: row.secretVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rotatedAt: row.rotatedAt,
    revokedAt: row.revokedAt,
    revision: row.revision,
  };
}

function auditFromRow(row: AISecretAuditEventRow): AISecretAuditEvent {
  return {
    id: row.id,
    credentialRef: row.credentialRef,
    eventType: row.eventType,
    secretVersion: row.secretVersion,
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    outcome: row.outcome,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
  };
}

function insertAudit(
  database: Pick<ContentDatabase["db"], "insert">,
  input: {
    credentialRef: string;
    eventType: "CREATED" | "RESOLVED" | "ROTATED" | "REVOKED" | "RESOLVE_FAILED";
    secretVersion: number | null;
    actor: AISecretActor;
    outcome: "SUCCESS" | "FAILURE";
    errorCode?: string | null;
    createdAt: number;
  },
): AISecretAuditEventRow {
  if (input.errorCode && (!/^[A-Z0-9_]+$/u.test(input.errorCode) || input.errorCode.length > 120)) {
    throw new AISecretStoreError(
      "AI_SECRET_INPUT_INVALID",
      "The AI secret audit code is invalid.",
    );
  }
  return database
    .insert(aiSecretAuditEvents)
    .values({
      id: uuidv7(),
      credentialRef: input.credentialRef,
      eventType: input.eventType,
      secretVersion: input.secretVersion,
      actorType: input.actor.type,
      actorUserId: input.actor.type === "ADMIN" ? input.actor.actorUserId : null,
      outcome: input.outcome,
      errorCode: input.errorCode ?? null,
      createdAt: input.createdAt,
    })
    .returning()
    .get();
}
