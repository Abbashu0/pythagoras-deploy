"use client";

import * as React from "react";
import { v7 as uuidv7 } from "uuid";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ListTree,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { Asset as AdminAsset } from "@/components/admin-ui/domain/content/assets";
import { Breadcrumbs } from "@/components/admin-ui/navigation/breadcrumbs";
import { Tabs } from "@/components/admin-ui/navigation/tabs";
import { CompactPageHeader, PageShell, Section, TwoColumnLayout } from "@/components/admin-ui/layout/page";
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from "@/components/admin-ui/overlays/drawer";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/admin-ui/overlays/dialog";
import { FormField } from "@/components/admin-ui/forms/field";
import { TextArea, TextField } from "@/components/admin-ui/forms/input";
import { TagsEditor } from "@/components/admin-ui/forms/editable";
import { Select } from "@/components/admin-ui/forms/select";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { Panel, PanelBody, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { Badge, StatusBadge } from "@/components/admin-ui/status/status-badge";
import { InlineNote } from "@/components/admin-ui/feedback/banner";
import { toast } from "@/components/admin-ui/feedback/toaster";
import { RichDocumentRenderer } from "@/components/admin/rich-content";
import { RichDocumentEditor, type RichDocumentIdAllocator } from "./rich-document-editor";
import type {
  DirectQuestionDetail,
  DirectQuestionPackageTaxonomyNode,
  DirectQuestionPackageWorkspace,
  PreparedDirectQuestionIds,
} from "@/server/question-editor";
import type { CanonicalRichDocument, QuestionItemContent, QuestionOccurrenceContent, QuestionSourceKind } from "@/server/questions";
import { QUESTION_SOURCE_KIND_LABELS, questionSourceKindLabel } from "@/lib/question-source-labels";

const SOURCE_OPTIONS = Object.entries(QUESTION_SOURCE_KIND_LABELS).map(([value, label]) => ({ value, label }));
const localAssetUrl = (assetId: string) => `/api/admin/local/assets/${encodeURIComponent(assetId)}/content`;

type EditorTab = "content" | "variants" | "taxonomy";
type OccurrenceDraft = QuestionOccurrenceContent;
type PreparedIdKind = "block" | "verse" | "occurrence" | "variant";
type PreparedIdPool = Record<PreparedIdKind, string[]>;

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok) throw new Error(payload?.code ?? "REQUEST_FAILED");
  return payload as T;
}

export function QuestionEditorWorkspace({
  packageId,
  questionId,
  fromSubjectKey,
  fromNodeId,
}: {
  packageId: string;
  questionId: string | null;
  fromSubjectKey?: string | null;
  fromNodeId?: string | null;
}) {
  const router = useRouter();
  const [workspace, setWorkspace] = React.useState<DirectQuestionPackageWorkspace | null>(null);
  const [detail, setDetail] = React.useState<DirectQuestionDetail | null>(null);
  const [draft, setDraft] = React.useState<QuestionItemContent | null>(null);
  const [baseline, setBaseline] = React.useState<QuestionItemContent | null>(null);
  const [assets, setAssets] = React.useState<AdminAsset[]>([]);
  const [tab, setTab] = React.useState<EditorTab>("content");
  const [selectedVariantId, setSelectedVariantId] = React.useState<string | null>(null);
  const [occurrenceEditor, setOccurrenceEditor] = React.useState<{ variantId: string; value: OccurrenceDraft } | null>(null);
  const [deletedVariantIds, setDeletedVariantIds] = React.useState<string[]>([]);
  const [deletedOccurrenceIds, setDeletedOccurrenceIds] = React.useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [conflictOpen, setConflictOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const initialVariantIds = React.useRef(new Set<string>());
  const initialOccurrenceIds = React.useRef(new Set<string>());
  const idPool = React.useRef<PreparedIdPool>({ block: [], verse: [], occurrence: [], variant: [] });
  const allocator = React.useCallback<RichDocumentIdAllocator>((kind) => idPool.current[kind].shift() ?? uuidv7(), []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workspaceResponse, assetResponse, idResponse] = await Promise.all([
        requestJson<{ workspace: DirectQuestionPackageWorkspace }>(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}`),
        requestJson<{ items: AdminAsset[] }>("/api/admin/local/assets?limit=200&sort=newest&mediaKind=image"),
        requestJson<{ ids: PreparedDirectQuestionIds }>(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}/editor/ids`, { method: "POST", body: JSON.stringify({ blocks: 100, verses: 100, occurrences: 100, variants: 100 }) }),
      ]);
      const nextWorkspace = workspaceResponse.workspace;
      let nextDetail: DirectQuestionDetail;
      if (questionId) {
        nextDetail = (await requestJson<{ question: DirectQuestionDetail }>(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}/questions/${encodeURIComponent(questionId)}`)).question;
      } else {
        const prepared = (await requestJson<{ prepared: { questionId: string; content: QuestionItemContent } }>(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}/editor/ids`, { method: "POST", body: JSON.stringify({ newQuestion: true }) })).prepared;
        nextDetail = { id: prepared.questionId, packageId, revision: 0, createdAt: 0, updatedAt: 0, updatedBy: "", content: prepared.content };
      }
      const nextContent = structuredClone(nextDetail.content);
      idPool.current = {
        block: [...idResponse.ids.blockIds],
        verse: [...idResponse.ids.verseIds],
        occurrence: [...idResponse.ids.occurrenceIds],
        variant: [...idResponse.ids.variantIds],
      };
      setWorkspace(nextWorkspace);
      setAssets(assetResponse.items);
      setDetail(nextDetail);
      setDraft(nextContent);
      setBaseline(structuredClone(nextContent));
      setSelectedVariantId(nextContent.primaryVariantId || nextContent.variants[0]?.id || null);
      initialVariantIds.current = new Set(nextContent.variants.map((variant) => variant.id));
      initialOccurrenceIds.current = new Set(nextContent.variants.flatMap((variant) => variant.occurrences.map((occurrence) => occurrence.id)));
      setDeletedVariantIds([]);
      setDeletedOccurrenceIds([]);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "QUESTION_EDITOR_NOT_FOUND" ? "لم تعد الحزمة أو السؤال موجودًا." : "تعذّر تحميل بيانات السؤال.");
    } finally {
      setLoading(false);
    }
  }, [packageId, questionId]);

  React.useEffect(() => { void load(); }, [load]);

  const dirty = Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline));
  const currentQuestionId = detail?.id ?? questionId;
  const primary = draft?.variants.find((variant) => variant.id === draft.primaryVariantId) ?? draft?.variants[0];
  const selectedVariant = draft?.variants.find((variant) => variant.id === selectedVariantId) ?? primary;
  const backHref = fromSubjectKey ? `/admin/content/materials/${encodeURIComponent(fromSubjectKey)}` : `/admin/content/question-packages/${encodeURIComponent(packageId)}`;
  const contextQuery = fromSubjectKey ? `?fromSubjectKey=${encodeURIComponent(fromSubjectKey)}${fromNodeId ? `&fromNodeId=${encodeURIComponent(fromNodeId)}` : ""}` : "";

  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const updateDraft = (next: QuestionItemContent) => setDraft(next);
  const updateVariant = (variantId: string, update: (variant: QuestionItemContent["variants"][number]) => QuestionItemContent["variants"][number]) => {
    if (!draft) return;
    setDraft({ ...draft, variants: draft.variants.map((variant) => variant.id === variantId ? update(variant) : variant) });
  };

  const save = async () => {
    if (!draft || !detail || saving) return;
    setSaving(true);
    setError(null);
    try {
      const targetQuestionId = currentQuestionId ?? detail.id;
      const existingQuestion = detail.revision > 0;
      const url = `/api/admin/local/question-packages/${encodeURIComponent(packageId)}/questions${existingQuestion ? `/${encodeURIComponent(targetQuestionId)}` : ""}`;
      const response = await requestJson<{ question: DirectQuestionDetail }>(url, {
        method: existingQuestion ? "PATCH" : "POST",
        body: JSON.stringify(existingQuestion ? { content: draft, expectedRevision: detail.revision, deleteVariantIds: deletedVariantIds, deleteOccurrenceIds: deletedOccurrenceIds } : { questionId: targetQuestionId, content: draft }),
      });
      const next = response.question;
      setDetail(next);
      setDraft(structuredClone(next.content));
      setBaseline(structuredClone(next.content));
      setDeletedVariantIds([]);
      setDeletedOccurrenceIds([]);
      toast.success("تم حفظ السؤال canonical.");
      if (!questionId && next.id) router.replace(`/admin/content/question-packages/${encodeURIComponent(packageId)}/questions/${encodeURIComponent(next.id)}${contextQuery}`);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "QUESTION_EDITOR_CONFLICT") setConflictOpen(true);
      else setError(cause instanceof Error && cause.message === "QUESTION_EDITOR_INVALID" ? "راجع الحقول المطلوبة وبنية المحتوى قبل الحفظ." : "تعذّر حفظ السؤال. بقيت تعديلاتك المحلية محفوظة.");
    } finally {
      setSaving(false);
    }
  };

  const navigateBack = () => {
    if (dirty && !window.confirm("لديك تعديلات غير محفوظة. هل تريد مغادرة المحرر؟")) return;
    router.push(backHref);
  };

  const deleteQuestion = async () => {
    if (!detail || detail.revision < 1 || deleting) return;
    setDeleting(true);
    try {
      await requestJson(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}/questions/${encodeURIComponent(detail.id)}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: detail.revision }) });
      toast.success("تم حذف السؤال.");
      router.push(backHref);
    } catch (cause) {
      setDeleteOpen(false);
      if (cause instanceof Error && cause.message === "QUESTION_EDITOR_CONFLICT") setConflictOpen(true);
      else setError("تعذّر حذف السؤال؛ لم يتم تغيير البيانات.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <PageShell width="wide"><Panel><PanelBody><div className="h-12 w-72 animate-pulse rounded-md bg-inset" /></PanelBody></Panel></PageShell>;
  if (error || !workspace || !draft || !detail) return <PageShell width="wide"><ErrorStateView message={error ?? "السؤال غير موجود."} onRetry={load} /></PageShell>;

  const title = detail.revision === 0 ? "سؤال جديد" : `سؤال #${draft.displayOrder}`;
  const breadcrumbs = [{ label: "إدارة المحتوى", href: "/admin/content/materials" }, { label: workspace.package.subjectLabel, href: backHref }, { label: workspace.package.bankBrowseEntryLabel, href: `/admin/content/question-packages/${encodeURIComponent(packageId)}${contextQuery}` }, { label: title }];
  return (
    <PageShell width="wide">
      <CompactPageHeader
        breadcrumb={<Breadcrumbs items={breadcrumbs} />}
        icon={<BookOpen className="size-4 text-fg-tertiary" aria-hidden />}
        title={title}
        subtitle={<span className="text-xs text-fg-tertiary">{workspace.package.title}</span>}
        status={<Badge size="sm" variant="subtle" tone={dirty ? "warning" : "neutral"}>{dirty ? "تعديلات محلية" : `revision ${detail.revision}`}</Badge>}
        actions={<><Button size="sm" variant="quiet" onClick={navigateBack}>إلغاء التعديلات</Button>{detail.revision > 0 ? <Button size="sm" variant="dangerGhost" icon={<Trash2 aria-hidden />} onClick={() => setDeleteOpen(true)}>حذف</Button> : null}<Button size="sm" variant="primary" icon={<Save aria-hidden />} loading={saving} disabled={!dirty || saving} onClick={() => void save()}>حفظ</Button></>}
        tabs={<Tabs value={tab} onValueChange={(value) => setTab(value as EditorTab)} items={[{ value: "content", label: "المحتوى" }, { value: "variants", label: "الصيغ والورود", count: draft.variants.length }, { value: "taxonomy", label: "التصنيف" }]} />}
      />

      {error ? <InlineNote tone="danger" className="mt-4">{error}</InlineNote> : null}
      <div className="pb-24 pt-5">
        <TwoColumnLayout
          asideWidth="lg"
          asidePosition="end"
          stickyAside
          className="gap-6"
          aside={<LiveQuestionPreview draft={draft} packageTitle={workspace.package.title} />}
        >
          {tab === "content" ? <ContentTab draft={draft} primary={primary} assets={assets} allocator={allocator} onChange={updateDraft} /> : null}
          {tab === "variants" ? <VariantsTab draft={draft} selectedVariant={selectedVariant} selectedVariantId={selectedVariantId} assets={assets} allocator={allocator} onSelectVariant={setSelectedVariantId} onChange={updateDraft} onUpdateVariant={updateVariant} onDeleteVariant={(id) => { setDraft({ ...draft, variants: draft.variants.filter((variant) => variant.id !== id) }); if (initialVariantIds.current.has(id)) setDeletedVariantIds((current) => current.includes(id) ? current : [...current, id]); setSelectedVariantId(draft.variants.find((variant) => variant.id !== id)?.id ?? null); }} onOpenOccurrence={(variantId, value) => setOccurrenceEditor({ variantId, value })} onDeleteOccurrence={(variantId, occurrenceId) => { updateVariant(variantId, (variant) => ({ ...variant, occurrences: variant.occurrences.filter((occurrence) => occurrence.id !== occurrenceId) })); if (initialOccurrenceIds.current.has(occurrenceId)) setDeletedOccurrenceIds((current) => current.includes(occurrenceId) ? current : [...current, occurrenceId]); }} /> : null}
          {tab === "taxonomy" ? <TaxonomyTab draft={draft} taxonomy={workspace.taxonomy} onChange={updateDraft} /> : null}
        </TwoColumnLayout>
      </div>

      <OccurrenceDrawer
        value={occurrenceEditor}
        onClose={() => setOccurrenceEditor(null)}
        onSave={(variantId, occurrence) => { updateVariant(variantId, (variant) => ({ ...variant, occurrences: variant.occurrences.some((item) => item.id === occurrence.id) ? variant.occurrences.map((item) => item.id === occurrence.id ? occurrence : item) : [...variant.occurrences, occurrence] })); setOccurrenceEditor(null); }}
      />
      <Dialog open={deleteOpen} onOpenChange={(open) => { if (!open && !deleting) setDeleteOpen(false); }}>
        <DialogContent size="sm"><DialogHeader title="حذف السؤال" description="سيُحذف Question aggregate بصِيَغه ووروده وتعييناته. لا تُحذف الحزمة أو Assets." /><DialogBody><p className="text-sm text-fg-secondary">هذا إجراء صريح وغير قابل للتراجع.</p></DialogBody><DialogFooter><Button variant="quiet" onClick={() => setDeleteOpen(false)} disabled={deleting}>إلغاء</Button><Button variant="destructive" loading={deleting} onClick={() => void deleteQuestion()}>حذف السؤال</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent size="sm"><DialogHeader title="تعارض في السؤال" description="تم تعديل هذا السؤال منذ فتحه، لذلك لم تُستبدل النسخة الحالية." /><DialogBody><p className="text-sm text-fg-secondary">يمكنك إعادة تحميل النسخة الحالية أو إبقاء تعديلاتك المحلية للمقارنة.</p></DialogBody><DialogFooter><Button variant="quiet" onClick={() => setConflictOpen(false)}>إبقاء تعديلاتي</Button><Button variant="primary" onClick={() => { setConflictOpen(false); void load(); }}>إعادة تحميل النسخة الحالية</Button></DialogFooter></DialogContent>
      </Dialog>
    </PageShell>
  );
}

function ErrorStateView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="py-8"><InlineNote tone="danger">{message}</InlineNote><div className="mt-3"><Button size="sm" variant="secondary" onClick={onRetry}>إعادة المحاولة</Button></div></div>;
}

function ContentTab({ draft, primary, assets, allocator, onChange }: { draft: QuestionItemContent; primary: QuestionItemContent["variants"][number] | undefined; assets: AdminAsset[]; allocator: RichDocumentIdAllocator; onChange: (value: QuestionItemContent) => void }) {
  return <div className="space-y-6"><Section title="المحتوى الأساسي" description="حرّر الصيغة التي يشير إليها primaryVariantId؛ كل عنصر يبقى RichDocument canonical." spacing="none" divided><Panel><PanelHeader title="الصيغة الأساسية" actions={<Badge size="sm" variant="subtle" tone="accent">primary</Badge>} density="compact" /><PanelBody>{primary ? <RichDocumentEditor value={primary.content} onChange={(content) => onChange({ ...draft, variants: draft.variants.map((variant) => variant.id === primary.id ? { ...variant, content } : variant) })} assets={assets} allocateId={allocator} /> : <Well padding="md"><p className="text-sm text-fg-tertiary">لا توجد صيغة أساسية.</p></Well>}</PanelBody></Panel></Section><Section title="الإجابة المشتركة" description="للسؤال إجابة واحدة مشتركة، وليست إجابة منفصلة لكل صيغة." spacing="none" divided><Panel><PanelHeader title={draft.sharedAnswer ? "الإجابة" : "لا توجد إجابة"} density="compact" actions={draft.sharedAnswer ? <Button size="xs" variant="dangerGhost" icon={<Trash2 aria-hidden />} onClick={() => { if (window.confirm("إزالة الإجابة المشتركة؟")) onChange({ ...draft, sharedAnswer: null }); }}>إزالة الإجابة</Button> : <Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={() => onChange({ ...draft, sharedAnswer: blankDocument(allocator) })}>إضافة إجابة</Button>} /><PanelBody>{draft.sharedAnswer ? <RichDocumentEditor value={draft.sharedAnswer} onChange={(sharedAnswer) => onChange({ ...draft, sharedAnswer })} assets={assets} allocateId={allocator} /> : <p className="text-sm text-fg-tertiary">يمكن إضافة إجابة مشتركة عند الحاجة.</p>}</PanelBody></Panel></Section></div>;
}

function VariantsTab({ draft, selectedVariant, selectedVariantId, assets, allocator, onSelectVariant, onChange, onUpdateVariant, onDeleteVariant, onOpenOccurrence, onDeleteOccurrence }: { draft: QuestionItemContent; selectedVariant: QuestionItemContent["variants"][number] | undefined; selectedVariantId: string | null; assets: AdminAsset[]; allocator: RichDocumentIdAllocator; onSelectVariant: (id: string) => void; onChange: (value: QuestionItemContent) => void; onUpdateVariant: (id: string, update: (variant: QuestionItemContent["variants"][number]) => QuestionItemContent["variants"][number]) => void; onDeleteVariant: (id: string) => void; onOpenOccurrence: (variantId: string, value: OccurrenceDraft) => void; onDeleteOccurrence: (variantId: string, occurrenceId: string) => void }) {
  const addVariant = () => { const variantId = allocator("variant"); onChange({ ...draft, variants: [...draft.variants, { id: variantId, displayOrder: nextOrder(draft.variants.map((variant) => variant.displayOrder)), content: blankDocument(allocator), occurrences: [] }] }); onSelectVariant(variantId); };
  const moveVariant = (index: number, to: number) => { if (to < 0 || to >= draft.variants.length) return; const variants = [...draft.variants]; const [item] = variants.splice(index, 1); variants.splice(to, 0, item!); onChange({ ...draft, variants: variants.map((variant, order) => ({ ...variant, displayOrder: order + 1 })) }); };
  return <div className="space-y-6"><Section title="الصيغ" description="الصيغ أشكال بديلة للسؤال نفسه؛ لا تُنسخ الورود تلقائيًا." spacing="none" divided actions={<Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={addVariant}>إضافة صيغة</Button>}><div className="space-y-2">{draft.variants.map((variant, index) => <Panel key={variant.id} className={variant.id === selectedVariantId ? "border-accent" : undefined}><PanelBody><div className="flex flex-wrap items-center gap-2"><button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start" onClick={() => onSelectVariant(variant.id)}><Badge size="sm" variant="inset">صيغة {index + 1}</Badge>{variant.id === draft.primaryVariantId ? <StatusBadge status="active" label="الأساسية" size="sm" /> : null}<span className="text-xs text-fg-tertiary">{variant.occurrences.length} ورود</span></button><IconButton label="نقل لأعلى" size="xs" variant="ghost" disabled={index === 0} onClick={() => moveVariant(index, index - 1)}><ArrowUp aria-hidden /></IconButton><IconButton label="نقل لأسفل" size="xs" variant="ghost" disabled={index === draft.variants.length - 1} onClick={() => moveVariant(index, index + 1)}><ArrowDown aria-hidden /></IconButton>{variant.id !== draft.primaryVariantId ? <Button size="xs" variant="quiet" onClick={() => onChange({ ...draft, primaryVariantId: variant.id })}>جعلها أساسية</Button> : null}<Button size="xs" variant="dangerGhost" disabled={draft.variants.length <= 1 || variant.id === draft.primaryVariantId} onClick={() => { if (window.confirm("حذف هذه الصيغة وورودها؟")) onDeleteVariant(variant.id); }}>حذف</Button></div></PanelBody></Panel>)}</div></Section><Section title={selectedVariant ? `تحرير صيغة ${draft.variants.findIndex((variant) => variant.id === selectedVariant.id) + 1}` : "تحرير الصيغة"} description="محتوى الصيغة وورودها يبقيان منفصلين." spacing="none" divided>{selectedVariant ? <><Panel><PanelBody><RichDocumentEditor value={selectedVariant.content} onChange={(content) => onUpdateVariant(selectedVariant.id, (variant) => ({ ...variant, content }))} assets={assets} allocateId={allocator} /></PanelBody></Panel><OccurrenceManager variant={selectedVariant} onAdd={() => onOpenOccurrence(selectedVariant.id, newOccurrence(allocator, nextOrder(selectedVariant.occurrences.map((occurrence) => occurrence.displayOrder))))} onEdit={(occurrence) => onOpenOccurrence(selectedVariant.id, occurrence)} onDelete={(occurrenceId) => { if (window.confirm("حذف هذا الورود؟")) onDeleteOccurrence(selectedVariant.id, occurrenceId); }} /></> : <Well padding="md"><p className="text-sm text-fg-tertiary">اختر صيغة.</p></Well>}</Section></div>;
}

function OccurrenceManager({ variant, onAdd, onEdit, onDelete }: { variant: QuestionItemContent["variants"][number]; onAdd: () => void; onEdit: (occurrence: OccurrenceDraft) => void; onDelete: (id: string) => void }) {
  return <Panel><PanelHeader title="الورود المصدرية" description="كل ورود يحفظ metadata المصدر الأصلي كاملًا." density="compact" actions={<Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={onAdd}>إضافة ورود</Button>} /><PanelBody>{variant.occurrences.length ? <div className="space-y-2">{variant.occurrences.map((occurrence, index) => <div key={occurrence.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-inset px-3 py-2"><span className="w-8 shrink-0 text-center text-xs text-fg-quaternary tnum">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-fg">{occurrence.rawLabel}</p><p className="mt-0.5 text-2xs text-fg-tertiary">{questionSourceKindLabel(occurrence.sourceKind)}{occurrence.year ? ` · ${occurrence.year}` : ""}{occurrence.branches.length ? ` · ${occurrence.branches.join("، ")}` : ""}</p></div><Button size="xs" variant="quiet" onClick={() => onEdit(occurrence)}>تعديل</Button><IconButton label="حذف الورود" size="xs" variant="ghost" className="hover:text-danger-text" onClick={() => onDelete(occurrence.id)}><Trash2 aria-hidden /></IconButton></div>)}</div> : <p className="text-sm text-fg-tertiary">لا توجد ورود مسجلة.</p>}</PanelBody></Panel>;
}

function TaxonomyTab({ draft, taxonomy, onChange }: { draft: QuestionItemContent; taxonomy: DirectQuestionPackageTaxonomyNode[]; onChange: (value: QuestionItemContent) => void }) {
  const [query, setQuery] = React.useState("");
  const assignments = new Map(draft.taxonomyAssignments.map((assignment) => [assignment.taxonomyNodeId, assignment]));
  const filtered = taxonomy.filter((node) => !query.trim() || node.breadcrumb.toLowerCase().includes(query.trim().toLowerCase()) || node.label.includes(query.trim()));
  const setPrimary = (id: string) => onChange({ ...draft, taxonomyAssignments: draft.taxonomyAssignments.map((assignment) => assignment.taxonomyNodeId === id ? { ...assignment, role: "PRIMARY" as const } : { ...assignment, role: "RELATED" as const }) });
  const toggle = (id: string) => { if (assignments.has(id)) onChange({ ...draft, taxonomyAssignments: draft.taxonomyAssignments.filter((assignment) => assignment.taxonomyNodeId !== id).map((assignment, index) => ({ ...assignment, position: index })) }); else onChange({ ...draft, taxonomyAssignments: [...draft.taxonomyAssignments, { taxonomyNodeId: id, role: draft.taxonomyAssignments.some((assignment) => assignment.role === "PRIMARY") ? "RELATED" : "PRIMARY", position: draft.taxonomyAssignments.length }] }); };
  return <Section title="تعيينات التصنيف" description="اختر من عقد الحزمة الحالية فقط. لا يمكن إنشاء أو نقل عقدة من داخل محرر السؤال." spacing="none" divided><Panel><PanelBody><TextField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في التصنيفات…" prefix={<ListTree className="size-4" aria-hidden />} /><div className="mt-4 space-y-2">{filtered.map((node) => { const assignment = assignments.get(node.id); return <div key={node.id} className="flex items-center gap-2 rounded-md border border-border-subtle bg-inset px-3 py-2" style={{ paddingInlineStart: `${12 + taxonomyDepth(node, taxonomy) * 18}px` }}><button type="button" className="min-w-0 flex-1 truncate text-start text-sm text-fg" onClick={() => toggle(node.id)}>{node.breadcrumb}</button>{assignment ? <Badge size="sm" variant="subtle" tone={assignment.role === "PRIMARY" ? "accent" : "neutral"}>{assignment.role === "PRIMARY" ? "أساسي" : "مرتبط"}</Badge> : null}{assignment?.role !== "PRIMARY" ? <Button size="xs" variant="quiet" onClick={() => setPrimary(node.id)}>أساسي</Button> : null}{assignment ? <IconButton label="إزالة التصنيف" size="xs" variant="ghost" onClick={() => toggle(node.id)}><Check aria-hidden /></IconButton> : <Button size="xs" variant="outline" onClick={() => toggle(node.id)}>إضافة</Button>}</div>; })}</div>{!filtered.length ? <p className="mt-4 text-center text-sm text-fg-tertiary">لا توجد عقد مطابقة.</p> : null}</PanelBody></Panel></Section>;
}

function LiveQuestionPreview({ draft, packageTitle }: { draft: QuestionItemContent; packageTitle: string }) {
  const primary = draft.variants.find((variant) => variant.id === draft.primaryVariantId) ?? draft.variants[0];
  return <Panel><PanelHeader title="المعاينة الحية" description={packageTitle} density="compact" /><PanelBody>{primary ? <RichDocumentRenderer document={primary.content} resolveAssetUrl={localAssetUrl} /> : <p className="text-sm text-fg-tertiary">لا توجد صيغة أساسية.</p>}{draft.sharedAnswer ? <div className="mt-5 border-t border-border-subtle pt-4"><p className="mb-2 text-xs font-semibold text-fg-secondary">الإجابة المشتركة</p><RichDocumentRenderer document={draft.sharedAnswer} resolveAssetUrl={localAssetUrl} /></div> : null}</PanelBody></Panel>;
}

function OccurrenceDrawer({ value, onClose, onSave }: { value: { variantId: string; value: OccurrenceDraft } | null; onClose: () => void; onSave: (variantId: string, value: OccurrenceDraft) => void }) {
  const [draft, setDraft] = React.useState<OccurrenceDraft | null>(value?.value ?? null);
  React.useEffect(() => setDraft(value?.value ?? null), [value]);
  if (!value || !draft) return <Drawer open={false} onOpenChange={onClose}><DrawerContent /></Drawer>;
  const set = (patch: Partial<OccurrenceDraft>) => setDraft({ ...draft, ...patch });
  const save = () => { if (!draft.rawLabel.trim()) return; onSave(value.variantId, { ...draft, rawLabel: draft.rawLabel.trim() }); };
  return <Drawer open onOpenChange={(open) => { if (!open) onClose(); }}><DrawerContent size="lg"><DrawerHeader eyebrow="ورود مصدري" title="إضافة / تعديل ورود" description="يحفظ النص الأصلي وبيانات المصدر دون إعادة توليد أو تسطيح." /><DrawerBody><div className="space-y-4"><FormField label="نوع المصدر" required><Select value={draft.sourceKind} options={SOURCE_OPTIONS} onValueChange={(sourceKind) => set({ sourceKind: sourceKind as QuestionSourceKind })} /></FormField><div className="grid gap-4 sm:grid-cols-2"><FormField label="السنة"><TextField type="number" value={draft.year?.toString() ?? ""} onChange={(event) => { const number = Number(event.target.value); set({ year: Number.isSafeInteger(number) && number >= 1900 ? number : null }); }} /></FormField><FormField label="رمز الدور"><TextField value={draft.roundCode ?? ""} onChange={(event) => set({ roundCode: event.target.value || null })} /></FormField><FormField label="الجلسة"><TextField value={draft.session ?? ""} onChange={(event) => set({ session: event.target.value || null })} /></FormField><FormField label="اسم المصدر"><TextField value={draft.sourceName ?? ""} onChange={(event) => set({ sourceName: event.target.value || null })} /></FormField></div><FormField label="الوسم الأصلي" required description="يبقى كما ورد في المصدر ولا يُشتق من الحقول الأخرى."><TextField value={draft.rawLabel} onChange={(event) => set({ rawLabel: event.target.value })} /></FormField><FormField label="الفروع"><TagsEditor value={draft.branches} onValueChange={(branches) => set({ branches })} /></FormField><FormField label="المحددات"><TagsEditor value={draft.qualifiers} onValueChange={(qualifiers) => set({ qualifiers })} /></FormField><FormField label="ملاحظات"><TextArea value={draft.notes ?? ""} onChange={(event) => set({ notes: event.target.value || null })} minRows={3} maxRows={8} /></FormField></div></DrawerBody><DrawerFooter><Button variant="quiet" onClick={onClose}>إلغاء</Button><Button variant="primary" disabled={!draft.rawLabel.trim()} onClick={save}>حفظ الورود</Button></DrawerFooter></DrawerContent></Drawer>;
}

function newOccurrence(allocateId: RichDocumentIdAllocator, displayOrder: number): OccurrenceDraft {
  return { id: allocateId("occurrence"), displayOrder, sourceKind: "ministerial", year: null, roundCode: null, session: null, sourceName: null, notes: null, rawLabel: "", branches: [], qualifiers: [] };
}

function blankDocument(allocateId: RichDocumentIdAllocator): CanonicalRichDocument {
  return { type: "doc", version: 1, blocks: [{ id: allocateId("block"), type: "paragraph", spans: [{ text: "" }] }] };
}

function taxonomyDepth(node: DirectQuestionPackageTaxonomyNode, nodes: DirectQuestionPackageTaxonomyNode[]): number {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  let depth = 0;
  let current = node.parentId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) { seen.add(current); depth += 1; current = byId.get(current)?.parentId ?? null; }
  return depth;
}

function nextOrder(values: number[]): number {
  return Math.max(0, ...values) + 1;
}
