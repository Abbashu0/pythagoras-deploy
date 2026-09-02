import type { AIRetrievalConfigRevision } from "../retrieval-config";
import type { AIHybridEvidenceItem, AIHybridFusedCandidate, AIHybridSafeReason } from "./hybrid-contracts";

export function selectEvidence(input: {
  candidates: readonly AIHybridFusedCandidate[];
  config: Pick<AIRetrievalConfigRevision, "evidenceItemLimit" | "maximumEvidencePackBytes" | "maxEvidenceChunksPerSourceItem" | "minimumEvidenceItemCount">;
}): {
  items: AIHybridEvidenceItem[];
  evidenceByteCount: number;
  sufficient: boolean;
  safeReason: AIHybridSafeReason | null;
} {
  if (!input.candidates.length) return { items: [], evidenceByteCount: 0, sufficient: false, safeReason: "NO_CANDIDATES" };
  const sourceItemCounts = new Map<string, number>();
  const items: AIHybridEvidenceItem[] = [];
  let evidenceByteCount = 0;
  for (const candidate of input.candidates) {
    if (items.length >= input.config.evidenceItemLimit) break;
    const sourceItemKey = `${candidate.originKind}:${candidate.originId}:${candidate.sourceItemId}`;
    const sourceItemCount = sourceItemCounts.get(sourceItemKey) ?? 0;
    if (sourceItemCount >= input.config.maxEvidenceChunksPerSourceItem) continue;
    const bytes = evidencePayloadBytes(candidate);
    if (evidenceByteCount + bytes > input.config.maximumEvidencePackBytes) continue;
    sourceItemCounts.set(sourceItemKey, sourceItemCount + 1);
    evidenceByteCount += bytes;
    items.push({
      ...candidate,
      ordinal: items.length + 1,
      inclusionSignals: [
        ...candidate.retrievalSignals,
        candidate.rerankRank === null ? "FUSION_ORDER" : "RERANK_ORDER",
      ],
    });
  }
  if (items.length < input.config.minimumEvidenceItemCount) {
    return { items: [], evidenceByteCount: 0, sufficient: false, safeReason: "BELOW_MINIMUM_EVIDENCE" };
  }
  return { items, evidenceByteCount, sufficient: true, safeReason: null };
}

function evidencePayloadBytes(candidate: AIHybridFusedCandidate): number {
  return Buffer.byteLength(candidate.text, "utf8")
    + Buffer.byteLength(JSON.stringify(candidate.provenance), "utf8")
    + Buffer.byteLength(JSON.stringify(candidate.originMetadata), "utf8");
}
