import { and, asc, eq, sql } from "drizzle-orm";
import type { AdminActor } from "../admin-auth/contracts";
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
  QuestionBrowseContent,
  QuestionBrowseNodeEntity,
  QuestionItemContent,
  QuestionMaterializationPlan,
  QuestionOccurrenceEntity,
  QuestionPackageAggregate,
  QuestionPackageAssetBindingEntity,
  QuestionPackageContent,
  QuestionPackageEntity,
  QuestionRepository,
  QuestionTaxonomyContent,
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
      this.database.client
        .transaction(() => this.applyMaterializationPlanInTransaction(plan, null))
        .immediate();
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

  /** Apply a create or additive/non-destructive update inside the caller's transaction. */
  applyMaterializationPlanInTransaction(
    plan: QuestionMaterializationPlan,
    current: QuestionPackageAggregate | null,
  ): void {
    assertMaterializationPlan(plan);
    if (!current) {
      this.insertMaterializationPlanInTransaction(plan);
      return;
    }

    if (current.package.id !== plan.package.id) {
      invalid("Question Package identity is immutable after creation.");
    }
    if (plan.package.contentRevision < current.package.contentRevision) {
      invalid("Question Package contentRevision cannot decrease.");
    }

    const currentBindings = this.listAssetBindings(plan.package.id).map(
      ({ packageId: _packageId, ...binding }) => binding,
    );
    const nextBindings = plan.assetBindings.map(
      ({ packageId: _packageId, ...binding }) => binding,
    );
    if (
      plan.package.contentRevision === current.package.contentRevision &&
      !sameJson(currentBindings, nextBindings)
    ) {
      invalid("Question Package source provenance requires a newer contentRevision.");
    }

    const updatedPackage = this.database.db
      .update(questionPackages)
      .set({
        packageKey: plan.package.packageKey,
        title: plan.package.title,
        subjectKey: plan.package.subjectKey,
        language: plan.package.language,
        contentRevision: plan.package.contentRevision,
        bankBrowseMode: plan.package.bankBrowseMode,
        bankBrowseEntryKey: plan.package.bankBrowseEntryKey,
        bankBrowseEntryLabel: plan.package.bankBrowseEntryLabel,
        bankBrowseEntryOrder: plan.package.bankBrowseEntryOrder,
        sourceAssetId: plan.package.sourceAssetId,
        updatedAt: plan.package.updatedAt,
        updatedBy: plan.actor.actorUserId,
        revision: sql`${questionPackages.revision} + 1`,
      })
      .where(
        and(
          eq(questionPackages.id, plan.package.id),
          eq(questionPackages.revision, current.package.revision),
        ),
      )
      .returning({ id: questionPackages.id })
      .get();
    if (!updatedPackage) {
      throw new QuestionDomainConflictError(
        current.package.revision,
        this.requirePackage(plan.package.id).revision,
      );
    }

    this.database.db
      .delete(questionPackageAssetBindings)
      .where(eq(questionPackageAssetBindings.packageId, plan.package.id))
      .run();
    if (plan.assetBindings.length) {
      this.database.db
        .insert(questionPackageAssetBindings)
        .values(plan.assetBindings)
        .run();
    }

    const currentTaxonomy = new Map(current.taxonomy.map((node) => [node.id, node]));
    for (const node of hierarchyInsertOrder(plan.taxonomy)) {
      const existing = currentTaxonomy.get(node.id);
      const content: QuestionTaxonomyContent = {
        packageId: node.packageId,
        nodeKey: node.nodeKey,
        label: node.label,
        kind: node.kind,
        parentId: node.parentId,
        displayOrder: node.displayOrder,
      };
      if (existing) {
        this.updateTaxonomyNode({
          id: node.id,
          content,
          expectedRevision: existing.revision,
          actor: plan.actor,
        });
      } else {
        this.createTaxonomyNode({ id: node.id, content, actor: plan.actor });
      }
    }

    const currentBrowse = new Map(current.browseNodes.map((node) => [node.id, node]));
    for (const node of hierarchyInsertOrder(plan.browseNodes)) {
      const existing = currentBrowse.get(node.id);
      const content: QuestionBrowseContent = {
        packageId: node.packageId,
        nodeKey: node.nodeKey,
        label: node.label,
        nodeType: node.nodeType,
        parentId: node.parentId,
        displayOrder: node.displayOrder,
        taxonomyNodeId: node.taxonomyNodeId,
        includeDescendants: node.includeDescendants,
      };
      if (existing) {
        this.updateBrowseNode({
          id: node.id,
          content,
          expectedRevision: existing.revision,
          actor: plan.actor,
        });
      } else {
        this.createBrowseNode({ id: node.id, content, actor: plan.actor });
      }
    }

    const currentQuestions = new Map(current.questions.map((question) => [question.id, question]));
    for (const question of plan.questions) {
      const existing = currentQuestions.get(question.id);
      const content: QuestionItemContent = {
        packageId: question.packageId,
        displayOrder: question.displayOrder,
        primaryVariantId: question.primaryVariantId,
        taxonomyAssignments: question.taxonomyAssignments.map(({ questionId: _questionId, ...assignment }) => assignment),
        variants: question.variants.map((variant) => ({
          id: variant.id,
          displayOrder: variant.displayOrder,
          content: variant.content,
          occurrences: variant.occurrences.map(({ variantId: _variantId, createdAt: _createdAt, updatedAt: _updatedAt, updatedBy: _updatedBy, revision: _revision, ...occurrence }) => occurrence),
        })),
        sharedAnswer: question.sharedAnswer,
      };
      if (existing) {
        this.updateQuestionAggregate({
          id: question.id,
          content,
          expectedRevision: existing.revision,
          actor: plan.actor,
        });
      } else {
        this.createQuestionAggregate({ id: question.id, content, actor: plan.actor });
      }
    }
  }

  private insertMaterializationPlanInTransaction(plan: QuestionMaterializationPlan): void {
    this.database.db.insert(questionPackages).values(plan.package).run();
    for (const node of hierarchyInsertOrder(plan.taxonomy)) {
      this.database.db.insert(questionTaxonomyNodes).values(node).run();
    }
    for (const node of hierarchyInsertOrder(plan.browseNodes)) {
      this.database.db.insert(questionBankBrowseNodes).values(node).run();
    }
    if (plan.assetBindings.length) {
      this.database.db.insert(questionPackageAssetBindings).values(plan.assetBindings).run();
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
              occurrence.branches.map((value, position) => ({ occurrenceId: occurrence.id, position, value })),
            ).run();
          }
          if (occurrence.qualifiers.length) {
            this.database.db.insert(questionOccurrenceQualifiers).values(
              occurrence.qualifiers.map((value, position) => ({ occurrenceId: occurrence.id, position, value })),
            ).run();
          }
        }
      }
      this.database.db.insert(questionPrimaryVariants).values({ questionId: question.id, variantId: question.primaryVariantId }).run();
      this.database.db.insert(questionTaxonomyAssignments).values(question.taxonomyAssignments).run();
    }
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

  createPackage(input: { id: string; content: QuestionPackageContent; actor: AdminActor }): QuestionPackageEntity {
    assertMutationActor(input.actor);
    const now = this.clock();
    try {
      this.database.client.transaction(() => {
        const { assetBindings, ...packageContent } = input.content;
        this.database.db.insert(questionPackages).values({
          id: input.id,
          ...packageContent,
          createdAt: now,
          updatedAt: now,
          updatedBy: input.actor.actorUserId,
          revision: 1,
        }).run();
        if (assetBindings.length) {
          this.database.db.insert(questionPackageAssetBindings).values(
            assetBindings.map((binding) => ({ ...binding, packageId: input.id })),
          ).run();
        }
      })();
    } catch (error) {
      throw mapConstraintError(error);
    }
    return this.requirePackage(input.id);
  }

  updatePackage(input: { id: string; content: QuestionPackageContent; expectedRevision: number; actor: AdminActor }): QuestionPackageEntity {
    assertMutationActor(input.actor);
    const current = this.requirePackage(input.id);
    const currentBindings = this.listAssetBindings(input.id).map(({ packageId: _packageId, ...binding }) => binding);
    if (current.packageKey !== input.content.packageKey || current.subjectKey !== input.content.subjectKey || current.language !== input.content.language) {
      invalid("Question Package identity is immutable after creation.");
    }
    if (input.content.contentRevision < current.contentRevision) {
      invalid("Question Package contentRevision cannot decrease.");
    }
    const provenanceChanged = current.sourceAssetId !== input.content.sourceAssetId || JSON.stringify(currentBindings) !== JSON.stringify(input.content.assetBindings);
    if (input.content.contentRevision === current.contentRevision && provenanceChanged) {
      invalid("Question Package source provenance can change only with a newer contentRevision.");
    }
    let updated;
    try {
      this.database.client.transaction(() => {
        updated = this.database.db.update(questionPackages).set({
          title: input.content.title,
          contentRevision: input.content.contentRevision,
          bankBrowseMode: input.content.bankBrowseMode,
          bankBrowseEntryKey: input.content.bankBrowseEntryKey,
          bankBrowseEntryLabel: input.content.bankBrowseEntryLabel,
          bankBrowseEntryOrder: input.content.bankBrowseEntryOrder,
          sourceAssetId: input.content.sourceAssetId,
          updatedAt: this.clock(),
          updatedBy: input.actor.actorUserId,
          revision: sql`${questionPackages.revision} + 1`,
        }).where(and(eq(questionPackages.id, input.id), eq(questionPackages.revision, input.expectedRevision))).returning().get();
        if (!updated) throw new QuestionDomainConflictError(input.expectedRevision, this.requirePackage(input.id).revision);
        this.database.db.delete(questionPackageAssetBindings).where(eq(questionPackageAssetBindings.packageId, input.id)).run();
        if (input.content.assetBindings.length) {
          this.database.db.insert(questionPackageAssetBindings).values(
            input.content.assetBindings.map((binding) => ({ ...binding, packageId: input.id })),
          ).run();
        }
      })();
    } catch (error) {
      if (error instanceof QuestionDomainConflictError) throw error;
      throw mapConstraintError(error);
    }
    return toPackage(updated);
  }

  createTaxonomyNode(input: { id: string; content: QuestionTaxonomyContent; actor: AdminActor }): QuestionTaxonomyNodeEntity {
    assertMutationActor(input.actor);
    const now = this.clock();
    try {
      this.database.db.insert(questionTaxonomyNodes).values({ id: input.id, ...input.content, createdAt: now, updatedAt: now, updatedBy: input.actor.actorUserId, revision: 1 }).run();
    } catch (error) { throw mapConstraintError(error); }
    return this.requireTaxonomyNode(input.id);
  }

  updateTaxonomyNode(input: { id: string; content: QuestionTaxonomyContent; expectedRevision: number; actor: AdminActor }): QuestionTaxonomyNodeEntity {
    assertMutationActor(input.actor);
    const current = this.requireTaxonomyNode(input.id);
    if (current.packageId !== input.content.packageId) invalid("Taxonomy Package ownership is immutable.");
    let updated;
    try {
      updated = this.database.db.update(questionTaxonomyNodes).set({ ...input.content, updatedAt: this.clock(), updatedBy: input.actor.actorUserId, revision: sql`${questionTaxonomyNodes.revision} + 1` })
        .where(and(eq(questionTaxonomyNodes.id, input.id), eq(questionTaxonomyNodes.revision, input.expectedRevision))).returning().get();
    } catch (error) { throw mapConstraintError(error); }
    if (!updated) throw new QuestionDomainConflictError(input.expectedRevision, this.requireTaxonomyNode(input.id).revision);
    return toTaxonomyNode(updated);
  }

  createBrowseNode(input: { id: string; content: QuestionBrowseContent; actor: AdminActor }): QuestionBrowseNodeEntity {
    assertMutationActor(input.actor);
    const now = this.clock();
    try {
      this.database.db.insert(questionBankBrowseNodes).values({ id: input.id, ...input.content, createdAt: now, updatedAt: now, updatedBy: input.actor.actorUserId, revision: 1 }).run();
    } catch (error) { throw mapConstraintError(error); }
    return this.requireBrowseNode(input.id);
  }

  updateBrowseNode(input: { id: string; content: QuestionBrowseContent; expectedRevision: number; actor: AdminActor }): QuestionBrowseNodeEntity {
    assertMutationActor(input.actor);
    const current = this.requireBrowseNode(input.id);
    if (current.packageId !== input.content.packageId) invalid("Bank Browse Package ownership is immutable.");
    let updated;
    try {
      updated = this.database.db.update(questionBankBrowseNodes).set({ ...input.content, updatedAt: this.clock(), updatedBy: input.actor.actorUserId, revision: sql`${questionBankBrowseNodes.revision} + 1` })
        .where(and(eq(questionBankBrowseNodes.id, input.id), eq(questionBankBrowseNodes.revision, input.expectedRevision))).returning().get();
    } catch (error) { throw mapConstraintError(error); }
    if (!updated) throw new QuestionDomainConflictError(input.expectedRevision, this.requireBrowseNode(input.id).revision);
    return toBrowseNode(updated);
  }

  createQuestionAggregate(input: { id: string; content: QuestionItemContent; actor: AdminActor }): QuestionAggregate {
    assertMutationActor(input.actor);
    const now = this.clock();
    try {
      this.database.db.insert(questions).values({ id: input.id, packageId: input.content.packageId, displayOrder: input.content.displayOrder, sharedAnswer: input.content.sharedAnswer, createdAt: now, updatedAt: now, updatedBy: input.actor.actorUserId, revision: 1 }).run();
      this.insertQuestionChildren(input.id, input.content, input.actor, now);
    } catch (error) { throw mapConstraintError(error); }
    return this.requireQuestion(input.id);
  }

  updateQuestionAggregate(input: { id: string; content: QuestionItemContent; expectedRevision: number; actor: AdminActor }): QuestionAggregate {
    assertMutationActor(input.actor);
    const current = this.requireQuestion(input.id);
    if (current.revision !== input.expectedRevision) {
      throw new QuestionDomainConflictError(input.expectedRevision, current.revision);
    }
    if (current.packageId !== input.content.packageId) invalid("Question Package ownership is immutable.");
    assertNoImplicitChildDeletion(current, input.content);
    const now = this.clock();

    const changedVariantOrders = current.variants.filter((variant) => {
      const proposed = input.content.variants.find((candidate) => candidate.id === variant.id);
      return proposed && proposed.displayOrder !== variant.displayOrder;
    });
    const temporaryOrderBase = Math.max(10_000, ...current.variants.map((variant) => variant.displayOrder), ...input.content.variants.map((variant) => variant.displayOrder)) + 1;
    changedVariantOrders.forEach((variant, index) => {
      this.database.db.update(questionVariants).set({ displayOrder: temporaryOrderBase + index }).where(eq(questionVariants.id, variant.id)).run();
    });

    for (const proposed of input.content.variants) {
      const existing = current.variants.find((variant) => variant.id === proposed.id);
      if (!existing) {
        this.database.db.insert(questionVariants).values({ id: proposed.id, questionId: input.id, displayOrder: proposed.displayOrder, content: proposed.content, createdAt: now, updatedAt: now, updatedBy: input.actor.actorUserId, revision: 1 }).run();
      } else if (existing.displayOrder !== proposed.displayOrder || !sameJson(existing.content, proposed.content)) {
        this.database.db.update(questionVariants).set({ displayOrder: proposed.displayOrder, content: proposed.content, updatedAt: now, updatedBy: input.actor.actorUserId, revision: sql`${questionVariants.revision} + 1` }).where(and(eq(questionVariants.id, proposed.id), eq(questionVariants.questionId, input.id))).run();
      }
      this.updateOccurrences(proposed.id, existing?.occurrences ?? [], proposed.occurrences, input.actor, now);
    }

    this.database.db.delete(questionPrimaryVariants).where(eq(questionPrimaryVariants.questionId, input.id)).run();
    this.database.db.insert(questionPrimaryVariants).values({ questionId: input.id, variantId: input.content.primaryVariantId }).run();
    this.database.db.delete(questionTaxonomyAssignments).where(eq(questionTaxonomyAssignments.questionId, input.id)).run();
    this.insertAssignments(input.id, input.content);

    const updated = this.database.db.update(questions).set({ displayOrder: input.content.displayOrder, sharedAnswer: input.content.sharedAnswer, updatedAt: now, updatedBy: input.actor.actorUserId, revision: sql`${questions.revision} + 1` })
      .where(and(eq(questions.id, input.id), eq(questions.revision, input.expectedRevision))).returning().get();
    if (!updated) throw new QuestionDomainConflictError(input.expectedRevision, this.requireQuestion(input.id).revision);
    return this.requireQuestion(input.id);
  }

  private insertQuestionChildren(questionId: string, content: QuestionItemContent, actor: AdminActor, now: number): void {
    for (const variant of content.variants) {
      this.database.db.insert(questionVariants).values({ id: variant.id, questionId, displayOrder: variant.displayOrder, content: variant.content, createdAt: now, updatedAt: now, updatedBy: actor.actorUserId, revision: 1 }).run();
      for (const occurrence of variant.occurrences) this.insertOccurrence(variant.id, occurrence, actor, now);
    }
    this.database.db.insert(questionPrimaryVariants).values({ questionId, variantId: content.primaryVariantId }).run();
    this.insertAssignments(questionId, content);
  }

  private insertAssignments(questionId: string, content: QuestionItemContent): void {
    if (!content.taxonomyAssignments.length) return;
    this.database.db.insert(questionTaxonomyAssignments).values(content.taxonomyAssignments.map((assignment) => ({ questionId, packageId: content.packageId, ...assignment }))).run();
  }

  private insertOccurrence(variantId: string, occurrence: QuestionItemContent["variants"][number]["occurrences"][number], actor: AdminActor, now: number): void {
    const { branches, qualifiers, ...row } = occurrence;
    this.database.db.insert(questionOccurrences).values({ ...row, variantId, createdAt: now, updatedAt: now, updatedBy: actor.actorUserId, revision: 1 }).run();
    this.replaceOccurrenceValues(occurrence.id, branches, qualifiers);
  }

  private updateOccurrences(variantId: string, current: QuestionOccurrenceEntity[], proposed: QuestionItemContent["variants"][number]["occurrences"], actor: AdminActor, now: number): void {
    const changedOrders = current.filter((occurrence) => {
      const next = proposed.find((candidate) => candidate.id === occurrence.id);
      return next && next.displayOrder !== occurrence.displayOrder;
    });
    const temporaryOrderBase = Math.max(10_000, ...current.map((item) => item.displayOrder), ...proposed.map((item) => item.displayOrder)) + 1;
    changedOrders.forEach((occurrence, index) => {
      this.database.db.update(questionOccurrences).set({ displayOrder: temporaryOrderBase + index }).where(eq(questionOccurrences.id, occurrence.id)).run();
    });
    for (const occurrence of proposed) {
      const existing = current.find((candidate) => candidate.id === occurrence.id);
      if (!existing) {
        this.insertOccurrence(variantId, occurrence, actor, now);
        continue;
      }
      const { branches, qualifiers, ...row } = occurrence;
      const changed = !sameJson(stripOccurrenceMetadata(existing), occurrence);
      if (!changed) continue;
      this.database.db.update(questionOccurrences).set({ ...row, variantId, updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${questionOccurrences.revision} + 1` }).where(and(eq(questionOccurrences.id, occurrence.id), eq(questionOccurrences.variantId, variantId))).run();
      this.replaceOccurrenceValues(occurrence.id, branches, qualifiers);
    }
  }

  private replaceOccurrenceValues(occurrenceId: string, branches: string[], qualifiers: string[]): void {
    this.database.db.delete(questionOccurrenceBranches).where(eq(questionOccurrenceBranches.occurrenceId, occurrenceId)).run();
    this.database.db.delete(questionOccurrenceQualifiers).where(eq(questionOccurrenceQualifiers.occurrenceId, occurrenceId)).run();
    if (branches.length) this.database.db.insert(questionOccurrenceBranches).values(branches.map((value, position) => ({ occurrenceId, position, value }))).run();
    if (qualifiers.length) this.database.db.insert(questionOccurrenceQualifiers).values(qualifiers.map((value, position) => ({ occurrenceId, position, value }))).run();
  }

  private requirePackage(id: string): QuestionPackageEntity {
    const value = this.getPackage(id);
    if (!value) throw new QuestionDomainError("QUESTION_DOMAIN_NOT_FOUND", "Question Package was not found.");
    return value;
  }

  private requireTaxonomyNode(id: string): QuestionTaxonomyNodeEntity {
    const row = this.database.db.select().from(questionTaxonomyNodes).where(eq(questionTaxonomyNodes.id, id)).get();
    if (!row) throw new QuestionDomainError("QUESTION_DOMAIN_NOT_FOUND", "Question taxonomy node was not found.");
    return toTaxonomyNode(row);
  }

  private requireBrowseNode(id: string): QuestionBrowseNodeEntity {
    const row = this.database.db.select().from(questionBankBrowseNodes).where(eq(questionBankBrowseNodes.id, id)).get();
    if (!row) throw new QuestionDomainError("QUESTION_DOMAIN_NOT_FOUND", "Question Bank Browse node was not found.");
    return toBrowseNode(row);
  }

  private requireQuestion(id: string): QuestionAggregate {
    const value = this.getQuestion(id);
    if (!value) throw new QuestionDomainError("QUESTION_DOMAIN_NOT_FOUND", "Question was not found.");
    return value;
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

function assertMutationActor(actor: AdminActor): void {
  if (!actor.actorUserId?.trim() || !["OWNER", "ADMIN"].includes(actor.actorRole)) {
    invalid("An authenticated Admin actor is required.");
  }
}

function assertNoImplicitChildDeletion(current: QuestionAggregate, proposed: QuestionItemContent): void {
  const proposedVariants = new Map(proposed.variants.map((variant) => [variant.id, variant]));
  for (const variant of current.variants) {
    const next = proposedVariants.get(variant.id);
    if (!next) invalid("Existing Question Variants cannot be removed by omission.");
    const occurrenceIds = new Set(next.occurrences.map((occurrence) => occurrence.id));
    if (variant.occurrences.some((occurrence) => !occurrenceIds.has(occurrence.id))) {
      invalid("Existing Question occurrences cannot be removed by omission.");
    }
  }
}

function stripOccurrenceMetadata(value: QuestionOccurrenceEntity): QuestionItemContent["variants"][number]["occurrences"][number] {
  return {
    id: value.id,
    displayOrder: value.displayOrder,
    sourceKind: value.sourceKind,
    year: value.year,
    roundCode: value.roundCode,
    session: value.session,
    sourceName: value.sourceName,
    notes: value.notes,
    rawLabel: value.rawLabel,
    branches: value.branches,
    qualifiers: value.qualifiers,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
