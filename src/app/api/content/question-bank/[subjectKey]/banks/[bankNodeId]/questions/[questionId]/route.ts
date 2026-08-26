import { getMaterialQuestionBankService } from "@/server/material-question-bank";
import { publicQuestionBankError, publicQuestionBankJson } from "../../../../../_shared";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ subjectKey: string; bankNodeId: string; questionId: string }> }) {
  try {
    const { subjectKey, bankNodeId, questionId } = await context.params;
    return publicQuestionBankJson({ ok: true, question: getMaterialQuestionBankService().getPublicQuestion(subjectKey, bankNodeId, questionId) });
  } catch (error) { return publicQuestionBankError(error); }
}
