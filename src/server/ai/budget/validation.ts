import {
  AI_COST_CENTERS,
  type AICostCenter,
} from "../economics";
import { AIBudgetPolicyError } from "./errors";
import type { AIBudgetPolicyContent } from "./contracts";

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function normalizeAIBudgetPolicyContent(value: unknown): AIBudgetPolicyContent {
  if (!isPlainObject(value)) invalid("Budget Policy must be an object.");
  requireExactKeys(value, ["key", "displayName", "currency", "costCenter", "hardCapNano", "enabled"]);
  const key = text(value.key, "key", 1, 120).toLowerCase();
  if (!KEY_PATTERN.test(key)) invalid("Budget Policy key is invalid.");
  const displayName = text(value.displayName, "displayName", 1, 200);
  const currency = text(value.currency, "currency", 3, 3).toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) invalid("Budget Policy currency is invalid.");
  if (typeof value.costCenter !== "string" || !AI_COST_CENTERS.includes(value.costCenter as never)) {
    invalid("Budget Policy cost center is invalid.");
  }
  if (!Number.isSafeInteger(value.hardCapNano) || (value.hardCapNano as number) < 0 || (value.hardCapNano as number) > MAX_SAFE) {
    invalid("Budget Policy hard cap is outside the safe nano-unit range.");
  }
  if (typeof value.enabled !== "boolean") invalid("Budget Policy enabled state is invalid.");
  return {
    key,
    displayName,
    currency,
    costCenter: value.costCenter as AICostCenter,
    hardCapNano: value.hardCapNano as number,
    enabled: value.enabled,
  };
}
function invalid(message: string): never {
  throw new AIBudgetPolicyError("AI_BUDGET_POLICY_INVALID", message);
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max) invalid(`${field} length is invalid.`);
  return normalized;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid("Budget Policy fields are invalid.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
