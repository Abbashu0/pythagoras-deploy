import { validate as isUuid } from "uuid";
import type { ContentDatabase } from "../content";
import type { MaterialQuestionBankLayoutContent, MaterialQuestionBankNodeContent } from "./contracts";
import { MaterialQuestionBankError } from "./errors";

const ROOTS = new Set(["DIRECT", "CARDS"]);
const GROUP_PRESENTATIONS = new Set(["CARDS", "SWITCHER"]);
const TARGET_MODES = new Set(["ALL_PACKAGE_QUESTIONS", "TAXONOMY_FILTER"]);

function invalid(message: string): never {
  throw new MaterialQuestionBankError("MATERIAL_BANK_INVALID", message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid("Material Question Bank snapshot contains unsupported fields.");
}

function text(value: unknown, label: string, max: number, key = false): string {
  if (typeof value !== "string") invalid(`${label} must be text.`);
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > max) invalid(`${label} length is invalid.`);
  if (key && !/^[a-z0-9-]+$/u.test(normalized)) invalid(`${label} must be a semantic key.`);
  return normalized;
}

function nullableId(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value || value.length > 80) invalid(`${label} is invalid.`);
  return value;
}

function order(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10_000) invalid("Node displayOrder is invalid.");
  return value;
}

function normalizeNode(value: unknown): MaterialQuestionBankNodeContent {
  const input = object(value, "Node");
  exact(input, ["id", "nodeKey", "label", "nodeType", "parentId", "displayOrder", "groupPresentation", "packageId", "targetMode", "taxonomyNodeId", "includeDescendants", "enabled"]);
  if (typeof input.id !== "string" || !isUuid(input.id)) invalid("Node ID must be a UUID.");
  const nodeType = input.nodeType;
  if (nodeType !== "GROUP" && nodeType !== "BANK") invalid("Node type is invalid.");
  const groupPresentation = input.groupPresentation === null ? null : String(input.groupPresentation);
  const targetMode = input.targetMode === null ? null : String(input.targetMode);
  const packageId = nullableId(input.packageId, "Package ID");
  const taxonomyNodeId = nullableId(input.taxonomyNodeId, "Taxonomy node ID");
  const includeDescendants = input.includeDescendants;
  if (typeof input.enabled !== "boolean") invalid("Node enabled state is invalid.");
  if (nodeType === "GROUP") {
    if (!GROUP_PRESENTATIONS.has(groupPresentation ?? "") || packageId !== null || targetMode !== null || taxonomyNodeId !== null || includeDescendants !== null) invalid("GROUP node fields are inconsistent.");
  } else {
    if (groupPresentation !== null || !TARGET_MODES.has(targetMode ?? "")) invalid("BANK node fields are inconsistent.");
    if (targetMode === "ALL_PACKAGE_QUESTIONS" && (taxonomyNodeId !== null || includeDescendants !== null)) invalid("ALL_PACKAGE_QUESTIONS cannot contain a taxonomy filter.");
    if (targetMode === "TAXONOMY_FILTER" && (!packageId || !taxonomyNodeId || typeof includeDescendants !== "boolean")) invalid("TAXONOMY_FILTER requires Package, Taxonomy, and includeDescendants.");
  }
  return {
    id: input.id,
    nodeKey: text(input.nodeKey, "nodeKey", 120, true),
    label: text(input.label, "label", 500),
    nodeType,
    parentId: nullableId(input.parentId, "Parent ID"),
    displayOrder: order(input.displayOrder),
    groupPresentation: groupPresentation as MaterialQuestionBankNodeContent["groupPresentation"],
    packageId,
    targetMode: targetMode as MaterialQuestionBankNodeContent["targetMode"],
    taxonomyNodeId,
    includeDescendants: includeDescendants as boolean | null,
    enabled: input.enabled,
  };
}

export function normalizeMaterialQuestionBankLayout(value: unknown): MaterialQuestionBankLayoutContent {
  const input = object(value, "Layout");
  exact(input, ["materialId", "rootPresentation", "nodes"]);
  const materialId = nullableId(input.materialId, "Material ID");
  if (!materialId) invalid("Material ID is required.");
  if (!ROOTS.has(String(input.rootPresentation))) invalid("Root presentation is invalid.");
  if (!Array.isArray(input.nodes) || input.nodes.length > 500) invalid("Layout node count is invalid.");
  const nodes = input.nodes.map(normalizeNode);
  const ids = new Set<string>();
  const keys = new Set<string>();
  const siblingOrders = new Set<string>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (ids.has(node.id)) invalid("Node IDs must be unique.");
    if (keys.has(node.nodeKey)) invalid("Node keys must be unique within a Material.");
    const sibling = `${node.parentId ?? "ROOT"}\u0000${node.displayOrder}`;
    if (siblingOrders.has(sibling)) invalid("Sibling displayOrder values must be unique.");
    ids.add(node.id); keys.add(node.nodeKey); siblingOrders.add(sibling);
    if (node.parentId && !byId.has(node.parentId)) invalid("Node parent must belong to the same Material layout.");
    if (node.parentId === node.id) invalid("Node cannot be its own parent.");
  }
  for (const node of nodes) {
    const seen = new Set<string>();
    let current: MaterialQuestionBankNodeContent | undefined = node;
    while (current?.parentId) {
      if (seen.has(current.parentId)) invalid("Layout hierarchy contains a cycle.");
      seen.add(current.parentId);
      current = byId.get(current.parentId);
    }
    if (node.nodeType === "BANK" && nodes.some((candidate) => candidate.parentId === node.id)) invalid("BANK nodes must be leaves.");
    if (node.nodeType === "GROUP" && node.groupPresentation === "SWITCHER" && nodes.some((candidate) => candidate.parentId === node.id && candidate.nodeType !== "BANK")) invalid("SWITCHER groups may contain BANK children only.");
  }
  return { materialId, rootPresentation: input.rootPresentation as MaterialQuestionBankLayoutContent["rootPresentation"], nodes };
}

export function assertPublishableMaterialQuestionBankLayout(value: MaterialQuestionBankLayoutContent): void {
  if (value.rootPresentation === "DIRECT") {
    const enabledRoots = value.nodes.filter((node) => node.enabled && node.parentId === null);
    if (enabledRoots.length !== 1 || enabledRoots[0].nodeType !== "BANK") invalid("DIRECT layout requires exactly one enabled top-level BANK.");
  }
}

export function assertMaterialQuestionBankReferences(database: ContentDatabase, value: MaterialQuestionBankLayoutContent): void {
  const material = database.client.prepare("select id from canonical_materials where id = ?").get(value.materialId);
  if (!material) invalid("Material does not exist.");
  for (const node of value.nodes) {
    if (!node.packageId) continue;
    const pack = database.client.prepare("select id from question_packages where id = ?").get(node.packageId);
    if (!pack) invalid("Only a canonical published Question Package may be assigned.");
    if (node.targetMode === "TAXONOMY_FILTER") {
      const taxonomy = database.client.prepare("select id from question_taxonomy_nodes where id = ? and package_id = ?").get(node.taxonomyNodeId, node.packageId);
      if (!taxonomy) invalid("Taxonomy filter must belong to the selected Package.");
    }
  }
}
