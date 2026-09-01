import { and, asc, eq, lte } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiRateCardPriceLines,
  aiRateCardRevisions,
  aiRateCardTimeBands,
  aiRateCards,
  type AIRateCardPriceLineRow,
  type AIRateCardRevisionRow,
  type AIRateCardTimeBandRow,
} from "../../content/schema";
import type {
  AIRateCard,
  AIRateCardContent,
  AIRateCardRepository,
  AIRateCardRevision,
  AIRateCardStoredTimeBand,
  AIRateCardPriceLineContent,
} from "./contracts";
import { AIAccountingError } from "./errors";
import { normalizeAIRateCardContent } from "./validation";

export class SQLiteAIRateCardRepository implements AIRateCardRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIRateCard | null {
    const row = this.database.db
      .select()
      .from(aiRateCards)
      .where(eq(aiRateCards.id, id))
      .get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIAccountingError("AI_RATE_CARD_INVALID", "The current Rate Card revision is missing.");
    return {
      ...stripStoredBands(revision),
      id: row.id,
      currentRevision: row.currentRevision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  getCurrentRevision(id: string): AIRateCardRevision | null {
    const row = this.database.db
      .select({ currentRevision: aiRateCards.currentRevision })
      .from(aiRateCards)
      .where(eq(aiRateCards.id, id))
      .get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIRateCardRevision | null {
    const row = this.database.db
      .select()
      .from(aiRateCardRevisions)
      .where(and(eq(aiRateCardRevisions.rateCardId, id), eq(aiRateCardRevisions.revision, revision)))
      .get();
    return row ? this.revisionFromRow(row) : null;
  }

  listRevisions(): AIRateCardRevision[] {
    return this.database.db
      .select()
      .from(aiRateCardRevisions)
      .orderBy(asc(aiRateCardRevisions.rateCardId), asc(aiRateCardRevisions.revision))
      .all()
      .map((row) => this.revisionFromRow(row));
  }

  listResolutionRevisions(input: {
    modelConfigId: string;
    modelConfigRevision: number;
    at: number;
  }): AIRateCardRevision[] {
    return this.database.db
      .select()
      .from(aiRateCardRevisions)
      .where(
        and(
          eq(aiRateCardRevisions.modelConfigId, input.modelConfigId),
          eq(aiRateCardRevisions.modelConfigRevision, input.modelConfigRevision),
          lte(aiRateCardRevisions.createdAt, input.at),
          lte(aiRateCardRevisions.effectiveFrom, input.at),
        ),
      )
      .orderBy(asc(aiRateCardRevisions.rateCardId), asc(aiRateCardRevisions.revision))
      .all()
      .map((row) => this.revisionFromRow(row));
  }

  create(input: {
    id: string;
    content: AIRateCardContent;
    actor: AdminActor;
    now: number;
  }): AIRateCardRevision {
    try {
      this.database.db.insert(aiRateCards).values({
        id: input.id,
        key: input.content.key,
        currentRevision: 1,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actor.actorUserId,
        updatedBy: input.actor.actorUserId,
      }).run();
      this.insertRevisionRows(input.id, 1, input.content, input.actor, input.now);
      const revision = this.getRevision(input.id, 1);
      if (!revision) throw new AIAccountingError("AI_RATE_CARD_INVALID", "The new Rate Card revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIAccountingError) throw error;
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The Rate Card could not be created.", error);
    }
  }

  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AIRateCardContent;
    actor: AdminActor;
    now: number;
  }): AIRateCardRevision {
    const current = this.database.db
      .select({ currentRevision: aiRateCards.currentRevision })
      .from(aiRateCards)
      .where(eq(aiRateCards.id, input.id))
      .get();
    if (!current) throw new AIAccountingError("AI_ACCOUNTING_NOT_FOUND", "The Rate Card was not found.");
    if (current.currentRevision !== input.expectedRevision) {
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The Rate Card changed before publication.");
    }
    const nextRevision = input.expectedRevision + 1;
    try {
      this.insertRevisionRows(input.id, nextRevision, input.content, input.actor, input.now);
      const updated = this.database.db
        .update(aiRateCards)
        .set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        })
        .where(and(eq(aiRateCards.id, input.id), eq(aiRateCards.currentRevision, input.expectedRevision)))
        .returning({ currentRevision: aiRateCards.currentRevision })
        .get();
      if (!updated) throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The Rate Card changed before publication.");
      const revision = this.getRevision(input.id, nextRevision);
      if (!revision) throw new AIAccountingError("AI_RATE_CARD_INVALID", "The new Rate Card revision could not be read.");
      return revision;
    } catch (error) {
      if (error instanceof AIAccountingError) throw error;
      throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", "The Rate Card revision could not be appended.", error);
    }
  }

  private insertRevisionRows(
    rateCardId: string,
    revision: number,
    content: AIRateCardContent,
    actor: AdminActor,
    now: number,
  ): void {
    const normalized = normalizeAIRateCardContent(content);
    const revisionId = uuidv7();
    this.database.db.insert(aiRateCardRevisions).values({
      id: revisionId,
      rateCardId,
      revision,
      displayName: normalized.displayName,
      modelConfigId: normalized.modelConfigId,
      modelConfigRevision: normalized.modelConfigRevision,
      currency: normalized.currency,
      billingUsageNormalizerKey: normalized.billingUsageNormalizerKey,
      effectiveFrom: normalized.effectiveFrom,
      effectiveTo: normalized.effectiveTo,
      enabled: normalized.enabled,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();

    const storedBands = normalized.timeBands.map((band) => ({
      id: uuidv7(),
      rateCardRevisionId: revisionId,
      ...band,
    }));
    if (storedBands.length) {
      this.database.db.insert(aiRateCardTimeBands).values(storedBands.map((band) => ({
        id: band.id,
        rateCardRevisionId: band.rateCardRevisionId,
        timeZone: band.timeZone,
        daysOfWeekMask: band.daysOfWeekMask,
        startMinute: band.startMinute,
        endMinute: band.endMinute,
      }))).run();
    }
    const priceLines: Array<{
      id: string;
      rateCardRevisionId: string;
      timeBandId: string | null;
      component: AIRateCardPriceLineContent["component"];
      unit: AIRateCardPriceLineContent["unit"];
      amountNano: number;
    }> = normalized.priceLines.map((line) => ({
      id: uuidv7(),
      rateCardRevisionId: revisionId,
      timeBandId: null,
      ...line,
    }));
    for (const band of storedBands) {
      priceLines.push(...band.priceLines.map((line) => ({
        id: uuidv7(),
        rateCardRevisionId: revisionId,
        timeBandId: band.id,
        ...line,
      })));
    }
    this.database.db.insert(aiRateCardPriceLines).values(priceLines).run();
  }

  private revisionFromRow(row: AIRateCardRevisionRow): AIRateCardRevision {
    const bandRows = this.database.db
      .select()
      .from(aiRateCardTimeBands)
      .where(eq(aiRateCardTimeBands.rateCardRevisionId, row.id))
      .orderBy(asc(aiRateCardTimeBands.id))
      .all();
    const lineRows = this.database.db
      .select()
      .from(aiRateCardPriceLines)
      .where(eq(aiRateCardPriceLines.rateCardRevisionId, row.id))
      .orderBy(asc(aiRateCardPriceLines.id))
      .all();
    const defaultLines = lineRows
      .filter((line) => line.timeBandId === null)
      .map(priceLineFromRow);
    const bands = bandRows.map((band) => storedBandFromRow(
      band,
      lineRows.filter((line) => line.timeBandId === band.id).map(priceLineFromRow),
    ));
    const content = normalizeAIRateCardContent({
      key: this.rateCardKey(row.rateCardId),
      displayName: row.displayName,
      modelConfigId: row.modelConfigId,
      modelConfigRevision: row.modelConfigRevision,
      currency: row.currency,
      billingUsageNormalizerKey: row.billingUsageNormalizerKey,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      enabled: row.enabled,
      priceLines: defaultLines,
      timeBands: bands.map(stripBandId),
    });
    return {
      ...content,
      rateCardId: row.rateCardId,
      revision: row.revision,
      revisionId: row.id,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      timeBands: bands,
    };
  }

  private rateCardKey(rateCardId: string): string {
    const row = this.database.db.select({ key: aiRateCards.key }).from(aiRateCards).where(eq(aiRateCards.id, rateCardId)).get();
    if (!row) throw new AIAccountingError("AI_RATE_CARD_INVALID", "The Rate Card identity is missing.");
    return row.key;
  }
}

function priceLineFromRow(row: AIRateCardPriceLineRow): AIRateCardPriceLineContent {
  return {
    component: row.component,
    unit: row.unit,
    amountNano: row.amountNano,
  };
}

function storedBandFromRow(
  row: AIRateCardTimeBandRow,
  priceLines: AIRateCardPriceLineContent[],
): AIRateCardStoredTimeBand {
  return {
    id: row.id,
    timeZone: row.timeZone,
    daysOfWeekMask: row.daysOfWeekMask,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    priceLines,
  };
}

function stripBandId(band: AIRateCardStoredTimeBand) {
  const { id: _id, ...content } = band;
  return content;
}

function stripStoredBands(revision: AIRateCardRevision): AIRateCardContent {
  return {
    key: revision.key,
    displayName: revision.displayName,
    modelConfigId: revision.modelConfigId,
    modelConfigRevision: revision.modelConfigRevision,
    currency: revision.currency,
    billingUsageNormalizerKey: revision.billingUsageNormalizerKey,
    effectiveFrom: revision.effectiveFrom,
    effectiveTo: revision.effectiveTo,
    enabled: revision.enabled,
    priceLines: revision.priceLines,
    timeBands: revision.timeBands.map(stripBandId),
  };
}
