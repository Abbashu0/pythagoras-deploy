import { desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { ContentDatabase } from "../../content/database";
import { aiAgentInstructionConformance } from "../../content/schema";
import type { Agent1ConformanceRecord, Agent1ProbeEvidence, Agent1ProbeKind } from "./instruction-conformance-contracts";
import type { Agent1AssuranceTier } from "./instruction-qualification";

export function agent1ProbeKinds(tier: Agent1AssuranceTier): readonly Agent1ProbeKind[] {
  return tier === "STRICT" ? ["AUTHORITY_CONFLICT", "APPLICATION_IDENTITY", "INSTRUCTION_OVERRIDE"] : ["DEV_APPLICATION_IDENTITY", "DEV_DIRECT_OVERRIDE", "DEV_FOUNDATION_IDENTITY_BAIT", "DEV_CONTROL_DATA_INJECTION"];
}
const reasons = ["HOSTED_WEB_FLATTENED_PROMPT", "UNEXPECTED_FINAL_OUTPUT", "UPSTREAM_FAILURE", "OUTPUT_LIMIT", "EMPTY_FINAL_OUTPUT", "CONFIGURATION_CHANGED", "NOT_TESTED", "SUITE_CHANGED", "ROUTE_CHANGED", "MODEL_NOT_READY", "CANCELLED", "DEVELOPMENT_ONLY"];

/** Append-only server evidence. Explicit projections prevent accidental raw-output persistence. */
export class Agent1ConformanceRepository {
  constructor(private readonly database: ContentDatabase) {}

  latest(modelConfigId: string): Agent1ConformanceRecord | null {
    const row = this.database.db.select().from(aiAgentInstructionConformance).where(eq(aiAgentInstructionConformance.modelConfigId, modelConfigId)).orderBy(desc(aiAgentInstructionConformance.createdAt), desc(aiAgentInstructionConformance.id)).get();
    if (!row) return null;
    return { ...row, evidence: normalizedEvidence(row.evidence, row.assuranceTier) } as Agent1ConformanceRecord;
  }

  append(input: Omit<Agent1ConformanceRecord, "id">): Agent1ConformanceRecord {
    if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) throw new Error("INVALID_CONFORMANCE_TIME");
    if ((input.assuranceTier !== "STRICT" && input.assuranceTier !== "DEVELOPMENT_FLATTENED") || !Number.isSafeInteger(input.framingVersion) || (input.assuranceTier === "STRICT" ? input.framingVersion !== 0 : input.framingVersion < 1)) throw new Error("INVALID_CONFORMANCE_ASSURANCE");
    const evidence = normalizedEvidence(input.evidence, input.assuranceTier);
    if (input.reason !== null && !reasons.includes(input.reason)) throw new Error("INVALID_CONFORMANCE_REASON");
    if (input.status === "PASS" && (input.source !== "LIVE_PROBE" || input.reason !== null || evidence.some((probe) => probe.status !== "PASS" || probe.reason !== null))) throw new Error("INVALID_CONFORMANCE_PASS");
    const value: Agent1ConformanceRecord = {
      id: uuidv7(), modelConfigId: input.modelConfigId, modelRevision: input.modelRevision,
      providerId: input.providerId, providerRevision: input.providerRevision,
      adapterKey: input.adapterKey, apiFormat: input.apiFormat, channel: input.channel,
      transportFingerprint: input.transportFingerprint, classifierVersion: input.classifierVersion,
      conformanceVersion: input.conformanceVersion, frameworkVersion: input.frameworkVersion,
      frameworkHash: input.frameworkHash, status: input.status, reason: input.reason,
      assuranceTier: input.assuranceTier, framingVersion: input.framingVersion,
      source: input.source, evidence, createdAt: input.createdAt, createdBy: input.createdBy,
    };
    return this.database.client.transaction(() => {
      // A later verdict must supersede old PASS even if the server clock moves backwards.
      const previous = this.latest(input.modelConfigId);
      value.createdAt = Math.max(input.createdAt, (previous?.createdAt ?? -1) + 1);
      if (!Number.isSafeInteger(value.createdAt)) throw new Error("INVALID_CONFORMANCE_TIME");
      this.database.db.insert(aiAgentInstructionConformance).values(value).run();
      return value;
    }).immediate();
  }
}

function normalizedEvidence(value: readonly Agent1ProbeEvidence[], tier: Agent1AssuranceTier): Agent1ProbeEvidence[] {
  const kinds = agent1ProbeKinds(tier);
  if (!Array.isArray(value) || value.length !== kinds.length) throw new Error("INVALID_CONFORMANCE_EVIDENCE");
  return value.map((probe, index) => {
    if (probe.kind !== kinds[index] || !["PASS", "FAIL", "ERROR", "NOT_RUN"].includes(probe.status) || (probe.reason !== null && !reasons.includes(probe.reason))) throw new Error("INVALID_CONFORMANCE_EVIDENCE");
    return { kind: probe.kind, status: probe.status, reason: probe.reason };
  });
}
