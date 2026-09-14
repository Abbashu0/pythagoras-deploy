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
} from "../../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ packageId: string }> },
) {
  try {
    requireLocalAdminRead(request);
    const database = getContentDatabase();
    const workspace = await getDirectQuestionEditorService().getPackageWorkspace(
      (await context.params).packageId,
      getLocalAdminActor(database),
    );
    return localJson({ ok: true, workspace });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ packageId: string }> },
) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (Object.keys(body).some((key) => !["title", "expectedRevision"].includes(key))) {
      throw new AdminValidationError("Package update contains unsupported fields.");
    }
    if (!("title" in body) || !("expectedRevision" in body)) {
      throw new AdminValidationError("Package title and revision are required.");
    }
    const workspace = await getDirectQuestionEditorService().updatePackageTitle(
      (await context.params).packageId,
      body.title,
      body.expectedRevision,
      actor,
    );
    return localJson({ ok: true, workspace });
  } catch (error) {
    return localApiError(error);
  }
}
