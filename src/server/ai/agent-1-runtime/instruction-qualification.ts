import type { Agent1InstructionAuthority } from "./instruction-conformance-contracts";

export type Agent1AssuranceTier = "STRICT" | "DEVELOPMENT_FLATTENED";
export type Agent1Qualification = "STRICT_PASS" | "DEV_COMPAT_PASS";
export type Agent1ExecutionBoundary = "STRICT_AGENT" | "DEVELOPMENT_STATELESS_CHAT" | "DEVELOPMENT_CONFORMANCE_PROBE";

/** NODE_ENV alone never grants compatibility to a strict/production boundary. */
export function isDevelopmentAgentExecution(boundary: Agent1ExecutionBoundary, environment = process.env.NODE_ENV): boolean {
  return environment === "development" && (boundary === "DEVELOPMENT_STATELESS_CHAT" || boundary === "DEVELOPMENT_CONFORMANCE_PROBE");
}
export function qualifiesAgent1Execution(authority: Agent1InstructionAuthority, boundary: Agent1ExecutionBoundary = "STRICT_AGENT", environment = process.env.NODE_ENV): boolean {
  if (authority.status !== "PASS") return false;
  if (authority.assuranceTier === "STRICT" && authority.qualification === "STRICT_PASS" && authority.qualified) return true;
  return authority.assuranceTier === "DEVELOPMENT_FLATTENED" && authority.qualification === "DEV_COMPAT_PASS" && isDevelopmentAgentExecution(boundary, environment);
}

/** Operational readiness is independent of advisory conformance in the dev chat.
 * All other boundaries retain their existing fail-closed qualification policy. */
export function canExecuteAgent1Model(model: { ready: boolean; instructionAuthority: Agent1InstructionAuthority | null }, boundary: Agent1ExecutionBoundary = "STRICT_AGENT", environment = process.env.NODE_ENV): boolean {
  if (!model.ready) return false;
  if (boundary === "DEVELOPMENT_STATELESS_CHAT") return isDevelopmentAgentExecution(boundary, environment);
  return model.instructionAuthority !== null && qualifiesAgent1Execution(model.instructionAuthority, boundary, environment);
}
