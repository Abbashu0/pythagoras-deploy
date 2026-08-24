import { and, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../admin-auth";
import { createAssetService, MAX_JSON_INSPECTION_BYTES } from "../assets";
import { SQLiteAssetRepository } from "../assets/sqlite-asset-repository";
import { createCanonicalContentRepository } from "../canonical-content";
import { createChangeManagementService } from "../change-management/service";
import { changeSetItems, changeSets, questionPackages } from "../content/schema";
import type { ContentDatabase } from "../content";
import { inspectQuestionPackageJson, type QuestionPackageDiagnostic, type QuestionPackageV1 } from "../question-packages";
import { AssetLibraryQuestionPackageAssetResolver, getEligibleQuestionPackage, QuestionPackageMaterializer, SQLiteQuestionRepository, type QuestionMaterializationPlan, type QuestionPackageContent } from "../questions";
import type { CompactQuestionPackageStageResult, ManualQuestionPackageInput, QuestionPackageImportPreflight } from "./contracts";
import { QuestionImportError } from "./errors";

const ACTIVE_CHANGE_STATUSES = ["DRAFT", "SUBMITTED", "NEEDS_CHANGES", "APPROVED", "CONFLICTED"] as const;

export class QuestionPackageImportService {
  private readonly assets;
  private readonly canonical;
  private readonly questionRepository;
  private readonly assetRepository;
  private readonly changes;

  constructor(private readonly database: ContentDatabase) {
    this.assets = createAssetService(database);
    this.canonical = createCanonicalContentRepository(database);
    this.questionRepository = new SQLiteQuestionRepository(database);
    this.assetRepository = new SQLiteAssetRepository(database);
    this.changes = createChangeManagementService(database);
  }

  async preflight(assetId: string, actor: AdminActor): Promise<QuestionPackageImportPreflight> {
    assertActor(actor);
    const validation = await this.loadAndValidate(assetId);
    const source = validation.package;
    const warnings = validation.diagnostics.filter((item) => item.severity === "WARNING");
    const blockers = validation.diagnostics
      .filter((item) => item.severity === "ERROR")
      .map(compactDiagnostic);
    if (!source) return emptyPreflight(assetId, validation.status, warnings, blockers);

    const usedRefs = collectUsedAssetRefs(source);
    let resolvedAssets = 0;
    for (const entry of source.assetsManifest) {
      const resolved = this.assetRepository.findBySha256(entry.sha256);
      if (resolved && resolved.byteSize === entry.byteSize && resolved.mimeType === entry.mimeType) resolvedAssets += 1;
      else if (usedRefs.has(entry.ref)) blockers.push({ code: "QUESTION_ASSET_UNRESOLVED", message: `Required package asset is unresolved: ${entry.ref}.` });
    }
    const unresolvedAssets = source.assetsManifest.length - resolvedAssets;
    const alreadyImported = Boolean(this.questionRepository.getPackage(source.package.id));
    const existingChangeSetId = this.findActivePackageChangeSet(source.package.id);
    if (!alreadyImported && !existingChangeSetId) blockers.push(...this.findCanonicalCollisions(source));
    const occurrences = source.questions.reduce((total, question) => total + question.variants.reduce((sum, variant) => sum + variant.occurrences.length, 0), 0);
    const variants = source.questions.reduce((total, question) => total + question.variants.length, 0);
    const eligibleStatus = validation.status === "VALID" || validation.status === "VALID_WITH_WARNINGS";
    return {
      assetId,
      status: validation.status,
      eligible: eligibleStatus && blockers.length === 0 && !alreadyImported,
      acknowledgementRequired: validation.status === "VALID_WITH_WARNINGS" && !alreadyImported,
      alreadyImported,
      existingChangeSetId,
      package: {
        id: source.package.id,
        key: source.package.key,
        title: source.package.title,
        subjectKey: source.package.subjectKey,
        language: source.package.language,
        schemaVersion: source.schemaVersion,
        contentRevision: source.package.contentRevision,
        bankBrowseMode: source.bankBrowse.mode,
        bankBrowseEntry: { ...source.bankBrowse.entry },
      },
      counts: {
        taxonomy: source.taxonomy.length,
        browseNodes: source.bankBrowse.nodes.length,
        questions: source.questions.length,
        variants,
        occurrences,
        manifestAssets: source.assetsManifest.length,
        usedAssets: usedRefs.size,
        resolvedAssets,
        unresolvedAssets,
        estimatedChangeItems: 1 + source.taxonomy.length + source.bankBrowse.nodes.length + source.questions.length,
      },
      warnings,
      blockers: uniqueBlockers(blockers),
    };
  }

  async stage(assetId: string, acknowledgeWarnings: boolean, actor: AdminActor): Promise<CompactQuestionPackageStageResult> {
    const preflight = await this.preflight(assetId, actor);
    if (!preflight.package) throw new QuestionImportError("QUESTION_IMPORT_INELIGIBLE", "Asset is not a supported Question Package.");
    if (preflight.alreadyImported) return { outcome: "ALREADY_IMPORTED", packageId: preflight.package.id, changeSetId: null, changeSetRevision: null, itemCount: 0 };
    if (preflight.existingChangeSetId) return { outcome: "EXISTING_DRAFT", packageId: preflight.package.id, changeSetId: preflight.existingChangeSetId, changeSetRevision: this.requireChangeSetRevision(preflight.existingChangeSetId), itemCount: this.countChangeSetItems(preflight.existingChangeSetId) };
    if (!preflight.eligible || preflight.blockers.length) throw new QuestionImportError("QUESTION_IMPORT_CONFLICT", "Question Package preflight contains blocking issues.");
    if (preflight.acknowledgementRequired && !acknowledgeWarnings) throw new QuestionImportError("QUESTION_IMPORT_ACKNOWLEDGEMENT_REQUIRED", "Warnings must be acknowledged before staging.");

    const validation = await this.loadAndValidate(assetId);
    const materializer = new QuestionPackageMaterializer(new AssetLibraryQuestionPackageAssetResolver(this.assetRepository));
    const plan = materializer.createPlan(getEligibleQuestionPackage(validation), actor, { sourceAssetId: assetId });
    const items = planToChangeItems(plan);
    const compact = this.changes.createBulkChangeSet({
      title: `استيراد حزمة: ${plan.package.title}`,
      description: boundedImportDescription(preflight),
      items,
    }, actor);
    return { outcome: "STAGED", packageId: plan.package.id, changeSetId: compact.changeSet.id, changeSetRevision: compact.changeSet.revision, itemCount: compact.itemCount };
  }

  createEmptyPackage(input: ManualQuestionPackageInput, actor: AdminActor): CompactQuestionPackageStageResult {
    assertActor(actor);
    const packageId = uuidv7();
    const content: QuestionPackageContent = {
      packageKey: input.packageKey,
      title: input.title,
      subjectKey: input.subjectKey,
      language: input.language,
      contentRevision: 1,
      bankBrowseMode: input.bankBrowseMode,
      bankBrowseEntryKey: input.bankBrowseEntryKey,
      bankBrowseEntryLabel: input.bankBrowseEntryLabel,
      bankBrowseEntryOrder: input.bankBrowseEntryOrder,
      sourceAssetId: null,
      assetBindings: [],
    };
    const compact = this.changes.createBulkChangeSet({
      title: `إنشاء حزمة أسئلة: ${input.title}`,
      description: "حزمة أسئلة فارغة أُنشئت يدويًا وتنتظر المراجعة والنشر قبل أن تصبح قانونية.",
      items: [{ resourceType: "question.package", resourceId: packageId, expectedRevision: 0, operation: "CREATE", desired: content }],
    }, actor);
    return { outcome: "STAGED", packageId, changeSetId: compact.changeSet.id, changeSetRevision: compact.changeSet.revision, itemCount: 1 };
  }

  listWorkspace() {
    const materials = this.canonical.getSnapshot().materials.map((item) => ({ subjectKey: item.subjectKey, label: item.label, available: item.available }));
    const packages = this.database.db.select().from(questionPackages).orderBy(questionPackages.subjectKey, questionPackages.bankBrowseEntryOrder).all();
    return { packages: packages.map((item) => ({ id: item.id, packageKey: item.packageKey, title: item.title, subjectKey: item.subjectKey, language: item.language, contentRevision: item.contentRevision, bankBrowseMode: item.bankBrowseMode, bankBrowseEntryLabel: item.bankBrowseEntryLabel, bankBrowseEntryOrder: item.bankBrowseEntryOrder, revision: item.revision })), materials };
  }

  private async loadAndValidate(assetId: string) {
    let opened;
    try { opened = await this.assets.openContent(assetId); }
    catch { throw new QuestionImportError("QUESTION_IMPORT_NOT_FOUND", "Question Package Asset could not be opened safely."); }
    if (opened.asset.mediaKind !== "json" || opened.asset.mimeType !== "application/json") {
      return { status: "GENERIC_JSON" as const, package: null, diagnostics: [] as QuestionPackageDiagnostic[] };
    }
    if (opened.asset.byteSize > MAX_JSON_INSPECTION_BYTES) throw new QuestionImportError("QUESTION_IMPORT_INELIGIBLE", "Question Package exceeds the inspection limit.");
    let parsed: unknown;
    try { parsed = JSON.parse((await new Response(opened.body).text()).replace(/^\uFEFF/u, "")); }
    catch { return { status: "INVALID" as const, package: null, diagnostics: [{ severity: "ERROR" as const, code: "JSON_PARSE_FAILED", message: "JSON could not be parsed safely.", jsonPointer: "" }] }; }
    const subjectKeys = new Set<string>(this.canonical.getSnapshot().materials.map((item) => item.subjectKey));
    return inspectQuestionPackageJson(parsed, { canonicalSubjectKeys: subjectKeys });
  }

  private findActivePackageChangeSet(packageId: string): string | null {
    const row = this.database.db.select({ id: changeSets.id }).from(changeSetItems)
      .innerJoin(changeSets, eq(changeSetItems.changeSetId, changeSets.id))
      .where(and(eq(changeSetItems.resourceType, "question.package"), eq(changeSetItems.resourceId, packageId), inArray(changeSets.status, [...ACTIVE_CHANGE_STATUSES])))
      .limit(1).get();
    return row?.id ?? null;
  }

  private findCanonicalCollisions(source: QuestionPackageV1): Array<{ code: string; message: string; entityId?: string }> {
    const blockers: Array<{ code: string; message: string; entityId?: string }> = [];
    const packageByKey = this.questionRepository.getPackageByKey(source.package.key);
    if (packageByKey) blockers.push({ code: "PACKAGE_KEY_COLLISION", message: "Package key already exists.", entityId: packageByKey.id });
    const sameSubject = this.questionRepository.listPackagesBySubject(source.package.subjectKey);
    if (sameSubject.some((item) => item.bankBrowseEntryKey === source.bankBrowse.entry.key)) blockers.push({ code: "BANK_ENTRY_KEY_COLLISION", message: "Bank Browse entry key already exists for this subject." });
    if (sameSubject.some((item) => item.bankBrowseEntryOrder === source.bankBrowse.entry.order)) blockers.push({ code: "BANK_ENTRY_ORDER_COLLISION", message: "Bank Browse entry order already exists for this subject." });
    const probes: Array<[string, string[], string]> = [
      ["TAXONOMY_ID_COLLISION", source.taxonomy.map((item) => item.id), "question_taxonomy_nodes"],
      ["BROWSE_ID_COLLISION", source.bankBrowse.nodes.map((item) => item.id), "question_bank_browse_nodes"],
      ["QUESTION_ID_COLLISION", source.questions.map((item) => item.id), "questions"],
      ["VARIANT_ID_COLLISION", source.questions.flatMap((item) => item.variants.map((variant) => variant.id)), "question_variants"],
      ["OCCURRENCE_ID_COLLISION", source.questions.flatMap((item) => item.variants.flatMap((variant) => variant.occurrences.map((occurrence) => occurrence.id))), "question_occurrences"],
    ];
    for (const [code, ids, tableName] of probes) {
      for (const group of chunks(ids, 400)) {
        if (!group.length) continue;
        const placeholders = group.map(() => "?").join(",");
        const rows = this.database.client.prepare(`select id from ${tableName} where id in (${placeholders})`).all(...group) as Array<{ id: string }>;
        blockers.push(...rows.map((row) => ({ code, message: "A canonical Question resource ID already exists.", entityId: row.id })));
      }
    }
    return blockers;
  }

  private requireChangeSetRevision(id: string): number {
    const row = this.database.db.select({ revision: changeSets.revision }).from(changeSets).where(eq(changeSets.id, id)).get();
    if (!row) throw new QuestionImportError("QUESTION_IMPORT_CONFLICT", "Existing import Change Set disappeared.");
    return row.revision;
  }

  private countChangeSetItems(id: string): number {
    const row = this.database.client.prepare("select count(*) as count from change_set_items where change_set_id = ?").get(id) as { count: number };
    return Number(row.count);
  }
}

function planToChangeItems(plan: QuestionMaterializationPlan) {
  return [
    { resourceType: "question.package", resourceId: plan.package.id, expectedRevision: 0, operation: "CREATE" as const, desired: { packageKey: plan.package.packageKey, title: plan.package.title, subjectKey: plan.package.subjectKey, language: plan.package.language, contentRevision: plan.package.contentRevision, bankBrowseMode: plan.package.bankBrowseMode, bankBrowseEntryKey: plan.package.bankBrowseEntryKey, bankBrowseEntryLabel: plan.package.bankBrowseEntryLabel, bankBrowseEntryOrder: plan.package.bankBrowseEntryOrder, sourceAssetId: plan.package.sourceAssetId, assetBindings: plan.assetBindings.map(({ packageId: _packageId, ...binding }) => binding) } },
    ...plan.taxonomy.map((node) => ({ resourceType: "question.taxonomy", resourceId: node.id, expectedRevision: 0, operation: "CREATE" as const, desired: { packageId: node.packageId, nodeKey: node.nodeKey, label: node.label, kind: node.kind, parentId: node.parentId, displayOrder: node.displayOrder } })),
    ...plan.browseNodes.map((node) => ({ resourceType: "question.browse", resourceId: node.id, expectedRevision: 0, operation: "CREATE" as const, desired: { packageId: node.packageId, nodeKey: node.nodeKey, label: node.label, nodeType: node.nodeType, parentId: node.parentId, displayOrder: node.displayOrder, taxonomyNodeId: node.taxonomyNodeId, includeDescendants: node.includeDescendants } })),
    ...plan.questions.map((question) => ({ resourceType: "question.item", resourceId: question.id, expectedRevision: 0, operation: "CREATE" as const, desired: { packageId: question.packageId, displayOrder: question.displayOrder, primaryVariantId: question.primaryVariantId, taxonomyAssignments: question.taxonomyAssignments.map(({ taxonomyNodeId, role, position }) => ({ taxonomyNodeId, role, position })), variants: question.variants.map((variant) => ({ id: variant.id, displayOrder: variant.displayOrder, content: variant.content, occurrences: variant.occurrences.map(({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers }) => ({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers })) })), sharedAnswer: question.sharedAnswer } })),
  ];
}

function collectUsedAssetRefs(source: QuestionPackageV1): Set<string> {
  const refs = new Set<string>();
  for (const question of source.questions) for (const document of [...question.variants.map((item) => item.content), question.sharedAnswer].filter(Boolean)) for (const block of document!.blocks) if (block.type === "image") refs.add(block.assetRef);
  return refs;
}

function boundedImportDescription(preflight: QuestionPackageImportPreflight): string {
  const counts = preflight.counts;
  return `استيراد أولي من Asset ${preflight.assetId}. الحزمة ${preflight.package?.key}; ${counts.questions} سؤال، ${counts.variants} صيغة، ${counts.occurrences} ورود، ${counts.taxonomy} تصنيف، ${counts.browseNodes} مسار، ${counts.usedAssets} أصل مستخدم. التحذيرات: ${preflight.warnings.length}.`;
}

function emptyPreflight(assetId: string, status: QuestionPackageImportPreflight["status"], warnings: QuestionPackageDiagnostic[], blockers: QuestionPackageImportPreflight["blockers"]): QuestionPackageImportPreflight {
  return { assetId, status, eligible: false, acknowledgementRequired: false, alreadyImported: false, existingChangeSetId: null, package: null, counts: { taxonomy: 0, browseNodes: 0, questions: 0, variants: 0, occurrences: 0, manifestAssets: 0, usedAssets: 0, resolvedAssets: 0, unresolvedAssets: 0, estimatedChangeItems: 0 }, warnings, blockers };
}

function compactDiagnostic(item: QuestionPackageDiagnostic) { return { code: item.code, message: item.message, ...(item.entityId ? { entityId: item.entityId } : {}) }; }
function uniqueBlockers(items: QuestionPackageImportPreflight["blockers"]) { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.code}:${item.entityId ?? ""}:${item.message}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function chunks<T>(items: T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
function assertActor(actor: AdminActor) { if (!actor.actorUserId || !["OWNER", "ADMIN"].includes(actor.actorRole)) throw new QuestionImportError("QUESTION_IMPORT_INVALID", "Authenticated Admin actor is required."); }
