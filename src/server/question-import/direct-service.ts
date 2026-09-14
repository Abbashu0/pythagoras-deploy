import { eq, sql } from "drizzle-orm";
import type { AdminActor } from "../admin-auth";
import { publicationState } from "../content/schema";
import type { ContentDatabase } from "../content";
import { QuestionSearchService } from "../question-search";
import { createQuestionPackageInspectionService } from "../question-packages";
import type {
  QuestionMaterializationPlan,
  QuestionPackageAggregate,
} from "../questions";
import { SQLiteQuestionRepository } from "../questions";
import type { QuestionPackageImportPreflight } from "./contracts";
import { QuestionImportError } from "./errors";
import { QuestionPackageImportService } from "./service";

export type DirectQuestionPackageOperation =
  | "IMPORTED"
  | "UPDATED"
  | "ALREADY_IMPORTED";

export interface PreparedDirectQuestionPackage {
  preflight: QuestionPackageImportPreflight;
  plan: QuestionMaterializationPlan | null;
  existing: QuestionPackageAggregate | null;
  operation: DirectQuestionPackageOperation;
}

export interface DirectQuestionPackageApplyResult {
  operation: DirectQuestionPackageOperation;
  package: QuestionPackageAggregate;
  preflight: QuestionPackageImportPreflight;
}

function assertActor(actor: AdminActor): void {
  if (!actor.actorUserId?.trim() || !["OWNER", "ADMIN"].includes(actor.actorRole)) {
    throw new QuestionImportError(
      "QUESTION_IMPORT_INVALID",
      "An authenticated Admin actor is required.",
    );
  }
}

function isAlreadyImportedBlocker(code: string): boolean {
  return code === "PACKAGE_REVISION_NOT_NEWER";
}

/**
 * Direct local-Admin Question Package application. It deliberately composes
 * the existing inspection, validation and materialization logic while leaving
 * the historical Change Set staging service untouched.
 */
export class DirectQuestionPackageService {
  private readonly importer: QuestionPackageImportService;
  private readonly questions: SQLiteQuestionRepository;
  private readonly inspections;

  constructor(private readonly database: ContentDatabase) {
    this.importer = new QuestionPackageImportService(database);
    this.questions = new SQLiteQuestionRepository(database);
    this.inspections = createQuestionPackageInspectionService(database);
  }

  async inspect(
    assetId: string,
    actor: AdminActor,
  ): Promise<QuestionPackageImportPreflight> {
    assertActor(actor);
    return this.importer.preflight(assetId, actor);
  }

  async prepare(
    assetId: string,
    actor: AdminActor,
  ): Promise<PreparedDirectQuestionPackage> {
    assertActor(actor);
    try {
      await this.inspections.inspectAsset(assetId);
    } catch {
      throw new QuestionImportError(
        "QUESTION_IMPORT_NOT_FOUND",
        "Question Package Asset could not be inspected safely.",
      );
    }
    const preflight = await this.importer.preflight(assetId, actor);
    if (!preflight.package) {
      throw new QuestionImportError(
        "QUESTION_IMPORT_INELIGIBLE",
        "Asset is not a supported Question Package.",
      );
    }

    const existing = this.questions.getPackageAggregate(preflight.package.id);
    const alreadyImported =
      Boolean(existing) &&
      existing?.package.contentRevision === preflight.package.contentRevision &&
      preflight.blockers.length > 0 &&
      preflight.blockers.every((item) => isAlreadyImportedBlocker(item.code));
    if (alreadyImported && existing) {
      return {
        preflight,
        plan: null,
        existing,
        operation: "ALREADY_IMPORTED",
      };
    }

    if (!preflight.eligible || preflight.blockers.length) {
      throw new QuestionImportError(
        "QUESTION_IMPORT_CONFLICT",
        "Question Package preflight contains blocking issues.",
      );
    }

    const plan = await this.importer.createMaterializationPlan(assetId, actor);
    if (existing && hasSupersededResources(existing, plan)) {
      throw new QuestionImportError(
        "QUESTION_IMPORT_CONFLICT",
        "This Question Package update removes existing canonical resources and requires advanced handling.",
      );
    }
    return {
      preflight,
      plan,
      existing,
      operation: existing ? "UPDATED" : "IMPORTED",
    };
  }

  applyPreparedInTransaction(
    prepared: PreparedDirectQuestionPackage,
  ): QuestionPackageAggregate {
    if (prepared.plan) {
      this.questions.applyMaterializationPlanInTransaction(
        prepared.plan,
        prepared.existing,
      );
      const items = [
        { resourceType: "question.package", resourceId: prepared.plan.package.id },
        ...prepared.plan.taxonomy.map((item) => ({ resourceType: "question.taxonomy", resourceId: item.id })),
        ...prepared.plan.browseNodes.map((item) => ({ resourceType: "question.browse", resourceId: item.id })),
        ...prepared.plan.questions.map((item) => ({ resourceType: "question.item", resourceId: item.id })),
      ];
      new QuestionSearchService(this.database).rebuildForPublicationInTransaction(items);
    }
    const aggregate = this.questions.getPackageAggregate(prepared.preflight.package?.id ?? "");
    if (!aggregate) {
      throw new QuestionImportError(
        "QUESTION_IMPORT_CONFLICT",
        "The direct Question Package application could not be reloaded.",
      );
    }
    return aggregate;
  }

  async apply(
    assetId: string,
    acknowledgeWarnings: boolean,
    actor: AdminActor,
  ): Promise<DirectQuestionPackageApplyResult> {
    const prepared = await this.prepare(assetId, actor);
    if (prepared.preflight.acknowledgementRequired && !acknowledgeWarnings) {
      throw new QuestionImportError(
        "QUESTION_IMPORT_ACKNOWLEDGEMENT_REQUIRED",
        "Warnings must be acknowledged before applying the Question Package.",
      );
    }

    let aggregate: QuestionPackageAggregate | undefined;
    this.database.client
      .transaction(() => {
        aggregate = this.applyPreparedInTransaction(prepared);
        if (prepared.plan) this.bumpContentRevision();
      })
      .immediate();
    if (!aggregate) {
      throw new QuestionImportError(
        "QUESTION_IMPORT_CONFLICT",
        "The direct Question Package application did not complete.",
      );
    }
    return {
      operation: prepared.operation,
      package: aggregate,
      preflight: prepared.preflight,
    };
  }

  private bumpContentRevision(): void {
    const now = Date.now();
    this.database.db
      .update(publicationState)
      .set({
        currentRevision: sql`${publicationState.currentRevision} + 1`,
        updatedAt: now,
      })
      .where(eq(publicationState.id, "global"))
      .run();
  }
}

function hasSupersededResources(
  existing: QuestionPackageAggregate,
  plan: QuestionMaterializationPlan,
): boolean {
  const nextTaxonomy = new Set(plan.taxonomy.map((item) => item.id));
  const nextBrowse = new Set(plan.browseNodes.map((item) => item.id));
  const nextQuestions = new Set(plan.questions.map((item) => item.id));
  const nextVariants = new Set(plan.questions.flatMap((item) => item.variants.map((variant) => variant.id)));
  const nextOccurrences = new Set(plan.questions.flatMap((item) => item.variants.flatMap((variant) => variant.occurrences.map((occurrence) => occurrence.id))));
  return existing.taxonomy.some((item) => !nextTaxonomy.has(item.id))
    || existing.browseNodes.some((item) => !nextBrowse.has(item.id))
    || existing.questions.some((item) => !nextQuestions.has(item.id))
    || existing.questions.some((item) => item.variants.some((variant) => !nextVariants.has(variant.id)))
    || existing.questions.some((item) => item.variants.some((variant) => variant.occurrences.some((occurrence) => !nextOccurrences.has(occurrence.id))));
}
