import { getMaterialQuestionBankService } from "@/server/material-question-bank";
import { publicQuestionBankError, publicQuestionBankJson } from "../_shared";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ subjectKey: string }> }) {
  try {
    const { subjectKey } = await context.params;
    return publicQuestionBankJson({ ok: true, layout: getMaterialQuestionBankService().getPublicLayout(subjectKey) });
  } catch (error) { return publicQuestionBankError(error); }
}
