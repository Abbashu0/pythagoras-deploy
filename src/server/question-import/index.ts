import { getContentDatabase, type ContentDatabase } from "../content";
import { DirectQuestionPackageService } from "./direct-service";
import { QuestionPackageImportService } from "./service";

export * from "./contracts";
export * from "./errors";
export { QuestionPackageImportService } from "./service";
export {
  DirectQuestionPackageService,
  type DirectQuestionPackageApplyResult,
  type DirectQuestionPackageOperation,
  type PreparedDirectQuestionPackage,
} from "./direct-service";

export function createQuestionPackageImportService(database: ContentDatabase) {
  return new QuestionPackageImportService(database);
}

type ImportGlobal = typeof globalThis & { __pythagorasQuestionPackageImportService?: QuestionPackageImportService };
export function getQuestionPackageImportService(): QuestionPackageImportService {
  const target = globalThis as ImportGlobal;
  return target.__pythagorasQuestionPackageImportService ??= new QuestionPackageImportService(getContentDatabase());
}

type DirectImportGlobal = typeof globalThis & { __pythagorasDirectQuestionPackageService?: DirectQuestionPackageService };

export function createDirectQuestionPackageService(database: ContentDatabase) {
  return new DirectQuestionPackageService(database);
}

export function getDirectQuestionPackageService(): DirectQuestionPackageService {
  const target = globalThis as DirectImportGlobal;
  return target.__pythagorasDirectQuestionPackageService ??= new DirectQuestionPackageService(getContentDatabase());
}
