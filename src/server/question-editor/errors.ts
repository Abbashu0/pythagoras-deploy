export const QUESTION_EDITOR_ERROR_CODES = [
  "QUESTION_EDITOR_NOT_FOUND",
  "QUESTION_EDITOR_FORBIDDEN",
  "QUESTION_EDITOR_INVALID",
  "QUESTION_EDITOR_CONFLICT",
] as const;
export type QuestionEditorErrorCode = (typeof QUESTION_EDITOR_ERROR_CODES)[number];

export class QuestionEditorError extends Error {
  constructor(readonly code: QuestionEditorErrorCode, message: string) {
    super(message);
    this.name = "QuestionEditorError";
  }
}

export function isQuestionEditorError(error: unknown): error is QuestionEditorError {
  return error instanceof QuestionEditorError;
}
