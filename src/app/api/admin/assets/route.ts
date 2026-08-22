import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import {
  getAssetService,
  parseAssetUpload,
  removeParsedAssetUpload,
  resolveMaximumAssetBytes,
  toSafeAsset,
} from "@/server/assets";
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

export async function GET(request: NextRequest) {
  try {
    requireAssetApiAdmin(request);
    const limit = parseOptionalInteger(request.nextUrl.searchParams.get("limit"));
    const offset = parseOptionalInteger(request.nextUrl.searchParams.get("offset"));
    const assets = getAssetService()
      .list({ limit, offset })
      .map(toSafeAsset);
    return noStoreAssetJson({ ok: true, assets });
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
    return noStoreAssetJson(
      { ok: true, asset: toSafeAsset(result.asset), reused: result.reused },
      { status: result.reused ? 200 : 201 },
    );
  } catch (error) {
    return assetApiErrorResponse(error);
  } finally {
    if (stagedPath) await removeParsedAssetUpload(stagedPath);
  }
}
