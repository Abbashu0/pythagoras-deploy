export const ADMIN_ROLES = ["OWNER", "ADMIN"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: AdminRole;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  passwordChangedAt: number;
  revision: number;
}

export interface SafeAdminIdentity {
  id: string;
  displayName: string;
  role: AdminRole;
}

export interface AdminSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

export interface AdminSessionWithUser {
  session: AdminSession;
  user: AdminUser;
}

export interface AdminAuthentication {
  sessionId: string;
  user: AdminUser;
  expiresAt: number;
}

export interface AdminActor {
  actorUserId: string;
  actorRole: AdminRole;
}

export interface CreateAdminUserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: number;
}

export interface CreateAdminSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
}

export interface AdminIdentityRepository {
  hasOwner(): boolean;
  findById(id: string): AdminUser | null;
  findByEmail(normalizedEmail: string): AdminUser | null;
  createInitialOwner(input: CreateAdminUserRecord): AdminUser;
  createAdmin(input: CreateAdminUserRecord): AdminUser;
  recordSuccessfulLogin(userId: string, loggedInAt: number): void;
  setEnabled(userId: string, enabled: boolean, expectedRevision: number, now: number): AdminUser;
}

export interface AdminSessionRepository {
  create(input: CreateAdminSessionRecord): AdminSession;
  findByTokenHash(tokenHash: string): AdminSessionWithUser | null;
  touchIfDue(sessionId: string, seenAt: number, dueBefore: number): void;
  revokeByTokenHash(tokenHash: string, revokedAt: number): boolean;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export interface AuthenticatedSessionResult {
  rawToken: string;
  authentication: AdminAuthentication;
}

export function isAdminRole(value: unknown): value is AdminRole {
  return value === "OWNER" || value === "ADMIN";
}

export function toSafeAdminIdentity(user: AdminUser): SafeAdminIdentity {
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
  };
}
