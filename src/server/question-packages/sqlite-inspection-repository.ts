import { eq } from "drizzle-orm";
import type { ContentDatabase } from "../content/database";
import {
  questionPackageInspections,
  type QuestionPackageInspectionRow,
} from "../content/schema";
import type { QuestionPackageInspection } from "./contracts";

export interface StoreQuestionPackageInspectionInput
  extends QuestionPackageInspection {
  assetId: string;
  sourceSha256: string;
  inspectorVersion: number;
}

export class SQLiteQuestionPackageInspectionRepository {
  constructor(private readonly database: ContentDatabase) {}

  findByAssetId(assetId: string): QuestionPackageInspectionRow | null {
    return (
      this.database.db
        .select()
        .from(questionPackageInspections)
        .where(eq(questionPackageInspections.assetId, assetId))
        .get() ?? null
    );
  }

  store(input: StoreQuestionPackageInspectionInput): QuestionPackageInspectionRow {
    this.database.db
      .insert(questionPackageInspections)
      .values(input)
      .onConflictDoUpdate({
        target: questionPackageInspections.assetId,
        set: {
          sourceSha256: input.sourceSha256,
          status: input.status,
          format: input.format,
          schemaVersion: input.schemaVersion,
          packageId: input.packageId,
          packageKey: input.packageKey,
          title: input.title,
          subjectKey: input.subjectKey,
          questionCount: input.questionCount,
          variantCount: input.variantCount,
          errorCount: input.errorCount,
          warningCount: input.warningCount,
          diagnostics: input.diagnostics,
          inspectorVersion: input.inspectorVersion,
          inspectedAt: input.inspectedAt,
        },
      })
      .run();
    const stored = this.findByAssetId(input.assetId);
    if (!stored) throw new Error("Question Package inspection was not persisted.");
    return stored;
  }
}
