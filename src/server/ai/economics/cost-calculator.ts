import type {
  AIBillableUsage,
  AICostBreakdownItem,
  AICostCalculation,
  AIRateCardPriceComponent,
  AIRateCardPriceLineContent,
  ResolvedAIRateCard,
} from "./contracts";
import { AIAccountingError } from "./errors";
import { normalizeAIBillableUsage } from "./validation";

const TOKENS_PER_MILLION = BigInt(1_000_000);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const BILLABLE_COMPONENTS: ReadonlyArray<{
  component: AIRateCardPriceComponent;
  usageKey: keyof Omit<AIBillableUsage, "requestUnits">;
}> = [
  { component: "STANDARD_INPUT", usageKey: "standardInputTokens" },
  { component: "CACHE_HIT_INPUT", usageKey: "cacheHitInputTokens" },
  { component: "CACHE_MISS_INPUT", usageKey: "cacheMissInputTokens" },
  { component: "OUTPUT", usageKey: "outputTokens" },
  { component: "REASONING", usageKey: "reasoningTokens" },
];

export class AICostCalculator {
  calculate(
    rateCard: ResolvedAIRateCard,
    usageInput: AIBillableUsage,
  ): AICostCalculation {
    const usage = normalizeAIBillableUsage(usageInput);
    const lines = new Map<AIRateCardPriceComponent, AIRateCardPriceLineContent>();
    for (const line of rateCard.priceLines) {
      if (lines.has(line.component)) {
        throw new AIAccountingError(
          "AI_RATE_CARD_INVALID",
          "The resolved Rate Card contains duplicate price components.",
        );
      }
      lines.set(line.component, line);
    }

    let total = BigInt(0);
    const breakdown: AICostBreakdownItem[] = [];
    const missingComponents: AIRateCardPriceComponent[] = [];

    for (const entry of BILLABLE_COMPONENTS) {
      const quantity = usage[entry.usageKey];
      const line = lines.get(entry.component);
      this.addComponent(entry.component, quantity, line, breakdown, missingComponents, (cost) => {
        total += cost;
      });
    }

    const requestLine = lines.get("REQUEST");
    this.addComponent("REQUEST", usage.requestUnits, requestLine, breakdown, missingComponents, (cost) => {
      total += cost;
    });

    const knownCostNano = safeNumber(total, "The calculated AI cost exceeds the safe integer range.");
    return {
      currency: rateCard.currency,
      knownCostNano,
      completeness: missingComponents.length ? "PARTIAL" : "COMPLETE",
      missingComponents: Object.freeze([...missingComponents]),
      breakdown: Object.freeze([...breakdown]),
      costBasis: "RATE_CARD",
    };
  }

  private addComponent(
    component: AIRateCardPriceComponent,
    quantity: number | null,
    line: AIRateCardPriceLineContent | undefined,
    breakdown: AICostBreakdownItem[],
    missingComponents: AIRateCardPriceComponent[],
    addCost: (cost: bigint) => void,
  ): void {
    if (quantity === null) {
      if (line) missingComponents.push(component);
      return;
    }
    if (quantity === 0 && !line) return;
    if (!line) {
      if (quantity > 0) {
        throw new AIAccountingError(
          "AI_RATE_CARD_INCOMPLETE",
          "The Rate Card has no price for a positive billable component.",
        );
      }
      return;
    }
    const cost = priceFor(line, quantity);
    addCost(cost);
    breakdown.push({
      component,
      quantity,
      unit: line.unit,
      rateAmountNano: line.amountNano,
      costNano: safeNumber(cost, "The AI cost component exceeds the safe integer range."),
    });
  }
}

function priceFor(line: AIRateCardPriceLineContent, quantity: number): bigint {
  const amount = BigInt(line.amountNano);
  const count = BigInt(quantity);
  if (line.unit === "PER_REQUEST") return amount * count;
  return ceilDivide(amount * count, TOKENS_PER_MILLION);
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

function safeNumber(value: bigint, message: string): number {
  if (value < BigInt(0) || value > MAX_SAFE_INTEGER_BIGINT) {
    throw new AIAccountingError("AI_COST_OVERFLOW", message);
  }
  return Number(value);
}
