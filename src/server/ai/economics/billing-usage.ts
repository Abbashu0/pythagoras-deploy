import type {
  AIBillableUsage,
  AIBillingUsageNormalizationContext,
  AIBillingUsageNormalizer,
} from "./contracts";
import type { NormalizedProviderUsage } from "../gateway";
import { AIAccountingError } from "./errors";
import {
  assertNormalizedProviderUsage,
  normalizeAIBillableUsage,
} from "./validation";

const NORMALIZER_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

/** Explicit server-owned billing semantics; never selected through dynamic module loading. */
export class AIBillingUsageNormalizerRegistry {
  private readonly normalizers = new Map<string, AIBillingUsageNormalizer>();

  constructor(normalizers: readonly AIBillingUsageNormalizer[] = []) {
    for (const normalizer of normalizers) {
      if (
        typeof normalizer.key !== "string" ||
        normalizer.key.length < 1 ||
        normalizer.key.length > 120 ||
        !NORMALIZER_KEY_PATTERN.test(normalizer.key)
      ) {
        throw new AIAccountingError(
          "AI_BILLING_USAGE_INVALID",
          "The billing usage normalizer key is invalid.",
        );
      }
      if (this.normalizers.has(normalizer.key)) {
        throw new AIAccountingError(
          "AI_BILLING_USAGE_INVALID",
          "The billing usage normalizer key is registered more than once.",
        );
      }
      this.normalizers.set(normalizer.key, normalizer);
    }
  }

  get(key: string): AIBillingUsageNormalizer | null {
    return this.normalizers.get(key) ?? null;
  }

  require(key: string): AIBillingUsageNormalizer {
    const normalizer = this.normalizers.get(key);
    if (!normalizer) {
      throw new AIAccountingError(
        "AI_BILLING_NORMALIZER_NOT_FOUND",
        "The configured billing usage normalizer is not registered.",
      );
    }
    return normalizer;
  }

  normalize(
    key: string,
    usage: NormalizedProviderUsage,
    context: AIBillingUsageNormalizationContext,
  ): AIBillableUsage {
    assertNormalizedProviderUsage(usage);
    const normalizer = this.require(key);
    let result: AIBillableUsage;
    try {
      result = normalizer.normalize(usage, context);
    } catch {
      throw new AIAccountingError(
        "AI_BILLING_USAGE_INVALID",
        "The billing usage normalizer returned invalid usage.",
      );
    }
    return normalizeAIBillableUsage(result);
  }
}
