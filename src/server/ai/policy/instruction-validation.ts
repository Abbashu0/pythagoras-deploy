import {
  AI_INSTRUCTION_POLICY_MAX_BYTES,
  AI_INSTRUCTION_POLICY_SCOPES,
  type AIInstructionPolicyContent,
} from "./instruction-contracts";
import { AIPolicyError } from "./errors";
import { assertInstructionText } from "@/lib/ai-instruction-sections";
import { validateInstructionAuthoring } from "./instruction-compiler";

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SUBJECT_KEY_PATTERN = /^[a-z0-9-]{1,80}$/u;

export function normalizeAIInstructionPolicyContent(value: unknown): AIInstructionPolicyContent {
  if (!isPlainObject(value)) invalid("Instruction Policy must be an object.");
  requireExactKeys(value, ["key", "scope", "subjectKey", "displayName", "instructions", "enabled", ...(Object.hasOwn(value, "authoring") ? ["authoring"] : [])]);
  const key = text(value.key, "key", 1, 120).toLowerCase();
  if (!KEY_PATTERN.test(key)) invalid("Instruction Policy key is invalid.");
  if (typeof value.scope !== "string" || !AI_INSTRUCTION_POLICY_SCOPES.includes(value.scope as never)) invalid("Instruction Policy scope is invalid.");
  const scope = value.scope as AIInstructionPolicyContent["scope"];
  const subjectKey = value.subjectKey === null ? null : normalizeSubjectKey(value.subjectKey);
  if (scope === "GLOBAL" && subjectKey !== null) invalid("Global Instruction Policy cannot have a subject.");
  if (scope === "SUBJECT" && subjectKey === null) invalid("Subject Instruction Policy requires a subject.");
  const displayName = text(value.displayName, "displayName", 1, 200);
  try { assertInstructionText(value.instructions, "instructions", AI_INSTRUCTION_POLICY_MAX_BYTES); } catch { invalid("Instruction Policy text is invalid."); }
  const instructions = value.instructions;
  if (!instructions.trim()) invalid("Instruction Policy text is empty.");
  if (typeof value.enabled !== "boolean") invalid("Instruction Policy enabled state is invalid.");
  let authoring;
  if (Object.hasOwn(value, "authoring")) {
    try { authoring = validateInstructionAuthoring(value.authoring, instructions); }
    catch { invalid("Instruction Policy authoring metadata is invalid."); }
  }
  return { key, scope, subjectKey, displayName, instructions, enabled: value.enabled, ...(authoring ? { authoring } : {}) };
}

function normalizeSubjectKey(value: unknown): string {
  if (typeof value !== "string") invalid("Instruction Policy subject is invalid.");
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!SUBJECT_KEY_PATTERN.test(normalized)) invalid("Instruction Policy subject is invalid.");
  return normalized;
}

function text(value: unknown, field: string, min: number, maxBytes: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length < min || Buffer.byteLength(normalized, "utf8") > maxBytes) invalid(`${field} length is invalid.`);
  return normalized;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("Instruction Policy fields are invalid.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AIPolicyError("AI_POLICY_INVALID", message);
}
