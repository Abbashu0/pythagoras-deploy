import type { AdminActor } from "../admin-auth/contracts";
import type {
  QuestionPackageDiagnostic,
  QuestionPackageValidationResult,
  RichDocument,
} from "../question-packages/contracts";
import type {
  QuestionMaterializationPlan,
  QuestionPackageAssetBindingEntity,
} from "./contracts";
import {
  ELIGIBLE_QUESTION_PACKAGE,
  type EligibleQuestionPackage,
} from "./contracts";
import type { QuestionPackageAssetResolver } from "./asset-resolver";
import { toCanonicalRichDocument } from "./canonical-rich-document";
import { QuestionDomainError } from "./errors";

export function getEligibleQuestionPackage(
  validation: QuestionPackageValidationResult,
): EligibleQuestionPackage {
  if (
    (validation.status !== "VALID" &&
      validation.status !== "VALID_WITH_WARNINGS") ||
    !validation.package
  ) {
    throw new QuestionDomainError(
      "QUESTION_PACKAGE_INELIGIBLE",
      "Only a VALID or VALID_WITH_WARNINGS Question Package can be materialized.",
    );
  }
  return {
    [ELIGIBLE_QUESTION_PACKAGE]: true,
    validationStatus: validation.status,
    diagnostics: structuredClone(validation.diagnostics),
    package: structuredClone(validation.package),
  };
}

export interface CreateQuestionMaterializationPlanOptions {
  sourceAssetId?: string;
}

export class QuestionPackageMaterializer {
  constructor(
    private readonly assetResolver: QuestionPackageAssetResolver,
    private readonly clock: () => number = Date.now,
  ) {}

  createPlan(
    eligible: EligibleQuestionPackage,
    actor: AdminActor,
    options: CreateQuestionMaterializationPlanOptions = {},
  ): QuestionMaterializationPlan {
    if (eligible[ELIGIBLE_QUESTION_PACKAGE] !== true) {
      throw new QuestionDomainError(
        "QUESTION_PACKAGE_INELIGIBLE",
        "Question Package eligibility must come from the approved validation boundary.",
      );
    }
    assertActor(actor);
    const sourceAssetId = options.sourceAssetId
      ? this.assetResolver.requireSourceJsonAsset(options.sourceAssetId).id
      : null;
    const source = eligible.package;
    const now = this.clock();
    const usedAssetRefs = collectUsedAssetRefs(source.questions);
    const assetIdsByRef = new Map<string, string>();
    const assetBindings: QuestionPackageAssetBindingEntity[] =
      source.assetsManifest.map((entry, position) => {
        const resolved = this.assetResolver.resolveManifestEntry(entry);
        if (resolved) assetIdsByRef.set(entry.ref, resolved.id);
        if (usedAssetRefs.has(entry.ref) && !resolved) {
          throw new QuestionDomainError(
            "QUESTION_ASSET_UNRESOLVED",
            `Required Question Package asset could not be resolved: ${entry.ref}.`,
          );
        }
        return {
          packageId: source.package.id,
          assetRef: entry.ref,
          expectedSha256: entry.sha256,
          assetId: resolved?.id ?? null,
          filename: entry.filename,
          mimeType: entry.mimeType,
          byteSize: entry.byteSize,
          metadata: entry.metadata ? structuredClone(entry.metadata) : null,
          position,
        };
      });

    const resolveAssetRef = (assetRef: string): string => {
      const assetId = assetIdsByRef.get(assetRef);
      if (!assetId) {
        throw new QuestionDomainError(
          "QUESTION_ASSET_UNRESOLVED",
          `Required Question Package asset could not be resolved: ${assetRef}.`,
        );
      }
      return assetId;
    };

    return {
      actor,
      warnings: eligible.diagnostics.filter(
        (diagnostic): diagnostic is QuestionPackageDiagnostic =>
          diagnostic.severity === "WARNING",
      ),
      package: {
        id: source.package.id,
        packageKey: source.package.key,
        title: source.package.title,
        subjectKey: source.package.subjectKey,
        language: source.package.language,
        contentRevision: source.package.contentRevision,
        bankBrowseMode: source.bankBrowse.mode,
        bankBrowseEntryKey: source.bankBrowse.entry.key,
        bankBrowseEntryLabel: source.bankBrowse.entry.label,
        bankBrowseEntryOrder: source.bankBrowse.entry.order,
        sourceAssetId,
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.actorUserId,
        revision: 1,
      },
      taxonomy: source.taxonomy.map((node) => ({
        id: node.id,
        packageId: source.package.id,
        nodeKey: node.key,
        label: node.label,
        kind: node.kind,
        parentId: node.parentId,
        displayOrder: node.order,
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.actorUserId,
        revision: 1,
      })),
      browseNodes:
        source.bankBrowse.mode === "TREE"
          ? source.bankBrowse.nodes.map((node) => ({
              id: node.id,
              packageId: source.package.id,
              nodeKey: node.key,
              label: node.label,
              nodeType: node.type,
              parentId: node.parentId,
              displayOrder: node.order,
              taxonomyNodeId: node.filter?.taxonomyNodeId ?? null,
              includeDescendants: node.filter?.includeDescendants ?? null,
              createdAt: now,
              updatedAt: now,
              updatedBy: actor.actorUserId,
              revision: 1,
            }))
          : [],
      assetBindings,
      questions: source.questions.map((question) => ({
        id: question.id,
        packageId: source.package.id,
        displayOrder: question.order,
        sharedAnswer: question.sharedAnswer
          ? toCanonicalRichDocument(question.sharedAnswer, resolveAssetRef)
          : null,
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.actorUserId,
        revision: 1,
        primaryVariantId: question.primaryVariantId,
        taxonomyAssignments: question.taxonomyAssignments.map(
          (assignment, position) => ({
            questionId: question.id,
            taxonomyNodeId: assignment.taxonomyNodeId,
            packageId: source.package.id,
            role: assignment.role,
            position,
          }),
        ),
        variants: question.variants.map((variant) => ({
          id: variant.id,
          questionId: question.id,
          displayOrder: variant.order,
          content: toCanonicalRichDocument(variant.content, resolveAssetRef),
          createdAt: now,
          updatedAt: now,
          updatedBy: actor.actorUserId,
          revision: 1,
          occurrences: variant.occurrences.map((occurrence, index) => ({
            id: occurrence.id,
            variantId: variant.id,
            displayOrder: index + 1,
            sourceKind: occurrence.sourceKind,
            year: occurrence.year ?? null,
            roundCode: occurrence.roundCode ?? null,
            session: occurrence.session ?? null,
            sourceName: occurrence.sourceName ?? null,
            notes: occurrence.notes ?? null,
            rawLabel: occurrence.rawLabel,
            branches: [...occurrence.branches],
            qualifiers: [...occurrence.qualifiers],
            createdAt: now,
            updatedAt: now,
            updatedBy: actor.actorUserId,
            revision: 1,
          })),
        })),
      })),
    };
  }
}

function collectUsedAssetRefs(
  questions: EligibleQuestionPackage["package"]["questions"],
): Set<string> {
  const refs = new Set<string>();
  const collect = (document: RichDocument | undefined) => {
    document?.blocks.forEach((block) => {
      if (block.type === "image") refs.add(block.assetRef);
    });
  };
  questions.forEach((question) => {
    question.variants.forEach((variant) => collect(variant.content));
    collect(question.sharedAnswer);
  });
  return refs;
}

function assertActor(actor: AdminActor): void {
  if (
    !actor.actorUserId?.trim() ||
    (actor.actorRole !== "OWNER" && actor.actorRole !== "ADMIN")
  ) {
    throw new QuestionDomainError(
      "QUESTION_DOMAIN_VALIDATION_FAILED",
      "An authenticated Admin actor is required for Question materialization.",
    );
  }
}
