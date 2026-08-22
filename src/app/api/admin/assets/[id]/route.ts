import type { NextRequest } from "next/server";
import { getAssetService, toSafeAssetWithCreator } from "@/server/assets";
import { getCanonicalContentRepository } from "@/server/canonical-content";
import {
  assetApiErrorResponse,
  noStoreAssetJson,
  requireAssetApiAdmin,
} from "../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireAssetApiAdmin(request);
    const { id } = await context.params;
    return noStoreAssetJson({
      ok: true,
      asset: toSafeAssetWithCreator(getAssetService().getByIdWithCreator(id)),
      usage: getCanonicalContentRepository().getAssetUsage(id),
    });
  } catch (error) {
    return assetApiErrorResponse(error);
  }
}
