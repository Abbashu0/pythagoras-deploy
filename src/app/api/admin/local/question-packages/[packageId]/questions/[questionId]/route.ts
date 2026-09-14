import type { NextRequest } from "next/server";
import { AdminValidationError, getLocalAdminActor } from "@/server/admin-auth";
import { getContentDatabase } from "@/server/content";
import { getDirectQuestionEditorService } from "@/server/question-editor";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../../../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ packageId: string; questionId: string }> },
) {
  try {
    requireLocalAdminRead(request);
    const database = getContentDatabase();
    const params = await context.params;
    const question = getDirectQuestionEditorService().getQuestion(
      params.packageId,
      params.questionId,
      getLocalAdminActor(database),
    );
    return localJson({ ok: true, question });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ packageId: string; questionId: string }> },
) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (Object.keys(body).some((key) => !["content", "expectedRevision", "deleteVariantIds", "deleteOccurrenceIds"].includes(key))) {
      throw new AdminValidationError("Question update contains unsupported fields.");
    }
    if (!("content" in body) || !("expectedRevision" in body)) throw new AdminValidationError("Question content and revision are required.");
    const params = await context.params;
    const question = getDirectQuestionEditorService().updateQuestion(
      params.packageId,
      params.questionId,
      body.content,
      body.expectedRevision,
      { variantIds: body.deleteVariantIds, occurrenceIds: body.deleteOccurrenceIds },
      actor,
    );
    return localJson({ ok: true, question });
  } catch (error) {
    return localApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ packageId: string; questionId: string }> },
) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (Object.keys(body).length !== 1 || !("expectedRevision" in body)) throw new AdminValidationError("Question revision is required for deletion.");
    const params = await context.params;
    getDirectQuestionEditorService().deleteQuestion(params.packageId, params.questionId, body.expectedRevision, actor);
    return localJson({ ok: true, deleted: true });
  } catch (error) {
    return localApiError(error);
  }
}
