import type { Agent1InstructionChannel } from "./instruction-transport";
import type { Agent1AssuranceTier, Agent1Qualification } from "./instruction-qualification";
export const AGENT_1_CONFORMANCE_VERSION = 1;
export const AGENT_1_DEVELOPMENT_COMPATIBILITY_VERSION = 1;
export type Agent1ConformanceStatus = "UNKNOWN" | "PASS" | "FAIL" | "ERROR" | "STALE";
export type Agent1ConformanceReason = "HOSTED_WEB_FLATTENED_PROMPT" | "UNEXPECTED_FINAL_OUTPUT" | "UPSTREAM_FAILURE" | "OUTPUT_LIMIT" | "EMPTY_FINAL_OUTPUT" | "CONFIGURATION_CHANGED" | "NOT_TESTED" | "SUITE_CHANGED" | "ROUTE_CHANGED" | "MODEL_NOT_READY" | "CANCELLED" | "DEVELOPMENT_ONLY";
export type Agent1ProbeKind = "AUTHORITY_CONFLICT" | "APPLICATION_IDENTITY" | "INSTRUCTION_OVERRIDE" | "DEV_APPLICATION_IDENTITY" | "DEV_DIRECT_OVERRIDE" | "DEV_FOUNDATION_IDENTITY_BAIT" | "DEV_CONTROL_DATA_INJECTION";
export interface Agent1ProbeEvidence { kind: Agent1ProbeKind; status: "PASS" | "FAIL" | "ERROR" | "NOT_RUN"; reason: Agent1ConformanceReason | null }
export interface Agent1ConformanceIdentity {
  modelConfigId: string; modelRevision: number; providerId: string; providerRevision: number;
  adapterKey: string; apiFormat: string; channel: Agent1InstructionChannel; transportFingerprint: string;
  classifierVersion: number; conformanceVersion: number; frameworkVersion: number; frameworkHash: string;
  assuranceTier: Agent1AssuranceTier; framingVersion: number;
}
export interface Agent1ConformanceRecord extends Agent1ConformanceIdentity {
  id: string; status: "PASS" | "FAIL" | "ERROR"; reason: Agent1ConformanceReason | null;
  source: "LIVE_PROBE" | "STATIC_ANALYSIS"; evidence: Agent1ProbeEvidence[]; createdAt: number; createdBy: string;
}
export interface Agent1InstructionAuthority {
  status: Agent1ConformanceStatus; qualified: boolean; reason: Agent1ConformanceReason | null;
  /** qualified retains strict-only meaning; DEV_COMPAT_PASS is never strict-qualified. */
  assuranceTier: Agent1AssuranceTier; qualification: Agent1Qualification | null;
  label: string; explanation: string; recordId: string | null; checkedAt: number | null;
  source: "LIVE_PROBE" | "STATIC_ANALYSIS" | null; identity: Agent1ConformanceIdentity;
}
