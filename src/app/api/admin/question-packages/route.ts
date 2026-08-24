import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getQuestionPackageImportService, QuestionImportError, type ManualQuestionPackageInput } from "@/server/question-import";
import { questionApiError, questionJson, readQuestionBody, requireQuestionAdmin } from "./_shared";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try { requireQuestionAdmin(request); return questionJson({ ok: true, ...getQuestionPackageImportService().listWorkspace() }); }
  catch (error) { return questionApiError(error); }
}
export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireQuestionAdmin(request);
    const body = await readQuestionBody(request);
    const input: ManualQuestionPackageInput = {
      title: text(body.title), packageKey: text(body.packageKey), subjectKey: text(body.subjectKey), language: text(body.language),
      bankBrowseMode: body.bankBrowseMode === "TREE" ? "TREE" : body.bankBrowseMode === "ALL_PACKAGE_QUESTIONS" ? "ALL_PACKAGE_QUESTIONS" : invalid(),
      bankBrowseEntryKey: text(body.bankBrowseEntryKey), bankBrowseEntryLabel: text(body.bankBrowseEntryLabel), bankBrowseEntryOrder: Number(body.bankBrowseEntryOrder),
    };
    return questionJson({ ok: true, result: getQuestionPackageImportService().createEmptyPackage(input, getAdminActor(authentication)) }, 201);
  } catch (error) { return questionApiError(error); }
}
function text(value: unknown): string { if (typeof value !== "string") return invalid(); return value; }
function invalid(): never { throw new QuestionImportError("QUESTION_IMPORT_INVALID", "Manual Question Package fields are invalid."); }
