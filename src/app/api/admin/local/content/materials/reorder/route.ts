import type { NextRequest } from "next/server";
import { AdminValidationError } from "@/server/admin-auth";
import { getCanonicalContentRepository, getDirectMaterialService } from "@/server/canonical-content";
import { getContentDatabase } from "@/server/content";
import { toLocalAdminMaterialView } from "@/server/canonical-content/admin-view";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
} from "../../../_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (
      Object.keys(body).some((key) => !["ids", "expectedRevisions"].includes(key)) ||
      !("ids" in body) ||
      !("expectedRevisions" in body)
    ) {
      throw new AdminValidationError("Material order and revisions are required.");
    }
    getDirectMaterialService().reorder(body.ids, body.expectedRevisions, actor);
    const database = getContentDatabase();
    const snapshot = getCanonicalContentRepository().getSnapshot();
    return localJson({
      ok: true,
      materials: await Promise.all(
        snapshot.materials.map((material) => toLocalAdminMaterialView(database, material)),
      ),
    });
  } catch (error) {
    return localApiError(error);
  }
}
