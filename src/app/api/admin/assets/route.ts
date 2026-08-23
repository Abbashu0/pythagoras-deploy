import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import {
  ASSET_MEDIA_KINDS,
  ASSET_SORT_OPTIONS,
  getAssetService,
  parseAssetUpload,
  removeParsedAssetUpload,
  resolveMaximumAssetBytes,
  toSafeAssetWithCreator,
} from "@/server/assets";
import {
  getQuestionPackageInspectionService,
  type QuestionPackageInspection,
} from "@/server/question-packages";
import type { SafeAssetWithCreator } from "@/server/assets";
import type { AssetMediaKind, AssetSort } from "@/server/assets";
import { getContentDatabase } from "@/server/content";
import {
  assetApiErrorResponse,
  noStoreAssetJson,
  requireAssetApiAdmin,
} from "./_shared";

export const runtime = "nodejs";

function parseOptionalInteger(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^[0-9]+$/u.test(value)) return Number.NaN;
  return Number(value);
}

function parseMediaKind(value: string | null): AssetMediaKind | undefined {
  if (value === null) return undefined;
  return ASSET_MEDIA_KINDS.find((kind) => kind === value) ?? (value as AssetMediaKind);
}

function parseSort(value: string | null): AssetSort | undefined {
  if (value === null) return undefined;
  return ASSET_SORT_OPTIONS.find((sort) => sort === value) ?? (value as AssetSort);
}

export async function GET(request: NextRequest) {
  try {
    requireAssetApiAdmin(request);
    const limit = parseOptionalInteger(request.nextUrl.searchParams.get("limit"));
    const offset = parseOptionalInteger(request.nextUrl.searchParams.get("offset"));
    const page = getAssetService().browse({
      limit,
      offset,
      query: request.nextUrl.searchParams.get("q") ?? undefined,
      mediaKind: parseMediaKind(request.nextUrl.searchParams.get("mediaKind")),
      sort: parseSort(request.nextUrl.searchParams.get("sort")),
    });
    let inspectionService: ReturnType<typeof getQuestionPackageInspectionService> | undefined;
    const items: Array<SafeAssetWithCreator & { questionPackageInspection: QuestionPackageInspection | null }> = [];
    for (const record of page.items) {
      const asset = toSafeAssetWithCreator(record);
      items.push({
        ...asset,
        questionPackageInspection:
          record.asset.mediaKind === "json"
            ? await (inspectionService ??= getQuestionPackageInspectionService()).inspectAsset(record.asset.id)
            : null,
      });
    }
    return noStoreAssetJson({
      ok: true,
      items,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    });
  } catch (error) {
    return assetApiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let stagedPath: string | undefined;
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireAssetApiAdmin(request);
    const database = getContentDatabase();
    const upload = await parseAssetUpload(
      request,
      database.paths.tempDirectory,
      resolveMaximumAssetBytes(),
    );
    stagedPath = upload.filePath;
    const result = await getAssetService().ingest(
      upload,
      getAdminActor(authentication),
    );
    const asset = getAssetService().getByIdWithCreator(result.asset.id);
    const questionPackageInspection =
      result.asset.mediaKind === "json"
        ? await getQuestionPackageInspectionService().inspectAsset(result.asset.id)
        : null;
    return noStoreAssetJson(
      {
        ok: true,
        asset: { ...toSafeAssetWithCreator(asset), questionPackageInspection },
        reused: result.reused,
      },
      { status: result.reused ? 200 : 201 },
    );
  } catch (error) {
    return assetApiErrorResponse(error);
  } finally {
    if (stagedPath) await removeParsedAssetUpload(stagedPath);
  }
}
