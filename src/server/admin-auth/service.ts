import { getContentDatabase, type ContentDatabase } from "../content/database";
import { AdminAuthService } from "./admin-auth-service";
import { LoginAttemptLimiter } from "./login-attempt-limiter";
import { Argon2idPasswordHasher } from "./password-hasher";
import { SQLiteAdminIdentityRepository } from "./sqlite-admin-identity-repository";
import { SQLiteAdminSessionRepository } from "./sqlite-admin-session-repository";

export function createAdminAuthService(database: ContentDatabase): AdminAuthService {
  return new AdminAuthService(
    new SQLiteAdminIdentityRepository(database),
    new SQLiteAdminSessionRepository(database),
    new Argon2idPasswordHasher(),
    { loginAttemptLimiter: new LoginAttemptLimiter() },
  );
}

type AdminAuthGlobal = typeof globalThis & {
  __pythagorasAdminAuthService?: AdminAuthService;
};

export function getAdminAuthService(): AdminAuthService {
  const authGlobal = globalThis as AdminAuthGlobal;
  if (!authGlobal.__pythagorasAdminAuthService) {
    authGlobal.__pythagorasAdminAuthService = createAdminAuthService(
      getContentDatabase(),
    );
  }
  return authGlobal.__pythagorasAdminAuthService;
}
