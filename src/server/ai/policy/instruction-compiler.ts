import { createHash } from "node:crypto";
import { compileInstructionSections, validateInstructionSections, INSTRUCTION_COMPILER_VERSION, type InstructionSection } from "@/lib/ai-instruction-sections";
import { AIPolicyError } from "./errors";
export interface InstructionAuthoring { sections: InstructionSection[]; compilerVersion: typeof INSTRUCTION_COMPILER_VERSION; compiledHash: string }
export const instructionHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export function compileInstructionAuthoring(value: unknown, publication = true): { instructions: string; authoring: InstructionAuthoring } {
  const sections = validateInstructionSections(value, publication);
  const { text } = compileInstructionSections(sections);
  return { instructions: text, authoring: { sections, compilerVersion: INSTRUCTION_COMPILER_VERSION, compiledHash: instructionHash(text) } };
}
export function validateInstructionAuthoring(value: unknown, instructions: string): InstructionAuthoring {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "compiledHash,compilerVersion,sections") throw new AIPolicyError("AI_POLICY_INVALID", "Instruction authoring metadata is invalid.");
  const candidate = value as InstructionAuthoring;
  const compiled = compileInstructionAuthoring(candidate.sections);
  if (candidate.compilerVersion !== INSTRUCTION_COMPILER_VERSION || candidate.compiledHash !== compiled.authoring.compiledHash || compiled.instructions !== instructions) throw new AIPolicyError("AI_POLICY_INVALID", "Instruction compiler integrity check failed.");
  return compiled.authoring;
}
export function instructionRevisionSections(revision: { policyId: string; displayName: string; instructions: string; authoring?: InstructionAuthoring }): InstructionSection[] {
  return revision.authoring?.sections ?? [{ id: revision.policyId, title: revision.displayName, description: "إصدار نصّي سابق؛ نشره كمسودة منظّمة يضيف عنوان الفقرة إلى النص التنفيذي.", body: revision.instructions, enabled: true }];
}
