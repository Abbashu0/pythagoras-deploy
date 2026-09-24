import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PAIRING_CODE_TTL_MS = 2 * 60 * 1_000;
const SESSION_TTL_MS = 30 * 60 * 1_000;
const SESSION_REQUEST_LIMIT = 32;
const PAIRING_ATTEMPT_WINDOW_MS = 60 * 1_000;
const PAIRING_ATTEMPT_LIMIT = 12;
const MAX_FAILED_CODES = 5;

type PendingPairing = {
  digest: Buffer;
  expiresAt: number;
  failedCodes: number;
};

type MobileSession = {
  digest: Buffer;
  expiresAt: number;
  requestsRemaining: number;
};

export type Agent1DevPairResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; code: "PAIRING_CODE_INVALID" | "PAIRING_RATE_LIMITED" };

/** Process-memory-only pairing for the explicitly development-only iPhone chat. */
export class Agent1DevPairingRegistry {
  private pending: PendingPairing | null = null;
  private session: MobileSession | null = null;
  private attemptWindowStartedAt = 0;
  private attemptsInWindow = 0;

  constructor(
    private readonly options: {
      now?: () => number;
      createCode?: () => string;
      createToken?: () => string;
    } = {},
  ) {}

  issueCode(): { code: string; expiresAt: number } {
    const now = this.now();
    const code = (this.options.createCode ?? (() => randomBytes(10).toString("hex")))()
      .replace(/[^a-f0-9]/giu, "")
      .toUpperCase();
    if (!/^[A-F0-9]{20}$/u.test(code)) {
      throw new Error("The development pairing code generator returned an invalid code.");
    }

    const expiresAt = now + PAIRING_CODE_TTL_MS;
    this.pending = { digest: digest(code), expiresAt, failedCodes: 0 };
    this.session = null;
    return { code, expiresAt };
  }

  redeemCode(value: unknown): Agent1DevPairResult {
    const now = this.now();
    if (!this.canAttempt(now)) {
      return { ok: false, code: "PAIRING_RATE_LIMITED" };
    }

    const pending = this.pending;
    if (!pending || pending.expiresAt <= now || typeof value !== "string") {
      this.expirePending(now);
      return { ok: false, code: "PAIRING_CODE_INVALID" };
    }

    const candidate = value.trim().toUpperCase();
    if (!/^[A-F0-9]{20}$/u.test(candidate) || !safeDigestEqual(pending.digest, digest(candidate))) {
      pending.failedCodes += 1;
      if (pending.failedCodes >= MAX_FAILED_CODES) this.pending = null;
      return { ok: false, code: "PAIRING_CODE_INVALID" };
    }

    this.pending = null;
    const token = (this.options.createToken ?? (() => randomBytes(32).toString("base64url")))();
    const expiresAt = now + SESSION_TTL_MS;
    this.session = {
      digest: digest(token),
      expiresAt,
      requestsRemaining: SESSION_REQUEST_LIMIT,
    };
    return { ok: true, token, expiresAt };
  }

  authorizeRequest(token: unknown): boolean {
    const now = this.now();
    const session = this.session;
    if (
      !session ||
      session.expiresAt <= now ||
      session.requestsRemaining <= 0 ||
      typeof token !== "string" ||
      token.length < 40 ||
      token.length > 128
    ) {
      if (session && (session.expiresAt <= now || session.requestsRemaining <= 0)) {
        this.session = null;
      }
      return false;
    }

    if (!safeDigestEqual(session.digest, digest(token))) return false;
    session.requestsRemaining -= 1;
    if (session.requestsRemaining <= 0) this.session = null;
    return true;
  }

  revokeSession(token: unknown): void {
    if (typeof token !== "string" || !this.session) return;
    if (safeDigestEqual(this.session.digest, digest(token))) this.session = null;
  }

  private canAttempt(now: number): boolean {
    if (now - this.attemptWindowStartedAt >= PAIRING_ATTEMPT_WINDOW_MS) {
      this.attemptWindowStartedAt = now;
      this.attemptsInWindow = 0;
    }
    if (this.attemptsInWindow >= PAIRING_ATTEMPT_LIMIT) return false;
    this.attemptsInWindow += 1;
    return true;
  }

  private expirePending(now: number): void {
    if (this.pending && this.pending.expiresAt <= now) this.pending = null;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

const globalRegistryKey = "__pythagorasAgent1DevPairingRegistry" as const;
type RegistryGlobal = typeof globalThis & {
  [globalRegistryKey]?: Agent1DevPairingRegistry;
};

/** Shared across Next dev route bundles and hot reloads, but never written to disk. */
export function getAgent1DevPairingRegistry(): Agent1DevPairingRegistry {
  const registryGlobal = globalThis as RegistryGlobal;
  registryGlobal[globalRegistryKey] ??= new Agent1DevPairingRegistry();
  return registryGlobal[globalRegistryKey];
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function safeDigestEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
