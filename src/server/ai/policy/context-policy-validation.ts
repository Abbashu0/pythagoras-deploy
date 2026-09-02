import {
  AI_CONTEXT_POLICY_MAX_BUDGET_TOKENS,
  AI_CONTEXT_POLICY_MAX_RECENT_TURNS,
  type AIContextPolicyContent,
} from "./context-policy-contracts";
import { AIPolicyError } from "./errors";

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const BUDGET_FIELDS = [
  "softInputBudgetTokens",
  "hardInputBudgetTokens",
  "outputReserveTokens",
  "policyBudgetTokens",
  "summaryBudgetTokens",
  "recentTurnsBudgetTokens",
  "memoryBudgetTokens",
  "evidenceBudgetTokens",
] as const;

export function normalizeAIContextPolicyContent(value: unknown): AIContextPolicyContent {
  if (!isPlainObject(value)) invalid("Context Policy must be an object.");
  requireExactKeys(value, ["key", "displayName", ...BUDGET_FIELDS, "maxRecentTurns", "enabled"]);
  const key = text(value.key, "key", 1, 120).toLowerCase();
  if (!KEY_PATTERN.test(key)) invalid("Context Policy key is invalid.");
  const displayName = text(value.displayName, "displayName", 1, 200);
  const budgets = Object.fromEntries(BUDGET_FIELDS.map((field) => [field, positiveOrZeroInteger(value[field], field)])) as Pick<AIContextPolicyContent, (typeof BUDGET_FIELDS)[number]>;
  if (budgets.softInputBudgetTokens <= 0 || budgets.hardInputBudgetTokens < budgets.softInputBudgetTokens) invalid("Context Policy soft and hard budgets are invalid.");
  if (budgets.outputReserveTokens <= 0) invalid("Context Policy output reserve is invalid.");
  if (typeof value.maxRecentTurns !== "number" || !Number.isSafeInteger(value.maxRecentTurns) || value.maxRecentTurns < 1 || value.maxRecentTurns > AI_CONTEXT_POLICY_MAX_RECENT_TURNS) invalid("Context Policy recent-turn bound is invalid.");
  if (typeof value.enabled !== "boolean") invalid("Context Policy enabled state is invalid.");
  return { key, displayName, ...budgets, maxRecentTurns: value.maxRecentTurns, enabled: value.enabled };
}

function positiveOrZeroInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > AI_CONTEXT_POLICY_MAX_BUDGET_TOKENS) invalid(`${field} is invalid.`);
  return value;
}

function text(value: unknown, field: string, min: number, maxLength: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length < min || normalized.length > maxLength) invalid(`${field} length is invalid.`);
  return normalized;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("Context Policy fields are invalid.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AIPolicyError("AI_POLICY_INVALID", message);
}
