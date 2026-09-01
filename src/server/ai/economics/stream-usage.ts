import type {
  AIGenerationUsageSnapshot,
} from "./contracts";
import type {
  GatewayGenerationStreamEvent,
  NormalizedProviderUsage,
} from "../gateway";
import { assertNormalizedProviderUsage } from "./validation";

const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "cacheHitInputTokens",
  "cacheMissInputTokens",
] as const;

/** Aggregates cumulative/best-known snapshots without double-counting stream events. */
export class AIGenerationUsageAccumulator {
  private usage: AIGenerationUsageSnapshot = {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheHitInputTokens: null,
    cacheMissInputTokens: null,
  };

  observe(usage: NormalizedProviderUsage): void {
    assertNormalizedProviderUsage(usage);
    for (const field of USAGE_FIELDS) {
      const next = usage[field];
      const current = this.usage[field];
      if (next !== null && (current === null || next > current)) {
        this.usage[field] = next;
      }
    }
  }

  observeGatewayEvent(event: GatewayGenerationStreamEvent): void {
    if (event.type === "USAGE" || event.type === "COMPLETED") this.observe(event.usage);
  }

  snapshot(): AIGenerationUsageSnapshot {
    return { ...this.usage };
  }
}
