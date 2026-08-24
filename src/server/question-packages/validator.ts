import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import schema from "./question-package-v1.schema.json";
import {
  QUESTION_PACKAGE_CONTENT_MODE,
  QUESTION_PACKAGE_FORMAT,
  QUESTION_PACKAGE_SCHEMA_VERSION,
  type QuestionPackageDiagnostic,
  type QuestionPackageV1,
  type QuestionPackageValidationResult,
  type RichDocument,
  type RichInline,
} from "./contracts";

const MAX_DIAGNOSTICS = 250;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false,
  allowUnionTypes: true,
});
const validateStructure = ajv.compile(schema) as ValidateFunction<QuestionPackageV1>;

export interface InspectQuestionPackageOptions {
  canonicalSubjectKeys?: ReadonlySet<string>;
}

export function inspectQuestionPackageJson(
  value: unknown,
  options: InspectQuestionPackageOptions = {},
): QuestionPackageValidationResult {
  if (!isRecord(value)) {
    return result("GENERIC_JSON", null, []);
  }

  const hasPackageMarker =
    "$schema" in value ||
    "format" in value ||
    "schemaVersion" in value ||
    "contentMode" in value;
  if (!hasPackageMarker) return result("GENERIC_JSON", null, []);

  if (
    value.format === QUESTION_PACKAGE_FORMAT &&
    typeof value.schemaVersion === "string" &&
    value.schemaVersion !== QUESTION_PACKAGE_SCHEMA_VERSION
  ) {
    return result("UNSUPPORTED_VERSION", null, [
      diagnostic(
        "ERROR",
        "UNSUPPORTED_SCHEMA_VERSION",
        `Question Package schema version ${value.schemaVersion} is not supported.`,
        "/schemaVersion",
      ),
    ]);
  }

  if (
    value.format !== QUESTION_PACKAGE_FORMAT ||
    value.contentMode !== QUESTION_PACKAGE_CONTENT_MODE
  ) {
    return result("INVALID", null, [
      diagnostic(
        "ERROR",
        "INVALID_PACKAGE_MARKERS",
        "The JSON contains package markers but is not a supported Pythagoras Question Package.",
        "",
      ),
    ]);
  }

  if (!validateStructure(value)) {
    const diagnostics = (validateStructure.errors ?? [])
      .slice(0, MAX_DIAGNOSTICS)
      .map(structuralDiagnostic);
    return result("INVALID", null, diagnostics);
  }

  const questionPackage = value as QuestionPackageV1;
  const diagnostics = validateSemantics(questionPackage, options).slice(
    0,
    MAX_DIAGNOSTICS,
  );
  const hasErrors = diagnostics.some((item) => item.severity === "ERROR");
  const hasWarnings = diagnostics.some((item) => item.severity === "WARNING");
  return result(
    hasErrors ? "INVALID" : hasWarnings ? "VALID_WITH_WARNINGS" : "VALID",
    questionPackage,
    diagnostics,
  );
}

export function isQuestionPackageEligibleForFutureImport(
  status: QuestionPackageValidationResult["status"],
): boolean {
  return status === "VALID" || status === "VALID_WITH_WARNINGS";
}

function validateSemantics(
  questionPackage: QuestionPackageV1,
  options: InspectQuestionPackageOptions,
): QuestionPackageDiagnostic[] {
  const diagnostics: QuestionPackageDiagnostic[] = [];
  const entityIds = new Map<string, string>();
  const blockIds = new Map<string, string>();

  if (
    options.canonicalSubjectKeys &&
    !options.canonicalSubjectKeys.has(questionPackage.package.subjectKey)
  ) {
    diagnostics.push(
      diagnostic(
        "ERROR",
        "UNKNOWN_SUBJECT_KEY",
        "Package subjectKey does not match a canonical material.",
        "/package/subjectKey",
        questionPackage.package.id,
        { subjectKey: questionPackage.package.subjectKey },
      ),
    );
  }

  registerEntityId(entityIds, questionPackage.package.id, "/package/id", diagnostics);
  validateUniqueAndSequential(
    questionPackage.taxonomy,
    "/taxonomy",
    diagnostics,
    (node) => node.id,
    (node) => node.key,
    (node) => node.parentId,
  );
  validateParentGraph(
    questionPackage.taxonomy,
    "/taxonomy",
    diagnostics,
    "TAXONOMY",
  );

  const taxonomyIds = new Set(questionPackage.taxonomy.map((node) => node.id));
  questionPackage.taxonomy.forEach((node, index) =>
    registerEntityId(entityIds, node.id, `/taxonomy/${index}/id`, diagnostics),
  );

  if (questionPackage.bankBrowse.mode === "TREE") {
    validateUniqueAndSequential(
      questionPackage.bankBrowse.nodes,
      "/bankBrowse/nodes",
      diagnostics,
      (node) => node.id,
      (node) => node.key,
      (node) => node.parentId,
    );
    validateParentGraph(
      questionPackage.bankBrowse.nodes,
      "/bankBrowse/nodes",
      diagnostics,
      "BROWSE",
    );
    questionPackage.bankBrowse.nodes.forEach((node, index) => {
      registerEntityId(
        entityIds,
        node.id,
        `/bankBrowse/nodes/${index}/id`,
        diagnostics,
      );
      if (node.type === "GROUP" && node.filter) {
        diagnostics.push(
          diagnostic(
            "ERROR",
            "GROUP_HAS_FILTER",
            "Browse GROUP nodes cannot define a question filter.",
            `/bankBrowse/nodes/${index}/filter`,
            node.id,
          ),
        );
      }
      if (node.type === "QUESTION_LIST" && !node.filter) {
        diagnostics.push(
          diagnostic(
            "ERROR",
            "BROWSE_FILTER_REQUIRED",
            "Browse QUESTION_LIST nodes must target taxonomy through a filter.",
            `/bankBrowse/nodes/${index}/filter`,
            node.id,
          ),
        );
      }
      if (node.filter && !taxonomyIds.has(node.filter.taxonomyNodeId)) {
        diagnostics.push(
          diagnostic(
            "ERROR",
            "BROWSE_TARGET_NOT_FOUND",
            "Browse filter targets a taxonomy node that does not exist.",
            `/bankBrowse/nodes/${index}/filter/taxonomyNodeId`,
            node.id,
          ),
        );
      }
    });
  }

  const manifestRefs = new Set<string>();
  questionPackage.assetsManifest.forEach((entry, index) => {
    if (manifestRefs.has(entry.ref)) {
      diagnostics.push(
        diagnostic(
          "ERROR",
          "DUPLICATE_ASSET_REF",
          "Asset manifest references must be unique.",
          `/assetsManifest/${index}/ref`,
          undefined,
          { assetRef: entry.ref },
        ),
      );
    }
    manifestRefs.add(entry.ref);
    if (isUnsafeManifestFilename(entry.filename)) {
      diagnostics.push(
        diagnostic(
          "ERROR",
          "UNSAFE_MANIFEST_FILENAME",
          "Asset manifest filenames must be relative leaf filenames without path semantics.",
          `/assetsManifest/${index}/filename`,
          undefined,
          { assetRef: entry.ref },
        ),
      );
    }
  });

  validateUniqueAndSequential(
    questionPackage.questions,
    "/questions",
    diagnostics,
    (question) => question.id,
  );
  const usedAssetRefs = new Set<string>();
  questionPackage.questions.forEach((question, questionIndex) => {
    const questionPointer = `/questions/${questionIndex}`;
    registerEntityId(entityIds, question.id, `${questionPointer}/id`, diagnostics);
    const variantIds = new Set(question.variants.map((variant) => variant.id));
    if (!variantIds.has(question.primaryVariantId)) {
      diagnostics.push(
        diagnostic(
          "ERROR",
          "PRIMARY_VARIANT_NOT_FOUND",
          "primaryVariantId must reference a variant owned by this question.",
          `${questionPointer}/primaryVariantId`,
          question.id,
        ),
      );
    }
    validateUniqueAndSequential(
      question.variants,
      `${questionPointer}/variants`,
      diagnostics,
      (variant) => variant.id,
    );

    const assignmentTargets = new Set<string>();
    let primaryAssignments = 0;
    question.taxonomyAssignments.forEach((assignment, assignmentIndex) => {
      const pointer = `${questionPointer}/taxonomyAssignments/${assignmentIndex}`;
      if (!taxonomyIds.has(assignment.taxonomyNodeId)) {
        diagnostics.push(
          diagnostic(
            "ERROR",
            "TAXONOMY_ASSIGNMENT_NOT_FOUND",
            "Question assignment targets a taxonomy node that does not exist.",
            `${pointer}/taxonomyNodeId`,
            question.id,
          ),
        );
      }
      if (assignmentTargets.has(assignment.taxonomyNodeId)) {
        diagnostics.push(
          diagnostic(
            "ERROR",
            "DUPLICATE_TAXONOMY_ASSIGNMENT",
            "A question cannot assign the same taxonomy node more than once.",
            `${pointer}/taxonomyNodeId`,
            question.id,
          ),
        );
      }
      assignmentTargets.add(assignment.taxonomyNodeId);
      if (assignment.role === "PRIMARY") primaryAssignments += 1;
    });
    if (primaryAssignments !== 1) {
      diagnostics.push(
        diagnostic(
          "ERROR",
          "PRIMARY_ASSIGNMENT_COUNT_INVALID",
          "Each question must have exactly one PRIMARY taxonomy assignment.",
          `${questionPointer}/taxonomyAssignments`,
          question.id,
          { primaryAssignments },
        ),
      );
    }

    question.variants.forEach((variant, variantIndex) => {
      const variantPointer = `${questionPointer}/variants/${variantIndex}`;
      registerEntityId(entityIds, variant.id, `${variantPointer}/id`, diagnostics);
      registerRichDocumentIdentity(
        variant.content,
        `${variantPointer}/content`,
        entityIds,
        blockIds,
        diagnostics,
      );
      if (!isMeaningfulRichDocument(variant.content)) {
        diagnostics.push(
          diagnostic(
            "ERROR",
            "EMPTY_VARIANT_CONTENT",
            "A Question Variant must contain meaningful educational content.",
            `${variantPointer}/content/blocks`,
            variant.id,
          ),
        );
      }
      collectAssetRefs(variant.content, usedAssetRefs);
      variant.occurrences.forEach((occurrence, occurrenceIndex) => {
        registerEntityId(
          entityIds,
          occurrence.id,
          `${variantPointer}/occurrences/${occurrenceIndex}/id`,
          diagnostics,
        );
        if (occurrence.rawLabel.trim().length === 0) {
          diagnostics.push(
            diagnostic(
              "ERROR",
              "EMPTY_OCCURRENCE_RAW_LABEL",
              "Occurrence rawLabel must preserve a non-empty original source label.",
              `${variantPointer}/occurrences/${occurrenceIndex}/rawLabel`,
              occurrence.id,
            ),
          );
        }
      });
    });
    if (question.sharedAnswer) {
      registerRichDocumentIdentity(
        question.sharedAnswer,
        `${questionPointer}/sharedAnswer`,
        entityIds,
        blockIds,
        diagnostics,
      );
      collectAssetRefs(question.sharedAnswer, usedAssetRefs);
      if (!isMeaningfulRichDocument(question.sharedAnswer)) {
        diagnostics.push(
          diagnostic(
            "WARNING",
            "EMPTY_SHARED_ANSWER",
            "The shared answer is present but has no meaningful content.",
            `${questionPointer}/sharedAnswer/blocks`,
            question.id,
          ),
        );
      }
    } else {
      diagnostics.push(
        diagnostic(
          "WARNING",
          "SHARED_ANSWER_MISSING",
          "Question has no shared answer yet.",
          `${questionPointer}/sharedAnswer`,
          question.id,
        ),
      );
    }
  });

  usedAssetRefs.forEach((assetRef) => {
    if (!manifestRefs.has(assetRef)) {
      diagnostics.push(
        diagnostic(
          "ERROR",
          "ASSET_REF_NOT_FOUND",
          "Rich content references an asset absent from assetsManifest.",
          "/questions",
          undefined,
          { assetRef },
        ),
      );
    }
  });
  manifestRefs.forEach((assetRef) => {
    if (!usedAssetRefs.has(assetRef)) {
      diagnostics.push(
        diagnostic(
          "WARNING",
          "UNUSED_ASSET_MANIFEST_ENTRY",
          "Asset manifest entry is not referenced by rich content.",
          "/assetsManifest",
          undefined,
          { assetRef },
        ),
      );
    }
  });

  return diagnostics;
}

function validateUniqueAndSequential<T extends { order: number }>(
  items: readonly T[],
  pointer: string,
  diagnostics: QuestionPackageDiagnostic[],
  getId: (item: T) => string,
  getKey?: (item: T) => string,
  getOrderGroup?: (item: T) => string | null,
): void {
  const ids = new Set<string>();
  const keys = new Set<string>();
  const orderGroups = new Map<string | null, Map<number, number>>();
  items.forEach((item, index) => {
    if (ids.has(getId(item))) {
      diagnostics.push(
        diagnostic("ERROR", "DUPLICATE_ID", "Entity IDs must be unique within their collection.", `${pointer}/${index}/id`, getId(item)),
      );
    }
    ids.add(getId(item));
    if (getKey) {
      const key = getKey(item);
      if (keys.has(key)) diagnostics.push(diagnostic("ERROR", "DUPLICATE_KEY", "Entity keys must be unique within their collection.", `${pointer}/${index}/key`, getId(item)));
      keys.add(key);
    }
    const orderGroup = getOrderGroup ? getOrderGroup(item) : null;
    const orders = orderGroups.get(orderGroup) ?? new Map<number, number>();
    const firstIndex = orders.get(item.order);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "ERROR",
          "DUPLICATE_ORDER",
          "Sibling order values must be unique within the same parent.",
          `${pointer}/${index}/order`,
          getId(item),
          { order: item.order, parentId: orderGroup, firstIndex },
        ),
      );
    }
    orders.set(item.order, index);
    orderGroups.set(orderGroup, orders);
  });
  orderGroups.forEach((orders, orderGroup) => {
    if (orders.size <= 1) return;
    const sorted = [...orders.keys()].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] !== sorted[index - 1] + 1) {
        diagnostics.push(
          diagnostic(
            "WARNING",
            "ORDER_GAP",
            "Sibling order values contain a gap; original values remain preserved.",
            pointer,
            undefined,
            { parentId: orderGroup },
          ),
        );
        break;
      }
    }
  });
}

function validateParentGraph<T extends { id: string; parentId: string | null }>(
  nodes: readonly T[],
  pointer: string,
  diagnostics: QuestionPackageDiagnostic[],
  prefix: "TAXONOMY" | "BROWSE",
): void {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  nodes.forEach((node, index) => {
    if (node.parentId && !nodeIds.has(node.parentId)) {
      diagnostics.push(diagnostic("ERROR", `${prefix}_PARENT_NOT_FOUND`, "Parent reference does not exist in this hierarchy.", `${pointer}/${index}/parentId`, node.id));
      return;
    }
    const seen = new Set<string>();
    let cursor: string | null = node.id;
    while (cursor) {
      if (seen.has(cursor)) {
        diagnostics.push(diagnostic("ERROR", `${prefix}_CYCLE`, "Hierarchy contains a parent cycle.", `${pointer}/${index}/parentId`, node.id));
        break;
      }
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  });
}

function registerEntityId(
  registry: Map<string, string>,
  id: string,
  pointer: string,
  diagnostics: QuestionPackageDiagnostic[],
): void {
  const existing = registry.get(id);
  if (existing) diagnostics.push(diagnostic("ERROR", "DUPLICATE_ENTITY_ID", "Stable entity IDs must be unique across the package.", pointer, id, { firstPointer: existing }));
  else registry.set(id, pointer);
}

function registerRichDocumentIdentity(
  document: RichDocument,
  pointer: string,
  entityIds: Map<string, string>,
  blockIds: Map<string, string>,
  diagnostics: QuestionPackageDiagnostic[],
): void {
  document.blocks.forEach((block, blockIndex) => {
    const blockPointer = `${pointer}/blocks/${blockIndex}`;
    const existingBlock = blockIds.get(block.id);
    if (existingBlock) {
      diagnostics.push(
        diagnostic(
          "ERROR",
          "DUPLICATE_BLOCK_ID",
          "RichDocument block IDs must be unique across the package.",
          `${blockPointer}/id`,
          block.id,
          { firstPointer: existingBlock },
        ),
      );
    } else {
      blockIds.set(block.id, `${blockPointer}/id`);
    }
    registerEntityId(entityIds, block.id, `${blockPointer}/id`, diagnostics);

    if (block.type === "quran" || block.type === "poetry") {
      block.verses.forEach((verse, verseIndex) =>
        registerEntityId(
          entityIds,
          verse.id,
          `${blockPointer}/verses/${verseIndex}/id`,
          diagnostics,
        ),
      );
    }

    if (block.type === "table" && block.headerRowCount > block.rows.length) {
      diagnostics.push(
        diagnostic(
          "ERROR",
          "TABLE_HEADER_ROW_COUNT_INVALID",
          "headerRowCount cannot exceed the number of table rows.",
          `${blockPointer}/headerRowCount`,
          block.id,
        ),
      );
    }
  });
}

function isMeaningfulRichDocument(document: RichDocument): boolean {
  return document.blocks.some((block) => {
    switch (block.type) {
      case "paragraph":
      case "heading":
        return isMeaningfulInline(block.spans);
      case "ordered-list":
      case "bullet-list":
        return block.items.some((item) => isMeaningfulInline(item.spans));
      case "quran":
        return block.verses.some((verse) => isMeaningfulInline(verse.spans));
      case "poetry":
        return block.verses.some(
          (verse) =>
            isMeaningfulInline(verse.sadr) || isMeaningfulInline(verse.ajuz),
        );
      case "table":
        return (
          (block.caption ? isMeaningfulInline(block.caption) : false) ||
          block.rows.some((row) =>
            row.cells.some((cell) => isMeaningfulInline(cell.spans)),
          )
        );
      case "image":
        return true;
      case "divider":
        return false;
    }
  });
}

function isMeaningfulInline(inline: RichInline): boolean {
  return inline.some((span) => span.text.trim().length > 0);
}

function collectAssetRefs(document: RichDocument, output: Set<string>): void {
  document.blocks.forEach((block) => {
    if (block.type === "image") output.add(block.assetRef);
  });
}

function isUnsafeManifestFilename(filename: string): boolean {
  return (
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("..") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(filename) ||
    /^[a-z]:/iu.test(filename) ||
    /[\u0000-\u001f\u007f]/u.test(filename)
  );
}

function structuralDiagnostic(error: ErrorObject): QuestionPackageDiagnostic {
  const missingProperty =
    error.keyword === "required" && typeof error.params.missingProperty === "string"
      ? `/${escapePointer(error.params.missingProperty)}`
      : "";
  return diagnostic(
    "ERROR",
    `SCHEMA_${error.keyword.toUpperCase().replaceAll("-", "_")}`,
    error.message ? `Schema validation failed: ${error.message}.` : "Schema validation failed.",
    `${error.instancePath}${missingProperty}`,
  );
}

function diagnostic(
  severity: QuestionPackageDiagnostic["severity"],
  code: string,
  message: string,
  jsonPointer: string,
  entityId?: string,
  context?: QuestionPackageDiagnostic["context"],
): QuestionPackageDiagnostic {
  return { severity, code, message, jsonPointer, ...(entityId ? { entityId } : {}), ...(context ? { context } : {}) };
}

function result(
  status: QuestionPackageValidationResult["status"],
  questionPackage: QuestionPackageV1 | null,
  diagnostics: QuestionPackageDiagnostic[],
): QuestionPackageValidationResult {
  return { status, package: questionPackage, diagnostics };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
