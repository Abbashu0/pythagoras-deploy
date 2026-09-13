import type { NextRequest } from "next/server";
import { getAssetDependents, getAssetService } from "@/server/assets";
import { getContentDatabase } from "@/server/content";
import { localApiError, localJson, requireLocalAdminRead } from "../../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    const database = getContentDatabase();
    const service = getAssetService();
    const inventory = service.getInventoryStats();
    const all = service.listAll();
    const presence = await Promise.all(
      all.map(async (asset) => ({
        missing: !(await service.hasStoredObject(asset)),
        unused: getAssetDependents(database, asset.id).length === 0,
      })),
    );
    return localJson({
      ok: true,
      stats: {
        ...inventory,
        missing: presence.filter((item) => item.missing).length,
        processing: 0,
        unused: presence.filter((item) => item.unused).length,
      },
    });
  } catch (error) {
    return localApiError(error);
  }
}
