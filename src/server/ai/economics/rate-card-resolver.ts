import type {
  AIRateCardRepository,
  ResolvedAIRateCard,
} from "./contracts";
import { AIAccountingError } from "./errors";
import type { AIRateCardModelRevisionRepository } from "./contracts";
import { getZonedWeekdayAndMinute } from "./time-bands";

const MAX_RUNTIME_TIMESTAMP = 8_640_000_000_000_000;

export class AIRateCardResolver {
  constructor(
    private readonly rateCards: AIRateCardRepository,
    private readonly modelRevisions: AIRateCardModelRevisionRepository,
  ) {}

  resolve(input: {
    modelConfigId: string;
    modelConfigRevision: number;
    at: number;
  }): ResolvedAIRateCard {
    if (!Number.isSafeInteger(input.at) || input.at < 0 || input.at > MAX_RUNTIME_TIMESTAMP) {
      throw new AIAccountingError("AI_RATE_CARD_INVALID", "The Rate Card resolution timestamp is invalid.");
    }
    if (!this.modelRevisions.get(input.modelConfigId, input.modelConfigRevision)) {
      throw new AIAccountingError(
        "AI_MODEL_REVISION_NOT_FOUND",
        "The requested Model configuration revision is not published.",
      );
    }
    const candidates = this.rateCards.listEligibleRevisions(input);
    if (!candidates.length) {
      throw new AIAccountingError("AI_RATE_CARD_NOT_FOUND", "No applicable published Rate Card was found.");
    }
    if (candidates.length > 1) {
      throw new AIAccountingError("AI_RATE_CARD_AMBIGUOUS", "More than one Rate Card applies to this operation.");
    }
    const candidate = candidates[0];
    const matchingBands = candidate.timeBands.filter((band) => {
      const local = getZonedWeekdayAndMinute(input.at, band.timeZone);
      const dayBit = 1 << local.weekday;
      return (band.daysOfWeekMask & dayBit) !== 0 &&
        local.minute >= band.startMinute &&
        local.minute < band.endMinute;
    });
    if (matchingBands.length > 1) {
      throw new AIAccountingError("AI_RATE_CARD_AMBIGUOUS", "More than one recurring Rate Card band applies.");
    }
    const band = matchingBands[0];
    return Object.freeze({
      rateCardId: candidate.rateCardId,
      rateCardRevision: candidate.revision,
      rateCardRevisionId: candidate.revisionId,
      modelConfigId: candidate.modelConfigId,
      modelConfigRevision: candidate.modelConfigRevision,
      currency: candidate.currency,
      billingUsageNormalizerKey: candidate.billingUsageNormalizerKey,
      effectiveFrom: candidate.effectiveFrom,
      effectiveTo: candidate.effectiveTo,
      pricingRuleId: band?.id ?? "DEFAULT",
      pricingRuleKind: band ? "TIME_BAND" : "DEFAULT",
      timeZone: band?.timeZone ?? null,
      priceLines: Object.freeze(
        [...(band ? band.priceLines : candidate.priceLines)].map((line) => Object.freeze({ ...line })),
      ),
    });
  }
}
