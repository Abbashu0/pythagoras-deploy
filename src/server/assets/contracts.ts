import type { AdminActor } from "../admin-auth/contracts";

export const ASSET_MEDIA_KINDS = [
  "image",
  "video",
  "audio",
  "document",
  "json",
  "other-safe-file",
] as const;

export type AssetMediaKind = (typeof ASSET_MEDIA_KINDS)[number];

export interface Asset {
  id: string;
  originalFilename: string;
  displayName: string;
  mimeType: string;
  mediaKind: AssetMediaKind;
  byteSize: number;
  sha256: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export type SafeAsset = Omit<Asset, "storageKey">;

export interface CreateAssetRecord {
  id?: string;
  originalFilename: string;
  displayName: string;
  mimeType: string;
  mediaKind: AssetMediaKind;
  byteSize: number;
  sha256: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  actor: AdminActor;
}

export interface UpdateAssetMetadata {
  id: string;
  displayName: string;
  expectedRevision: number;
  actor: AdminActor;
}

export interface ListAssetsOptions {
  limit?: number;
  offset?: number;
}

export interface AssetRepository {
  create(input: CreateAssetRecord): Asset;
  findById(id: string): Asset | null;
  findBySha256(sha256: string): Asset | null;
  list(options?: ListAssetsOptions): Asset[];
  updateMetadata(input: UpdateAssetMetadata): Asset;
}

export interface IngestAssetInput {
  filePath: string;
  originalFilename: string;
  displayName?: string;
}

export interface IngestAssetResult {
  asset: Asset;
  reused: boolean;
}

export interface AssetIntegrityResult {
  assetId: string;
  ok: boolean;
  status: "ok" | "missing" | "size-mismatch" | "hash-mismatch";
  expectedSha256: string;
  actualSha256: string | null;
  expectedByteSize: number;
  actualByteSize: number | null;
}

export function toSafeAsset(asset: Asset): SafeAsset {
  const { storageKey: _storageKey, ...safe } = asset;
  return safe;
}
