export const AI_SECRET_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type AISecretStatus = (typeof AI_SECRET_STATUSES)[number];

export const AI_SECRET_AUDIT_EVENT_TYPES = [
  "CREATED",
  "RESOLVED",
  "ROTATED",
  "REVOKED",
  "RESOLVE_FAILED",
] as const;
export type AISecretAuditEventType =
  (typeof AI_SECRET_AUDIT_EVENT_TYPES)[number];

export const AI_SECRET_AUDIT_ACTOR_TYPES = ["ADMIN", "SYSTEM"] as const;
export type AISecretAuditActorType = (typeof AI_SECRET_AUDIT_ACTOR_TYPES)[number];

export const AI_SECRET_AUDIT_OUTCOMES = ["SUCCESS", "FAILURE"] as const;
export type AISecretAuditOutcome = (typeof AI_SECRET_AUDIT_OUTCOMES)[number];

/** UUID-shaped but otherwise opaque reference; it carries no secret material. */
export const AI_SECRET_CREDENTIAL_REF_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isAISecretCredentialRef(value: unknown): value is string {
  return typeof value === "string" && AI_SECRET_CREDENTIAL_REF_PATTERN.test(value);
}

export type AISecretActor =
  | { type: "ADMIN"; actorUserId: string }
  | { type: "SYSTEM" };

export interface AISecretMetadata {
  credentialRef: string;
  status: AISecretStatus;
  secretVersion: number;
  createdAt: number;
  updatedAt: number;
  rotatedAt: number | null;
  revokedAt: number | null;
  revision: number;
}

export interface AISecretAuditEvent {
  id: string;
  credentialRef: string;
  eventType: AISecretAuditEventType;
  secretVersion: number | null;
  actorType: AISecretAuditActorType;
  actorUserId: string | null;
  outcome: AISecretAuditOutcome;
  errorCode: string | null;
  createdAt: number;
}

export interface AISecretStoreAdapter {
  create(input: {
    secret: string;
    actor: AISecretActor;
  }): Promise<AISecretMetadata>;
  resolve(credentialRef: string): Promise<string>;
  rotate(input: {
    credentialRef: string;
    secret: string;
    actor: AISecretActor;
  }): Promise<AISecretMetadata>;
  revoke(input: {
    credentialRef: string;
    actor: AISecretActor;
  }): Promise<AISecretMetadata>;
  getMetadata(credentialRef: string): AISecretMetadata | null;
}

export interface AISecretMetadataRepository {
  get(credentialRef: string): AISecretMetadata | null;
  create(input: {
    metadata: AISecretMetadata;
    actor: AISecretActor;
  }): AISecretMetadata;
  rotate(input: {
    credentialRef: string;
    expectedVersion: number;
    rotatedAt: number;
    actor: AISecretActor;
  }): AISecretMetadata;
  revoke(input: {
    credentialRef: string;
    expectedVersion: number;
    revokedAt: number;
    actor: AISecretActor;
  }): AISecretMetadata;
  appendAudit(input: {
    credentialRef: string;
    eventType: AISecretAuditEventType;
    secretVersion: number | null;
    actor: AISecretActor;
    outcome: AISecretAuditOutcome;
    errorCode?: string | null;
    createdAt: number;
  }): AISecretAuditEvent;
  listAudit(credentialRef: string): AISecretAuditEvent[];
}
