import {
  AI_STUDENT_PRINCIPAL_STATUSES,
  type AIStudentPrincipal,
  type StudentPrincipalProvider,
} from "./contracts";
import { AIConversationError } from "./errors";

const PRINCIPAL_REF_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;

export function validateAIStudentPrincipal(value: unknown): AIStudentPrincipal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AIConversationError("AI_STUDENT_PRINCIPAL_UNAVAILABLE", "A server-resolved Student Principal is required.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.principalRef !== "string" || !PRINCIPAL_REF_PATTERN.test(record.principalRef) || typeof record.status !== "string" || !AI_STUDENT_PRINCIPAL_STATUSES.includes(record.status as AIStudentPrincipal["status"])) {
    throw new AIConversationError("AI_STUDENT_PRINCIPAL_UNAVAILABLE", "The server-resolved Student Principal is invalid.");
  }
  return { principalRef: record.principalRef, status: record.status as AIStudentPrincipal["status"] };
}

export async function resolveActiveStudentPrincipal(
  provider: StudentPrincipalProvider,
  serverRequestContext: unknown,
): Promise<AIStudentPrincipal> {
  let resolved: AIStudentPrincipal | null;
  try {
    resolved = await provider.resolve(serverRequestContext);
  } catch (error) {
    throw new AIConversationError("AI_STUDENT_PRINCIPAL_UNAVAILABLE", "The Student Principal could not be resolved.", {}, error);
  }
  if (resolved === null) throw new AIConversationError("AI_STUDENT_PRINCIPAL_UNAVAILABLE", "The Student Principal could not be resolved.");
  const principal = validateAIStudentPrincipal(resolved);
  if (principal.status !== "ACTIVE") throw new AIConversationError("AI_STUDENT_PRINCIPAL_INACTIVE", "The Student Principal is not active.");
  return principal;
}

export function assertActiveStudentPrincipal(principal: AIStudentPrincipal): AIStudentPrincipal {
  const validated = validateAIStudentPrincipal(principal);
  if (validated.status !== "ACTIVE") throw new AIConversationError("AI_STUDENT_PRINCIPAL_INACTIVE", "The Student Principal is not active.");
  return validated;
}
