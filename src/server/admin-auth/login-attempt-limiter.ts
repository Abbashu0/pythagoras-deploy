import { createHash } from "node:crypto";
import { AdminRateLimitError } from "./errors";

interface AttemptState {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

export interface LoginAttemptLimiterOptions {
  clock?: () => number;
  windowMs?: number;
  backoffStartsAfter?: number;
  maxBackoffMs?: number;
}

export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, AttemptState>();
  private readonly clock: () => number;
  private readonly windowMs: number;
  private readonly backoffStartsAfter: number;
  private readonly maxBackoffMs: number;

  constructor(options: LoginAttemptLimiterOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.windowMs = options.windowMs ?? 10 * 60 * 1000;
    this.backoffStartsAfter = options.backoffStartsAfter ?? 3;
    this.maxBackoffMs = options.maxBackoffMs ?? 30 * 1000;
  }

  assertAllowed(identityAndSource: string): void {
    const key = this.hashKey(identityAndSource);
    const state = this.getCurrentState(key);
    if (!state) return;

    const now = this.clock();
    if (state.blockedUntil > now) {
      throw new AdminRateLimitError(
        Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)),
      );
    }
  }

  recordFailure(identityAndSource: string): void {
    const key = this.hashKey(identityAndSource);
    const now = this.clock();
    const current = this.getCurrentState(key) ?? {
      failures: 0,
      windowStartedAt: now,
      blockedUntil: now,
    };
    const failures = current.failures + 1;
    const backoffExponent = Math.max(0, failures - this.backoffStartsAfter);
    const backoffMs =
      failures < this.backoffStartsAfter
        ? 0
        : Math.min(2 ** backoffExponent * 1000, this.maxBackoffMs);

    this.attempts.set(key, {
      failures,
      windowStartedAt: current.windowStartedAt,
      blockedUntil: now + backoffMs,
    });
  }

  clear(identityAndSource: string): void {
    this.attempts.delete(this.hashKey(identityAndSource));
  }

  private getCurrentState(key: string): AttemptState | null {
    const state = this.attempts.get(key);
    if (!state) return null;
    if (this.clock() - state.windowStartedAt >= this.windowMs) {
      this.attempts.delete(key);
      return null;
    }
    return state;
  }

  private hashKey(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }
}
