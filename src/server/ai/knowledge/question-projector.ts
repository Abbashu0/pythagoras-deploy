import { createHash } from "node:crypto";
import type { ContentDatabase } from "../../content/database";
import type { QuestionAggregate } from "../../questions/contracts";
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
    return aggregate.questions.flatMap((question) => this.projectQuestion(question, input.subjectKey, aggregate.package.revision, aggregate.package.contentRevision));
  }

  projectQuestion(question: QuestionAggregate, subjectKey: string, questionPackageRevision = question.revision, questionPackageContentRevision = question.revision): AIQuestionKnowledgeProjection[] {
    return question.variants.map((variant) => ({
      projectionId: projectionId(question.packageId, questionPackageRevision, question.id, variant.id),
      subjectKey,
      questionPackageId: question.packageId,
      questionPackageRevision,
      questionPackageContentRevision,
      questionId: question.id,
      questionDisplayOrder: question.displayOrder,
      variantId: variant.id,
      variantDisplayOrder: variant.displayOrder,
      isPrimaryVariant: question.primaryVariantId === variant.id,
      formulation: variant.content,
      sharedAnswer: question.sharedAnswer,
      occurrences: variant.occurrences,
      taxonomyAssignments: question.taxonomyAssignments,
    }));
  }
}

export function createQuestionKnowledgeProjector(database: ContentDatabase): QuestionKnowledgeProjector {
  return new SQLiteQuestionKnowledgeProjector(database);
}

function projectionId(packageId: string, packageRevision: number, questionId: string, variantId: string): string {
  const digest = createHash("sha256").update(`pythagoras.question-knowledge.v1|${packageId}|${packageRevision}|${questionId}|${variantId}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
