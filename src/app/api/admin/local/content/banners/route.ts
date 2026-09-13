import type { NextRequest } from "next/server";
import {
  getDirectBannerService,
} from "@/server/canonical-content";
import { getCanonicalContentRepository } from "@/server/canonical-content";
import { AdminValidationError } from "@/server/admin-auth";
import { toLocalAdminBannerView } from "./_view";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../_shared";

export const runtime = "nodejs";

const CREATE_FIELDS = new Set([
  "title",
  "assetId",
  "startsAt",
  "endsAt",
  "offsetX",
  "offsetY",
  "scale",
  "enabled",
]);

function assertFields(body: Record<string, unknown>, allowed: Set<string>): void {
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new AdminValidationError("Banner request contains unsupported fields.");
  }
}

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    const banners = await Promise.all(
      getDirectBannerService()
        .list()
        .map((banner) => toLocalAdminBannerView(banner)),
    );
    return localJson({
      ok: true,
      banners,
      contentRevision: getCanonicalContentRepository().getSnapshot().contentRevision,
    });
  } catch (error) {
    return localApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    assertFields(body, CREATE_FIELDS);
    const banner = getDirectBannerService().create(body, actor);
    return localJson(
      { ok: true, banner: await toLocalAdminBannerView(banner) },
      { status: 201 },
    );
  } catch (error) {
    return localApiError(error);
  }
}
