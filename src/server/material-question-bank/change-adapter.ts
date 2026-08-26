import type { AdminActor } from "../admin-auth";
import type { ChangeOperation, ChangePresentation, ChangeResourceAdapter, ChangeSetCoordinator, ChangeSetItem, ChangeSetValidationPhase, ChangeSnapshot, ResourceState } from "../change-management";
import { ChangeManagementError, deriveChangedPaths, validateChangeSnapshot } from "../change-management";
import type { ContentDatabase } from "../content";
import { MATERIAL_QUESTION_BANK_RESOURCE_TYPE, type MaterialQuestionBankLayoutContent } from "./contracts";
import { MaterialQuestionBankError } from "./errors";
import { SQLiteMaterialQuestionBankRepository } from "./sqlite-repository";
import { assertMaterialQuestionBankReferences, assertPublishableMaterialQuestionBankLayout, normalizeMaterialQuestionBankLayout } from "./validation";

export class MaterialQuestionBankChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = MATERIAL_QUESTION_BANK_RESOURCE_TYPE;
  readonly areaLabel = "المواد / بنك الأسئلة";
  readonly mergeStrategy = "CONSERVATIVE" as const;

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    const current = new SQLiteMaterialQuestionBankRepository(database).get(resourceId);
    if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "Material Question Bank layout was not found.");
    return { resourceId, revision: current.revision, snapshot: snapshot(current) };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    try {
      const proposed = normalizeMaterialQuestionBankLayout(desired);
      if (proposed.materialId !== resourceId) invalid("Material layout identity is immutable.");
      const existing = new SQLiteMaterialQuestionBankRepository(database).get(resourceId);
      const current = operation === "CREATE" ? { resourceId, revision: 0, snapshot: {} as ChangeSnapshot } : this.loadCurrent(database, resourceId);
      if (operation === "CREATE" && existing) conflict("Material layout already exists.");
      if (operation === "UPDATE" && !existing) conflict("Material layout does not exist.");
      if (existing) assertPublishedNodesPreserved(existing.nodes.map((node) => node.id), proposed.nodes.map((node) => node.id));
      assertMaterialQuestionBankReferences(database, proposed);
      const proposedSnapshot = snapshot(proposed);
      validateChangeSnapshot(proposedSnapshot);
      const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
      if (!changedPaths.length) invalid("Layout proposal does not change Product state.");
      return { current, proposedSnapshot, changedPaths };
    } catch (error) { throw mapError(error); }
  }

  validateSnapshot(value: ChangeSnapshot): void {
    try { validateChangeSnapshot(value); normalizeMaterialQuestionBankLayout(value); } catch (error) { throw mapError(error); }
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const after = normalizeMaterialQuestionBankLayout(proposed);
    const previous = Object.keys(before).length ? normalizeMaterialQuestionBankLayout(before) : null;
    const fieldDiffs = [
      { path: "rootPresentation", label: "طريقة دخول الطالب", before: previous?.rootPresentation, after: after.rootPresentation },
      { path: "nodes", label: "بنية البنك", before: snapshot({ materialId: after.materialId, rootPresentation: after.rootPresentation, nodes: previous?.nodes ?? [] }).nodes, after: snapshot(after).nodes },
    ];
    return {
      resourceLabel: materialLabel(after.materialId),
      resourceSubtitle: operation === "CREATE" ? "تخطيط جديد لبنك المادة" : `تحديث تخطيط · ${resourceId}`,
      changeSummary: `${after.nodes.length} عقدة في التخطيط المقترح`,
      areaLabel: this.areaLabel,
      fieldDiffs,
    };
  }

  apply(database: ContentDatabase, resourceId: string, value: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may publish Material Question Bank layouts.");
    try {
      const clean = normalizeMaterialQuestionBankLayout(value);
      if (clean.materialId !== resourceId) invalid("Material layout identity is immutable.");
      assertPublishableMaterialQuestionBankLayout(clean);
      assertMaterialQuestionBankReferences(database, clean);
      const saved = new SQLiteMaterialQuestionBankRepository(database).save({ content: clean, expectedRevision, actor, operation });
      return { resourceId, revision: saved.revision, snapshot: snapshot(saved) };
    } catch (error) { throw mapError(error); }
  }
}

export class MaterialQuestionBankChangeSetCoordinator implements ChangeSetCoordinator {
  validate(database: ContentDatabase, items: ChangeSetItem[], _phase: ChangeSetValidationPhase): void {
    for (const item of items) {
      if (item.resourceType !== MATERIAL_QUESTION_BANK_RESOURCE_TYPE) continue;
      try {
        const value = normalizeMaterialQuestionBankLayout(item.proposedSnapshot);
        assertPublishableMaterialQuestionBankLayout(value);
        assertMaterialQuestionBankReferences(database, value);
      } catch (error) { throw mapError(error); }
    }
  }
  planPublication(_database: ContentDatabase, items: ChangeSetItem[]): ChangeSetItem[] { return items; }
}

function snapshot(value: MaterialQuestionBankLayoutContent): ChangeSnapshot {
  return structuredClone({
    materialId: value.materialId,
    rootPresentation: value.rootPresentation,
    nodes: value.nodes,
  }) as unknown as ChangeSnapshot;
}
function materialLabel(id: string): string { return `بنك أسئلة المادة · ${id}`; }
function assertPublishedNodesPreserved(current: string[], proposed: string[]): void {
  const ids = new Set(proposed);
  if (current.some((id) => !ids.has(id))) invalid("Published placement nodes must be disabled instead of removed.");
}
function invalid(message: string): never { throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", message); }
function conflict(message: string): never { throw new ChangeManagementError("CHANGE_CONFLICT", message); }
function mapError(error: unknown): Error {
  if (error instanceof ChangeManagementError) return error;
  if (error instanceof MaterialQuestionBankError) {
    return new ChangeManagementError(error.code === "MATERIAL_BANK_CONFLICT" ? "CHANGE_CONFLICT" : error.code === "MATERIAL_BANK_NOT_FOUND" ? "CHANGE_NOT_FOUND" : "CHANGE_VALIDATION_FAILED", error.message, error);
  }
  return error instanceof Error ? error : new Error("Material Question Bank operation failed.");
}
