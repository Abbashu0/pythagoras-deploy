import type { Agent1InstructionCaptureMetadata } from "./instruction-envelope";
export type Agent1PolicyDecision = { action: "ALLOW" | "DENY" | "ASK"; reason: "INFRASTRUCTURE_SELF_IDENTIFICATION" | null };
export interface Agent1OutputPolicyContext {
  requestId: string;
  instructions: Readonly<Agent1InstructionCaptureMetadata>;
  modelConfigId: string;
  providerId: string;
  infrastructureAliases: readonly string[];
  discloseInfrastructureIdentity: boolean;
}
export interface Agent1OutputPolicy { evaluate(context: Agent1OutputPolicyContext, output: string): Agent1PolicyDecision }
/** Final-output boundary only. Not an interception/retraction guarantee for streaming. */
export class Agent1IdentityOutputPolicy implements Agent1OutputPolicy {
  evaluate(context: Agent1OutputPolicyContext, output: string): Agent1PolicyDecision {
    if (context.discloseInfrastructureIdentity) return { action: "ALLOW", reason: null };
    const aliases = context.infrastructureAliases.filter((alias) => alias.trim() && alias.length <= 128).map(escapeRegex);
    if (!aliases.length) return { action: "ALLOW", reason: null };
    // Quoted examples/code are discussion, not unquoted first-person self-identification.
    const prose = output.replace(/```[\s\S]*?(?:```|$)/gu, " ").replace(/["“«][^"”»\n]*["”»]/gu, " ");
    const self = /(?:^|[.!?؟\n])\s*(?:[-*]\s*)?(?:i\s+am|i['’]m|my\s+(?:identity|name)\s+is|أنا|انا|هويتي(?:\s+هي)?|اسمي)\s+(?:(?:a|an|the)\s+)?(?:(?:language\s+model|model|نموذج|مودل|المساعد)\s+)?/giu;
    const identity = new RegExp(`^(?:${aliases.join("|")})(?=$|[\\s.,!?:;،؟-])`, "iu");
    for (const match of prose.matchAll(self)) if (identity.test(prose.slice(match.index! + match[0].length))) return { action: "DENY", reason: "INFRASTRUCTURE_SELF_IDENTIFICATION" };
    return { action: "ALLOW", reason: null };
  }
}
export type Agent1FutureToolPolicyPhase = "TOOL_CALL" | "TOOL_RESULT";
/** Future tool adapters must enforce decisions before side effects; no tool runner added here. */
export interface Agent1FutureToolPolicy { evaluate(phase: Agent1FutureToolPolicyPhase, toolName: string, data: unknown): Agent1PolicyDecision }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
