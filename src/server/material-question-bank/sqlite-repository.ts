import type { AdminActor } from "../admin-auth";
import type { ContentDatabase } from "../content";
import type { MaterialQuestionBankLayoutContent, MaterialQuestionBankLayoutEntity, MaterialQuestionBankNodeContent } from "./contracts";
import { MaterialQuestionBankError } from "./errors";

type LayoutRow = { material_id: string; root_presentation: "DIRECT" | "CARDS"; created_at: number; updated_at: number; updated_by: string; revision: number };
type NodeRow = {
  id: string; material_id: string; node_key: string; label: string; node_type: "GROUP" | "BANK"; parent_id: string | null;
  display_order: number; group_presentation: "CARDS" | "SWITCHER" | null; package_id: string | null;
  target_mode: "ALL_PACKAGE_QUESTIONS" | "TAXONOMY_FILTER" | null; taxonomy_node_id: string | null;
  include_descendants: number | null; enabled: number;
};

export class SQLiteMaterialQuestionBankRepository {
  constructor(private readonly database: ContentDatabase, private readonly clock: () => number = Date.now) {}

  get(materialId: string): MaterialQuestionBankLayoutEntity | null {
    const layout = this.database.client.prepare("select * from material_question_bank_layouts where material_id = ?").get(materialId) as LayoutRow | undefined;
    if (!layout) return null;
    const nodes = this.database.client.prepare("select * from material_question_bank_nodes where material_id = ? order by coalesce(parent_id,''), display_order, id").all(materialId) as NodeRow[];
    return {
      materialId: layout.material_id,
      rootPresentation: layout.root_presentation,
      nodes: nodes.map(toNode),
      createdAt: Number(layout.created_at), updatedAt: Number(layout.updated_at), updatedBy: layout.updated_by, revision: Number(layout.revision),
    };
  }

  save(input: { content: MaterialQuestionBankLayoutContent; expectedRevision: number; actor: AdminActor; operation: "CREATE" | "UPDATE" }): MaterialQuestionBankLayoutEntity {
    const current = this.get(input.content.materialId);
    if (input.operation === "CREATE") {
      if (current || input.expectedRevision !== 0) throw new MaterialQuestionBankError("MATERIAL_BANK_CONFLICT", "Layout already exists.");
      const now = this.clock();
      this.database.client.prepare("insert into material_question_bank_layouts(material_id,root_presentation,created_at,updated_at,updated_by,revision) values(?,?,?,?,?,1)")
        .run(input.content.materialId, input.content.rootPresentation, now, now, input.actor.actorUserId);
      this.insertNodes(input.content.materialId, input.content.nodes);
      return this.require(input.content.materialId);
    }
    if (!current || current.revision !== input.expectedRevision) throw new MaterialQuestionBankError("MATERIAL_BANK_CONFLICT", "Layout changed before publication.");
    const updated = this.database.client.prepare("update material_question_bank_layouts set root_presentation=?,updated_at=?,updated_by=?,revision=revision+1 where material_id=? and revision=?")
      .run(input.content.rootPresentation, this.clock(), input.actor.actorUserId, input.content.materialId, input.expectedRevision);
    if (updated.changes !== 1) throw new MaterialQuestionBankError("MATERIAL_BANK_CONFLICT", "Layout changed before publication.");
    this.replaceNodes(input.content.materialId, input.content.nodes);
    return this.require(input.content.materialId);
  }

  private require(materialId: string): MaterialQuestionBankLayoutEntity {
    const value = this.get(materialId);
    if (!value) throw new MaterialQuestionBankError("MATERIAL_BANK_NOT_FOUND", "Material Question Bank layout was not found.");
    return value;
  }

  private insertNodes(materialId: string, nodes: MaterialQuestionBankNodeContent[]): void {
    const insert = this.database.client.prepare(`insert into material_question_bank_nodes
      (id,material_id,node_key,label,node_type,parent_id,display_order,group_presentation,package_id,target_mode,taxonomy_node_id,include_descendants,enabled)
      values(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const node of topological(nodes)) insert.run(...nodeValues(materialId, node));
  }

  private replaceNodes(materialId: string, nodes: MaterialQuestionBankNodeContent[]): void {
    const existing = this.database.client.prepare("select id from material_question_bank_nodes where material_id=? order by id").all(materialId) as Array<{ id: string }>;
    const proposedIds = new Set(nodes.map((node) => node.id));
    if (existing.some((row) => !proposedIds.has(row.id))) {
      throw new MaterialQuestionBankError("MATERIAL_BANK_INVALID", "Published placement nodes must be disabled instead of removed.");
    }
    this.database.client.prepare("update material_question_bank_nodes set display_order=display_order+100000 where material_id=?").run(materialId);
    const exists = new Set(existing.map((row) => row.id));
    const update = this.database.client.prepare(`update material_question_bank_nodes set
      node_key=?,label=?,node_type=?,parent_id=?,display_order=?,group_presentation=?,package_id=?,target_mode=?,taxonomy_node_id=?,include_descendants=?,enabled=?
      where id=? and material_id=?`);
    const insert = this.database.client.prepare(`insert into material_question_bank_nodes
      (id,material_id,node_key,label,node_type,parent_id,display_order,group_presentation,package_id,target_mode,taxonomy_node_id,include_descendants,enabled)
      values(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const node of topological(nodes)) {
      if (exists.has(node.id)) {
        update.run(node.nodeKey, node.label, node.nodeType, node.parentId, node.displayOrder, node.groupPresentation, node.packageId, node.targetMode, node.taxonomyNodeId, booleanInt(node.includeDescendants), booleanInt(node.enabled), node.id, materialId);
      } else insert.run(...nodeValues(materialId, node));
    }
  }
}

function nodeValues(materialId: string, node: MaterialQuestionBankNodeContent): unknown[] {
  return [node.id, materialId, node.nodeKey, node.label, node.nodeType, node.parentId, node.displayOrder, node.groupPresentation, node.packageId, node.targetMode, node.taxonomyNodeId, booleanInt(node.includeDescendants), booleanInt(node.enabled)];
}

function booleanInt(value: boolean | null): number | null { return value === null ? null : value ? 1 : 0; }

function toNode(row: NodeRow): MaterialQuestionBankNodeContent {
  return {
    id: row.id, nodeKey: row.node_key, label: row.label, nodeType: row.node_type, parentId: row.parent_id,
    displayOrder: Number(row.display_order), groupPresentation: row.group_presentation, packageId: row.package_id,
    targetMode: row.target_mode, taxonomyNodeId: row.taxonomy_node_id,
    includeDescendants: row.include_descendants === null ? null : Boolean(row.include_descendants), enabled: Boolean(row.enabled),
  };
}

function topological(nodes: MaterialQuestionBankNodeContent[]): MaterialQuestionBankNodeContent[] {
  const result: MaterialQuestionBankNodeContent[] = [];
  const remaining = new Map(nodes.map((node) => [node.id, node]));
  while (remaining.size) {
    const ready = [...remaining.values()].filter((node) => node.parentId === null || result.some((item) => item.id === node.parentId));
    if (!ready.length) throw new MaterialQuestionBankError("MATERIAL_BANK_INVALID", "Layout hierarchy cannot be persisted.");
    ready.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
    for (const node of ready) { result.push(node); remaining.delete(node.id); }
  }
  return result;
}
