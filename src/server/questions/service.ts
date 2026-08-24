import type { AdminActor } from "../admin-auth/contracts";
import { SQLiteAssetRepository } from "../assets/sqlite-asset-repository";
import { getContentDatabase, type ContentDatabase } from "../content/database";
import type { QuestionPackageValidationResult } from "../question-packages/contracts";
import { AssetLibraryQuestionPackageAssetResolver } from "./asset-resolver";
import type {
  QuestionMaterializationPlan,
  QuestionPackageAggregate,
  QuestionPackageEntity,
} from "./contracts";
import {
  getEligibleQuestionPackage,
  QuestionPackageMaterializer,
  type CreateQuestionMaterializationPlanOptions,
} from "./materializer";
import { SQLiteQuestionRepository } from "./sqlite-question-repository";

export class QuestionDomainService {
  constructor(
    private readonly repository: SQLiteQuestionRepository,
    private readonly materializer: QuestionPackageMaterializer,
  ) {}

  createMaterializationPlan(
    validation: QuestionPackageValidationResult,
    actor: AdminActor,
    options: CreateQuestionMaterializationPlanOptions = {},
  ): QuestionMaterializationPlan {
    return this.materializer.createPlan(
      getEligibleQuestionPackage(validation),
      actor,
      options,
    );
  }

  /** Internal foundation only. M9 intentionally exposes no HTTP import surface. */
  materializePlan(
    plan: QuestionMaterializationPlan,
  ): QuestionPackageAggregate {
    return this.repository.materialize(plan);
  }

  getPackageAggregate(packageId: string): QuestionPackageAggregate | null {
    return this.repository.getPackageAggregate(packageId);
  }

  listPackagesBySubject(subjectKey: string): QuestionPackageEntity[] {
    return this.repository.listPackagesBySubject(subjectKey);
  }
}

export function createQuestionDomainService(
  database: ContentDatabase,
  clock: () => number = Date.now,
): QuestionDomainService {
  const assets = new SQLiteAssetRepository(database, clock);
  return new QuestionDomainService(
    new SQLiteQuestionRepository(database, clock),
    new QuestionPackageMaterializer(
      new AssetLibraryQuestionPackageAssetResolver(assets),
      clock,
    ),
  );
}

type QuestionDomainGlobal = typeof globalThis & {
  __pythagorasQuestionDomainService?: QuestionDomainService;
};

export function getQuestionDomainService(): QuestionDomainService {
  const serviceGlobal = globalThis as QuestionDomainGlobal;
  if (!serviceGlobal.__pythagorasQuestionDomainService) {
    serviceGlobal.__pythagorasQuestionDomainService =
      createQuestionDomainService(getContentDatabase());
  }
  return serviceGlobal.__pythagorasQuestionDomainService;
}
