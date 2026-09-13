import type { ContentDatabase } from "../content/database";
import type { AssetWithCreator } from "./contracts";
import { getAssetDependents } from "./dependencies";
import type { AssetService } from "./asset-service";

export interface LocalAdminAssetView {
  id: string;
  name: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string | null;
  width?: number;
  height?: number;
  referenceCount: number;
  references: ReturnType<typeof getAssetDependents>;
  integrity: "ok" | "missing" | "processing" | "failed";
  integrityDetail?: string;
  revision: number;
  tags: string[];
  uploadedAt: number;
  uploadedBy?: string;
}

export async function toLocalAdminAssetView(
  database: ContentDatabase,
  service: AssetService,
  record: AssetWithCreator,
): Promise<LocalAdminAssetView> {
  const references = getAssetDependents(database, record.asset.id);
  let integrity: LocalAdminAssetView["integrity"] = "ok";
  let integrityDetail: string | undefined;
  try {
    if (!(await service.hasStoredObject(record.asset))) integrity = "missing";
  } catch {
    integrity = "failed";
    integrityDetail = "تعذّر التحقق من وجود ملف التخزين.";
  }

  return {
    id: record.asset.id,
    name: record.asset.displayName,
    kind: record.asset.mediaKind,
    mimeType: record.asset.mimeType,
    sizeBytes: record.asset.byteSize,
    previewUrl:
      record.asset.mediaKind === "image"
        ? `/api/admin/local/assets/${encodeURIComponent(record.asset.id)}/content`
        : null,
    ...(record.asset.width !== null ? { width: record.asset.width } : {}),
    ...(record.asset.height !== null ? { height: record.asset.height } : {}),
    referenceCount: references.length,
    references,
    integrity,
    ...(integrityDetail ? { integrityDetail } : {}),
    revision: record.asset.revision,
    tags: [],
    uploadedAt: record.asset.createdAt,
    uploadedBy: record.creator.displayName,
  };
}
