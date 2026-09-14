import type { NextRequest } from "next/server";
import {
  ASSET_MEDIA_KINDS,
  ASSET_SORT_OPTIONS,
  getAssetService,
  parseAssetUpload,
  removeParsedAssetUpload,
  resolveMaximumAssetBytes,
} from "@/server/assets";
import { getContentDatabase } from "@/server/content";
import { toLocalAdminAssetView } from "@/server/assets/admin-view";
import { getQuestionPackageInspectionService } from "@/server/question-packages";
import {
  localApiError,
  localJson,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../_shared";

export const runtime = "nodejs";

async function inspectQuestionPackage(assetId: string) {
  try {
    return await getQuestionPackageInspectionService().inspectAsset(assetId);
  } catch {
    return null;
  }
}

function optionalInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^[0-9]+$/u.test(value)) return Number.NaN;
  return Number(value);
}

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    const service = getAssetService();
    const database = getContentDatabase();
    const mediaKindValue = request.nextUrl.searchParams.get("mediaKind");
    const sortValue = request.nextUrl.searchParams.get("sort");
    const page = service.browse({
      limit: optionalInteger(request.nextUrl.searchParams.get("limit")),
      offset: optionalInteger(request.nextUrl.searchParams.get("offset")),
      query: request.nextUrl.searchParams.get("q") ?? undefined,
      mediaKind:
        mediaKindValue === null
          ? undefined
          : ASSET_MEDIA_KINDS.includes(mediaKindValue as (typeof ASSET_MEDIA_KINDS)[number])
            ? (mediaKindValue as (typeof ASSET_MEDIA_KINDS)[number])
            : (mediaKindValue as never),
      sort:
        sortValue === null
          ? undefined
          : ASSET_SORT_OPTIONS.includes(sortValue as (typeof ASSET_SORT_OPTIONS)[number])
            ? (sortValue as (typeof ASSET_SORT_OPTIONS)[number])
            : (sortValue as never),
    });
    const items = await Promise.all(
      page.items.map(async (item) =>
        toLocalAdminAssetView(
          database,
          service,
          item,
          item.asset.mediaKind === "json"
            ? await inspectQuestionPackage(item.asset.id)
            : null,
        ),
      ),
    );
    return localJson({ ok: true, items, total: page.total, limit: page.limit, offset: page.offset });
  } catch (error) {
    return localApiError(error);
  }
}

export async function POST(request: NextRequest) {
  let stagedPath: string | undefined;
  try {
    const actor = requireLocalAdminMutation(request);
    const database = getContentDatabase();
    const upload = await parseAssetUpload(
      request,
      database.paths.tempDirectory,
      resolveMaximumAssetBytes(),
    );
    stagedPath = upload.filePath;
    const service = getAssetService();
    const result = await service.ingest(upload, actor);
    const record = service.getByIdWithCreator(result.asset.id);
    const asset = await toLocalAdminAssetView(
      database,
      service,
      record,
      result.asset.mediaKind === "json"
        ? await inspectQuestionPackage(result.asset.id)
        : null,
    );
    return localJson(
      { ok: true, asset, reused: result.reused },
      { status: result.reused ? 200 : 201 },
    );
  } catch (error) {
    return localApiError(error);
  } finally {
    if (stagedPath) await removeParsedAssetUpload(stagedPath);
  }
}
