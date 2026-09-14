"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronLeft, FileJson, PackageOpen, Trash2 } from "lucide-react";
import { AssetThumb, type Asset } from "@/components/admin-ui/domain/content/assets";
import { EmptyState } from "@/components/admin-ui/feedback/empty-state";
import { InlineNote } from "@/components/admin-ui/feedback/banner";
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from "@/components/admin-ui/overlays/drawer";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { Panel, PanelBody, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { Badge, StatusBadge } from "@/components/admin-ui/status/status-badge";
import { SearchInput } from "@/components/admin-ui/forms/input";
import { Checkbox } from "@/components/admin-ui/forms/toggle";
import { Section } from "@/components/admin-ui/layout/page";
import { formatNumber } from "@/lib/format";
import { toast } from "@/components/admin-ui/feedback/toaster";
import type { MaterialQuestionBankLayoutContent, MaterialQuestionBankNodeContent } from "@/server/material-question-bank";

export type PackageInspection = {
  status: "GENERIC_JSON" | "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "UNSUPPORTED_VERSION";
  format: string | null;
  schemaVersion: string | null;
  packageId: string | null;
  packageKey: string | null;
  title: string | null;
  subjectKey: string | null;
  questionCount: number;
  variantCount: number;
  errorCount: number;
  warningCount: number;
};

export type QuestionPackageAsset = Asset & {
  questionPackageInspection: PackageInspection | null;
};

export type PackageOption = {
  id: string;
  packageKey: string;
  title: string;
  subjectKey: string;
  subjectLabel: string;
  contentRevision: number;
  sourceAssetId: string | null;
  sourceFilename: string | null;
  questionCount: number;
  variantCount: number;
  occurrenceCount: number;
  taxonomyCount: number;
  inspectionStatus: string | null;
};

export type MaterialBankWorkspace = {
  material: { id: string; subjectKey: string; label: string; available: boolean };
  layout: MaterialQuestionBankLayoutContent | null;
  canonicalRevision: number;
  published: boolean;
  packages: PackageOption[];
  taxonomy: Array<{ id: string; packageId: string; label: string; breadcrumb: string }>;
  productPreset: string | null;
  warnings: Array<{ code: "CROSS_SUBJECT_PLACEMENT"; nodeId: string; message: string }>;
};

function packageStatus(status: string | null | undefined): { key: "active" | "warning" | "failed" | "notConfigured" | "unknown"; label: string } {
  switch (status) {
    case "VALID": return { key: "active", label: "صالحة" };
    case "VALID_WITH_WARNINGS": return { key: "warning", label: "صالحة مع تحذيرات" };
    case "INVALID": return { key: "failed", label: "غير صالحة" };
    case "UNSUPPORTED_VERSION": return { key: "notConfigured", label: "إصدار غير مدعوم" };
    default: return { key: "unknown", label: "غير مفحوصة" };
  }
}

function packageFromAsset(asset: QuestionPackageAsset): PackageOption | null {
  const inspection = asset.questionPackageInspection;
  if (!inspection?.packageId || !inspection.title || !inspection.subjectKey) return null;
  return {
    id: inspection.packageId,
    packageKey: inspection.packageKey ?? inspection.packageId,
    title: inspection.title,
    subjectKey: inspection.subjectKey,
    subjectLabel: inspection.subjectKey,
    contentRevision: 0,
    sourceAssetId: asset.id,
    sourceFilename: asset.name,
    questionCount: inspection.questionCount,
    variantCount: inspection.variantCount,
    occurrenceCount: 0,
    taxonomyCount: 0,
    inspectionStatus: inspection.status,
  };
}

function assignedOption(
  packageId: string,
  packages: PackageOption[],
  assets: QuestionPackageAsset[],
): PackageOption | null {
  return packages.find((item) => item.id === packageId) ??
    assets.map(packageFromAsset).find((item) => item?.id === packageId) ??
    null;
}

function cloneLayout(layout: MaterialQuestionBankLayoutContent | null): MaterialQuestionBankLayoutContent | null {
  return layout ? structuredClone(layout) : null;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok) throw new Error(payload?.code ?? "REQUEST_FAILED");
  return payload as T;
}

export function MaterialQuestionBankPanel({
  workspace,
  packageAssets,
  onSaved,
}: {
  workspace: MaterialBankWorkspace;
  packageAssets: QuestionPackageAsset[];
  onSaved: (workspace: MaterialBankWorkspace) => void;
}) {
  const [draft, setDraft] = React.useState(() => cloneLayout(workspace.layout));
  const [sources, setSources] = React.useState<Record<string, string>>({});
  const [pickerNode, setPickerNode] = React.useState<MaterialQuestionBankNodeContent | null>(null);
  const [query, setQuery] = React.useState("");
  const [acknowledgeWarnings, setAcknowledgeWarnings] = React.useState(false);
  const [acknowledgeCrossSubject, setAcknowledgeCrossSubject] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(cloneLayout(workspace.layout));
    setSources({});
    setAcknowledgeWarnings(false);
    setAcknowledgeCrossSubject(false);
    setError(null);
  }, [workspace]);

  if (workspace.productPreset === null) {
    return (
      <EmptyState
        kind="future"
        title="لم يُحدَّد هيكل بنك الأسئلة لهذه المادة بعد."
        description="لا نُنشئ فصولًا أو بنوكًا تلقائيًا قبل أن يحدد المنتج هيكل هذه المادة."
      />
    );
  }
  if (!draft) return null;

  const assignedIds = new Set(draft.nodes.flatMap((node) => node.packageId ? [node.packageId] : []));
  const warningAssets = [...assignedIds]
    .map((id) => packageAssets.find((asset) => asset.questionPackageInspection?.packageId === id)?.questionPackageInspection)
    .filter((inspection): inspection is PackageInspection => inspection?.status === "VALID_WITH_WARNINGS");
  const crossSubject = [...assignedIds].some((id) => {
    const option = assignedOption(id, workspace.packages, packageAssets);
    return option?.subjectKey !== undefined && option.subjectKey !== workspace.material.subjectKey;
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.layout);

  const updateNode = (nodeId: string, patch: Partial<MaterialQuestionBankNodeContent>) => {
    setDraft((current) => current ? { ...current, nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node) } : current);
  };

  const selectAsset = (asset: QuestionPackageAsset) => {
    const packageId = asset.questionPackageInspection?.packageId;
    if (!pickerNode || !packageId || !draft) return;
    updateNode(pickerNode.id, { packageId });
    setSources((current) => ({ ...current, [packageId]: asset.id }));
    setPickerNode(null);
    setQuery("");
  };

  const removeAssignment = (node: MaterialQuestionBankNodeContent) => {
    updateNode(node.id, { packageId: null });
    setSources((current) => {
      const next = { ...current };
      const stillUsed = draft.nodes.some((item) => item.id !== node.id && item.packageId === node.packageId);
      if (node.packageId && !stillUsed) delete next[node.packageId];
      return next;
    });
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const packageSources = [...assignedIds].map((packageId) => {
        const fallback = workspace.packages.find((item) => item.id === packageId)?.sourceAssetId;
        return { packageId, assetId: sources[packageId] ?? fallback ?? "" };
      });
      const response = await requestJson<{ workspace: MaterialBankWorkspace }>(
        `/api/admin/local/content/materials/${encodeURIComponent(workspace.material.subjectKey)}/question-bank`,
        {
          method: "PATCH",
          body: JSON.stringify({
            layout: draft,
            expectedRevision: workspace.canonicalRevision,
            packageSources,
            acknowledgeWarnings,
            acknowledgeCrossSubject,
          }),
        },
      );
      onSaved(response.workspace);
      toast.success("تم حفظ توزيع بنك الأسئلة.");
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "QUESTION_IMPORT_ACKNOWLEDGEMENT_REQUIRED" ? "راجع تحذيرات الحزمة ثم أكدها قبل الحفظ." : code === "QUESTION_IMPORT_CONFLICT" ? "هذه الحزمة تحوي تعارضًا أو إزالة لمحتوى قائم وتحتاج معالجة متقدمة." : code === "MATERIAL_BANK_INVALID" ? "لا يمكن حفظ هذا التوزيع؛ راجع صحة الحزمة أو تأكيد الارتباط." : "تعذّر حفظ بنك الأسئلة.");
      toast.error(code === "QUESTION_IMPORT_CONFLICT" ? "لا يمكن تطبيق تحديث هذه الحزمة." : "تعذّر حفظ توزيع بنك الأسئلة.");
    } finally {
      setSaving(false);
    }
  };

  const filteredAssets = packageAssets
    .filter((asset) => {
      const inspection = asset.questionPackageInspection;
      if (!inspection || (inspection.status !== "VALID" && inspection.status !== "VALID_WITH_WARNINGS")) return false;
      const text = `${inspection.title ?? ""} ${inspection.packageKey ?? ""} ${inspection.subjectKey ?? ""}`.toLowerCase();
      return !query.trim() || text.includes(query.trim().toLowerCase());
    })
    .sort((left, right) => {
      const leftPriority = left.questionPackageInspection?.subjectKey === workspace.material.subjectKey ? 0 : 1;
      const rightPriority = right.questionPackageInspection?.subjectKey === workspace.material.subjectKey ? 0 : 1;
      return leftPriority - rightPriority || left.name.localeCompare(right.name);
    });

  const literature = draft.nodes.find((node) => node.nodeKey === "arabic-literature");
  const grammar = draft.nodes.find((node) => node.nodeKey === "arabic-grammar");
  const grammarNodes = draft.nodes.filter((node) => node.parentId === grammar?.id).sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));

  const renderSlot = (node: MaterialQuestionBankNodeContent) => {
    const option = node.packageId ? assignedOption(node.packageId, workspace.packages, packageAssets) : null;
    const status = packageStatus(option?.inspectionStatus);
    return (
      <Panel key={node.id}>
        <PanelHeader
          title={node.label}
          density="compact"
          icon={<PackageOpen aria-hidden />}
          actions={option ? <StatusBadge status={status.key} label={status.label} size="sm" /> : <Badge variant="subtle" tone="neutral">فارغة</Badge>}
        />
        <PanelBody>
          {option ? (
            <>
              <p className="text-sm font-medium text-fg">{option.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary">
                <span>{formatNumber(option.questionCount)} سؤال</span>
                <span>{formatNumber(option.variantCount)} صيغة</span>
                <span>{formatNumber(option.occurrenceCount)} ورود</span>
                {option.contentRevision > 0 ? <span>rev {option.contentRevision}</span> : null}
              </div>
              {option.sourceFilename ? <p className="mt-2 text-2xs text-fg-quaternary">المصدر: {option.sourceFilename}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" asChild>
                  <Link href={`/admin/content/materials/${encodeURIComponent(workspace.material.subjectKey)}/question-bank/${encodeURIComponent(node.id)}`}>فتح الأسئلة</Link>
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setPickerNode(node)}>استبدال الحزمة</Button>
                <IconButton label="إزالة الارتباط" size="sm" variant="ghost" className="hover:text-danger-text" onClick={() => removeAssignment(node)}><Trash2 aria-hidden /></IconButton>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-fg-tertiary">لا توجد حزمة مرتبطة</p>
              <Button size="sm" variant="secondary" onClick={() => setPickerNode(node)}>اختيار حزمة</Button>
            </div>
          )}
        </PanelBody>
      </Panel>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {workspace.warnings.length ? <InlineNote tone="warning">{workspace.warnings.map((warning) => warning.message).join(" ")}</InlineNote> : null}
      <Section title="الأدب" description="بنك مباشر واحد ضمن الهيكل العربي المحدد من المنتج." spacing="none" divided>
        {literature ? renderSlot(literature) : <EmptyState size="sm" title="تعريف الأدب غير مكتمل" description="تعذّر العثور على عقدة الأدب في preset العربي." />}
      </Section>
      <Section title="القواعد" description="مجموعة SWITCHER ثابتة، وترتيب البنوك التسعة غير قابل للتعديل من Admin." spacing="none" divided>
        <Panel>
          <PanelHeader title="القواعد" description="التوزيع Product-defined؛ التعديل متاح للـBANK assignment فقط." density="compact" />
          <PanelBody>
            <div className="grid gap-3 lg:grid-cols-2">{grammarNodes.map(renderSlot)}</div>
          </PanelBody>
        </Panel>
      </Section>
      {dirty ? (
        <Panel variant="tonal">
          <PanelBody>
            {warningAssets.length ? <label className="flex items-start gap-2 text-xs text-warning-text"><Checkbox checked={acknowledgeWarnings} onCheckedChange={(checked) => setAcknowledgeWarnings(Boolean(checked))} /><span>أؤكد أن تحذيرات الحزمة الصالحة مع التحذيرات راجعتها.</span></label> : null}
            {crossSubject ? <label className="mt-3 flex items-start gap-2 text-xs text-warning-text"><Checkbox checked={acknowledgeCrossSubject} onCheckedChange={(checked) => setAcknowledgeCrossSubject(Boolean(checked))} /><span>أؤكد أن إسناد الحزمة إلى مادة مختلفة مقصود.</span></label> : null}
            {error ? <InlineNote tone="danger" size="xs" className="mt-3">{error}</InlineNote> : null}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-fg-tertiary">التغييرات محلية حتى يتم حفظ التوزيع.</span>
              <Button variant="primary" loading={saving} onClick={() => void save()} disabled={saving || (warningAssets.length > 0 && !acknowledgeWarnings) || (crossSubject && !acknowledgeCrossSubject)}>حفظ</Button>
            </div>
          </PanelBody>
        </Panel>
      ) : null}

      <Drawer open={pickerNode !== null} onOpenChange={(open) => { if (!open) setPickerNode(null); }}>
        <DrawerContent size="xl">
          <DrawerHeader eyebrow="بنك الأسئلة" title="اختيار حزمة" description="الاختيار يغيّر المسودة فقط؛ لن يُستورد أو يُربط حتى تضغط حفظ." />
          <DrawerBody>
            <SearchInput value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="ابحث بعنوان الحزمة أو المادة" resultCount={filteredAssets.length} />
            <div className="mt-4 space-y-3">
              {filteredAssets.length ? filteredAssets.map((asset) => {
                const inspection = asset.questionPackageInspection!;
                const status = packageStatus(inspection.status);
                return (
                  <button key={asset.id} type="button" className="block w-full text-start" onClick={() => selectAsset(asset)}>
                    <Panel className="transition-colors hover:border-border-strong">
                      <PanelBody>
                        <div className="flex items-center gap-3">
                          <AssetThumb asset={asset} size="md" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-fg">{inspection.title ?? asset.name}</span><StatusBadge status={status.key} label={status.label} size="sm" /></div>
                            <p className="mt-1 text-xs text-fg-secondary">{inspection.subjectKey ?? "غير مصنفة"} · {formatNumber(inspection.questionCount)} سؤال · {formatNumber(inspection.variantCount)} صيغة</p>
                            {inspection.packageKey ? <p className="mt-1 text-2xs text-fg-quaternary" dir="ltr">{inspection.packageKey}</p> : null}
                          </div>
                          <Check className="size-4 text-accent-text" aria-hidden />
                        </div>
                      </PanelBody>
                    </Panel>
                  </button>
                );
              }) : <EmptyState kind="noResults" size="sm" title="لا توجد حزم مؤهلة" description="ارفع JSON صالحًا من مخزن الملفات أو عدّل البحث." />}
            </div>
          </DrawerBody>
          <DrawerFooter><Button variant="secondary" onClick={() => setPickerNode(null)}>إلغاء</Button></DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
