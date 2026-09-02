import type { AIRetrievalConfigRevision } from "../retrieval-config";
import { AI_RETRIEVAL_FUSION_SCORE_SCALE } from "../retrieval-config";
import type { AIHybridChunkCandidate, AIHybridFusedCandidate } from "./hybrid-contracts";

export interface AIHybridLexicalRankedCandidate {
  candidate: AIHybridChunkCandidate;
  rank: number;
}

export interface AIHybridSemanticRankedCandidate {
  candidate: AIHybridChunkCandidate;
  rank: number;
  cosineSimilarity: number;
}

export function weightedReciprocalRankFusion(
  lexical: readonly AIHybridLexicalRankedCandidate[],
  semantic: readonly AIHybridSemanticRankedCandidate[],
  config: Pick<AIRetrievalConfigRevision, "rrfConstant" | "lexicalWeightUnits" | "semanticWeightUnits" | "fusionCandidateLimit">,
): AIHybridFusedCandidate[] {
  const byChunk = new Map<string, { lexical?: AIHybridLexicalRankedCandidate; semantic?: AIHybridSemanticRankedCandidate }>();
  for (const entry of lexical) {
    const current = byChunk.get(entry.candidate.chunkId) ?? {};
    current.lexical = entry;
    byChunk.set(entry.candidate.chunkId, current);
  }
  for (const entry of semantic) {
    const current = byChunk.get(entry.candidate.chunkId) ?? {};
    current.semantic = entry;
    byChunk.set(entry.candidate.chunkId, current);
  }
  return [...byChunk.values()]
    .map((entry) => {
      const base = entry.semantic?.candidate ?? entry.lexical!.candidate;
      const lexicalRank = entry.lexical?.rank ?? null;
      const semanticRank = entry.semantic?.rank ?? null;
      const fusionScoreUnits = reciprocalContribution(config.lexicalWeightUnits, config.rrfConstant, lexicalRank) +
        reciprocalContribution(config.semanticWeightUnits, config.rrfConstant, semanticRank);
      const signals = lexicalRank !== null && semanticRank !== null
        ? ["BOTH" as const]
        : lexicalRank !== null
          ? ["LEXICAL" as const]
          : ["SEMANTIC" as const];
      return {
        ...base,
        m7aProjectionRevisionId: entry.lexical?.candidate.m7aProjectionRevisionId ?? base.m7aProjectionRevisionId,
        m7bEmbeddingProjectionRevisionId: entry.semantic?.candidate.m7bEmbeddingProjectionRevisionId ?? null,
        lexicalRank,
        semanticRank,
        cosineSimilarity: entry.semantic?.cosineSimilarity ?? null,
        fusionScoreUnits,
        retrievalSignals: signals,
        rerankRank: null,
        rerankScore: null,
      } satisfies AIHybridFusedCandidate;
    })
    .sort(compareFusedCandidates)
    .slice(0, config.fusionCandidateLimit);
}

export function reciprocalContribution(weightUnits: number, rrfConstant: number, rank: number | null): number {
  if (rank === null) return 0;
  return Math.floor((weightUnits * AI_RETRIEVAL_FUSION_SCORE_SCALE) / (rrfConstant + rank));
}

function compareFusedCandidates(left: AIHybridFusedCandidate, right: AIHybridFusedCandidate): number {
  return right.fusionScoreUnits - left.fusionScoreUnits || left.chunkId.localeCompare(right.chunkId);
}
