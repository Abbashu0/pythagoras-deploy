import type { NextRequest } from "next/server";
import { getCanonicalContentRepository } from "@/server/canonical-content";
import { getContentDatabase } from "@/server/content";
import { toLocalAdminMaterialView } from "@/server/canonical-content/admin-view";
import {
  localApiError,
  localJson,
  requireLocalAdminRead,
} from "../../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    const database = getContentDatabase();
    const service = getCanonicalContentRepository();
    const snapshot = service.getSnapshot();
    return localJson({
      ok: true,
      materials: await Promise.all(
        snapshot.materials.map((material) => toLocalAdminMaterialView(database, material)),
      ),
      settings: snapshot.materialSettings,
      contentRevision: snapshot.contentRevision,
    });
  } catch (error) {
    return localApiError(error);
  }
}
