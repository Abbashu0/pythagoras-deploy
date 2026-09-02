import type { AIKnowledgePackage, AIKnowledgePackageRevision, AIKnowledgeSource, AIKnowledgeSourceRevision } from "./contracts";

/** Future Admin-safe views: Knowledge contracts contain no secret bytes or storage paths. */
export type SafeAIKnowledgeSourceDTO = AIKnowledgeSource;
export type SafeAIKnowledgeSourceRevisionDTO = AIKnowledgeSourceRevision;
export type SafeAIKnowledgePackageDTO = AIKnowledgePackage;
export type SafeAIKnowledgePackageRevisionDTO = AIKnowledgePackageRevision;

export function toSafeAIKnowledgeSourceDTO(source: AIKnowledgeSource): SafeAIKnowledgeSourceDTO {
  return structuredClone(source);
}

export function toSafeAIKnowledgePackageDTO(knowledgePackage: AIKnowledgePackage): SafeAIKnowledgePackageDTO {
  return structuredClone(knowledgePackage);
}
