import type { AIInstructionPolicyRevision } from "../policy/instruction-contracts";
import { SQLiteAIInstructionPolicyRepository } from "../policy/instruction-repository";
import type { ContentDatabase } from "../../content/database";
import { agent1FrameworkContract, agent1Hash } from "./framework-contract";

export type Agent1InstructionLayerKind = "FRAMEWORK" | "GENERAL" | "SUBJECT" | "RUNTIME_CONTEXT";
export interface Agent1InstructionLayer {
  readonly kind: Agent1InstructionLayerKind;
  readonly version: number;
  readonly hash: string;
  readonly text: string;
  readonly policyId: string | null;
  readonly source: "FRAMEWORK" | "PUBLISHED" | "CONFORMANCE_PROBE";
}
export interface Agent1InstructionCaptureMetadata {
  generalPolicyId: string | null;
  generalRevision: number | null;
  generalCompiledHash: string | null;
  frameworkContractVersion: number;
  frameworkHash: string;
  envelopeHash: string;
}
export interface Agent1InstructionEnvelope {
  readonly version: 1;
  readonly layers: readonly Agent1InstructionLayer[];
  readonly instructions: string;
  readonly hash: string;
  readonly metadata: Readonly<Agent1InstructionCaptureMetadata>;
}

/** One composition boundary. Adapters receive these bytes, never construct policy. */
export function composeAgent1Instructions(input: { general?: Pick<AIInstructionPolicyRevision, "policyId" | "revision" | "instructions">; probeGeneral?: string; publicName?: string }): Agent1InstructionEnvelope {
  if (input.general && input.probeGeneral !== undefined) throw new Error("AMBIGUOUS_GENERAL_SOURCE");
  const framework = agent1FrameworkContract(input.publicName);
  const layers: Agent1InstructionLayer[] = [{ kind: "FRAMEWORK", version: framework.version, hash: framework.hash, text: framework.text, policyId: null, source: "FRAMEWORK" }];
  const generalText = input.general?.instructions ?? input.probeGeneral;
  if (generalText !== undefined) layers.push({ kind: "GENERAL", version: input.general?.revision ?? 0, hash: agent1Hash(generalText), text: generalText, policyId: input.general?.policyId ?? null, source: input.general ? "PUBLISHED" : "CONFORMANCE_PROBE" });
  // Fixed, ownership-labelled boundaries; revisions/IDs/timestamps stay outside the prefix.
  const instructions = layers.map((layer) => `<<<PYTHAGORAS_${layer.kind}_BEGIN>>>\n${layer.kind === "FRAMEWORK" ? "Runtime-owned invariants; highest application authority.\n" : "Operator-owned behavior; subordinate to FRAMEWORK invariants.\n"}${layer.text}\n<<<PYTHAGORAS_${layer.kind}_END>>>`).join("\n\n");
  const hash = agent1Hash(instructions);
  const metadata = Object.freeze({ generalPolicyId: input.general?.policyId ?? null, generalRevision: input.general?.revision ?? null, generalCompiledHash: input.general ? agent1Hash(input.general.instructions) : null, frameworkContractVersion: framework.version, frameworkHash: framework.hash, envelopeHash: hash });
  return Object.freeze({ version: 1, layers: Object.freeze(layers.map((layer) => Object.freeze(layer))), instructions, hash, metadata });
}
export function captureAgent1Instructions(database: ContentDatabase): Agent1InstructionEnvelope {
  const policy = new SQLiteAIInstructionPolicyRepository(database).getByScope("GLOBAL", null);
  return composeAgent1Instructions({ general: policy?.enabled ? { policyId: policy.id, revision: policy.currentRevision, instructions: policy.instructions } : undefined });
}
