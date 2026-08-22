import type { NextRequest } from "next/server";
import { getAssetService, toSafeAsset } from "@/server/assets";
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
      asset: toSafeAsset(getAssetService().getById(id)),
    });
  } catch (error) {
    return assetApiErrorResponse(error);
  }
}
