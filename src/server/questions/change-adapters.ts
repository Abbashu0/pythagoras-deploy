import { eq } from "drizzle-orm";
import type { AdminActor } from "../admin-auth/contracts";
import { assets } from "../content/schema";
import {
  canonicalMaterials,
  questionBankBrowseNodes,
  questionOccurrences,
  questionPackages,
  questions,
  questionTaxonomyNodes,
  questionVariants,
} from "../content/schema";
import type { ContentDatabase } from "../content/database";
import type {
  ChangeOperation,
  ChangePresentation,
  ChangeResourceAdapter,
  ChangeSetCoordinator,
  ChangeSetItem,
  ChangeSnapshot,
  ResourceState,
} from "../change-management/contracts";
import { ChangeManagementError } from "../change-management/errors";
import {
  deriveChangedPaths,
  validateChangeSnapshot,
} from "../change-management/snapshot";
import { assertCanonicalRichDocument } from "./canonical-rich-document";
import type {
  CanonicalRichDocument,
  QuestionBrowseContent,
  QuestionItemContent,
  QuestionOccurrenceContent,
  QuestionPackageContent,
  QuestionTaxonomyContent,
} from "./contracts";
import { QuestionDomainError } from "./errors";
import { SQLiteQuestionRepository } from "./sqlite-question-repository";

export const QUESTION_CHANGE_RESOURCE_TYPES = [
  "question.package",
  "question.taxonomy",
  "question.browse",
  "question.item",
] as const;

export type QuestionChangeResourceType =
  (typeof QUESTION_CHANGE_RESOURCE_TYPES)[number];

const QUESTION_TYPES = new Set<string>(QUESTION_CHANGE_RESOURCE_TYPES);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SOURCE_KINDS = new Set([
  "ministerial",
  "discussion-question",
  "educational-tv",
  "end-of-chapter",
  "book-question",
  "book-exercise",
  "enrichment",
  "other",
]);

const AREA_LABEL = "بنك الأسئلة";
const RESOURCE_LABELS: Record<QuestionChangeResourceType, string> = {
  "question.package": "حزمة أسئلة",
  "question.taxonomy": "تصنيف بنك الأسئلة",
  "question.browse": "مسار بنك الأسئلة",
  "question.item": "سؤال",
};

export class QuestionChangeAdapter implements ChangeResourceAdapter {
  readonly areaLabel = AREA_LABEL;
  readonly mergeStrategy: "THREE_WAY" | "CONSERVATIVE";

  constructor(readonly resourceType: QuestionChangeResourceType) {
    this.mergeStrategy = resourceType === "question.item"
      ? "CONSERVATIVE"
      : "THREE_WAY";
  }

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    assertUuid(resourceId, "resourceId");
    const repository = new SQLiteQuestionRepository(database);
    switch (this.resourceType) {
      case "question.package": {
        const aggregate = repository.getPackageAggregate(resourceId);
        if (!aggregate) notFound("Question Package");
        return {
          resourceId,
          revision: aggregate.package.revision,
          snapshot: packageSnapshot({
            ...aggregate.package,
            assetBindings: aggregate.assetBindings.map(({ packageId: _packageId, ...binding }) => binding),
          }),
        };
      }
      case "question.taxonomy": {
        const row = database.db.select().from(questionTaxonomyNodes)
          .where(eq(questionTaxonomyNodes.id, resourceId)).get();
        if (!row) notFound("Question taxonomy node");
        return {
          resourceId,
          revision: row.revision,
          snapshot: taxonomySnapshot(row),
        };
      }
      case "question.browse": {
        const row = database.db.select().from(questionBankBrowseNodes)
          .where(eq(questionBankBrowseNodes.id, resourceId)).get();
        if (!row) notFound("Question Bank Browse node");
        return {
          resourceId,
          revision: row.revision,
          snapshot: browseSnapshot(row),
        };
      }
      case "question.item": {
        const entity = repository.getQuestion(resourceId);
        if (!entity) notFound("Question");
        return {
          resourceId,
          revision: entity.revision,
          snapshot: questionSnapshot(entity),
        };
      }
    }
  }

  captureProposal(
    database: ContentDatabase,
    resourceId: string,
    desired: unknown,
    operation: ChangeOperation = "UPDATE",
  ) {
    assertUuid(resourceId, "resourceId");
    const current = operation === "CREATE"
      ? this.emptyCreateState(database, resourceId)
      : this.loadCurrent(database, resourceId);
    const proposedSnapshot = normalizeSnapshot(this.resourceType, desired);
    this.validateSnapshot(proposedSnapshot, operation);
    if (operation === "UPDATE") {
      assertImmutableOwnership(this.resourceType, current.snapshot, proposedSnapshot);
      if (this.resourceType === "question.item") {
        assertExistingQuestionChildrenPreserved(current.snapshot, proposedSnapshot);
      }
    }
    validateDatabaseLocalReferences(database, this.resourceType, proposedSnapshot);
    const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
    if (!changedPaths.length) validationError("The Question proposal does not change any fields.");
    return { current, proposedSnapshot, changedPaths };
  }

  validateSnapshot(
    snapshot: ChangeSnapshot,
    operation: ChangeOperation = "UPDATE",
  ): void {
    if (!operation || !["CREATE", "UPDATE"].includes(operation)) {
      validationError("Question change operation is invalid.");
    }
    validateChangeSnapshot(snapshot);
    normalizeSnapshot(this.resourceType, snapshot);
  }

  describe(
    resourceId: string,
    before: ChangeSnapshot,
    proposed: ChangeSnapshot,
    operation: ChangeOperation = "UPDATE",
  ): ChangePresentation {
    this.validateSnapshot(proposed, operation);
    if (operation === "UPDATE") this.validateSnapshot(before, operation);
    if (this.resourceType === "question.item") {
      return describeQuestionItem(resourceId, before, proposed, operation);
    }
    const diffs = deriveChangedPaths(before, proposed).map((path) => ({
      path,
      label: fieldLabel(path),
      before: before[path],
      after: proposed[path],
    }));
    const label = String(proposed.title ?? proposed.label ?? proposed.nodeKey ?? resourceId);
    return {
      resourceLabel: label,
      resourceSubtitle: operation === "CREATE" ? "عنصر جديد" : RESOURCE_LABELS[this.resourceType],
      changeSummary: `${diffs.length} ${diffs.length === 1 ? "حقل" : "حقول"}`,
      areaLabel: AREA_LABEL,
      fieldDiffs: diffs,
    };
  }

  apply(
    database: ContentDatabase,
    resourceId: string,
    snapshot: ChangeSnapshot,
    expectedRevision: number,
    actor: AdminActor,
    operation: ChangeOperation = "UPDATE",
  ): ResourceState {
    if (actor.actorRole !== "OWNER") {
      throw new ChangeManagementError(
        "CHANGE_AUTHORIZATION_FAILED",
        "Only OWNER may publish Question changes.",
      );
    }
    const clean = normalizeSnapshot(this.resourceType, snapshot);
    validateDatabaseLocalReferences(database, this.resourceType, clean);
    const repository = new SQLiteQuestionRepository(database);
    try {
      switch (this.resourceType) {
        case "question.package":
          if (operation === "CREATE") repository.createPackage({ id: resourceId, content: clean as unknown as QuestionPackageContent, actor });
          else repository.updatePackage({ id: resourceId, content: clean as unknown as QuestionPackageContent, expectedRevision, actor });
          break;
        case "question.taxonomy":
          if (operation === "CREATE") repository.createTaxonomyNode({ id: resourceId, content: clean as unknown as QuestionTaxonomyContent, actor });
          else repository.updateTaxonomyNode({ id: resourceId, content: clean as unknown as QuestionTaxonomyContent, expectedRevision, actor });
          break;
        case "question.browse":
          if (operation === "CREATE") repository.createBrowseNode({ id: resourceId, content: clean as unknown as QuestionBrowseContent, actor });
          else repository.updateBrowseNode({ id: resourceId, content: clean as unknown as QuestionBrowseContent, expectedRevision, actor });
          break;
        case "question.item":
          if (operation === "CREATE") repository.createQuestionAggregate({ id: resourceId, content: clean as unknown as QuestionItemContent, actor });
          else repository.updateQuestionAggregate({ id: resourceId, content: clean as unknown as QuestionItemContent, expectedRevision, actor });
          break;
      }
    } catch (error) {
      throw mapQuestionError(error);
    }
    return this.loadCurrent(database, resourceId);
  }

  private emptyCreateState(database: ContentDatabase, resourceId: string): ResourceState {
    try {
      this.loadCurrent(database, resourceId);
    } catch (error) {
      if (error instanceof ChangeManagementError && error.code === "CHANGE_NOT_FOUND") {
        return { resourceId, revision: 0, snapshot: {} };
      }
      throw error;
    }
    throw new ChangeManagementError(
      "CHANGE_CONFLICT",
      "The proposed Question resource identifier is already in use.",
    );
  }
}

export class QuestionChangeSetCoordinator implements ChangeSetCoordinator {
  validate(database: ContentDatabase, items: ChangeSetItem[]): void {
    const questionItems = items.filter((item) => QUESTION_TYPES.has(item.resourceType));
    if (!questionItems.length) return;
    validateEffectiveQuestionState(database, questionItems);
  }

  planPublication(database: ContentDatabase, items: ChangeSetItem[]): ChangeSetItem[] {
    const questionItems = items.filter((item) => QUESTION_TYPES.has(item.resourceType));
    if (questionItems.length < 2) return [...items];
    this.validate(database, questionItems);
    const ordered = topologicalQuestionItems(questionItems);
    let cursor = 0;
    return items.map((item) => QUESTION_TYPES.has(item.resourceType) ? ordered[cursor++] : item);
  }
}

export function createQuestionChangeAdapters(): ChangeResourceAdapter[] {
  return QUESTION_CHANGE_RESOURCE_TYPES.map((type) => new QuestionChangeAdapter(type));
}

function normalizeSnapshot(type: QuestionChangeResourceType, value: unknown): ChangeSnapshot {
  switch (type) {
    case "question.package": return normalizePackage(value);
    case "question.taxonomy": return normalizeTaxonomy(value);
    case "question.browse": return normalizeBrowse(value);
    case "question.item": return normalizeQuestionItem(value);
  }
}

function normalizePackage(value: unknown): ChangeSnapshot {
  const input = objectWithKeys(value, ["packageKey", "title", "subjectKey", "language", "contentRevision", "bankBrowseMode", "bankBrowseEntryKey", "bankBrowseEntryLabel", "bankBrowseEntryOrder", "sourceAssetId", "assetBindings"]);
  const assetBindings = arrayValue(input.assetBindings, "assetBindings").map((binding, index) => {
    const row = objectWithKeys(binding, ["assetRef", "expectedSha256", "assetId", "filename", "mimeType", "byteSize", "metadata", "position"], `assetBindings[${index}]`);
    const expectedSha256 = normalizedText(row.expectedSha256, "expectedSha256", 64, 64).toLowerCase();
    if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) validationError("Asset binding SHA-256 is invalid.");
    if (row.metadata !== null && (typeof row.metadata !== "object" || Array.isArray(row.metadata))) validationError("Asset binding metadata must be an object or null.");
    let metadata: ChangeSnapshot | null = null;
    if (row.metadata !== null) {
      validateChangeSnapshot(row.metadata);
      metadata = structuredClone(row.metadata);
    }
    return {
      assetRef: semanticKey(row.assetRef, "assetRef"),
      expectedSha256,
      assetId: nullableUuid(row.assetId, "assetId"),
      filename: exactText(row.filename, "filename", 1, 1000),
      mimeType: normalizedText(row.mimeType, "mimeType", 1, 127).toLowerCase(),
      byteSize: positiveInteger(row.byteSize, "byteSize"),
      metadata,
      position: nonNegativeInteger(row.position, "position"),
    };
  });
  assertUnique(assetBindings.map((binding) => String(binding.assetRef)), "Asset binding references must be unique.");
  assertUnique(assetBindings.map((binding) => Number(binding.position)), "Asset binding positions must be unique.");
  return {
    packageKey: semanticKey(input.packageKey, "packageKey"),
    title: normalizedText(input.title, "title", 1, 1000),
    subjectKey: semanticKey(input.subjectKey, "subjectKey"),
    language: normalizedText(input.language, "language", 2, 35),
    contentRevision: positiveInteger(input.contentRevision, "contentRevision"),
    bankBrowseMode: enumValue(input.bankBrowseMode, ["ALL_PACKAGE_QUESTIONS", "TREE"], "bankBrowseMode"),
    bankBrowseEntryKey: semanticKey(input.bankBrowseEntryKey, "bankBrowseEntryKey"),
    bankBrowseEntryLabel: normalizedText(input.bankBrowseEntryLabel, "bankBrowseEntryLabel", 1, 1000),
    bankBrowseEntryOrder: positiveInteger(input.bankBrowseEntryOrder, "bankBrowseEntryOrder"),
    sourceAssetId: nullableUuid(input.sourceAssetId, "sourceAssetId"),
    assetBindings,
  };
}

function normalizeTaxonomy(value: unknown): ChangeSnapshot {
  const input = objectWithKeys(value, ["packageId", "nodeKey", "label", "kind", "parentId", "displayOrder"]);
  return {
    packageId: uuidValue(input.packageId, "packageId"),
    nodeKey: semanticKey(input.nodeKey, "nodeKey"),
    label: normalizedText(input.label, "label", 1, 1000),
    kind: normalizedText(input.kind, "kind", 1, 120),
    parentId: nullableUuid(input.parentId, "parentId"),
    displayOrder: positiveInteger(input.displayOrder, "displayOrder"),
  };
}

function normalizeBrowse(value: unknown): ChangeSnapshot {
  const input = objectWithKeys(value, ["packageId", "nodeKey", "label", "nodeType", "parentId", "displayOrder", "taxonomyNodeId", "includeDescendants"]);
  const nodeType = enumValue(input.nodeType, ["GROUP", "QUESTION_LIST"], "nodeType");
  const taxonomyNodeId = nullableUuid(input.taxonomyNodeId, "taxonomyNodeId");
  const includeDescendants = nullableBoolean(input.includeDescendants, "includeDescendants");
  if (nodeType === "GROUP" && (taxonomyNodeId !== null || includeDescendants !== null)) {
    validationError("GROUP Browse nodes cannot target taxonomy.");
  }
  if (nodeType === "QUESTION_LIST" && (!taxonomyNodeId || includeDescendants === null)) {
    validationError("QUESTION_LIST Browse nodes require a taxonomy target and includeDescendants.");
  }
  return {
    packageId: uuidValue(input.packageId, "packageId"),
    nodeKey: semanticKey(input.nodeKey, "nodeKey"),
    label: normalizedText(input.label, "label", 1, 1000),
    nodeType,
    parentId: nullableUuid(input.parentId, "parentId"),
    displayOrder: positiveInteger(input.displayOrder, "displayOrder"),
    taxonomyNodeId,
    includeDescendants,
  };
}

function normalizeQuestionItem(value: unknown): ChangeSnapshot {
  const input = objectWithKeys(value, ["packageId", "displayOrder", "primaryVariantId", "taxonomyAssignments", "variants", "sharedAnswer"]);
  const variants = arrayValue(input.variants, "variants").map((variant, index) => normalizeVariant(variant, `variants[${index}]`));
  if (!variants.length) validationError("A Question must contain at least one Variant.");
  assertUnique(variants.map((variant) => String(variant.id)), "Variant IDs must be unique.");
  assertUnique(variants.map((variant) => Number(variant.displayOrder)), "Variant display order must be unique.");
  const primaryVariantId = uuidValue(input.primaryVariantId, "primaryVariantId");
  if (!variants.some((variant) => variant.id === primaryVariantId)) validationError("Primary Variant must belong to the Question.");

  const assignments = arrayValue(input.taxonomyAssignments, "taxonomyAssignments").map((assignment, index) => {
    const row = objectWithKeys(assignment, ["taxonomyNodeId", "role", "position"], `taxonomyAssignments[${index}]`);
    return {
      taxonomyNodeId: uuidValue(row.taxonomyNodeId, "taxonomyNodeId"),
      role: enumValue(row.role, ["PRIMARY", "RELATED"], "role"),
      position: nonNegativeInteger(row.position, "position"),
    };
  });
  if (assignments.filter((assignment) => assignment.role === "PRIMARY").length !== 1) validationError("A Question must have exactly one PRIMARY taxonomy assignment.");
  assertUnique(assignments.map((assignment) => String(assignment.taxonomyNodeId)), "Question taxonomy assignments must be unique.");
  assertUnique(assignments.map((assignment) => Number(assignment.position)), "Question taxonomy assignment positions must be unique.");

  let sharedAnswer: CanonicalRichDocument | null = null;
  if (input.sharedAnswer !== null) {
    assertCanonical(input.sharedAnswer, false);
    sharedAnswer = structuredClone(input.sharedAnswer);
  }
  return {
    packageId: uuidValue(input.packageId, "packageId"),
    displayOrder: positiveInteger(input.displayOrder, "displayOrder"),
    primaryVariantId,
    taxonomyAssignments: assignments,
    variants,
    sharedAnswer,
  } as unknown as ChangeSnapshot;
}

function normalizeVariant(value: unknown, path: string): ChangeSnapshot {
  const input = objectWithKeys(value, ["id", "displayOrder", "content", "occurrences"], path);
  assertCanonical(input.content, true);
  const occurrences = arrayValue(input.occurrences, `${path}.occurrences`).map((occurrence, index) => normalizeOccurrence(occurrence, `${path}.occurrences[${index}]`));
  assertUnique(occurrences.map((occurrence) => String(occurrence.id)), "Occurrence IDs must be unique inside a Variant.");
  assertUnique(occurrences.map((occurrence) => Number(occurrence.displayOrder)), "Occurrence display order must be unique inside a Variant.");
  return {
    id: uuidValue(input.id, `${path}.id`),
    displayOrder: positiveInteger(input.displayOrder, `${path}.displayOrder`),
    content: structuredClone(input.content) as unknown as ChangeSnapshot,
    occurrences,
  };
}

function normalizeOccurrence(value: unknown, path: string): ChangeSnapshot {
  const input = objectWithKeys(value, ["id", "displayOrder", "sourceKind", "year", "roundCode", "session", "sourceName", "notes", "rawLabel", "branches", "qualifiers"], path);
  const rawLabel = exactText(input.rawLabel, `${path}.rawLabel`, 1, 1000);
  return {
    id: uuidValue(input.id, `${path}.id`),
    displayOrder: positiveInteger(input.displayOrder, `${path}.displayOrder`),
    sourceKind: enumValue(input.sourceKind, [...SOURCE_KINDS], `${path}.sourceKind`),
    year: nullableYear(input.year, `${path}.year`),
    roundCode: nullableText(input.roundCode, `${path}.roundCode`, 160),
    session: nullableText(input.session, `${path}.session`, 160),
    sourceName: nullableText(input.sourceName, `${path}.sourceName`, 500),
    notes: nullableText(input.notes, `${path}.notes`, 2000),
    rawLabel,
    branches: stringArray(input.branches, `${path}.branches`),
    qualifiers: stringArray(input.qualifiers, `${path}.qualifiers`),
  };
}

function validateDatabaseLocalReferences(database: ContentDatabase, type: QuestionChangeResourceType, snapshot: ChangeSnapshot): void {
  if (type === "question.package") {
    const subject = database.db.select({ key: canonicalMaterials.subjectKey }).from(canonicalMaterials)
      .where(eq(canonicalMaterials.subjectKey, String(snapshot.subjectKey))).get();
    if (!subject) validationError("Question Package subjectKey must reference a canonical Material.");
    if (snapshot.sourceAssetId !== null) {
      const source = database.db.select({ mediaKind: assets.mediaKind, mimeType: assets.mimeType }).from(assets)
        .where(eq(assets.id, String(snapshot.sourceAssetId))).get();
      if (!source || source.mediaKind !== "json" || source.mimeType !== "application/json") {
        validationError("Question Package sourceAssetId must reference an immutable JSON Asset.");
      }
    }
    for (const binding of snapshot.assetBindings as unknown as QuestionPackageContent["assetBindings"]) {
      if (binding.assetId === null) continue;
      const resolved = database.db.select({ sha256: assets.sha256, byteSize: assets.byteSize, mimeType: assets.mimeType }).from(assets)
        .where(eq(assets.id, binding.assetId)).get();
      if (!resolved || resolved.sha256 !== binding.expectedSha256 || resolved.byteSize !== binding.byteSize || resolved.mimeType !== binding.mimeType) {
        validationError("Question Package Asset binding no longer matches the immutable Asset.");
      }
    }
  }
  if (type === "question.item") validateQuestionAssets(database, snapshot as unknown as QuestionItemContent);
}

function validateQuestionAssets(database: ContentDatabase, question: QuestionItemContent): void {
  const assetIds = new Set<string>();
  for (const variant of question.variants) collectDocumentAssetIds(variant.content, assetIds);
  if (question.sharedAnswer) collectDocumentAssetIds(question.sharedAnswer, assetIds);
  for (const assetId of assetIds) {
    const asset = database.db.select({ mediaKind: assets.mediaKind, mimeType: assets.mimeType }).from(assets).where(eq(assets.id, assetId)).get();
    if (!asset || asset.mediaKind !== "image" || !asset.mimeType.startsWith("image/")) {
      validationError("Canonical Question images must reference validated image Assets.");
    }
  }
}

function collectDocumentAssetIds(document: CanonicalRichDocument, target: Set<string>): void {
  for (const block of document.blocks) if (block.type === "image") target.add(block.assetId);
}

function validateEffectiveQuestionState(database: ContentDatabase, items: ChangeSetItem[]): void {
  const packages = new Map(database.db.select().from(questionPackages).all().map((row) => [row.id, packageSnapshot(row)]));
  const taxonomy = new Map(database.db.select().from(questionTaxonomyNodes).all().map((row) => [row.id, taxonomySnapshot(row)]));
  const browse = new Map(database.db.select().from(questionBankBrowseNodes).all().map((row) => [row.id, browseSnapshot(row)]));
  const questionOrders = new Map(database.db.select({ id: questions.id, packageId: questions.packageId, displayOrder: questions.displayOrder }).from(questions).all().map((row) => [row.id, { packageId: row.packageId, displayOrder: row.displayOrder }]));

  for (const item of items) {
    if (!QUESTION_TYPES.has(item.resourceType)) continue;
    const type = item.resourceType as QuestionChangeResourceType;
    const adapter = new QuestionChangeAdapter(type);
    adapter.validateSnapshot(item.proposedSnapshot, item.operation);
    const map = type === "question.package" ? packages : type === "question.taxonomy" ? taxonomy : type === "question.browse" ? browse : null;
    const currentExists = map ? map.has(item.resourceId) : questionOrders.has(item.resourceId);
    if (item.operation === "CREATE" && currentExists) validationError("A proposed Question resource already exists.");
    if (item.operation === "UPDATE" && !currentExists) validationError("A Question resource proposed for update does not exist.");
    if (item.operation === "UPDATE") {
      const current = adapter.loadCurrent(database, item.resourceId);
      assertImmutableOwnership(type, current.snapshot, item.proposedSnapshot);
      if (type === "question.item") assertExistingQuestionChildrenPreserved(current.snapshot, item.proposedSnapshot);
    }
    validateDatabaseLocalReferences(database, type, item.proposedSnapshot);
    if (map) map.set(item.resourceId, item.proposedSnapshot);
    else questionOrders.set(item.resourceId, { packageId: String(item.proposedSnapshot.packageId), displayOrder: Number(item.proposedSnapshot.displayOrder) });
  }

  validatePackageState(database, packages);
  validateHierarchyState(packages, taxonomy, "Taxonomy");
  validateBrowseState(packages, taxonomy, browse);
  validateQuestionOrders(packages, questionOrders);
  validateQuestionItems(database, items, packages, taxonomy);
}

function validatePackageState(database: ContentDatabase, packages: Map<string, ChangeSnapshot>): void {
  const subjects = new Set(database.db.select({ key: canonicalMaterials.subjectKey }).from(canonicalMaterials).all().map((row) => row.key));
  const keys = new Set<string>();
  const entries = new Set<string>();
  const orders = new Set<string>();
  for (const [id, value] of packages) {
    if (!subjects.has(String(value.subjectKey))) validationError(`Question Package ${id} references a missing Subject.`);
    uniqueToken(keys, String(value.packageKey), "Question Package keys must be unique.");
    uniqueToken(entries, `${value.subjectKey}:${value.bankBrowseEntryKey}`, "Question Package Bank Browse entry keys must be unique per Subject.");
    uniqueToken(orders, `${value.subjectKey}:${value.bankBrowseEntryOrder}`, "Question Package Bank Browse order must be unique per Subject.");
  }
}

function validateHierarchyState(packages: Map<string, ChangeSnapshot>, nodes: Map<string, ChangeSnapshot>, label: string): void {
  const keys = new Set<string>();
  const orders = new Set<string>();
  for (const [id, node] of nodes) {
    const packageId = String(node.packageId);
    if (!packages.has(packageId)) validationError(`${label} node references a missing Package.`);
    uniqueToken(keys, `${packageId}:${node.nodeKey}`, `${label} keys must be unique within a Package.`);
    uniqueToken(orders, `${packageId}:${node.parentId ?? "ROOT"}:${node.displayOrder}`, `${label} sibling order must be unique.`);
    if (node.parentId !== null) {
      const parent = nodes.get(String(node.parentId));
      if (!parent || parent.packageId !== packageId) validationError(`${label} parent must belong to the same Package.`);
    }
    assertNoCycle(id, nodes, label);
  }
}

function validateBrowseState(packages: Map<string, ChangeSnapshot>, taxonomy: Map<string, ChangeSnapshot>, browse: Map<string, ChangeSnapshot>): void {
  validateHierarchyState(packages, browse, "Bank Browse");
  for (const node of browse.values()) {
    if (node.nodeType === "QUESTION_LIST") {
      const target = taxonomy.get(String(node.taxonomyNodeId));
      if (!target || target.packageId !== node.packageId) validationError("Bank Browse taxonomy target must belong to the same Package.");
    }
  }
}

function validateQuestionOrders(packages: Map<string, ChangeSnapshot>, questionOrders: Map<string, { packageId: string; displayOrder: number }>): void {
  const orders = new Set<string>();
  for (const value of questionOrders.values()) {
    if (!packages.has(value.packageId)) validationError("Question references a missing Package.");
    uniqueToken(orders, `${value.packageId}:${value.displayOrder}`, "Question order must be unique within a Package.");
  }
}

function validateQuestionItems(database: ContentDatabase, items: ChangeSetItem[], packages: Map<string, ChangeSnapshot>, taxonomy: Map<string, ChangeSnapshot>): void {
  const variantOwners = new Map(database.db.select({ id: questionVariants.id, owner: questionVariants.questionId }).from(questionVariants).all().map((row) => [row.id, row.owner]));
  const occurrenceOwners = new Map(database.db.select({ id: questionOccurrences.id, owner: questionOccurrences.variantId }).from(questionOccurrences).all().map((row) => [row.id, row.owner]));
  for (const item of items) {
    if (item.resourceType !== "question.item") continue;
    const question = item.proposedSnapshot as unknown as QuestionItemContent;
    if (!packages.has(question.packageId)) validationError("Question references a Package unavailable to this Change Set.");
    for (const assignment of question.taxonomyAssignments) {
      const node = taxonomy.get(assignment.taxonomyNodeId);
      if (!node || node.packageId !== question.packageId) validationError("Question taxonomy assignment must belong to the same Package.");
    }
    for (const variant of question.variants) {
      const currentOwner = variantOwners.get(variant.id);
      if (currentOwner && currentOwner !== item.resourceId) validationError("A Variant cannot be re-parented to another Question.");
      for (const occurrence of variant.occurrences) {
        const occurrenceOwner = occurrenceOwners.get(occurrence.id);
        if (occurrenceOwner && occurrenceOwner !== variant.id) validationError("An occurrence cannot be re-parented to another Variant.");
      }
    }
  }
}

function topologicalQuestionItems(items: ChangeSetItem[]): ChangeSetItem[] {
  const keys = new Map(items.map((item) => [itemKey(item), item]));
  const dependencies = new Map(items.map((item) => [itemKey(item), new Set<string>()]));
  const packageItems = new Map<string, string>();
  const taxonomyItems = new Map<string, string>();
  const browseItems = new Map<string, string>();
  for (const item of items) {
    if (item.resourceType === "question.package") packageItems.set(item.resourceId, itemKey(item));
    if (item.resourceType === "question.taxonomy") taxonomyItems.set(item.resourceId, itemKey(item));
    if (item.resourceType === "question.browse") browseItems.set(item.resourceId, itemKey(item));
  }
  for (const item of items) {
    const deps = dependencies.get(itemKey(item))!;
    const snapshot = item.proposedSnapshot;
    const packageDependency = packageItems.get(String(snapshot.packageId ?? item.resourceId));
    if (packageDependency && packageDependency !== itemKey(item)) deps.add(packageDependency);
    if (item.resourceType === "question.taxonomy") addDependency(deps, taxonomyItems.get(String(snapshot.parentId)));
    if (item.resourceType === "question.browse") {
      addDependency(deps, browseItems.get(String(snapshot.parentId)));
      addDependency(deps, taxonomyItems.get(String(snapshot.taxonomyNodeId)));
    }
    if (item.resourceType === "question.item") {
      for (const assignment of snapshot.taxonomyAssignments as unknown as Array<{ taxonomyNodeId: string }>) addDependency(deps, taxonomyItems.get(assignment.taxonomyNodeId));
    }
  }

  const ordered: ChangeSetItem[] = [];
  const remaining = new Set(keys.keys());
  while (remaining.size) {
    const candidates = [...remaining].filter((key) => [...dependencies.get(key)!].every((dependency) => !remaining.has(dependency)));
    candidates.sort((left, right) => itemSort(keys.get(left)!, keys.get(right)!));
    const selected = candidates[0];
    if (!selected) validationError("Question publication dependencies contain a cycle.");
    ordered.push(keys.get(selected)!);
    remaining.delete(selected);
  }
  return ordered;
}

function describeQuestionItem(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation): ChangePresentation {
  const next = proposed as unknown as QuestionItemContent;
  const previous = operation === "CREATE" ? null : before as unknown as QuestionItemContent;
  const nextOccurrences = countOccurrences(next);
  const previousOccurrences = previous ? countOccurrences(previous) : 0;
  const fieldDiffs: ChangePresentation["fieldDiffs"] = [];
  if (!previous || previous.displayOrder !== next.displayOrder) fieldDiffs.push({ path: "displayOrder", label: "الترتيب", before: previous?.displayOrder, after: next.displayOrder });
  if (!previous || previous.primaryVariantId !== next.primaryVariantId) fieldDiffs.push({ path: "primaryVariantId", label: "الصيغة الأساسية", before: previous ? "محددة" : undefined, after: "محددة" });
  if (!previous || previous.variants.length !== next.variants.length || !sameJson(previous.variants, next.variants)) fieldDiffs.push({ path: "variants", label: "الصيغ", before: previous?.variants.length, after: next.variants.length });
  if (!previous || !sameJson(previous.sharedAnswer, next.sharedAnswer)) fieldDiffs.push({ path: "sharedAnswer", label: "الجواب", before: previous?.sharedAnswer ? "موجود" : "غير موجود", after: next.sharedAnswer ? "موجود" : "غير موجود" });
  if (!previous || previousOccurrences !== nextOccurrences) fieldDiffs.push({ path: "occurrences", label: "المصادر", before: previousOccurrences, after: nextOccurrences });
  if (!previous || !sameJson(previous.taxonomyAssignments, next.taxonomyAssignments)) fieldDiffs.push({ path: "taxonomyAssignments", label: "التصنيف", before: previous?.taxonomyAssignments.length, after: next.taxonomyAssignments.length });
  return {
    resourceLabel: `سؤال #${next.displayOrder}`,
    resourceSubtitle: `${next.variants.length} ${next.variants.length === 1 ? "صيغة" : "صيغ"} · ${nextOccurrences} ${nextOccurrences === 1 ? "ورود" : "ورود"}`,
    changeSummary: operation === "CREATE" ? "سؤال جديد كامل" : `${fieldDiffs.length} جوانب تعليمية معدّلة`,
    areaLabel: AREA_LABEL,
    fieldDiffs,
  };
}

function packageSnapshot(value: QuestionPackageContent | (Omit<QuestionPackageContent, "assetBindings"> & { assetBindings?: QuestionPackageContent["assetBindings"] })): ChangeSnapshot {
  return normalizePackage({
    packageKey: value.packageKey,
    title: value.title,
    subjectKey: value.subjectKey,
    language: value.language,
    contentRevision: value.contentRevision,
    bankBrowseMode: value.bankBrowseMode,
    bankBrowseEntryKey: value.bankBrowseEntryKey,
    bankBrowseEntryLabel: value.bankBrowseEntryLabel,
    bankBrowseEntryOrder: value.bankBrowseEntryOrder,
    sourceAssetId: value.sourceAssetId,
    assetBindings: value.assetBindings ?? [],
  });
}
function taxonomySnapshot(value: QuestionTaxonomyContent): ChangeSnapshot {
  return normalizeTaxonomy({
    packageId: value.packageId,
    nodeKey: value.nodeKey,
    label: value.label,
    kind: value.kind,
    parentId: value.parentId,
    displayOrder: value.displayOrder,
  });
}
function browseSnapshot(value: QuestionBrowseContent): ChangeSnapshot {
  return normalizeBrowse({
    packageId: value.packageId,
    nodeKey: value.nodeKey,
    label: value.label,
    nodeType: value.nodeType,
    parentId: value.parentId,
    displayOrder: value.displayOrder,
    taxonomyNodeId: value.taxonomyNodeId,
    includeDescendants: value.includeDescendants,
  });
}
function questionSnapshot(value: { packageId: string; displayOrder: number; primaryVariantId: string; taxonomyAssignments: Array<{ taxonomyNodeId: string; role: string; position: number }>; variants: Array<{ id: string; displayOrder: number; content: CanonicalRichDocument; occurrences: QuestionOccurrenceContent[] }>; sharedAnswer: CanonicalRichDocument | null }): ChangeSnapshot {
  return normalizeQuestionItem({
    packageId: value.packageId,
    displayOrder: value.displayOrder,
    primaryVariantId: value.primaryVariantId,
    taxonomyAssignments: value.taxonomyAssignments.map(({ taxonomyNodeId, role, position }) => ({ taxonomyNodeId, role, position })),
    variants: value.variants.map((variant) => ({ id: variant.id, displayOrder: variant.displayOrder, content: variant.content, occurrences: variant.occurrences.map(stripOccurrence) })),
    sharedAnswer: value.sharedAnswer,
  });
}

function stripOccurrence(value: QuestionOccurrenceContent): QuestionOccurrenceContent {
  return { id: value.id, displayOrder: value.displayOrder, sourceKind: value.sourceKind, year: value.year, roundCode: value.roundCode, session: value.session, sourceName: value.sourceName, notes: value.notes, rawLabel: value.rawLabel, branches: value.branches, qualifiers: value.qualifiers };
}

function assertImmutableOwnership(type: QuestionChangeResourceType, before: ChangeSnapshot, proposed: ChangeSnapshot): void {
  if (type === "question.package") {
    for (const key of ["packageKey", "subjectKey", "language", "contentRevision", "sourceAssetId", "assetBindings"] as const) if (!sameJson(before[key], proposed[key])) validationError(`Question Package ${key} is immutable after creation.`);
  }
  if (["question.taxonomy", "question.browse", "question.item"].includes(type) && before.packageId !== proposed.packageId) validationError("Question resource Package ownership is immutable.");
}

function assertExistingQuestionChildrenPreserved(before: ChangeSnapshot, proposed: ChangeSnapshot): void {
  const previous = before as unknown as QuestionItemContent;
  const next = proposed as unknown as QuestionItemContent;
  const variants = new Map(next.variants.map((variant) => [variant.id, variant]));
  for (const variant of previous.variants) {
    const proposedVariant = variants.get(variant.id);
    if (!proposedVariant) validationError("Existing Variants cannot be removed by omission.");
    const occurrenceIds = new Set(proposedVariant.occurrences.map((occurrence) => occurrence.id));
    if (variant.occurrences.some((occurrence) => !occurrenceIds.has(occurrence.id))) validationError("Existing occurrences cannot be removed by omission.");
  }
}

function assertNoCycle(id: string, nodes: Map<string, ChangeSnapshot>, label: string): void {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current) {
    if (seen.has(current)) validationError(`${label} hierarchy contains a cycle.`);
    seen.add(current);
    const node = nodes.get(current);
    current = node?.parentId === null || node?.parentId === undefined ? null : String(node.parentId);
  }
}

function objectWithKeys(value: unknown, keys: string[], path = "snapshot"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) validationError(`${path} must be an object.`);
  const input = value as Record<string, unknown>;
  const allowed = new Set(keys);
  if (Object.keys(input).some((key) => !allowed.has(key)) || keys.some((key) => !(key in input))) validationError(`${path} fields are invalid.`);
  return input;
}

function normalizedText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") validationError(`${field} must be text.`);
  const clean = value.normalize("NFKC").trim();
  if (clean.length < min || clean.length > max) validationError(`${field} length is invalid.`);
  return clean;
}

function exactText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) validationError(`${field} is invalid.`);
  return value;
}

function nullableText(value: unknown, field: string, max: number): string | null {
  if (value === null) return null;
  return exactText(value, field, 1, max);
}

function semanticKey(value: unknown, field: string): string {
  const clean = normalizedText(value, field, 1, 120).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(clean)) validationError(`${field} must be a portable semantic key.`);
  return clean;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) validationError(`${field} is invalid.`);
  return value as T;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) validationError(`${field} must be a positive integer.`);
  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) validationError(`${field} must be a non-negative integer.`);
  return Number(value);
}

function nullableYear(value: unknown, field: string): number | null {
  if (value === null) return null;
  const year = positiveInteger(value, field);
  if (year < 1900 || year > 2200) validationError(`${field} is outside the supported range.`);
  return year;
}

function uuidValue(value: unknown, field: string): string {
  assertUuid(value, field);
  return value;
}

function nullableUuid(value: unknown, field: string): string | null {
  if (value === null) return null;
  return uuidValue(value, field);
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null) return null;
  if (typeof value !== "boolean") validationError(`${field} must be boolean or null.`);
  return value;
}

function arrayValue(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > 10_000) validationError(`${field} must be an array.`);
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  const items = arrayValue(value, field).map((item, index) => exactText(item, `${field}[${index}]`, 1, 160));
  assertUnique(items, `${field} values must be unique.`);
  return items;
}

function assertCanonical(value: unknown, meaningful: boolean): asserts value is CanonicalRichDocument {
  try { assertCanonicalRichDocument(value, meaningful); }
  catch (error) { throw mapQuestionError(error); }
}

function assertUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) validationError(`${field} must be a stable UUID.`);
}

function assertUnique(values: Array<string | number>, message: string): void {
  if (new Set(values).size !== values.length) validationError(message);
}

function uniqueToken(target: Set<string>, value: string, message: string): void {
  if (target.has(value)) validationError(message);
  target.add(value);
}

function addDependency(target: Set<string>, dependency?: string): void {
  if (dependency) target.add(dependency);
}

function itemKey(item: ChangeSetItem): string {
  return `${item.resourceType}:${item.resourceId}`;
}

function itemSort(left: ChangeSetItem, right: ChangeSetItem): number {
  const priorities: Record<string, number> = { "question.package": 0, "question.taxonomy": 1, "question.browse": 2, "question.item": 3 };
  return (priorities[left.resourceType] ?? 99) - (priorities[right.resourceType] ?? 99) || left.resourceId.localeCompare(right.resourceId);
}

function fieldLabel(path: string): string {
  const key = path.split(".").at(-1) ?? path;
  return ({ title: "العنوان", label: "العنوان", displayOrder: "الترتيب", parentId: "القسم", taxonomyNodeId: "الموضوع", bankBrowseMode: "نمط التصفح", bankBrowseEntryLabel: "عنوان المدخل" } as Record<string, string>)[key] ?? key;
}

function countOccurrences(question: QuestionItemContent): number {
  return question.variants.reduce((total, variant) => total + variant.occurrences.length, 0);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mapQuestionError(error: unknown): ChangeManagementError {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof QuestionDomainError) {
    return new ChangeManagementError(
      error.code === "QUESTION_DOMAIN_CONFLICT" || error.code === "QUESTION_DOMAIN_DUPLICATE" ? "CHANGE_CONFLICT" : error.code === "QUESTION_DOMAIN_NOT_FOUND" ? "CHANGE_NOT_FOUND" : "CHANGE_VALIDATION_FAILED",
      error.message,
      error,
    );
  }
  return new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Question domain validation failed.", error);
}

function validationError(message: string): never {
  throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", message);
}

function notFound(label: string): never {
  throw new ChangeManagementError("CHANGE_NOT_FOUND", `${label} was not found.`);
}
