import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type {
  AdminActor,
  AdminAuthentication,
  AdminIdentityRepository,
  AdminSessionRepository,
  AdminUser,
  AuthenticatedSessionResult,
  PasswordHasher,
} from "./contracts";
import {
  AdminOwnerInvariantError,
  AdminSessionCollisionError,
  AdminSetupUnavailableError,
  InvalidAdminCredentialsError,
} from "./errors";
import { LoginAttemptLimiter } from "./login-attempt-limiter";
import { requireOwnerActor } from "./authorization";
import {
  generateAdminSessionToken,
  hashAdminSessionToken,
  isValidAdminSessionToken,
} from "./session-token";
import {
  isAcceptableLoginPassword,
  normalizeAdminDisplayName,
  normalizeAdminEmail,
  tryNormalizeAdminEmail,
  validateNewAdminPassword,
} from "./validation";

export const ADMIN_SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export interface InitialOwnerInput {
  displayName: unknown;
  email: unknown;
  password: unknown;
}

export interface AdminLoginInput {
  email: unknown;
  password: unknown;
  attemptKey: string;
}

export type CreateAdminInput = InitialOwnerInput;

export interface AdminAuthServiceOptions {
  clock?: () => number;
  idGenerator?: () => string;
  tokenGenerator?: () => string;
  sessionTtlMs?: number;
  sessionTouchIntervalMs?: number;
  loginAttemptLimiter?: LoginAttemptLimiter;
}

export class AdminAuthService {
  private readonly clock: () => number;
  private readonly idGenerator: () => string;
  private readonly tokenGenerator: () => string;
  private readonly sessionTtlMs: number;
  private readonly sessionTouchIntervalMs: number;
  private readonly loginAttemptLimiter: LoginAttemptLimiter;
  private readonly dummyHashPromise: Promise<string>;

  constructor(
    private readonly identities: AdminIdentityRepository,
    private readonly sessions: AdminSessionRepository,
    private readonly passwordHasher: PasswordHasher,
    options: AdminAuthServiceOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.idGenerator = options.idGenerator ?? uuidv7;
    this.tokenGenerator = options.tokenGenerator ?? generateAdminSessionToken;
    this.sessionTtlMs = options.sessionTtlMs ?? ADMIN_SESSION_ABSOLUTE_TTL_MS;
    this.sessionTouchIntervalMs =
      options.sessionTouchIntervalMs ?? ADMIN_SESSION_TOUCH_INTERVAL_MS;
    this.loginAttemptLimiter =
      options.loginAttemptLimiter ?? new LoginAttemptLimiter({ clock: this.clock });

    const inMemoryDummySecret = randomBytes(32).toString("base64url");
    this.dummyHashPromise = this.passwordHasher.hash(inMemoryDummySecret);
  }

  isSetupRequired(): boolean {
    return !this.identities.hasOwner();
  }

  async setupInitialOwner(input: InitialOwnerInput): Promise<AuthenticatedSessionResult> {
    if (this.identities.hasOwner()) {
      throw new AdminSetupUnavailableError();
    }

    const email = normalizeAdminEmail(input.email);
    const displayName = normalizeAdminDisplayName(input.displayName);
    const password = validateNewAdminPassword(input.password);
    const now = this.clock();
    const passwordHash = await this.passwordHasher.hash(password);

    const owner = this.identities.createInitialOwner({
      id: this.idGenerator(),
      email,
      displayName,
      passwordHash,
      createdAt: now,
    });

    return this.createAuthenticatedSession(owner, now);
  }

  async login(input: AdminLoginInput): Promise<AuthenticatedSessionResult> {
    this.loginAttemptLimiter.assertAllowed(input.attemptKey);

    const normalizedEmail = tryNormalizeAdminEmail(input.email);
    const user = normalizedEmail ? this.identities.findByEmail(normalizedEmail) : null;
    const passwordHash = user?.passwordHash ?? (await this.dummyHashPromise);
    const password = isAcceptableLoginPassword(input.password)
      ? input.password
      : "\u0000invalid-login-input";
    const verified = await this.passwordHasher.verify(passwordHash, password);

    if (!user || !user.enabled || !verified || !isAcceptableLoginPassword(input.password)) {
      this.loginAttemptLimiter.recordFailure(input.attemptKey);
      throw new InvalidAdminCredentialsError();
    }

    this.loginAttemptLimiter.clear(input.attemptKey);
    const now = this.clock();
    this.identities.recordSuccessfulLogin(user.id, now);
    const refreshedUser = this.identities.findById(user.id) ?? user;
    return this.createAuthenticatedSession(refreshedUser, now);
  }

  authenticateSessionToken(rawToken: unknown): AdminAuthentication | null {
    if (!isValidAdminSessionToken(rawToken)) return null;

    const tokenHash = hashAdminSessionToken(rawToken);
    const match = this.sessions.findByTokenHash(tokenHash);
    if (!match) return null;

    const now = this.clock();
    const { session, user } = match;
    if (
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      !user.enabled ||
      session.createdAt < user.passwordChangedAt
    ) {
      return null;
    }

    if (session.lastSeenAt <= now - this.sessionTouchIntervalMs) {
      this.sessions.touchIfDue(
        session.id,
        now,
        now - this.sessionTouchIntervalMs,
      );
    }

    return {
      sessionId: session.id,
      user,
      expiresAt: session.expiresAt,
    };
  }

  logout(rawToken: unknown): boolean {
    if (!isValidAdminSessionToken(rawToken)) return false;
    return this.sessions.revokeByTokenHash(
      hashAdminSessionToken(rawToken),
      this.clock(),
    );
  }

  async createAdmin(actor: AdminActor, input: CreateAdminInput): Promise<AdminUser> {
    requireOwnerActor(actor);
    const now = this.clock();
    return this.identities.createAdmin({
      id: this.idGenerator(),
      email: normalizeAdminEmail(input.email),
      displayName: normalizeAdminDisplayName(input.displayName),
      passwordHash: await this.passwordHasher.hash(
        validateNewAdminPassword(input.password),
      ),
      createdAt: now,
    });
  }

  setAdminEnabled(
    actor: AdminActor,
    userId: string,
    enabled: boolean,
    expectedRevision: number,
  ): AdminUser {
    requireOwnerActor(actor);
    const target = this.identities.findById(userId);
    if (!target) {
      throw new InvalidAdminCredentialsError();
    }
    if (target.role === "OWNER" && !enabled) {
      throw new AdminOwnerInvariantError();
    }
    return this.identities.setEnabled(
      userId,
      enabled,
      expectedRevision,
      this.clock(),
    );
  }

  private createAuthenticatedSession(
    user: AdminUser,
    createdAt: number,
  ): AuthenticatedSessionResult {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rawToken = this.tokenGenerator();
      if (!isValidAdminSessionToken(rawToken)) {
        throw new AdminSessionCollisionError();
      }

      try {
        const session = this.sessions.create({
          id: this.idGenerator(),
          userId: user.id,
          tokenHash: hashAdminSessionToken(rawToken),
          createdAt,
          expiresAt: createdAt + this.sessionTtlMs,
        });
        return {
          rawToken,
          authentication: {
            sessionId: session.id,
            user,
            expiresAt: session.expiresAt,
          },
        };
      } catch (error) {
        if (!(error instanceof AdminSessionCollisionError) || attempt === 2) {
          throw error;
        }
      }
    }
    throw new AdminSessionCollisionError();
  }
}
