import type { AIProviderConfig } from "../configuration";
import type { AIModelConfig } from "../model-registry";
import { isLocalOmniRouteUrl } from "../local-omniroute";
import type { Agent1AssuranceTier } from "./instruction-qualification";

export const AGENT_1_TRANSPORT_CLASSIFIER_VERSION = 2;
export type Agent1InstructionChannel = "CHAT_SYSTEM" | "CHAT_DEVELOPER" | "RESPONSES_INSTRUCTIONS" | "ANTHROPIC_SYSTEM";
export const DEEPSEEK_WEB_SOURCE = Object.freeze({ version: "3.8.50", commit: "5458026c216f77a3da68ea49152dc33470cfe2cb", file: "open-sse/executors/deepseek-web.ts" });

/** Isolated source-reviewed transport rules. API-format compatibility is not authority. */
export function classifyAgent1InstructionTransport(model: Pick<AIModelConfig, "providerModelId">, provider: Pick<AIProviderConfig, "baseUrl" | "apiFormat">) {
  let channel: Agent1InstructionChannel;
  if (provider.apiFormat === "OPENAI_RESPONSES") channel = "RESPONSES_INSTRUCTIONS";
  else if (provider.apiFormat === "ANTHROPIC_MESSAGES") channel = "ANTHROPIC_SYSTEM";
  else {
    const url = new URL(provider.baseUrl);
    // Official OpenAI documents developer as the instruction role for o1/newer.
    // Generic compatible servers retain system until a dedicated role policy is added.
    const official = url.protocol === "https:" && url.hostname === "api.openai.com" && !url.port && !url.search && !url.hash && !url.username && !url.password && url.pathname.replace(/\/$/u, "") === "/v1";
    const modern = /^(?:o[1-9](?:[-.]|$)|gpt-(?:[5-9]|\d{2,})(?:[-.]|$))/iu.test(model.providerModelId);
    channel = official && modern ? "CHAT_DEVELOPER" : "CHAT_SYSTEM";
  }
  const flattened = isLocalOmniRouteUrl(provider.baseUrl) && /^ds-web\//iu.test(model.providerModelId);
  const assuranceTier: Agent1AssuranceTier = flattened ? "DEVELOPMENT_FLATTENED" : "STRICT";
  // Strict role rules are unchanged V1; V2 adds the known flattened development lane.
  return Object.freeze({ version: flattened ? AGENT_1_TRANSPORT_CLASSIFIER_VERSION : 1, channel, assuranceTier, knownFlattened: flattened, reason: flattened ? "HOSTED_WEB_FLATTENED_PROMPT" as const : null });
}
