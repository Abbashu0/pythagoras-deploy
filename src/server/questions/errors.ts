export type QuestionDomainErrorCode =
  | "QUESTION_PACKAGE_INELIGIBLE"
  | "QUESTION_ASSET_UNRESOLVED"
  | "QUESTION_DOMAIN_VALIDATION_FAILED"
  | "QUESTION_DOMAIN_DUPLICATE"
  | "QUESTION_DOMAIN_NOT_FOUND"
  | "QUESTION_DOMAIN_CONFLICT";

export class QuestionDomainError extends Error {
  constructor(
    readonly code: QuestionDomainErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "QuestionDomainError";
  }
}

export class QuestionDomainConflictError extends QuestionDomainError {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      "QUESTION_DOMAIN_CONFLICT",
      `Question entity revision conflict: expected ${expectedRevision}, found ${actualRevision}.`,
    );
    this.name = "QuestionDomainConflictError";
  }
}

export function isQuestionDomainError(value: unknown): value is QuestionDomainError {
  return value instanceof QuestionDomainError;
}
