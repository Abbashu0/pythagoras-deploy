import { getContentDatabase, type ContentDatabase } from "../content";
import { QuestionPackageImportService } from "./service";

export * from "./contracts";
export * from "./errors";
export { QuestionPackageImportService } from "./service";

export function createQuestionPackageImportService(database: ContentDatabase) {
  return new QuestionPackageImportService(database);
}

type ImportGlobal = typeof globalThis & { __pythagorasQuestionPackageImportService?: QuestionPackageImportService };
export function getQuestionPackageImportService(): QuestionPackageImportService {
  const target = globalThis as ImportGlobal;
  return target.__pythagorasQuestionPackageImportService ??= new QuestionPackageImportService(getContentDatabase());
}
