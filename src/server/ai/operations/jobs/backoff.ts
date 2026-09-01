import { createHash } from "node:crypto";

import { AIJobError } from "./errors";

const MAX_TIMESTAMP = 8_640_000_000_000_000;

export function calculateAIJobRetryDelay(input: {
  jobId: string;
  attemptNumber: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}): number {
  if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1) {
    throw new AIJobError("AI_JOB_INVALID", "Job attempt number is invalid.");
  }
  let cap = input.backoffBaseMs;
  for (let index = 1; index < input.attemptNumber && cap < input.backoffMaxMs; index += 1) {
    cap = Math.min(input.backoffMaxMs, cap > Math.floor(Number.MAX_SAFE_INTEGER / 2) ? input.backoffMaxMs : cap * 2);
  }
  if (cap <= 0) return 0;
  const digest = createHash("sha256").update(`${input.jobId}:${input.attemptNumber}`).digest("hex");
  const bucket = Number.parseInt(digest.slice(0, 8), 16) % 1001;
  return Math.min(input.backoffMaxMs, Math.floor((cap * bucket) / 1000));
}

export function addAIJobDelay(now: number, delayMs: number): number {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(delayMs) || delayMs < 0 || now > MAX_TIMESTAMP - delayMs) {
    throw new AIJobError("AI_JOB_INVALID", "Job retry timestamp is invalid.");
  }
  return now + delayMs;
}
