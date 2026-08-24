import type { NextRequest } from "next/server";
import { getAdminActor } from "@/server/admin-auth";
import { getQuestionPackageImportService } from "@/server/question-import";
import { questionApiError, questionJson, requireQuestionAdmin } from "../../_shared";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  try {
    const authentication = requireQuestionAdmin(request);
    const { assetId } = await context.params;
    const preflight = await getQuestionPackageImportService().preflight(assetId, getAdminActor(authentication));
    return questionJson({ ok: true, preflight });
  } catch (error) { return questionApiError(error); }
}
