import type { AdminActor } from "../../admin-auth/contracts";
import type {
  ChangeOperation,
  ChangePresentation,
  ChangeResourceAdapter,
  ChangeSnapshot,
  ResourceState,
} from "../../change-management/contracts";
import { ChangeManagementError } from "../../change-management/errors";
import { deriveChangedPaths, validateChangeSnapshot } from "../../change-management/snapshot";
import type { ContentDatabase } from "../../content/database";
import {
  AI_RATE_CARD_RESOURCE_TYPE,
  type AIRateCard,
  type AIRateCardContent,
  type AIRateCardRevision,
} from "./contracts";
import { AIAccountingError } from "./errors";
import { SQLiteAIRateCardModelRevisionRepository } from "./model-revision-repository";
import { SQLiteAIRateCardRepository } from "./rate-card-repository";
import {
  assertNoRateCardEffectiveOverlaps,
  normalizeAIRateCardContent,
} from "./validation";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const FIELD_LABELS: Record<string, string> = {
  key: "Rate Card key",
  displayName: "Display name",
  modelConfigId: "Model configuration",
  modelConfigRevision: "Model configuration revision",
  currency: "Currency",
  billingUsageNormalizerKey: "Billing usage normalizer",
  effectiveFrom: "Effective from",
  effectiveTo: "Effective to",
  enabled: "Enabled state",
  priceLines: "Default price lines",
  timeBands: "Recurring time bands",
};

export class AIRateCardChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = AI_RATE_CARD_RESOURCE_TYPE;
  readonly areaLabel = "AI / Rate Cards";
  readonly mergeStrategy = "THREE_WAY" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const revision = new SQLiteAIRateCardRepository(database).getCurrentRevision(resourceId);
    if (!revision) {
      throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Rate Card was not found.");
    }
    return {
      resourceId,
      revision: revision.revision,
      snapshot: snapshotFromContent(revision),
    };
  }

  captureProposal(
    database: ContentDatabase,
    resourceId: string,
    desired: unknown,
    operation: ChangeOperation = "UPDATE",
  ) {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteAIRateCardRepository(database);
    const current = operation === "CREATE"
      ? this.emptyCreateState(repository, resourceId)
      : this.loadCurrent(database, resourceId);
    try {
      const content = normalizeAIRateCardContent(desired);
      if (operation === "UPDATE") {
        const previous = normalizeAIRateCardContent(current.snapshot);
        assertStableRateCardIdentity(previous, content);
        if (content.effectiveFrom < previous.effectiveFrom) {
          throw new AIAccountingError(
            "AI_RATE_CARD_INVALID",
            "A Rate Card revision cannot move its effective start backward.",
          );
        }
      }
      const proposedSnapshot = snapshotFromContent(content);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) {
        throw new AIAccountingError("AI_RATE_CARD_INVALID", "The Rate Card proposal does not change any fields.");
      }
      return { current, proposedSnapshot, changedPaths };
    } catch (error) {
      throw mapAccountingError(error);
    }
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    try {
      validateChangeSnapshot(snapshot);
      normalizeAIRateCardContent(snapshot);
    } catch (error) {
      throw mapAccountingError(error);
    }
  }

  describe(
    resourceId: string,
    before: ChangeSnapshot,
    proposed: ChangeSnapshot,
    operation: ChangeOperation = "UPDATE",
  ): ChangePresentation {
    const after = normalizeAIRateCardContent(proposed);
    const previous = operation === "CREATE" && Object.keys(before).length === 0
      ? null
      : normalizeAIRateCardContent(before);
    if (previous && previous.key !== after.key) {
      throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Rate Card key is immutable after creation.");
    }
    const changedPaths = deriveChangedPaths(
      previous ? snapshotFromContent(previous) : {},
      snapshotFromContent(after),
    );
    return {
      resourceLabel: after.displayName,
      resourceSubtitle: operation === "CREATE"
        ? "New governed Rate Card"
        : `Rate Card · ${resourceId}`,
      changeSummary: `${changedPaths.length} changed field${changedPaths.length === 1 ? "" : "s"}`,
      areaLabel: this.areaLabel,
      fieldDiffs: changedPaths.map((path) => ({
        path,
        label: FIELD_LABELS[path] ?? path,
        before: previous ? snapshotFromContent(previous)[path] : undefined,
        after: snapshotFromContent(after)[path],
      })),
    };
  }

  apply(
    database: ContentDatabase,
    resourceId: string,
    value: ChangeSnapshot,
    expectedRevision: number,
    actor: AdminActor,
    operation: ChangeOperation = "UPDATE",
  ): ResourceState {
    if (actor.actorRole !== "OWNER") {
      throw new ChangeManagementError(
        "CHANGE_AUTHORIZATION_FAILED",
        "Only OWNER may publish Rate Cards.",
      );
    }
    assertUuid(resourceId, "resourceId");
    const content = normalizeAIRateCardContent(value);
    const repository = new SQLiteAIRateCardRepository(database);
    const current = operation === "UPDATE"
      ? repository.getCurrentRevision(resourceId)
      : null;
    if (operation === "UPDATE") {
      if (!current) {
        throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Rate Card was not found.");
      }
      assertStableRateCardIdentity(current, content);
      if (content.effectiveFrom < current.effectiveFrom) {
        throw new ChangeManagementError(
          "CHANGE_VALIDATION_FAILED",
          "A Rate Card revision cannot move its effective start backward.",
        );
      }
    }
    const modelRevision = new SQLiteAIRateCardModelRevisionRepository(database).get(
      content.modelConfigId,
      content.modelConfigRevision,
    );
    if (!modelRevision) {
      throw new ChangeManagementError(
        "CHANGE_VALIDATION_FAILED",
        "The referenced published Model configuration revision was not found.",
      );
    }
    try {
      const now = Date.now();
      assertNoRateCardEffectiveOverlaps([
        ...repository.listRevisions(),
        pendingRevision(
          resourceId,
          operation === "CREATE" ? 1 : expectedRevision + 1,
          content,
          now,
        ),
      ]);
      const revision = operation === "CREATE"
        ? repository.create({ id: resourceId, content, actor, now })
        : repository.appendRevision({
            id: resourceId,
            expectedRevision,
            content,
            actor,
            now,
          });
      return {
        resourceId,
        revision: revision.revision,
        snapshot: snapshotFromContent(revision),
      };
    } catch (error) {
      throw mapAccountingError(error);
    }
  }

  validatePublication(database: ContentDatabase): void {
    const repository = new SQLiteAIRateCardRepository(database);
    const revisions = repository.listRevisions();
    assertNoRateCardEffectiveOverlaps(revisions);
    const modelRevisions = new SQLiteAIRateCardModelRevisionRepository(database);
    for (const revision of revisions) {
      if (!modelRevisions.get(revision.modelConfigId, revision.modelConfigRevision)) {
        throw new ChangeManagementError(
          "CHANGE_VALIDATION_FAILED",
          "A Rate Card references a missing published Model configuration revision.",
        );
      }
    }
  }

  private emptyCreateState(
    repository: SQLiteAIRateCardRepository,
    resourceId: string,
  ): ResourceState {
    if (repository.getById(resourceId)) {
      throw new ChangeManagementError("CHANGE_CONFLICT", "The Rate Card identifier is already in use.");
    }
    return { resourceId, revision: 0, snapshot: {} };
  }
}

function pendingRevision(
  rateCardId: string,
  revision: number,
  content: AIRateCardContent,
  createdAt: number,
): AIRateCardRevision {
  return {
    ...content,
    rateCardId,
    revision,
    revisionId: `pending-${rateCardId}-${revision}`,
    createdAt,
    createdBy: "SYSTEM",
    timeBands: content.timeBands.map((band, index) => ({
      ...band,
      id: `pending-band-${index}`,
    })),
  };
}

function assertStableRateCardIdentity(
  current: Pick<AIRateCardContent, "key" | "modelConfigId" | "modelConfigRevision" | "currency">,
  next: AIRateCardContent,
): void {
  if (
    current.key !== next.key ||
    current.modelConfigId !== next.modelConfigId ||
    current.modelConfigRevision !== next.modelConfigRevision ||
    current.currency !== next.currency
  ) {
    throw new AIAccountingError(
      "AI_RATE_CARD_INVALID",
      "Rate Card key, Model target, Model revision, and currency are immutable after creation.",
    );
  }
}

function snapshotFromContent(
  content: AIRateCard | AIRateCardRevision | AIRateCardContent,
): ChangeSnapshot {
  return structuredClone({
    key: content.key,
    displayName: content.displayName,
    modelConfigId: content.modelConfigId,
    modelConfigRevision: content.modelConfigRevision,
    currency: content.currency,
    billingUsageNormalizerKey: content.billingUsageNormalizerKey,
    effectiveFrom: content.effectiveFrom,
    effectiveTo: content.effectiveTo,
    enabled: content.enabled,
    priceLines: content.priceLines,
    timeBands: content.timeBands.map((band) => ({
      timeZone: band.timeZone,
      daysOfWeekMask: band.daysOfWeekMask,
      startMinute: band.startMinute,
      endMinute: band.endMinute,
      priceLines: band.priceLines,
    })),
  }) as unknown as ChangeSnapshot;
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `${field} must be a stable UUID.`);
  }
}

function mapAccountingError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof AIAccountingError) {
    return new ChangeManagementError(
      error.code === "AI_ACCOUNTING_CONFLICT" ? "CHANGE_CONFLICT" : "CHANGE_VALIDATION_FAILED",
      error.message,
      error,
    );
  }
  return error instanceof Error
    ? new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Rate Card operation failed.", error)
    : new ChangeManagementError("CHANGE_PUBLICATION_FAILED", "The Rate Card operation failed.");
}
