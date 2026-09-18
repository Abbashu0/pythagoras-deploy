import { lookup } from "node:dns/promises";
import type { AIProviderApiFormat } from "@/lib/ai-provider-format";
import {
  LocalOmniRouteOutboundTargetPolicy,
  type OutboundTargetPolicy,
} from "./transport";

export const AI_OPENAI_RESPONSES_GENERATION_ADAPTER_KEY =
  "openai-responses-generation-v1" as const;
export const AI_ANTHROPIC_MESSAGES_GENERATION_ADAPTER_KEY =
  "anthropic-messages-generation-v1" as const;

export const AI_GENERATION_ADAPTER_KEYS = {
  OPENAI_CHAT_COMPLETIONS: "openai-compatible-generation-v1",
  OPENAI_RESPONSES: AI_OPENAI_RESPONSES_GENERATION_ADAPTER_KEY,
  ANTHROPIC_MESSAGES: AI_ANTHROPIC_MESSAGES_GENERATION_ADAPTER_KEY,
} as const satisfies Record<AIProviderApiFormat, string>;

export function adapterKeyForProviderApiFormat(
  apiFormat: AIProviderApiFormat,
): string {
  return AI_GENERATION_ADAPTER_KEYS[apiFormat];
}

export function createProviderOutboundPolicy(): OutboundTargetPolicy {
  return new LocalOmniRouteOutboundTargetPolicy({
    resolve: async (hostname) =>
      (await lookup(hostname, { all: true, verbatim: true })).map(
        (record) => record.address,
      ),
  });
}
