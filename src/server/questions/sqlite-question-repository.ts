import { and, asc, eq, sql } from "drizzle-orm";
import type { ContentDatabase } from "../content/database";
import {
  questionBankBrowseNodes,
  questionOccurrenceBranches,
  questionOccurrenceQualifiers,
  questionOccurrences,
  questionPackageAssetBindings,
  questionPackages,
  questionPrimaryVariants,
  questionTaxonomyAssignments,
  questionTaxonomyNodes,
  questionVariants,
  questions,
  type QuestionBankBrowseNodeRow,
  type QuestionOccurrenceRow,
  type QuestionPackageAssetBindingRow,
  type QuestionPackageRow,
  type QuestionRow,
  type QuestionTaxonomyAssignmentRow,
  type QuestionTaxonomyNodeRow,
  type QuestionVariantRow,
} from "../content/schema";
import { assertCanonicalRichDocument } from "./canonical-rich-document";
import type {
  QuestionAggregate,
  QuestionBrowseNodeEntity,
  QuestionMaterializationPlan,
  QuestionOccurrenceEntity,
  QuestionPackageAggregate,
  QuestionPackageAssetBindingEntity,
  QuestionPackageEntity,
  QuestionRepository,
  QuestionTaxonomyAssignmentEntity,
  QuestionTaxonomyNodeEntity,
  QuestionVariantEntity,
  UpdateQuestionPackageTitleInput,
} from "./contracts";
import { QuestionDomainConflictError, QuestionDomainError } from "./errors";

export class SQLiteQuestionRepository implements QuestionRepository {
  constructor(
    private readonly database: ContentDatabase,
    private readonly clock: () => number = Date.now,
  ) {}

  materialize(plan: QuestionMaterializationPlan): QuestionPackageAggregate {
    assertMaterializationPlan(plan);
    try {
      this.database.client.transaction(() => {
        this.database.db.insert(questionPackages).values(plan.package).run();

        for (const node of hierarchyInsertOrder(plan.taxonomy)) {
          this.database.db.insert(questionTaxonomyNodes).values(node).run();
        }
        for (const node of hierarchyInsertOrder(plan.browseNodes)) {
          this.database.db.insert(questionBankBrowseNodes).values(node).run();
        }
        if (plan.assetBindings.length) {
          this.database.db
            .insert(questionPackageAssetBindings)
            .values(plan.assetBindings)
            .run();
        }

        for (const question of plan.questions) {
          this.database.db.insert(questions).values({
            id: question.id,
            packageId: question.packageId,
            displayOrder: question.displayOrder,
            sharedAnswer: question.sharedAnswer,
            createdAt: question.createdAt,
            updatedAt: question.updatedAt,
            updatedBy: question.updatedBy,
            revision: question.revision,
          }).run();

          for (const variant of question.variants) {
            this.database.db.insert(questionVariants).values({
              id: variant.id,
              questionId: variant.questionId,
              displayOrder: variant.displayOrder,
              content: variant.content,
              createdAt: variant.createdAt,
              updatedAt: variant.updatedAt,
              updatedBy: variant.updatedBy,
              revision: variant.revision,
            }).run();
            for (const occurrence of variant.occurrences) {
              this.database.db.insert(questionOccurrences).values({
                id: occurrence.id,
                variantId: occurrence.variantId,
                displayOrder: occurrence.displayOrder,
                sourceKind: occurrence.sourceKind,
                year: occurrence.year,
                roundCode: occurrence.roundCode,
                session: occurrence.session,
                sourceName: occurrence.sourceName,
                notes: occurrence.notes,
                rawLabel: occurrence.rawLabel,
                createdAt: occurrence.createdAt,
                updatedAt: occurrence.updatedAt,
                updatedBy: occurrence.updatedBy,
                revision: occurrence.revision,
              }).run();
              if (occurrence.branches.length) {
                this.database.db.insert(questionOccurrenceBranches).values(
                  occurrence.branches.map((value, position) => ({
                    occurrenceId: occurrence.id,
                    position,
                    value,
                  })),
                ).run();
              }
              if (occurrence.qualifiers.length) {
                this.database.db.insert(questionOccurrenceQualifiers).values(
                  occurrence.qualifiers.map((value, position) => ({
                    occurrenceId: occurrence.id,
                    position,
                    value,
                  })),
                ).run();
              }
            }
          }

          this.database.db.insert(questionPrimaryVariants).values({
            questionId: question.id,
            variantId: question.primaryVariantId,
          }).run();
          this.database.db
            .insert(questionTaxonomyAssignments)
            .values(question.taxonomyAssignments)
            .run();
        }
      }).immediate();
    } catch (error) {
      throw mapConstraintError(error);
    }

    const aggregate = this.getPackageAggregate(plan.package.id);
    if (!aggregate) {
      throw new QuestionDomainError(
        "QUESTION_DOMAIN_NOT_FOUND",
        "Materialized Question Package could not be reloaded.",
      );
    }
    return aggregate;
  }

  getPackage(packageId: string): QuestionPackageEntity | null {
    const row = this.database.db
      .select()
      .from(questionPackages)
      .where(eq(questionPackages.id, packageId))
      .get();
    return row ? toPackage(row) : null;
  }

  getPackageByKey(packageKey: string): QuestionPackageEntity | null {
    const row = this.database.db
      .select()
      .from(questionPackages)
      .where(eq(questionPackages.packageKey, packageKey))
      .get();
    return row ? toPackage(row) : null;
  }

  getPackageAggregate(packageId: string): QuestionPackageAggregate | null {
    const packageEntity = this.getPackage(packageId);
    if (!packageEntity) return null;
    return {
      package: packageEntity,
      taxonomy: this.listTaxonomy(packageId),
      browseNodes: this.listBrowseNodes(packageId),
      assetBindings: this.listAssetBindings(packageId),
      questions: this.listQuestions(packageId),
    };
  }

  listPackagesBySubject(subjectKey: string): QuestionPackageEntity[] {
    return this.database.db
      .select()
      .from(questionPackages)
      .where(eq(questionPackages.subjectKey, subjectKey))
      .orderBy(asc(questionPackages.bankBrowseEntryOrder), asc(questionPackages.id))
      .all()
      .map(toPackage);
  }

  listTaxonomy(packageId: string): QuestionTaxonomyNodeEntity[] {
    return this.database.db
      .select()
      .from(questionTaxonomyNodes)
      .where(eq(questionTaxonomyNodes.packageId, packageId))
      .orderBy(
        asc(questionTaxonomyNodes.parentId),
        asc(questionTaxonomyNodes.displayOrder),
        asc(questionTaxonomyNodes.id),
      )
      .all()
      .map(toTaxonomyNode);
  }

  listBrowseNodes(packageId: string): QuestionBrowseNodeEntity[] {
    return this.database.db
      .select()
      .from(questionBankBrowseNodes)
      .where(eq(questionBankBrowseNodes.packageId, packageId))
      .orderBy(
        asc(questionBankBrowseNodes.parentId),
        asc(questionBankBrowseNodes.displayOrder),
        asc(questionBankBrowseNodes.id),
      )
      .all()
      .map(toBrowseNode);
  }

  listQuestions(packageId: string): QuestionAggregate[] {
    return this.database.db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.packageId, packageId))
      .orderBy(asc(questions.displayOrder), asc(questions.id))
      .all()
      .map(({ id }) => this.getQuestion(id))
      .filter((item): item is QuestionAggregate => item !== null);
  }

  getQuestion(questionId: string): QuestionAggregate | null {
    const row = this.database.db
      .select()
      .from(questions)
      .where(eq(questions.id, questionId))
      .get();
    if (!row) return null;
    if (row.sharedAnswer) assertCanonicalRichDocument(row.sharedAnswer);

    const primary = this.database.db
      .select()
      .from(questionPrimaryVariants)
      .where(eq(questionPrimaryVariants.questionId, questionId))
      .get();
    if (!primary) {
      throw new QuestionDomainError(
        "QUESTION_DOMAIN_VALIDATION_FAILED",
        "Canonical Question is missing its primary Variant relation.",
      );
    }
    const variants = this.database.db
      .select()
      .from(questionVariants)
      .where(eq(questionVariants.questionId, questionId))
      .orderBy(asc(questionVariants.displayOrder), asc(questionVariants.id))
      .all()
      .map((variant) => this.toVariantAggregate(variant));
    const taxonomyAssignments = this.database.db
      .select()
      .from(questionTaxonomyAssignments)
      .where(eq(questionTaxonomyAssignments.questionId, questionId))
      .orderBy(asc(questionTaxonomyAssignments.position))
      .all()
      .map(toAssignment);
    return {
      ...toQuestion(row),
      primaryVariantId: primary.variantId,
      taxonomyAssignments,
      variants,
    };
  }

  updatePackageTitle(input: UpdateQuestionPackageTitleInput): QuestionPackageEntity {
    if (
      !input.actor.actorUserId?.trim() ||
      (input.actor.actorRole !== "OWNER" && input.actor.actorRole !== "ADMIN")
    ) {
      throw new QuestionDomainError(
        "QUESTION_DOMAIN_VALIDATION_FAILED",
        "An authenticated Admin actor is required.",
      );
    }
    const title = input.title.trim();
    if (!title || title.length > 1000 || input.expectedRevision < 1) {
      throw new QuestionDomainError(
        "QUESTION_DOMAIN_VALIDATION_FAILED",
        "Question Package title or expected revision is invalid.",
      );
    }
    const updated = this.database.db
      .update(questionPackages)
      .set({
        title,
        updatedAt: this.clock(),
        updatedBy: input.actor.actorUserId,
        revision: sql`${questionPackages.revision} + 1`,
      })
      .where(
        and(
          eq(questionPackages.id, input.id),
          eq(questionPackages.revision, input.expectedRevision),
        ),
      )
      .returning()
      .get();
    if (updated) return toPackage(updated);
    const current = this.getPackage(input.id);
    if (!current) {
      throw new QuestionDomainError(
        "QUESTION_DOMAIN_NOT_FOUND",
        "Question Package was not found.",
      );
    }
    throw new QuestionDomainConflictError(
      input.expectedRevision,
      current.revision,
    );
  }

  private listAssetBindings(packageId: string): QuestionPackageAssetBindingEntity[] {
    return this.database.db
      .select()
      .from(questionPackageAssetBindings)
      .where(eq(questionPackageAssetBindings.packageId, packageId))
      .orderBy(asc(questionPackageAssetBindings.position))
      .all()
      .map(toAssetBinding);
  }

  private toVariantAggregate(
    row: QuestionVariantRow,
  ): QuestionVariantEntity & { occurrences: QuestionOccurrenceEntity[] } {
    assertCanonicalRichDocument(row.content, true);
    const occurrences = this.database.db
      .select()
      .from(questionOccurrences)
      .where(eq(questionOccurrences.variantId, row.id))
      .orderBy(asc(questionOccurrences.displayOrder), asc(questionOccurrences.id))
      .all()
      .map((occurrence) => this.toOccurrence(occurrence));
    return { ...toVariant(row), occurrences };
  }

  private toOccurrence(row: QuestionOccurrenceRow): QuestionOccurrenceEntity {
    const branches = this.database.db
      .select({ value: questionOccurrenceBranches.value })
      .from(questionOccurrenceBranches)
      .where(eq(questionOccurrenceBranches.occurrenceId, row.id))
      .orderBy(asc(questionOccurrenceBranches.position))
      .all()
      .map(({ value }) => value);
    const qualifiers = this.database.db
      .select({ value: questionOccurrenceQualifiers.value })
      .from(questionOccurrenceQualifiers)
      .where(eq(questionOccurrenceQualifiers.occurrenceId, row.id))
      .orderBy(asc(questionOccurrenceQualifiers.position))
      .all()
      .map(({ value }) => value);
    return { ...toOccurrence(row), branches, qualifiers };
  }
}

function assertMaterializationPlan(plan: QuestionMaterializationPlan): void {
  const packageId = plan.package.id;
  if (!plan.actor.actorUserId || !["OWNER", "ADMIN"].includes(plan.actor.actorRole)) {
    invalid("An authenticated Admin actor is required.");
  }
  if (plan.package.updatedBy !== plan.actor.actorUserId) {
    invalid("Question Package attribution does not match the authenticated actor.");
  }
  assertHierarchy(plan.taxonomy, packageId, "Taxonomy");
  assertHierarchy(plan.browseNodes, packageId, "Bank Browse");
  const taxonomyIds = new Set(plan.taxonomy.map((node) => node.id));
  plan.browseNodes.forEach((node) => {
    if (node.taxonomyNodeId && !taxonomyIds.has(node.taxonomyNodeId)) {
      invalid("Bank Browse target must belong to the same Package.");
    }
  });
  plan.assetBindings.forEach((binding) => {
    if (binding.packageId !== packageId) invalid("Asset binding Package mismatch.");
  });
  plan.questions.forEach((question) => {
    if (question.packageId !== packageId) invalid("Question Package mismatch.");
    if (question.sharedAnswer) assertCanonicalRichDocument(question.sharedAnswer);
    const variantIds = new Set(question.variants.map((variant) => variant.id));
    if (!variantIds.has(question.primaryVariantId)) {
      invalid("Primary Variant must belong to the same Question.");
    }
    if (question.taxonomyAssignments.filter((item) => item.role === "PRIMARY").length !== 1) {
      invalid("A Question must have exactly one PRIMARY taxonomy assignment.");
    }
    question.taxonomyAssignments.forEach((assignment) => {
      if (
        assignment.packageId !== packageId ||
        assignment.questionId !== question.id ||
        !taxonomyIds.has(assignment.taxonomyNodeId)
      ) invalid("Question taxonomy assignment crosses aggregate ownership.");
    });
    question.variants.forEach((variant) => {
      if (variant.questionId !== question.id) invalid("Variant Question mismatch.");
      assertCanonicalRichDocument(variant.content, true);
      variant.occurrences.forEach((occurrence) => {
        if (occurrence.variantId !== variant.id) invalid("Occurrence Variant mismatch.");
      });
    });
  });
}

function assertHierarchy<T extends { id: string; packageId: string; parentId: string | null }>(
  nodes: readonly T[],
  packageId: string,
  label: string,
): void {
  const ids = new Set(nodes.map((node) => node.id));
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  nodes.forEach((node) => {
    if (node.packageId !== packageId) invalid(`${label} Package mismatch.`);
    if (node.parentId && !ids.has(node.parentId)) invalid(`${label} parent is outside the Package.`);
    const seen = new Set<string>();
    let current: string | null = node.id;
    while (current) {
      if (seen.has(current)) invalid(`${label} hierarchy contains a cycle.`);
      seen.add(current);
      current = parents.get(current) ?? null;
    }
  });
}

function hierarchyInsertOrder<T extends { id: string; parentId: string | null }>(
  nodes: readonly T[],
): T[] {
  const pending = [...nodes];
  const inserted = new Set<string>();
  const ordered: T[] = [];
  while (pending.length) {
    const index = pending.findIndex(
      (node) => node.parentId === null || inserted.has(node.parentId),
    );
    if (index < 0) invalid("Hierarchy cannot be inserted because its parent graph is invalid.");
    const [node] = pending.splice(index, 1);
    ordered.push(node);
    inserted.add(node.id);
  }
  return ordered;
}

function toPackage(row: QuestionPackageRow): QuestionPackageEntity {
  return { ...row };
}

function toTaxonomyNode(row: QuestionTaxonomyNodeRow): QuestionTaxonomyNodeEntity {
  return { ...row };
}

function toBrowseNode(row: QuestionBankBrowseNodeRow): QuestionBrowseNodeEntity {
  return { ...row };
}

function toQuestion(row: QuestionRow): Omit<QuestionAggregate, "primaryVariantId" | "taxonomyAssignments" | "variants"> {
  return { ...row };
}

function toVariant(row: QuestionVariantRow): QuestionVariantEntity {
  return { ...row };
}

function toOccurrence(row: QuestionOccurrenceRow): Omit<QuestionOccurrenceEntity, "branches" | "qualifiers"> {
  return { ...row };
}

function toAssignment(row: QuestionTaxonomyAssignmentRow): QuestionTaxonomyAssignmentEntity {
  return { ...row };
}

function toAssetBinding(row: QuestionPackageAssetBindingRow): QuestionPackageAssetBindingEntity {
  return { ...row };
}

function mapConstraintError(error: unknown): QuestionDomainError {
  if (error instanceof QuestionDomainError) return error;
  const code =
    error instanceof Error && "code" in error
      ? String((error as Error & { code?: unknown }).code)
      : "";
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return new QuestionDomainError(
      "QUESTION_DOMAIN_DUPLICATE",
      "Question domain identity or ordering already exists.",
      error,
    );
  }
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    return new QuestionDomainError(
      "QUESTION_DOMAIN_VALIDATION_FAILED",
      "Question domain relational integrity rejected the materialization.",
      error,
    );
  }
  return new QuestionDomainError(
    "QUESTION_DOMAIN_VALIDATION_FAILED",
    "Question Package materialization failed and was rolled back.",
    error,
  );
}

function invalid(message: string): never {
  throw new QuestionDomainError("QUESTION_DOMAIN_VALIDATION_FAILED", message);
}
