# M2 — Local Admin identity

M2 makes the local Admin surface server-authenticated. It does not migrate existing browser content, add team management, or implement review and publication workflows.

## Identity and roles

- `admin_users` stores normalized email identities, display names, Argon2id password hashes, enabled state, role, timestamps, and optimistic revision.
- Supported roles are constrained to `OWNER` and `ADMIN` in both TypeScript and SQLite.
- A partial unique SQLite index permits only one `OWNER`. The initial role is assigned by the server and competing first-run setup attempts cannot create two owners.
- The only owner cannot be disabled through the M2 service boundary. No public user-management endpoint exists in M2.

Future mutations obtain `actorUserId` and `actorRole` from a validated server session through the authorization helpers. Browser-supplied actor or role fields are never authoritative.

## Password policy

- Algorithm: Argon2id through `argon2`.
- Parameters: 19,456 KiB memory, 2 iterations, parallelism 1, 32-byte hash output.
- New passwords accept 12–1,024 Unicode characters without artificial composition rules or silent truncation.
- Passwords and hashes are never returned by Admin APIs or logged.
- Login uses one generic public failure for unknown identities and incorrect passwords, including a dummy Argon2 verification for unknown identities.

There are no default credentials, email verification, or password-reset flows.

## Sessions

- A successful setup or login generates a new 32-byte cryptographically random opaque token.
- The raw token exists only in the browser cookie. SQLite stores its SHA-256 digest, never the raw token.
- Sessions have a 12-hour absolute lifetime. `lastSeenAt` writes are throttled to at most once every 15 minutes.
- Logout revokes the database session before expiring the cookie. Disabled users and expired, revoked, or pre-password-change sessions are rejected.

Cookie configuration:

- name: `pythagoras_admin_session`
- `HttpOnly=true`
- `SameSite=Strict`
- `Path=/`
- no `Domain` attribute
- `Secure=true` for HTTPS

Plain HTTP is accepted only for exact loopback origins (`localhost`, `127.0.0.1`, or `[::1]`) so local development remains usable. Non-loopback Admin mutation requests over insecure HTTP are rejected; a non-local deployment must use HTTPS.

## Routes and APIs

- `/admin/setup` is available only while no owner exists.
- `/admin/login` is available after setup.
- All other `/admin` routes require an enabled user with an active session.
- `GET /api/admin/session` returns only `id`, `displayName`, and `role`.
- `POST /api/admin/auth/setup`, `/login`, and `/logout` use no-store responses.
- `GET /api/system/status` remains public and sanitized; it exposes no paths, users, hashes, or database internals.
- Student `/` remains public.

## Mutation security and login throttling

Current state-changing Admin endpoints require an `Origin` matching `Host`, reject cross-site Fetch Metadata, and allow insecure transport only on loopback. Future cookie-authenticated Admin mutation routes must reuse `assertTrustedMutationRequest`; `SameSite` alone is not the CSRF boundary.

Login failures are tracked in server memory per normalized identity. Backoff begins after three failures, grows exponentially, is capped at 30 seconds, and resets after ten minutes or a successful login. M2 intentionally does not trust `X-Forwarded-For` before a trusted-proxy boundary exists. This is a modest local defense, not a distributed rate limiter; process restarts clear the counters.

## Verification

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```
