import type { AssetService } from "../assets";
import { MAX_JSON_INSPECTION_BYTES } from "../assets";
import type { SQLiteCanonicalContentRepository } from "../canonical-content";
import type { ContentDatabase } from "../content";
import type {
  QuestionPackageDiagnostic,
  QuestionPackageInspection,
  QuestionPackageInspectionSummary,
  QuestionPackageV1,
} from "./contracts";
import { inspectQuestionPackageJson } from "./validator";
import { SQLiteQuestionPackageInspectionRepository } from "./sqlite-inspection-repository";

export const QUESTION_PACKAGE_INSPECTOR_VERSION = 1;

export class QuestionPackageInspectionService {
  private readonly repository: SQLiteQuestionPackageInspectionRepository;

  constructor(
    database: ContentDatabase,
    private readonly assets: AssetService,
    private readonly canonicalContent: SQLiteCanonicalContentRepository,
  ) {
    this.repository = new SQLiteQuestionPackageInspectionRepository(database);
  }

  async inspectAsset(assetId: string): Promise<QuestionPackageInspection | null> {
    const asset = this.assets.getById(assetId);
    if (asset.mediaKind !== "json") return null;

    const cached = this.repository.findByAssetId(assetId);
    if (
      cached &&
      cached.sourceSha256 === asset.sha256 &&
      cached.inspectorVersion === QUESTION_PACKAGE_INSPECTOR_VERSION
    ) {
      return rowToInspection(cached);
    }

    if (asset.byteSize > MAX_JSON_INSPECTION_BYTES) {
      return this.persist(asset.id, asset.sha256, null, [
        {
          severity: "ERROR",
          code: "JSON_INSPECTION_LIMIT_EXCEEDED",
          message: "JSON asset exceeds the bounded inspection limit.",
          jsonPointer: "",
          context: { maximumBytes: MAX_JSON_INSPECTION_BYTES },
        },
      ]);
    }

    const { body } = await this.assets.openContent(assetId);
    let parsed: unknown;
    try {
      const text = await new Response(body).text();
      parsed = JSON.parse(text.replace(/^\uFEFF/u, ""));
    } catch {
      return this.persist(asset.id, asset.sha256, null, [
        {
          severity: "ERROR",
          code: "JSON_PARSE_FAILED",
          message: "JSON asset could not be parsed safely.",
          jsonPointer: "",
        },
      ]);
    }

    const subjectKeys = new Set(
      this.canonicalContent.getSnapshot().materials.map((material) => material.subjectKey),
    );
    const validation = inspectQuestionPackageJson(parsed, {
      canonicalSubjectKeys: subjectKeys,
    });
    return this.persist(
      asset.id,
      asset.sha256,
      validation.package,
      validation.diagnostics,
      validation.status,
      parsed,
    );
  }

  private persist(
    assetId: string,
    sourceSha256: string,
    questionPackage: QuestionPackageV1 | null,
    diagnostics: QuestionPackageDiagnostic[],
    status: QuestionPackageInspection["status"] = "INVALID",
    parsed?: unknown,
  ): QuestionPackageInspection {
    const marker = isRecord(parsed) ? parsed : null;
    const summary = summarizeInspection(status, questionPackage, diagnostics, marker);
    return rowToInspection(
      this.repository.store({
        assetId,
        sourceSha256,
        inspectorVersion: QUESTION_PACKAGE_INSPECTOR_VERSION,
        ...summary,
        diagnostics,
      }),
    );
  }
}

function summarizeInspection(
  status: QuestionPackageInspection["status"],
  questionPackage: QuestionPackageV1 | null,
  diagnostics: QuestionPackageDiagnostic[],
  marker: Record<string, unknown> | null,
): QuestionPackageInspectionSummary {
  const packageMetadata = questionPackage?.package;
  const markerPackage = isRecord(marker?.package) ? marker.package : null;
  return {
    status,
    format: textOrNull(questionPackage?.format ?? marker?.format),
    schemaVersion: textOrNull(questionPackage?.schemaVersion ?? marker?.schemaVersion),
    packageId: textOrNull(packageMetadata?.id ?? markerPackage?.id),
    packageKey: textOrNull(packageMetadata?.key ?? markerPackage?.key),
    title: textOrNull(packageMetadata?.title ?? markerPackage?.title),
    subjectKey: textOrNull(packageMetadata?.subjectKey ?? markerPackage?.subjectKey),
    questionCount: questionPackage?.questions.length ?? 0,
    variantCount:
      questionPackage?.questions.reduce(
        (total, question) => total + question.variants.length,
        0,
      ) ?? 0,
    errorCount: diagnostics.filter((item) => item.severity === "ERROR").length,
    warningCount: diagnostics.filter((item) => item.severity === "WARNING").length,
    inspectedAt: Date.now(),
  };
}

function rowToInspection(
  row: ReturnType<SQLiteQuestionPackageInspectionRepository["store"]>,
): QuestionPackageInspection {
  return {
    status: row.status,
    format: row.format,
    schemaVersion: row.schemaVersion,
    packageId: row.packageId,
    packageKey: row.packageKey,
    title: row.title,
    subjectKey: row.subjectKey,
    questionCount: row.questionCount,
    variantCount: row.variantCount,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    diagnostics: row.diagnostics,
    inspectedAt: row.inspectedAt,
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 1000) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
