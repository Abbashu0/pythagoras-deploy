import type { MaterialQuestionBankLayoutContent, MaterialQuestionBankNodeContent } from "./contracts";
import { MaterialQuestionBankError } from "./errors";

/**
 * Product-owned Question Bank topology. These IDs are intentionally committed
 * constants: assignments may change through Change Sets, but topology does not.
 */
export const ARABIC_QUESTION_BANK_PRESET = {
  key: "ARABIC_FIXED",
  subjectKey: "arabic",
  rootPresentation: "CARDS" as const,
  nodes: [
    node("0195a100-0001-7000-8000-000000000001", "arabic-literature", "الأدب", "BANK", null, 1),
    node("0195a100-0002-7000-8000-000000000002", "arabic-grammar", "القواعد", "GROUP", null, 2, "SWITCHER"),
    node("0195a100-0011-7000-8000-000000000011", "arabic-grammar-istifham", "الاستفهام", "BANK", "0195a100-0002-7000-8000-000000000002", 1),
    node("0195a100-0012-7000-8000-000000000012", "arabic-grammar-nafi", "النفي", "BANK", "0195a100-0002-7000-8000-000000000002", 2),
    node("0195a100-0013-7000-8000-000000000013", "arabic-grammar-taqdim-takhir", "التقديم والتأخير", "BANK", "0195a100-0002-7000-8000-000000000002", 3),
    node("0195a100-0014-7000-8000-000000000014", "arabic-grammar-tawkeed", "التوكيد", "BANK", "0195a100-0002-7000-8000-000000000002", 4),
    node("0195a100-0015-7000-8000-000000000015", "arabic-grammar-nidaa", "النداء", "BANK", "0195a100-0002-7000-8000-000000000002", 5),
    node("0195a100-0016-7000-8000-000000000016", "arabic-grammar-taajjub", "التعجب", "BANK", "0195a100-0002-7000-8000-000000000002", 6),
    node("0195a100-0017-7000-8000-000000000017", "arabic-grammar-madh-dham", "المدح والذم", "BANK", "0195a100-0002-7000-8000-000000000002", 7),
    node("0195a100-0018-7000-8000-000000000018", "arabic-grammar-tamanni-tarajji", "التمني والترجي", "BANK", "0195a100-0002-7000-8000-000000000002", 8),
    node("0195a100-0019-7000-8000-000000000019", "arabic-grammar-ard-tahdid", "العرض والتحضيض", "BANK", "0195a100-0002-7000-8000-000000000002", 9),
  ],
} as const;

export type MaterialQuestionBankProductPresetKey = typeof ARABIC_QUESTION_BANK_PRESET.key;

export function getMaterialQuestionBankProductPreset(subjectKey: string) {
  return subjectKey === ARABIC_QUESTION_BANK_PRESET.subjectKey ? ARABIC_QUESTION_BANK_PRESET : null;
}

export function createProductPresetLayout(materialId: string, subjectKey: string): MaterialQuestionBankLayoutContent | null {
  const preset = getMaterialQuestionBankProductPreset(subjectKey);
  if (!preset) return null;
  return {
    materialId,
    rootPresentation: preset.rootPresentation,
    nodes: preset.nodes.map((definition) => ({ ...definition })),
  };
}

/** Only BANK assignment fields are editable for a Product-defined topology. */
export function assertProductPresetStructure(subjectKey: string, value: MaterialQuestionBankLayoutContent): void {
  const preset = getMaterialQuestionBankProductPreset(subjectKey);
  if (!preset) return;
  if (value.rootPresentation !== preset.rootPresentation || value.nodes.length !== preset.nodes.length) immutable();
  const expectedById = new Map(preset.nodes.map((item) => [item.id, item]));
  for (const actual of value.nodes) {
    const expected = expectedById.get(actual.id);
    if (!expected || !sameStructure(actual, expected)) immutable();
    if (actual.nodeType === "GROUP" && (actual.packageId !== null || actual.targetMode !== null || actual.taxonomyNodeId !== null || actual.includeDescendants !== null)) immutable();
  }
}

export function isProductPresetLayout(subjectKey: string, value: MaterialQuestionBankLayoutContent): boolean {
  try { assertProductPresetStructure(subjectKey, value); return Boolean(getMaterialQuestionBankProductPreset(subjectKey)); }
  catch { return false; }
}

function node(
  id: string,
  nodeKey: string,
  label: string,
  nodeType: "GROUP" | "BANK",
  parentId: string | null,
  displayOrder: number,
  groupPresentation: "SWITCHER" | undefined = undefined,
): MaterialQuestionBankNodeContent {
  return nodeType === "GROUP"
    ? { id, nodeKey, label, nodeType, parentId, displayOrder, groupPresentation: groupPresentation ?? "SWITCHER", packageId: null, targetMode: null, taxonomyNodeId: null, includeDescendants: null, enabled: true }
    : { id, nodeKey, label, nodeType, parentId, displayOrder, groupPresentation: null, packageId: null, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeId: null, includeDescendants: null, enabled: true };
}

function sameStructure(actual: MaterialQuestionBankNodeContent, expected: MaterialQuestionBankNodeContent): boolean {
  return actual.id === expected.id
    && actual.nodeKey === expected.nodeKey
    && actual.label === expected.label
    && actual.nodeType === expected.nodeType
    && actual.parentId === expected.parentId
    && actual.displayOrder === expected.displayOrder
    && actual.groupPresentation === expected.groupPresentation
    && actual.enabled === expected.enabled;
}

function immutable(): never {
  throw new MaterialQuestionBankError("MATERIAL_BANK_INVALID", "This Product-defined Question Bank structure is immutable; only BANK package assignments may change.");
}
