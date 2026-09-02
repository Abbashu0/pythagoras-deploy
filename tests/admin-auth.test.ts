import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AdminAuthService,
  AdminAuthorizationError,
  AdminOwnerInvariantError,
  AdminRateLimitError,
  AdminSetupUnavailableError,
  Argon2idPasswordHasher,
  LoginAttemptLimiter,
  SQLiteAdminIdentityRepository,
  SQLiteAdminSessionRepository,
  assertTrustedMutationRequest,
  getAdminActor,
  getLoginAttemptKey,
  hashAdminSessionToken,
  requireOwner,
} from "../src/server/admin-auth/index";
import {
  getContentDatabaseStatus,
  openContentDatabase,
  type ContentDatabase,
} from "../src/server/content/index";
import { adminAuthErrorResponse } from "../src/app/api/admin/auth/_shared";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const OWNER_PASSWORD = randomBytes(32).toString("base64url");
const ADMIN_PASSWORD = randomBytes(32).toString("base64url");

function createTemporaryDirectory(prefix = "pythagoras-auth-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface AuthFixture {
  root: string;
  database: ContentDatabase;
  identities: SQLiteAdminIdentityRepository;
  sessions: SQLiteAdminSessionRepository;
  service: AdminAuthService;
  now(): number;
  advance(milliseconds: number): void;
  close(): void;
}

function createAuthFixture(options: { sessionTtlMs?: number } = {}): AuthFixture {
  const root = createTemporaryDirectory();
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const sessions = new SQLiteAdminSessionRepository(database);
  let currentTime = 1_800_000_000_000;
  const clock = () => currentTime;
  const service = new AdminAuthService(
    identities,
    sessions,
    new Argon2idPasswordHasher(),
    {
      clock,
      sessionTtlMs: options.sessionTtlMs,
      loginAttemptLimiter: new LoginAttemptLimiter({ clock }),
    },
  );

  return {
    root,
    database,
    identities,
    sessions,
    service,
    now: clock,
    advance(milliseconds) {
      currentTime += milliseconds;
    },
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function setupOwner(fixture: AuthFixture) {
  return fixture.service.setupInitialOwner({
    displayName: "مالك فيثاغورس",
    email: "Owner@Example.com ",
    password: OWNER_PASSWORD,
  });
}

test("creates the first OWNER with normalized identity and an Argon2id hash only", async () => {
  const fixture = createAuthFixture();
  try {
    const result = await setupOwner(fixture);
    const stored = fixture.identities.findByEmail("owner@example.com");

    assert.ok(stored);
    assert.equal(stored.id, result.authentication.user.id);
    assert.equal(stored.role, "OWNER");
    assert.equal(stored.enabled, true);
    assert.equal(stored.email, "owner@example.com");
    assert.notEqual(stored.passwordHash, OWNER_PASSWORD);
    assert.equal(stored.passwordHash.includes(OWNER_PASSWORD), false);
    assert.match(stored.passwordHash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/u);

    const hasher = new Argon2idPasswordHasher();
    assert.equal(await hasher.verify(stored.passwordHash, OWNER_PASSWORD), true);
    assert.equal(await hasher.verify(stored.passwordHash, "wrong password"), false);

    fixture.database.client.pragma("wal_checkpoint(TRUNCATE)");
    const databaseBytes = readFileSync(fixture.database.paths.databaseFile);
    assert.equal(databaseBytes.includes(Buffer.from(OWNER_PASSWORD, "utf8")), false);
  } finally {
    fixture.close();
  }
});

test("enforces the single-owner setup invariant across competing database connections", async () => {
  const root = createTemporaryDirectory("pythagoras-owner-race-");
  const firstDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const secondDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  try {
    const firstService = new AdminAuthService(
      new SQLiteAdminIdentityRepository(firstDatabase),
      new SQLiteAdminSessionRepository(firstDatabase),
      new Argon2idPasswordHasher(),
    );
    const secondService = new AdminAuthService(
      new SQLiteAdminIdentityRepository(secondDatabase),
      new SQLiteAdminSessionRepository(secondDatabase),
      new Argon2idPasswordHasher(),
    );

    const results = await Promise.allSettled([
      firstService.setupInitialOwner({
        displayName: "First Owner",
        email: "first@example.com",
        password: OWNER_PASSWORD,
      }),
      secondService.setupInitialOwner({
        displayName: "Second Owner",
        email: "second@example.com",
        password: OWNER_PASSWORD,
      }),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof AdminSetupUnavailableError);
    const ownerCount = firstDatabase.client
      .prepare("select count(*) as count from admin_users where role = 'OWNER'")
      .get() as { count: number };
    assert.equal(ownerCount.count, 1);
  } finally {
    firstDatabase.close();
    secondDatabase.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses generic login failures and updates lastLoginAt only after success", async () => {
  const fixture = createAuthFixture();
  try {
    await setupOwner(fixture);

    await assert.rejects(
      fixture.service.login({
        email: "owner@example.com",
        password: "definitely wrong",
        attemptKey: "owner@example.com\u0000local",
      }),
      /supplied credentials are invalid/u,
    );
    await assert.rejects(
      fixture.service.login({
        email: "missing@example.com",
        password: "definitely wrong",
        attemptKey: "missing@example.com\u0000local",
      }),
      /supplied credentials are invalid/u,
    );
    assert.equal(fixture.identities.findByEmail("owner@example.com")?.lastLoginAt, null);

    fixture.advance(10_000);
    const loggedIn = await fixture.service.login({
      email: "OWNER@example.com",
      password: OWNER_PASSWORD,
      attemptKey: "owner@example.com\u0000local",
    });
    assert.equal(loggedIn.authentication.user.role, "OWNER");
    assert.equal(
      fixture.identities.findByEmail("owner@example.com")?.lastLoginAt,
      fixture.now(),
    );
  } finally {
    fixture.close();
  }
});

test("stores only a SHA-256 session digest while the 256-bit raw token authenticates", async () => {
  const fixture = createAuthFixture();
  try {
    const result = await setupOwner(fixture);
    const rawToken = result.rawToken;
    const stored = fixture.database.client
      .prepare("select token_hash as tokenHash from admin_sessions where id = ?")
      .get(result.authentication.sessionId) as { tokenHash: string };

    assert.equal(Buffer.from(rawToken, "base64url").byteLength, 32);
    assert.equal(stored.tokenHash, hashAdminSessionToken(rawToken));
    assert.notEqual(stored.tokenHash, rawToken);
    assert.match(stored.tokenHash, /^[0-9a-f]{64}$/u);
    assert.equal(
      fixture.service.authenticateSessionToken(rawToken)?.user.id,
      result.authentication.user.id,
    );
  } finally {
    fixture.close();
  }
});

test("revokes a session on logout and rejects the copied old token", async () => {
  const fixture = createAuthFixture();
  try {
    const result = await setupOwner(fixture);
    assert.equal(fixture.service.logout(result.rawToken), true);
    assert.equal(fixture.service.authenticateSessionToken(result.rawToken), null);
    const revoked = fixture.database.client
      .prepare("select revoked_at as revokedAt from admin_sessions where id = ?")
      .get(result.authentication.sessionId) as { revokedAt: number | null };
    assert.equal(revoked.revokedAt, fixture.now());
  } finally {
    fixture.close();
  }
});

test("rejects sessions after their absolute expiration", async () => {
  const fixture = createAuthFixture({ sessionTtlMs: 1_000 });
  try {
    const result = await setupOwner(fixture);
    fixture.advance(1_001);
    assert.equal(fixture.service.authenticateSessionToken(result.rawToken), null);
  } finally {
    fixture.close();
  }
});

test("disabled ADMIN sessions stay unauthorized and are transactionally revoked", async () => {
  const fixture = createAuthFixture();
  try {
    const ownerSession = await setupOwner(fixture);
    const ownerActor = getAdminActor(ownerSession.authentication);
    const admin = await fixture.service.createAdmin(ownerActor, {
      displayName: "Content Admin",
      email: "admin@example.com",
      password: ADMIN_PASSWORD,
    });
    const adminSession = await fixture.service.login({
      email: admin.email,
      password: ADMIN_PASSWORD,
      attemptKey: "admin@example.com\u0000local",
    });

    fixture.service.setAdminEnabled(ownerActor, admin.id, false, admin.revision);
    assert.equal(fixture.service.authenticateSessionToken(adminSession.rawToken), null);
    const revoked = fixture.database.client
      .prepare("select revoked_at as revokedAt from admin_sessions where id = ?")
      .get(adminSession.authentication.sessionId) as { revokedAt: number | null };
    assert.equal(revoked.revokedAt, fixture.now());
  } finally {
    fixture.close();
  }
});

test("ADMIN cannot use OWNER authorization and the only OWNER cannot be disabled", async () => {
  const fixture = createAuthFixture();
  try {
    const ownerSession = await setupOwner(fixture);
    const ownerActor = getAdminActor(ownerSession.authentication);
    const admin = await fixture.service.createAdmin(ownerActor, {
      displayName: "Regular Admin",
      email: "regular@example.com",
      password: ADMIN_PASSWORD,
    });
    const adminSession = await fixture.service.login({
      email: admin.email,
      password: ADMIN_PASSWORD,
      attemptKey: "regular@example.com\u0000local",
    });

    assert.throws(
      () => requireOwner(adminSession.authentication),
      (error) =>
        error instanceof AdminAuthorizationError && error.code === "ADMIN_FORBIDDEN",
    );
    await assert.rejects(
      fixture.service.createAdmin(getAdminActor(adminSession.authentication), {
        displayName: "Forbidden Admin",
        email: "forbidden@example.com",
        password: ADMIN_PASSWORD,
      }),
      AdminAuthorizationError,
    );
    assert.throws(
      () =>
        fixture.service.setAdminEnabled(
          ownerActor,
          ownerSession.authentication.user.id,
          false,
          ownerSession.authentication.user.revision,
        ),
      AdminOwnerInvariantError,
    );
  } finally {
    fixture.close();
  }
});

test("owner and active sessions persist across database and service restarts", async () => {
  const root = createTemporaryDirectory("pythagoras-auth-persistence-");
  let firstDatabase: ContentDatabase | null = openContentDatabase({
    dataDirectory: root,
    migrationsDirectory,
  });
  try {
    const firstService = new AdminAuthService(
      new SQLiteAdminIdentityRepository(firstDatabase),
      new SQLiteAdminSessionRepository(firstDatabase),
      new Argon2idPasswordHasher(),
    );
    const ownerSession = await firstService.setupInitialOwner({
      displayName: "Persistent Owner",
      email: "persistent@example.com",
      password: OWNER_PASSWORD,
    });
    firstDatabase.close();
    firstDatabase = null;

    const reopened = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    try {
      const restartedService = new AdminAuthService(
        new SQLiteAdminIdentityRepository(reopened),
        new SQLiteAdminSessionRepository(reopened),
        new Argon2idPasswordHasher(),
      );
      const authentication = restartedService.authenticateSessionToken(
        ownerSession.rawToken,
      );
      assert.equal(authentication?.user.email, "persistent@example.com");
      assert.equal(authentication?.user.role, "OWNER");
    } finally {
      reopened.close();
    }
  } finally {
    firstDatabase?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the current migration chain upgrades an existing M1 database without losing M2", () => {
  const dataRoot = createTemporaryDirectory("pythagoras-m1-upgrade-");
  const m1Migrations = createTemporaryDirectory("pythagoras-m1-migrations-");
  try {
    mkdirSync(path.join(m1Migrations, "meta"), { recursive: true });
    copyFileSync(
      path.join(migrationsDirectory, "0000_content-foundation.sql"),
      path.join(m1Migrations, "0000_content-foundation.sql"),
    );
    writeFileSync(
      path.join(m1Migrations, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "sqlite",
        entries: [
          {
            idx: 0,
            version: "6",
            when: 1_787_406_399_690,
            tag: "0000_content-foundation",
            breakpoints: true,
          },
        ],
      }),
    );

    const m1Database = openContentDatabase({
      dataDirectory: dataRoot,
      migrationsDirectory: m1Migrations,
    });
    assert.equal(getContentDatabaseStatus(m1Database).migrationsApplied, 1);
    m1Database.close();

    const upgraded = openContentDatabase({
      dataDirectory: dataRoot,
      migrationsDirectory,
    });
    assert.equal(getContentDatabaseStatus(upgraded).migrationsApplied, 20);
    const tables = upgraded.client
      .prepare(
        "select name from sqlite_master where type = 'table' and name in ('admin_users', 'admin_sessions') order by name",
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((table) => table.name),
      ["admin_sessions", "admin_users"],
    );
    upgraded.close();
  } finally {
    try { rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* Windows temp scanners may retain an already-closed fixture. */ }
    try { rmSync(m1Migrations, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best-effort test fixture cleanup */ }
  }
});

test("same-origin mutation checks allow loopback HTTP and HTTPS but reject unsafe origins", () => {
  const local = new Request("http://localhost:3000/api/admin/auth/login", {
    method: "POST",
    headers: {
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.deepEqual(assertTrustedMutationRequest(local), { secure: false });

  const https = new Request("https://admin.example.test/api/admin/auth/login", {
    method: "POST",
    headers: {
      Host: "admin.example.test",
      Origin: "https://admin.example.test",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.deepEqual(assertTrustedMutationRequest(https), { secure: true });

  for (const request of [
    new Request("http://localhost:3000/api/admin/auth/login", {
      method: "POST",
      headers: { Host: "localhost:3000", Origin: "https://evil.example" },
    }),
    new Request("http://192.168.1.8:3000/api/admin/auth/login", {
      method: "POST",
      headers: { Host: "192.168.1.8:3000", Origin: "http://192.168.1.8:3000" },
    }),
  ]) {
    assert.throws(() => assertTrustedMutationRequest(request));
  }
});

test("login throttling applies temporary backoff without permanent lockout", () => {
  let now = 10_000;
  const limiter = new LoginAttemptLimiter({
    clock: () => now,
    backoffStartsAfter: 3,
    maxBackoffMs: 5_000,
  });
  const key = "owner@example.com\u0000local";

  limiter.recordFailure(key);
  limiter.recordFailure(key);
  limiter.recordFailure(key);
  assert.throws(() => limiter.assertAllowed(key), AdminRateLimitError);
  now += 1_001;
  assert.doesNotThrow(() => limiter.assertAllowed(key));
  limiter.clear(key);
  assert.doesNotThrow(() => limiter.assertAllowed(key));
});

test("login throttling keys are normalized per identity", () => {
  assert.equal(
    getLoginAttemptKey("  OWNER@Example.com  "),
    getLoginAttemptKey("owner@example.com"),
  );
  assert.notEqual(
    getLoginAttemptKey("owner@example.com"),
    getLoginAttemptKey("other@example.com"),
  );
});

test("API error mapping uses stable codes across server bundle boundaries", async () => {
  const setupResponse = adminAuthErrorResponse(
    Object.assign(new Error("bundled setup error"), {
      code: "ADMIN_SETUP_UNAVAILABLE",
    }),
    "setup",
  );
  assert.equal(setupResponse.status, 409);
  assert.equal(
    (await setupResponse.json() as { code: string }).code,
    "ADMIN_SETUP_UNAVAILABLE",
  );

  const loginResponse = adminAuthErrorResponse(
    Object.assign(new Error("bundled credential error"), {
      code: "ADMIN_INVALID_CREDENTIALS",
    }),
    "login",
  );
  assert.equal(loginResponse.status, 401);
  assert.deepEqual(await loginResponse.json(), {
    ok: false,
    code: "ADMIN_INVALID_CREDENTIALS",
    message: "Invalid email or password.",
  });
});

function listFilesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    if (statSync(fullPath).isDirectory()) files.push(...listFilesRecursively(fullPath));
    else files.push(fullPath);
  }
  return files;
}

test("authentication code does not intentionally use browser storage or JavaScript tokens", () => {
  const authRoots = [
    path.join(process.cwd(), "src", "server", "admin-auth"),
    path.join(process.cwd(), "src", "app", "api", "admin"),
    path.join(process.cwd(), "src", "components", "admin", "auth"),
    path.join(process.cwd(), "src", "app", "admin", "(auth)"),
  ];
  const forbidden = /localStorage|sessionStorage|indexedDB|IndexedDB|JWT/gu;

  for (const file of authRoots.flatMap(listFilesRecursively)) {
    if (!/\.(ts|tsx)$/u.test(file)) continue;
    assert.equal(forbidden.test(readFileSync(file, "utf8")), false, file);
    forbidden.lastIndex = 0;
  }
});
