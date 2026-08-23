import { createAssetService, getAssetService } from "../assets";
import {
  createCanonicalContentRepository,
  getCanonicalContentRepository,
} from "../canonical-content";
import { getContentDatabase, type ContentDatabase } from "../content";
import { QuestionPackageInspectionService } from "./inspection-service";

export function createQuestionPackageInspectionService(
  database: ContentDatabase,
): QuestionPackageInspectionService {
  return new QuestionPackageInspectionService(
    database,
    createAssetService(database),
    createCanonicalContentRepository(database),
  );
}

type QuestionPackageGlobal = typeof globalThis & {
  __pythagorasQuestionPackageInspectionService?: QuestionPackageInspectionService;
};

export function getQuestionPackageInspectionService(): QuestionPackageInspectionService {
  const target = globalThis as QuestionPackageGlobal;
  if (!target.__pythagorasQuestionPackageInspectionService) {
    target.__pythagorasQuestionPackageInspectionService = new QuestionPackageInspectionService(
      getContentDatabase(),
      getAssetService(),
      getCanonicalContentRepository(),
    );
  }
  return target.__pythagorasQuestionPackageInspectionService;
}
