import { AdminUntrustedOriginError, AdminValidationError } from "./errors";

export const ADMIN_AUTH_MAX_REQUEST_BYTES = 16 * 1024;

export interface TrustedMutationContext {
  secure: boolean;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "").toLowerCase();
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function assertTrustedMutationRequest(request: Request): TrustedMutationContext {
  const originHeader = request.headers.get("origin");
  const hostHeader = request.headers.get("host");
  if (!originHeader || !hostHeader || originHeader === "null") {
    throw new AdminUntrustedOriginError();
  }

  let origin: URL;
  let requestHost: string;
  try {
    origin = new URL(originHeader);
    requestHost = new URL(`${origin.protocol}//${hostHeader}`).host;
  } catch {
    throw new AdminUntrustedOriginError();
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || origin.host.toLowerCase() !== requestHost.toLowerCase()) {
    throw new AdminUntrustedOriginError();
  }

  if (origin.protocol === "https:") {
    return { secure: true };
  }

  if (origin.protocol === "http:" && isLoopbackHostname(origin.hostname)) {
    return { secure: false };
  }

  throw new AdminUntrustedOriginError();
}

function requestHostname(hostHeader: string | null): string {
  if (!hostHeader) throw new AdminUntrustedOriginError();
  try {
    return normalizeHostname(new URL(`http://${hostHeader}`).hostname);
  } catch {
    throw new AdminUntrustedOriginError();
  }
}

/** The rebuilt local Admin is intentionally unavailable to remote hosts. */
export function assertLocalAdminRequest(request: Request): void {
  if (!isLoopbackHostname(requestHostname(request.headers.get("host")))) {
    throw new AdminUntrustedOriginError();
  }
}

/** Same-origin protection plus the loopback-only local Admin boundary. */
export function assertTrustedLocalAdminMutationRequest(
  request: Request,
): TrustedMutationContext {
  const trusted = assertTrustedMutationRequest(request);
  const originHeader = request.headers.get("origin");
  let origin: URL;
  try {
    origin = new URL(originHeader ?? "");
  } catch {
    throw new AdminUntrustedOriginError();
  }

  if (
    !isLoopbackHostname(origin.hostname) ||
    !isLoopbackHostname(requestHostname(request.headers.get("host")))
  ) {
    throw new AdminUntrustedOriginError();
  }

  return trusted;
}

export async function readAdminAuthJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    contentType !== "application/json" ||
    !Number.isFinite(declaredLength) ||
    declaredLength > ADMIN_AUTH_MAX_REQUEST_BYTES
  ) {
    throw new AdminValidationError("Invalid authentication request.");
  }

  const body = await request.text();
  if (!body || Buffer.byteLength(body, "utf8") > ADMIN_AUTH_MAX_REQUEST_BYTES) {
    throw new AdminValidationError("Invalid authentication request.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new AdminValidationError("Invalid authentication request.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AdminValidationError("Invalid authentication request.");
  }
  return parsed as Record<string, unknown>;
}

export function getLoginAttemptKey(email: unknown): string {
  const identity =
    typeof email === "string"
      ? email.normalize("NFKC").trim().toLowerCase().slice(0, 254)
      : "invalid-identity";
  return `identity\u0000${identity}`;
}
