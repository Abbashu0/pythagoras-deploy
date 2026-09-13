import type { NextRequest } from "next/server";
import { AdminValidationError } from "@/server/admin-auth";
import { getDirectBannerService } from "@/server/canonical-content";
import { toLocalAdminBannerView } from "../_view";
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
      throw new AdminValidationError("Banner order and revisions are required.");
    }
    const banners = getDirectBannerService().reorder(
      body.ids,
      body.expectedRevisions,
      actor,
    );
    return localJson({
      ok: true,
      banners: await Promise.all(banners.map((banner) => toLocalAdminBannerView(banner))),
    });
  } catch (error) {
    return localApiError(error);
  }
}
