import { createHash } from "node:crypto";
import type { ContentDatabase } from "../../content/database";
import type { QuestionAggregate, QuestionPackageEntity } from "../../questions/contracts";
import { SQLiteQuestionRepository } from "../../questions/sqlite-question-repository";
import type { AIQuestionKnowledgeProjection, QuestionKnowledgeProjector } from "./contracts";
import { AIKnowledgeError } from "./errors";

/**
 * Read-only bridge from already-published canonical Question data to a future
 * Knowledge projection. It deliberately writes no Knowledge rows.
 */
export class SQLiteQuestionKnowledgeProjector implements QuestionKnowledgeProjector {
  private readonly questions: SQLiteQuestionRepository;

  constructor(private readonly database: ContentDatabase) {
    this.questions = new SQLiteQuestionRepository(database);
  }

  projectPackage(input: { packageId: string; subjectKey: string }): AIQuestionKnowledgeProjection[] {
    const aggregate = this.questions.getPackageAggregate(input.packageId);
    if (!aggregate) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_NOT_FOUND", "The canonical Question Package was not found.");
    if (aggregate.package.subjectKey !== input.subjectKey) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "Question Knowledge projection subject does not match the canonical Question Package.");
    return aggregate.questions.flatMap((question) => this.projectResolvedQuestion(question, aggregate.package));
  }

  projectQuestionById(input: { questionId: string; subjectKey: string }): AIQuestionKnowledgeProjection[] {
    const question = this.questions.getQuestion(input.questionId);
    if (!question) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The canonical Question was not found.");
    const questionPackage = this.questions.getPackage(question.packageId);
    if (!questionPackage) throw new AIKnowledgeError("AI_KNOWLEDGE_PACKAGE_NOT_FOUND", "The canonical Question Package was not found.");
    if (questionPackage.subjectKey !== input.subjectKey) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "Question Knowledge projection subject does not match the canonical Question Package.");
    return this.projectResolvedQuestion(question, questionPackage);
  }

  private projectResolvedQuestion(question: QuestionAggregate, questionPackage: QuestionPackageEntity): AIQuestionKnowledgeProjection[] {
    const questionPackageRevision = questionPackage.revision;
    const questionPackageContentRevision = questionPackage.contentRevision;
    return question.variants.map((variant) => ({
      projectionId: projectionId(question.packageId, question.id, variant.id),
      subjectKey: questionPackage.subjectKey,
      questionPackageId: question.packageId,
      questionPackageRevision,
      questionPackageContentRevision,
      questionId: question.id,
      questionDisplayOrder: question.displayOrder,
      questionRevision: question.revision,
      variantId: variant.id,
      variantDisplayOrder: variant.displayOrder,
      variantRevision: variant.revision,
      isPrimaryVariant: question.primaryVariantId === variant.id,
      formulation: variant.content,
      sharedAnswer: question.sharedAnswer,
      occurrences: variant.occurrences,
      taxonomyAssignments: question.taxonomyAssignments,
      projectionRevisionFingerprint: projectionRevisionFingerprint(questionPackage, question, variant),
    }));
  }
}

export function createQuestionKnowledgeProjector(database: ContentDatabase): QuestionKnowledgeProjector {
  return new SQLiteQuestionKnowledgeProjector(database);
}

function projectionId(packageId: string, questionId: string, variantId: string): string {
  const digest = createHash("sha256").update(`pythagoras.question-knowledge.v1|${packageId}|${questionId}|${variantId}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function projectionRevisionFingerprint(questionPackage: QuestionPackageEntity, question: QuestionAggregate, variant: QuestionAggregate["variants"][number]): string {
  const safeMetadata = {
    questionPackageId: questionPackage.id,
    questionPackageRevision: questionPackage.revision,
    questionPackageContentRevision: questionPackage.contentRevision,
    questionId: question.id,
    questionDisplayOrder: question.displayOrder,
    questionRevision: question.revision,
    primaryVariantId: question.primaryVariantId,
    variantId: variant.id,
    variantDisplayOrder: variant.displayOrder,
    variantRevision: variant.revision,
    occurrenceRevisions: variant.occurrences
      .map((occurrence) => ({ id: occurrence.id, revision: occurrence.revision, displayOrder: occurrence.displayOrder }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    taxonomyAssignments: question.taxonomyAssignments
      .map((assignment) => ({ questionId: assignment.questionId, taxonomyNodeId: assignment.taxonomyNodeId, packageId: assignment.packageId, role: assignment.role, position: assignment.position }))
      .sort((left, right) => left.taxonomyNodeId.localeCompare(right.taxonomyNodeId) || left.position - right.position),
  };
  return createHash("sha256").update(JSON.stringify(safeMetadata)).digest("hex");
}
