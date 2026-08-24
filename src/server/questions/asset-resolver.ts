import type { Asset, AssetRepository } from "../assets/contracts";
import type { QuestionPackageV1 } from "../question-packages/contracts";
import { QuestionDomainError } from "./errors";

type ManifestEntry = QuestionPackageV1["assetsManifest"][number];

export interface QuestionPackageAssetResolver {
  resolveManifestEntry(entry: ManifestEntry): Asset | null;
  requireSourceJsonAsset(assetId: string): Asset;
}

export class AssetLibraryQuestionPackageAssetResolver
  implements QuestionPackageAssetResolver
{
  constructor(private readonly assets: AssetRepository) {}

  resolveManifestEntry(entry: ManifestEntry): Asset | null {
    const asset = this.assets.findBySha256(entry.sha256);
    if (!asset) return null;
    if (asset.byteSize !== entry.byteSize || asset.mimeType !== entry.mimeType) {
      return null;
    }
    return asset;
  }

  requireSourceJsonAsset(assetId: string): Asset {
    const asset = this.assets.findById(assetId);
    if (!asset || asset.mediaKind !== "json") {
      throw new QuestionDomainError(
        "QUESTION_DOMAIN_VALIDATION_FAILED",
        "Question Package sourceAssetId must reference an existing immutable JSON Asset.",
      );
    }
    return asset;
  }
}
