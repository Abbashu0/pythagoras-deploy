export class QuestionSearchError extends Error {
  constructor(
    readonly code: "QUESTION_SEARCH_EMPTY_QUERY" | "QUESTION_SEARCH_UNAVAILABLE",
    message: string,
  ) { super(message); this.name = "QuestionSearchError"; }
}

export function isQuestionSearchError(value: unknown): value is QuestionSearchError {
  return value instanceof QuestionSearchError;
}
