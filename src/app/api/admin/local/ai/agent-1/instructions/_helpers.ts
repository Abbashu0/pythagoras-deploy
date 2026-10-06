import { AIPolicyError } from "@/server/ai/policy/errors";
import { InstructionSectionError } from "@/lib/ai-instruction-sections";
import { localApiError, localJson } from "../../../_shared";
export function instructionApiError(error: unknown) {
  if (error instanceof InstructionSectionError) return localJson({ ok: false, code: "AI_POLICY_INVALID", field: error.field, message: error.message }, { status: 400 });
  if (error instanceof AIPolicyError) return localJson({ ok: false, code: error.code, message: error.message, details: error.details }, { status: error.code === "AI_POLICY_CONFLICT" || error.code === "AI_POLICY_SCOPE_CONFLICT" ? 409 : error.code === "AI_POLICY_NOT_FOUND" ? 404 : 400 });
  return localApiError(error);
}
