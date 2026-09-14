import { and, eq, sql } from "drizzle-orm";
import type { AdminActor } from "../admin-auth/contracts";
import { getContentDatabase, type ContentDatabase } from "../content/database";
import {
  canonicalCarouselSettings,
  canonicalContentState,
  publicationState,
} from "../content/schema";
import { CanonicalContentError } from "./errors";
import type { CanonicalCarouselSettings } from "./contracts";
import { SQLiteCanonicalContentRepository } from "./sqlite-canonical-content-repository";

export const DIRECT_CAROUSEL_INTERVAL_MIN_MS = 5_000;
export const DIRECT_CAROUSEL_INTERVAL_MAX_MS = 30_000;

export interface DirectCarouselSettingsUpdateInput {
  autoSlideInterval?: unknown;
}

function invalid(message: string): never {
  throw new CanonicalContentError("CANONICAL_VALIDATION_FAILED", message);
}

function assertActor(actor: AdminActor): void {
  if (!actor.actorUserId?.trim() || !["OWNER", "ADMIN"].includes(actor.actorRole)) {
    throw new CanonicalContentError(
      "CANONICAL_AUTHORIZATION_FAILED",
      "A valid local Admin actor is required.",
    );
  }
}

function normalizeInterval(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < DIRECT_CAROUSEL_INTERVAL_MIN_MS ||
    value > DIRECT_CAROUSEL_INTERVAL_MAX_MS
  ) {
    invalid("The carousel interval must be between five and thirty seconds.");
  }
  return value;
}

function normalizeRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new CanonicalContentError(
      "CANONICAL_CONFLICT",
      "The carousel settings revision is stale or invalid.",
    );
  }
  return value;
}

export class DirectCarouselSettingsService {
  private readonly canonical: SQLiteCanonicalContentRepository;

  constructor(private readonly database: ContentDatabase) {
    this.canonical = new SQLiteCanonicalContentRepository(database);
  }

  get(): CanonicalCarouselSettings {
    this.canonical.bootstrap();
    return this.canonical.getSnapshot().carouselSettings;
  }

  update(
    input: DirectCarouselSettingsUpdateInput,
    expectedRevision: unknown,
    actor: AdminActor,
  ): CanonicalCarouselSettings {
    assertActor(actor);
    this.canonical.bootstrap();
    const interval = normalizeInterval(input.autoSlideInterval);
    const revision = normalizeRevision(expectedRevision);
    const now = Date.now();

    this.database.db.transaction((transaction) => {
      const current = transaction
        .select()
        .from(canonicalCarouselSettings)
        .where(eq(canonicalCarouselSettings.id, "global"))
        .get();
      if (!current) {
        throw new CanonicalContentError(
          "CANONICAL_BOOTSTRAP_FAILED",
          "Canonical carousel settings are missing.",
        );
      }
      if (current.revision !== revision) {
        throw new CanonicalContentError(
          "CANONICAL_CONFLICT",
          "The carousel settings changed before they were saved.",
        );
      }

      const updated = transaction
        .update(canonicalCarouselSettings)
        .set({
          autoSlideInterval: interval,
          updatedAt: now,
          updatedBy: actor.actorUserId,
          revision: sql`${canonicalCarouselSettings.revision} + 1`,
        })
        .where(
          and(
            eq(canonicalCarouselSettings.id, "global"),
            eq(canonicalCarouselSettings.revision, revision),
          ),
        )
        .returning({ id: canonicalCarouselSettings.id })
        .get();
      if (!updated) {
        throw new CanonicalContentError(
          "CANONICAL_CONFLICT",
          "The carousel settings changed before they were saved.",
        );
      }

      // A direct local Admin write is the first canonical source of truth for
      // this setting, so the public app endpoint must expose it immediately.
      transaction
        .update(canonicalContentState)
        .set({
          runtimeSourceMode: "CANONICAL",
          updatedAt: now,
          updatedBy: actor.actorUserId,
          revision: sql`${canonicalContentState.revision} + 1`,
        })
        .where(
          and(
            eq(canonicalContentState.id, "global"),
            eq(canonicalContentState.runtimeSourceMode, "LEGACY"),
          ),
        )
        .run();

      transaction
        .update(publicationState)
        .set({
          currentRevision: sql`${publicationState.currentRevision} + 1`,
          updatedAt: now,
        })
        .where(eq(publicationState.id, "global"))
        .run();
    });

    return this.get();
  }
}

let singleton: DirectCarouselSettingsService | undefined;

export function createDirectCarouselSettingsService(
  database: ContentDatabase,
): DirectCarouselSettingsService {
  return new DirectCarouselSettingsService(database);
}

export function getDirectCarouselSettingsService(): DirectCarouselSettingsService {
  singleton ??= new DirectCarouselSettingsService(getContentDatabase());
  return singleton;
}
