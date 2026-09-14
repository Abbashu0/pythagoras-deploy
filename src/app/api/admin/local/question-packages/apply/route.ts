import type { NextRequest } from "next/server";
import { AdminValidationError } from "@/server/admin-auth";
import { getDirectQuestionPackageService } from "@/server/question-import";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
} from "../../_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (
      Object.keys(body).some((key) => !["assetId", "acknowledgeWarnings"].includes(key)) ||
      typeof body.assetId !== "string"
    ) {
      throw new AdminValidationError("Question Package Asset ID is required.");
    }
    const result = await getDirectQuestionPackageService().apply(
      body.assetId,
      body.acknowledgeWarnings === true,
      actor,
    );
    return localJson({
      ok: true,
      operation: result.operation,
      package: {
        id: result.package.package.id,
        packageKey: result.package.package.packageKey,
        title: result.package.package.title,
        subjectKey: result.package.package.subjectKey,
        contentRevision: result.package.package.contentRevision,
        counts: {
          taxonomy: result.package.taxonomy.length,
          browseNodes: result.package.browseNodes.length,
          questions: result.package.questions.length,
          variants: result.package.questions.reduce((count, question) => count + question.variants.length, 0),
          occurrences: result.package.questions.reduce((count, question) => count + question.variants.reduce((total, variant) => total + variant.occurrences.length, 0), 0),
        },
      },
    });
  } catch (error) {
    return localApiError(error);
  }
}
