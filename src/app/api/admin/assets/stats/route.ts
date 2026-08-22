import type { NextRequest } from "next/server";
import { getAssetService } from "@/server/assets";
import {
  assetApiErrorResponse,
  noStoreAssetJson,
  requireAssetApiAdmin,
} from "../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    requireAssetApiAdmin(request);
    return noStoreAssetJson({ ok: true, stats: getAssetService().getInventoryStats() });
  } catch (error) {
    return assetApiErrorResponse(error);
  }
}
