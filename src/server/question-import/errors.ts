export class QuestionImportError extends Error {
  constructor(
    readonly code:
      | "QUESTION_IMPORT_NOT_FOUND"
      | "QUESTION_IMPORT_INELIGIBLE"
      | "QUESTION_IMPORT_ACKNOWLEDGEMENT_REQUIRED"
      | "QUESTION_IMPORT_CONFLICT"
      | "QUESTION_IMPORT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "QuestionImportError";
  }
}

export function isQuestionImportError(value: unknown): value is QuestionImportError {
  return value instanceof QuestionImportError;
}
