"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, BookOpen, ChevronLeft, Filter, FolderOpen, Search, Tags } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CanonicalQuestionInspector } from "@/components/admin/questions/canonical-question-inspector";
import { CanonicalQuestionTable } from "@/components/admin/questions/canonical-question-table";
import { Breadcrumbs } from "@/components/admin-ui/navigation/breadcrumbs";
import { FilterBar, type FilterValues, type SavedView } from "@/components/admin-ui/tables/filters";
import { DensityControl, type TableDensity } from "@/components/admin-ui/tables/data-table";
import { Drawer, DrawerContent } from "@/components/admin-ui/overlays/drawer";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/admin-ui/overlays/dialog";
import { EmptyState, ErrorState, NoResultsState } from "@/components/admin-ui/feedback/empty-state";
import { Button } from "@/components/admin-ui/primitives/button";
import { Panel, PanelBody, PanelHeader } from "@/components/admin-ui/primitives/surface";
import { Tooltip } from "@/components/admin-ui/primitives/tooltip";
import { Badge, StatusBadge } from "@/components/admin-ui/status/status-badge";
import { PageHeader, PageShell, Section } from "@/components/admin-ui/layout/page";
import { InspectorPanel } from "@/components/admin-ui/layout/master-detail";
import { Tabs } from "@/components/admin-ui/navigation/tabs";
import { TextField } from "@/components/admin-ui/forms/input";
import { FormField } from "@/components/admin-ui/forms/field";
import { formatNumber } from "@/lib/format";
import type { DirectQuestionDetail, DirectQuestionListResult, DirectQuestionPackageWorkspace, DirectQuestionSummary } from "@/server/question-editor";
import { questionSourceKindLabel } from "@/lib/question-source-labels";

type WorkspaceTab = "questions" | "taxonomy" | "info";

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok) throw new Error(payload?.code ?? "REQUEST_FAILED");
  return payload as T;
}

function filterValue(values: FilterValues, key: string): string | undefined {
  return values[key]?.[0];
}

function errorLabel(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "QUESTION_EDITOR_CONFLICT" || code === "CANONICAL_CONFLICT") return "تغيّر المحتوى قبل اكتمال العملية. حدّث الصفحة وحاول مجددًا.";
  if (code === "QUESTION_EDITOR_NOT_FOUND") return "لم تعد الحزمة أو السؤال موجودًا.";
  return "تعذّر تحميل مساحة الحزمة. لم تُفقد أي تغييرات محفوظة.";
}

export default function QuestionPackageWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ packageId: string }>();
  const searchParams = useSearchParams();
  const packageId = Array.isArray(params.packageId) ? params.packageId[0] : params.packageId;
  const fromSubjectKey = searchParams.get("fromSubjectKey");
  const fromNodeId = searchParams.get("fromNodeId");
  const [workspace, setWorkspace] = React.useState<DirectQuestionPackageWorkspace | null>(null);
  const [questions, setQuestions] = React.useState<DirectQuestionListResult | null>(null);
  const [query, setQuery] = React.useState("");
  const [filters, setFilters] = React.useState<FilterValues>({});
  const [density, setDensity] = React.useState<TableDensity>("compact");
  const [tab, setTab] = React.useState<WorkspaceTab>("questions");
  const [offset, setOffset] = React.useState(0);
  const [selected, setSelected] = React.useState<DirectQuestionSummary | null>(null);
  const [selectedQuestion, setSelectedQuestion] = React.useState<DirectQuestionDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [questionsLoading, setQuestionsLoading] = React.useState(false);
  const [inspectorLoading, setInspectorLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<DirectQuestionSummary | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState("");
  const [savingTitle, setSavingTitle] = React.useState(false);
  const [savedViews, setSavedViews] = React.useState<SavedView[]>([]);
  const requestRef = React.useRef<AbortController | null>(null);
  const inspectorRequestRef = React.useRef<AbortController | null>(null);
  const questionWorkspaceRef = React.useRef<HTMLDivElement>(null);
  const inspectorUsesDrawer = useQuestionInspectorDrawer(questionWorkspaceRef, workspace !== null);

  const loadWorkspace = React.useCallback(async () => {
    if (!packageId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await requestJson<{ workspace: DirectQuestionPackageWorkspace }>(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}`);
      setWorkspace(response.workspace);
      setTitleDraft(response.workspace.package.title);
    } catch (cause) {
      setError(errorLabel(cause));
    } finally {
      setLoading(false);
    }
  }, [packageId]);

  const loadQuestions = React.useCallback(async () => {
    if (!packageId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setQuestionsLoading(true);
    setListError(null);
    const params = new URLSearchParams({ offset: String(offset), limit: "25" });
    if (query.trim()) params.set("query", query.trim());
    const map: Array<[string, string]> = [
      ["taxonomyNodeId", "taxonomyNodeId"],
      ["sourceKind", "sourceKind"],
      ["year", "year"],
      ["hasAnswer", "hasAnswer"],
      ["variantCount", "variantCount"],
      ["occurrenceState", "occurrenceState"],
    ];
    for (const [key, apiKey] of map) {
      const value = filterValue(filters, key);
      if (value) params.set(apiKey, value);
    }
    try {
      const result = await requestJson<DirectQuestionListResult>(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}/questions?${params.toString()}`, { signal: controller.signal });
      if (!controller.signal.aborted) setQuestions(result);
    } catch (cause) {
      if (!controller.signal.aborted) setListError(errorLabel(cause));
    } finally {
      if (!controller.signal.aborted) setQuestionsLoading(false);
    }
  }, [filters, offset, packageId, query]);

  React.useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  React.useEffect(() => {
    const timer = window.setTimeout(() => void loadQuestions(), query.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [loadQuestions, query]);
  React.useEffect(() => {
    if (!packageId) return;
    try {
      const stored = window.localStorage.getItem(`pythagoras:question-package-view:${packageId}`);
      if (stored) setSavedViews(JSON.parse(stored) as SavedView[]);
    } catch { /* UI preference storage is optional. */ }
  }, [packageId]);

  const saveViews = (next: SavedView[]) => {
    setSavedViews(next);
    try { window.localStorage.setItem(`pythagoras:question-package-view:${packageId}`, JSON.stringify(next)); } catch { /* Ignore unavailable browser storage. */ }
  };

  const openQuestion = async (item: DirectQuestionSummary) => {
    if (selected?.id === item.id) {
      closeInspector();
      return;
    }
    inspectorRequestRef.current?.abort();
    const controller = new AbortController();
    inspectorRequestRef.current = controller;
    setSelected(item);
    setSelectedQuestion(null);
    setInspectorLoading(true);
    try {
      const response = await requestJson<{ question: DirectQuestionDetail }>(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}/questions/${encodeURIComponent(item.id)}`, { signal: controller.signal });
      if (!controller.signal.aborted) setSelectedQuestion(response.question);
    } catch (cause) {
      if (!controller.signal.aborted) setListError(errorLabel(cause));
    } finally {
      if (!controller.signal.aborted) setInspectorLoading(false);
    }
  };

  const closeInspector = () => {
    inspectorRequestRef.current?.abort();
    inspectorRequestRef.current = null;
    setSelected(null);
    setSelectedQuestion(null);
    setInspectorLoading(false);
  };

  const editHref = selected ? `/admin/content/question-packages/${encodeURIComponent(packageId)}/questions/${encodeURIComponent(selected.id)}${contextQuery(fromSubjectKey, fromNodeId)}` : "#";
  const newHref = `/admin/content/question-packages/${encodeURIComponent(packageId)}/questions/new${contextQuery(fromSubjectKey, fromNodeId)}`;
  const backHref = fromSubjectKey ? `/admin/content/materials/${encodeURIComponent(fromSubjectKey)}` : `/admin/content/materials`;

  const deleteQuestion = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await requestJson(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}/questions/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: deleteTarget.revision }) });
      setDeleteTarget(null);
      setSelected(null);
      setSelectedQuestion(null);
      await Promise.all([loadWorkspace(), loadQuestions()]);
    } catch (cause) {
      setListError(errorLabel(cause));
    } finally {
      setDeleting(false);
    }
  };

  const updateTitle = async () => {
    if (!workspace || savingTitle || !titleDraft.trim() || titleDraft === workspace.package.title) return;
    setSavingTitle(true);
    try {
      const response = await requestJson<{ workspace: DirectQuestionPackageWorkspace }>(`/api/admin/local/question-packages/${encodeURIComponent(packageId)}`, { method: "PATCH", body: JSON.stringify({ title: titleDraft, expectedRevision: workspace.package.revision }) });
      setWorkspace(response.workspace);
      setTitleDraft(response.workspace.package.title);
    } catch (cause) {
      setError(errorLabel(cause));
    } finally {
      setSavingTitle(false);
    }
  };

  if (loading && !workspace) return <PageShell width="wide"><Panel><PanelBody><div className="h-12 w-72 animate-pulse rounded-md bg-inset" /></PanelBody></Panel></PageShell>;
  if (error || !workspace) return <PageShell width="wide"><ErrorState title="تعذّر تحميل الحزمة" description={error ?? "الحزمة غير موجودة."} onRetry={loadWorkspace} /></PageShell>;

  const pkg = workspace.package;
  const facets = buildFacets(workspace);
  const sourceAsset = pkg.sourceAsset;
  const headerMeta = <><span>{formatNumber(workspace.counts.questionCount)} سؤال</span><span>{formatNumber(workspace.counts.variantCount)} صيغة</span><span>{formatNumber(workspace.counts.occurrenceCount)} ورود</span></>;
  const originBreadcrumbs = [
    { label: "إدارة المحتوى", href: "/admin/content/materials" },
    { label: pkg.subjectLabel, href: backHref },
    { label: "بنك الأسئلة", href: backHref },
    { label: pkg.bankBrowseEntryLabel },
  ];

  return (
    <PageShell width="wide">
      <PageHeader
        breadcrumb={<Breadcrumbs items={originBreadcrumbs} />}
        eyebrow="مساحة حزمة الأسئلة"
        title={pkg.title}
        description={`${pkg.subjectLabel} · ${pkg.language} · الحزمة canonical المباشرة المستخدمة من مواضع بنك الأسئلة.`}
        icon={<BookOpen className="size-5 text-fg-tertiary" aria-hidden />}
        status={sourceAsset?.liveContentIsNewer ? <StatusBadge status="warning" label="معدّلة داخل الأدمن" size="sm" /> : <Tooltip content="المحتوى canonical المستخدم حاليًا في التطبيق."><span><StatusBadge status="active" label="نسخة حية" size="sm" /></span></Tooltip>}
        meta={headerMeta}
        actions={<><Button variant="secondary" asChild><Link href={newHref}>سؤال جديد</Link></Button>{fromSubjectKey ? <Button variant="quiet" asChild><Link href={backHref}><ChevronLeft aria-hidden /> العودة إلى بنك المادة</Link></Button> : null}</>}
        tabs={<Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)} items={[{ value: "questions", label: <><span>الأسئلة</span><span className="tnum text-fg-quaternary">{formatNumber(workspace.counts.questionCount)}</span></> }, { value: "taxonomy", label: "التصنيف", count: workspace.counts.taxonomyCount }, { value: "info", label: "معلومات الحزمة" }]} />}
      />

      <div className="pb-24 pt-3">
        {tab === "questions" ? (
          <div ref={questionWorkspaceRef} data-question-workspace className="min-w-0">
            <div className="flex min-w-0 items-start">
              <div className="min-w-0 flex-1" style={!inspectorUsesDrawer ? { minWidth: QUESTION_TABLE_MIN_WIDTH } : undefined}>
                <div data-question-table className="space-y-3">
                  <FilterBar
                    query={query}
                    onQueryChange={(value) => { setQuery(value); setOffset(0); }}
                    searchPlaceholder="ابحث في السؤال أو الإجابة أو المصدر…"
                    searchWidth="w-full sm:min-w-[16rem] sm:flex-1"
                    facets={facets}
                    values={filters}
                    onValuesChange={(value) => { setFilters(value); setOffset(0); }}
                    resultCount={questions?.items.length ?? 0}
                    totalCount={questions?.total ?? 0}
                    savedViews={savedViews}
                    activeViewId={savedViews.find((view) => JSON.stringify(view.values) === JSON.stringify(filters) && (view.query ?? "") === query)?.id ?? null}
                    onSelectView={(id) => { const view = savedViews.find((candidate) => candidate.id === id); setFilters(view?.values ?? {}); setQuery(view?.query ?? ""); setOffset(0); }}
                    onSaveView={(name) => saveViews([...savedViews, { id: `view-${Date.now()}`, name, values: filters, query }])}
                    onDeleteView={(id) => saveViews(savedViews.filter((view) => view.id !== id))}
                  >
                    <DensityControl value={density} onChange={setDensity} />
                  </FilterBar>
                  {listError ? <ErrorState size="sm" title="تعذّر تحميل قائمة الأسئلة" description={listError} onRetry={loadQuestions} /> : null}
                  <CanonicalQuestionTable items={questions?.items ?? []} loading={questionsLoading} density={density} activeRowId={selected?.id ?? null} onRowClick={openQuestion} onEdit={(item) => router.push(`/admin/content/question-packages/${encodeURIComponent(packageId)}/questions/${encodeURIComponent(item.id)}${contextQuery(fromSubjectKey, fromNodeId)}`)} onDelete={setDeleteTarget} noResultsState={<NoResultsState query={query || undefined} activeFilterCount={Object.values(filters).flat().length} entityLabel="سؤال" onClearFilters={() => { setFilters({}); setQuery(""); setOffset(0); }} />} />
                  {questions && questions.items.length > 0 ? <ServerPagination offset={questions.offset} limit={questions.limit} total={questions.total} onChange={setOffset} /> : null}
                </div>
              </div>
              {!inspectorUsesDrawer ? <QuestionInspectorSlot loading={inspectorLoading} question={selectedQuestion} taxonomy={workspace.taxonomy} onClose={closeInspector} onEdit={() => router.push(editHref)} /> : null}
            </div>
            {inspectorUsesDrawer ? <Drawer open={selectedQuestion !== null || inspectorLoading} onOpenChange={(open) => { if (!open) closeInspector(); }}><DrawerContent size="lg" side="end" overlay={false} aria-label="معاينة السؤال"><QuestionInspectorSlot className="w-full" loading={inspectorLoading} question={selectedQuestion} taxonomy={workspace.taxonomy} onClose={closeInspector} onEdit={() => router.push(editHref)} /></DrawerContent></Drawer> : null}
          </div>
        ) : null}

        {tab === "taxonomy" ? <TaxonomyTab workspace={workspace} /> : null}
        {tab === "info" ? <PackageInfoTab workspace={workspace} titleDraft={titleDraft} setTitleDraft={setTitleDraft} saving={savingTitle} onSave={updateTitle} /> : null}
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent size="sm">
          <DialogHeader title="حذف السؤال" description="هذا إجراء صريح على Question canonical، ولا يحذف الحزمة أو ملفات Asset." />
          <DialogBody><p className="text-sm text-fg-secondary">سيُحذف السؤال رقم <strong className="text-fg">{deleteTarget?.displayOrder}</strong> بصِيَغه ووروده وتعييناته، ثم يُعاد بناء البحث.</p><p className="mt-2 text-xs text-danger-text">لا يمكن التراجع عن هذا الإجراء.</p></DialogBody>
          <DialogFooter><Button variant="quiet" onClick={() => setDeleteTarget(null)} disabled={deleting}>إلغاء</Button><Button variant="destructive" onClick={() => void deleteQuestion()} loading={deleting}>حذف السؤال</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

const QUESTION_TABLE_MIN_WIDTH = 720;
const QUESTION_INSPECTOR_INLINE_THRESHOLD = 1_152;

function useQuestionInspectorDrawer(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const [usesDrawer, setUsesDrawer] = React.useState(true);

  React.useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    const update = () => setUsesDrawer(element.getBoundingClientRect().width < QUESTION_INSPECTOR_INLINE_THRESHOLD);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enabled, ref]);

  return usesDrawer;
}

function QuestionInspectorSlot({ loading, question, taxonomy, onClose, onEdit, className }: { loading: boolean; question: DirectQuestionDetail | null; taxonomy: DirectQuestionPackageWorkspace["taxonomy"]; onClose: () => void; onEdit: () => void; className?: string }) {
  if (loading) {
    return <InspectorPanel className={className} open title="جارٍ تحميل السؤال" subtitle="المعاينة والتفاصيل" width="lg" onClose={onClose}><Panel><PanelBody><div className="h-24 animate-pulse rounded-md bg-inset" /></PanelBody></Panel></InspectorPanel>;
  }
  if (!question) return null;
  return <CanonicalQuestionInspector className={className} question={question} taxonomy={taxonomy} onClose={onClose} onEdit={onEdit} />;
}

function buildFacets(workspace: DirectQuestionPackageWorkspace) {
  return [
    { id: "taxonomyNodeId", label: "التصنيف", searchable: true, multiple: false, icon: <Tags aria-hidden />, options: workspace.taxonomy.map((node) => ({ value: node.id, label: node.breadcrumb, count: node.questionCount })) },
    { id: "sourceKind", label: "المصدر", multiple: false, icon: <Archive aria-hidden />, options: workspace.filterOptions.sourceKinds.map((item) => ({ value: item.value, label: questionSourceKindLabel(item.value), count: item.count })) },
    { id: "year", label: "السنة", multiple: false, icon: <FolderOpen aria-hidden />, options: workspace.filterOptions.years.map((year) => ({ value: String(year), label: String(year) })) },
    { id: "hasAnswer", label: "الإجابة", multiple: false, icon: <Search aria-hidden />, options: [{ value: "1", label: "لها إجابة" }, { value: "0", label: "بلا إجابة" }] },
    { id: "variantCount", label: "الصيغ", multiple: false, icon: <BookOpen aria-hidden />, options: [{ value: "ONE", label: "صيغة واحدة" }, { value: "MULTIPLE", label: "عدة صيغ" }] },
    { id: "occurrenceState", label: "الورود", multiple: false, icon: <Filter aria-hidden />, options: [{ value: "HAS", label: "لها ورود" }, { value: "NONE", label: "بلا ورود" }] },
  ];
}

function TaxonomyTab({ workspace }: { workspace: DirectQuestionPackageWorkspace }) {
  return <div className="grid gap-6 lg:grid-cols-2"><Section title="شجرة التصنيف" description="تصنيفات الحزمة الحالية للعرض والتعيين فقط؛ تعديل بنية الشجرة مؤجل." spacing="none" divided><Panel><PanelHeader title={`${workspace.taxonomy.length} عقدة`} density="compact" /><PanelBody><div className="space-y-2">{workspace.taxonomy.map((node) => <div key={node.id} className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-inset px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{node.breadcrumb}</p><p className="mt-0.5 text-2xs text-fg-tertiary">{node.kind} · {node.questionCount} سؤال</p></div><Badge size="sm" variant="inset">{node.displayOrder}</Badge></div>)}</div></PanelBody></Panel></Section><Section title="مسار بنك الأسئلة" description="بنية Browse محفوظة كما هي، دون تحرير شجرة الحزمة في هذه المرحلة." spacing="none" divided><Panel><PanelBody>{workspace.browseNodes.length ? <div className="space-y-2">{workspace.browseNodes.map((node) => <div key={node.id} className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-inset px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{node.label}</p><p className="mt-0.5 text-2xs text-fg-tertiary">{node.nodeType} · {node.parentId ? "عنصر فرعي" : "جذر"}</p></div><Badge size="sm" variant="inset">{node.displayOrder}</Badge></div>)}</div> : <p className="text-sm text-fg-tertiary">لا توجد عقد Browse.</p>}</PanelBody></Panel></Section></div>;
}

function PackageInfoTab({ workspace, titleDraft, setTitleDraft, saving, onSave }: { workspace: DirectQuestionPackageWorkspace; titleDraft: string; setTitleDraft: (value: string) => void; saving: boolean; onSave: () => void }) {
  const pkg = workspace.package;
  return <div className="grid gap-6 lg:grid-cols-2"><Section title="بيانات الحزمة" description="الهوية الأصلية ثابتة؛ عنوان الحزمة وحده قابل للتعديل المباشر." spacing="none" divided><Panel><PanelBody><FormField label="عنوان الحزمة"><TextField value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} /></FormField><div className="mt-3 flex justify-end"><Button variant="primary" loading={saving} disabled={!titleDraft.trim() || titleDraft === pkg.title} onClick={onSave}>حفظ العنوان</Button></div><dl className="mt-5 grid gap-3 border-t border-border-subtle pt-4 text-sm">{[["packageKey", pkg.packageKey], ["subjectKey", pkg.subjectKey], ["language", pkg.language], ["bankBrowseMode", pkg.bankBrowseMode], ["entry", pkg.bankBrowseEntryLabel], ["إصدار المحتوى", pkg.contentRevision], ["إصدار الكيان", pkg.revision]].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4"><dt className="text-fg-tertiary">{label}</dt><dd dir={label === "language" || label === "subjectKey" || label === "packageKey" ? "ltr" : undefined} className="text-end text-fg">{value}</dd></div>)}</dl></PanelBody></Panel></Section><Section title="المصدر والاستخدام" description="الملف المرفوع provenance immutable، والتعديلات الحية لا تغيّر Asset الأصلي." spacing="none" divided><Panel><PanelBody>{pkg.sourceAsset ? <div className="space-y-2 text-sm"><p className="font-medium text-fg">{pkg.sourceAsset.displayName}</p><p className="text-xs text-fg-secondary">{pkg.sourceAsset.mimeType} · {formatNumber(pkg.sourceAsset.byteSize)} بايت</p><p className="font-mono text-2xs text-fg-quaternary" dir="ltr">{pkg.sourceAsset.sha256}</p><div className="flex flex-wrap gap-2"><Badge size="sm" variant="inset">المصدر rev {pkg.sourceAsset.sourceContentRevision ?? "—"}</Badge><Badge size="sm" variant="inset">الحالي rev {pkg.contentRevision}</Badge>{pkg.sourceAsset.liveContentIsNewer ? <StatusBadge status="warning" label="تعديل حي" size="sm" /> : null}</div></div> : <p className="text-sm text-fg-tertiary">لا يوجد Source Asset مرتبط.</p>}<div className="mt-5 border-t border-border-subtle pt-4"><p className="text-xs font-medium text-fg-secondary">مواضع الاستخدام</p>{pkg.placements.length ? <div className="mt-2 space-y-2">{pkg.placements.map((placement) => <p key={placement.nodeId} className="text-sm text-fg">{placement.materialLabel} <span className="text-fg-quaternary">←</span> {placement.nodeLabel}</p>)}</div> : <p className="mt-2 text-sm text-fg-tertiary">لا توجد مواضع حالية.</p>}</div></PanelBody></Panel></Section></div>;
}

function ServerPagination({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  const page = Math.floor(offset / limit);
  const pages = Math.max(1, Math.ceil(total / limit));
  return <div data-question-pagination className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3"><p className="text-xs text-fg-tertiary"><span dir="ltr" className="tnum">{total ? offset + 1 : 0}–{Math.min(offset + limit, total)}</span> من <span dir="ltr" className="tnum">{total}</span></p><div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={page === 0} onClick={() => onChange(Math.max(0, offset - limit))}>السابق</Button><span dir="ltr" className="text-xs text-fg-tertiary tnum">{page + 1} / {pages}</span><Button size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => onChange(offset + limit)}>التالي</Button></div></div>;
}

function contextQuery(subjectKey: string | null, nodeId: string | null): string {
  const query = new URLSearchParams();
  if (subjectKey) query.set("fromSubjectKey", subjectKey);
  if (nodeId) query.set("fromNodeId", nodeId);
  const value = query.toString();
  return value ? `?${value}` : "";
}
