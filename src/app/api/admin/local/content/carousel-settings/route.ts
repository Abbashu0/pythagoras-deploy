import type { NextRequest } from "next/server";
import { AdminValidationError } from "@/server/admin-auth";
import { getDirectCarouselSettingsService } from "@/server/canonical-content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    return localJson({
      ok: true,
      settings: getDirectCarouselSettingsService().get(),
    });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    const keys = Object.keys(body).sort().join(",");
    if (keys !== "autoSlideInterval,expectedRevision") {
      throw new AdminValidationError(
        "Carousel settings require an interval and expected revision.",
      );
    }
    const settings = getDirectCarouselSettingsService().update(
      { autoSlideInterval: body.autoSlideInterval },
      body.expectedRevision,
      actor,
    );
    return localJson({ ok: true, settings });
  } catch (error) {
    return localApiError(error);
  }
}
