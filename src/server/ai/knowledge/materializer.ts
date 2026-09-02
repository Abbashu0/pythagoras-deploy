import type { ContentDatabase } from "../../content/database";
import { canonicalMaterials } from "../../content/schema";
import { SQLiteAssetRepository } from "../../assets/sqlite-asset-repository";
import { toCanonicalRichDocument, assertCanonicalRichDocument } from "../../questions/canonical-rich-document";
import type { AIKnowledgePackageAsset, AIKnowledgePackageDocument, AIKnowledgePackageV1 } from "./contracts";
import { AIKnowledgeError } from "./errors";
import { SQLiteAIKnowledgeSourceRepository } from "./source-repository";
import { inspectAIKnowledgePackageJson } from "./validation";

export function materializeAIKnowledgePackage(database: ContentDatabase, value: unknown): {
  package: AIKnowledgePackageV1;
  documents: AIKnowledgePackageDocument[];
  assets: AIKnowledgePackageAsset[];
} {
  const subjects = new Set(database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).all().map((item) => item.subjectKey));
  const sourceRepository = new SQLiteAIKnowledgeSourceRepository(database);
  const inspection = inspectAIKnowledgePackageJson(value, { canonicalSubjectKeys: subjects, sourceResolver: sourceRepository });
  if (!inspection.package || inspection.status === "INVALID" || inspection.status === "UNSUPPORTED_VERSION") {
    throw new AIKnowledgeError("AI_KNOWLEDGE_PUBLICATION_INVALID", "The Knowledge Package failed structural or semantic validation.");
  }
  const source = sourceRepository.getRevision(inspection.package.source.id, inspection.package.source.revision);
  if (!source || source.subjectKey !== inspection.package.package.subjectKey) throw new AIKnowledgeError("AI_KNOWLEDGE_PUBLICATION_INVALID", "The Knowledge Package Source pin is invalid.");

  const assetRepository = new SQLiteAssetRepository(database);
  const assetIds = new Map<string, string>();
  const assets: AIKnowledgePackageAsset[] = [];
  for (const entry of inspection.package.assetsManifest) {
    const asset = assetRepository.findBySha256(entry.sha256);
    if (!asset || asset.sha256 !== entry.sha256 || asset.byteSize !== entry.byteSize || asset.mimeType !== entry.mimeType || asset.mediaKind === "other-safe-file") {
      throw new AIKnowledgeError("AI_KNOWLEDGE_ASSET_INVALID", "A Knowledge Package asset is not present with the declared safe metadata.", { assetRef: entry.ref });
    }
    assetIds.set(entry.ref, asset.id);
    assets.push({
      packageRevisionId: "pending",
      assetRef: entry.ref,
      expectedSha256: entry.sha256,
      assetId: asset.id,
      filename: entry.filename,
      mimeType: entry.mimeType,
      byteSize: entry.byteSize,
      metadata: entry.metadata ?? null,
    });
  }

  const documents: AIKnowledgePackageDocument[] = inspection.package.documents.map((document) => {
    let content;
    try {
      content = toCanonicalRichDocument(document.content, (assetRef) => {
        const assetId = assetIds.get(assetRef);
        if (!assetId) throw new Error("asset reference is unresolved");
        return assetId;
      });
      assertCanonicalRichDocument(content, true);
    } catch {
      throw new AIKnowledgeError("AI_KNOWLEDGE_PUBLICATION_INVALID", "A Knowledge Package document could not be materialized safely.", { documentId: document.id });
    }
    return {
      packageRevisionId: "pending",
      documentId: document.id,
      displayOrder: document.order,
      title: document.title,
      provenance: document.provenance,
      content,
    };
  });
  return { package: inspection.package, documents, assets };
}
