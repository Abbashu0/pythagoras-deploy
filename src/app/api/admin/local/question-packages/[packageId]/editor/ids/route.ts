import type { NextRequest } from "next/server";
import { AdminValidationError, getLocalAdminActor } from "@/server/admin-auth";
import { getContentDatabase } from "@/server/content";
import { getDirectQuestionEditorService } from "@/server/question-editor";
import { localApiError, localJson, readLocalJsonBody, requireLocalAdminRead } from "../../../../_shared";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ packageId: string }> },
) {
  try {
    requireLocalAdminRead(request);
    const body = await readLocalJsonBody(request);
    const allowed = ["blocks", "verses", "occurrences", "variants", "taxonomy", "browse", "newQuestion"];
    if (Object.keys(body).some((key) => !allowed.includes(key))) throw new AdminValidationError("Question editor ID request contains unsupported fields.");
    const database = getContentDatabase();
    const service = getDirectQuestionEditorService();
    const actor = getLocalAdminActor(database);
    const packageId = (await context.params).packageId;
    if (body.newQuestion === true) return localJson({ ok: true, prepared: service.prepareNewQuestion(packageId, actor) });
    return localJson({ ok: true, ids: service.prepareIds({ blocks: count(body.blocks), verses: count(body.verses), occurrences: count(body.occurrences), variants: count(body.variants), taxonomy: count(body.taxonomy), browse: count(body.browse) }) });
  } catch (error) {
    return localApiError(error);
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
