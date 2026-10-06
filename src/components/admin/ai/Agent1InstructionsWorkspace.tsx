"use client";
import * as React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Check, Eye, FileText, History, Plus, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { compileInstructionSections, instructionBytes, instructionDraftKey, validateInstructionSections, INSTRUCTION_LIMITS, type InstructionSection } from "@/lib/ai-instruction-sections";
import type { InstructionAdminRevision } from "@/server/ai/policy/instruction-admin-service";
import type { InstructionTokenResult } from "@/server/ai/policy/instruction-token-service";
import { PageHeader, PageShell } from "@/components/admin-ui/layout/page";
import { Button } from "@/components/admin-ui/primitives/button";
import { Panel } from "@/components/admin-ui/primitives/surface";
import { Spinner } from "@/components/admin-ui/primitives/spinner";
import { Switch } from "@/components/admin-ui/forms/toggle";
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter } from "@/components/admin-ui/overlays/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter } from "@/components/admin-ui/overlays/drawer";
import { InstructionSectionCard } from "./instruction-section-card";
import { InstructionPreview } from "./instruction-preview";
import { useInstructionCount } from "./use-instruction-count";
import { useInstructionDraftGuard } from "./use-instruction-draft-guard";

const API = "/api/admin/local/ai/agent-1/instructions";
const number = (value: number) => value.toLocaleString("en-US");
const date = (value?: number) => value ? new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeStyle: "short" }).format(value) : "لم تُنشر بعد";
function blankSection(): InstructionSection { return { id: crypto.randomUUID(), title: "", description: "", body: "", enabled: true }; }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw Object.assign(new Error(body.message ?? "تعذّر إكمال العملية. حاول مجددًا."), { code: body.code });
  return body as T;
}
export function Agent1InstructionsWorkspace() {
  const [current, setCurrent] = React.useState<InstructionAdminRevision | null>(null);
  const [sections, setSections] = React.useState<InstructionSection[]>([]);
  const [enabled, setEnabled] = React.useState(true);
  const [baseKey, setBaseKey] = React.useState("");
  const [baseSections, setBaseSections] = React.useState<InstructionSection[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState(false);
  const [review, setReview] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyRows, setHistoryRows] = React.useState<InstructionAdminRevision[]>([]);
  const [historyBefore, setHistoryBefore] = React.useState<number | null>(null);
  const [historyBusy, setHistoryBusy] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<InstructionAdminRevision | null>(null);
  const [selectedCount, setSelectedCount] = React.useState<InstructionTokenResult | null>(null);
  const [selectedCountFailed, setSelectedCountFailed] = React.useState(false);
  const [publishedCount, setPublishedCount] = React.useState<InstructionTokenResult | null>(null);
  const [restoring, setRestoring] = React.useState<InstructionAdminRevision | null>(null);
  const dirty = Boolean(baseKey && instructionDraftKey(sections, enabled) !== baseKey);
  useInstructionDraftGuard(dirty);
  const count = useInstructionCount(sections);
  const compiled = compileInstructionSections(sections);
  let validation: string | null = null;
  try { validateInstructionSections(sections, true); } catch (reason) { validation = reason instanceof Error ? reason.message : "المسودة غير مكتملة."; }
  const active = sections.filter((section) => section.enabled).length;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await request<{ current: InstructionAdminRevision | null }>(API);
      const initial = result.current?.sections ?? [{ ...blankSection(), title: "ماذا تدعى أنت كمودل؟", description: "هوية المساعد ودوره داخل تطبيق فيثاغورس." }];
      setCurrent(result.current); setSections(initial); setBaseSections(structuredClone(initial)); setEnabled(result.current?.enabled ?? true); setBaseKey(instructionDraftKey(initial, result.current?.enabled ?? true)); setConflict(false); setCollapsed(new Set());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تعذّر التحميل."); } finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { if (focusId) { document.getElementById(`instruction-title-${focusId}`)?.focus(); setFocusId(null); } }, [focusId]);
  React.useEffect(() => {
    setPublishedCount(null);
    if (!current) return;
    const controller = new AbortController();
    void request<{ result: InstructionTokenResult }>(API + "/count", { method: "POST", body: JSON.stringify({ revision: current.revision }), signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setPublishedCount(value.result); }).catch(() => {});
    return () => controller.abort();
  }, [current, count.basis?.key]);
  React.useEffect(() => {
    setSelectedCount(null);
    setSelectedCountFailed(false);
    if (!selected) return;
    const controller = new AbortController();
    void request<{ result: InstructionTokenResult }>(API + "/count", { method: "POST", body: JSON.stringify({ revision: selected.revision }), signal: controller.signal }).then((value) => { if (!controller.signal.aborted) setSelectedCount(value.result); }).catch(() => { if (!controller.signal.aborted) setSelectedCountFailed(true); });
    return () => controller.abort();
  }, [selected]);
  function add(after?: string) {
    if (sections.length >= INSTRUCTION_LIMITS.sections) { toast.error("الحد الأقصى 24 فقرة."); return; }
    const source = after ? sections.find((section) => section.id === after) : null;
    const next = source ? { ...source, id: crypto.randomUUID() } : blankSection();
    setSections((previous) => { const result = [...previous]; result.splice(source ? previous.findIndex((section) => section.id === after) + 1 : result.length, 0, next); return result; }); setFocusId(next.id);
  }
  function move(id: string, direction: -1 | 1) { setSections((previous) => { const from = previous.findIndex((section) => section.id === id); return from + direction < 0 || from + direction >= previous.length ? previous : arrayMove(previous, from, from + direction); }); }
  async function publish() {
    setBusy(true); setError(null);
    try {
      const value = await request<{ current: InstructionAdminRevision }>(API, { method: "PUT", body: JSON.stringify({ expectedRevision: current?.revision ?? 0, sections, enabled }) });
      setCurrent(value.current); setSections(value.current.sections); setBaseSections(structuredClone(value.current.sections)); setBaseKey(instructionDraftKey(value.current.sections, value.current.enabled)); setEnabled(value.current.enabled); setReview(false); setConflict(false); toast.success("نُشر إصدار جديد. تطبّق التعليمات على الطلبات التالية فقط.");
    } catch (reason) { if ((reason as { code?: string }).code === "AI_POLICY_CONFLICT") { setConflict(true); setReview(false); } setError(reason instanceof Error ? reason.message : "تعذّر النشر."); } finally { setBusy(false); }
  }
  async function loadHistory(before?: number) {
    setHistoryBusy(true); setHistoryError(null);
    try { const result = await request<{ revisions: InstructionAdminRevision[]; nextBefore: number | null }>(API + "/history" + (before ? `?before=${before}` : "")); setHistoryRows((previous) => before ? [...previous, ...result.revisions] : result.revisions); setHistoryBefore(result.nextBefore); } catch (reason) { setHistoryError(reason instanceof Error ? reason.message : "تعذّر تحميل السجل."); } finally { setHistoryBusy(false); }
  }
  function restore(revision: InstructionAdminRevision) { setSections(structuredClone(revision.sections)); setEnabled(revision.enabled); setCollapsed(new Set()); setHistoryOpen(false); setRestoring(null); toast.info(`استُعيد الإصدار ${revision.revision} كمسودة فقط. لم يتغيّر الإصدار الحي.`); }
  const header = <PageHeader eyebrow="Agent 1 · التعليمات العامة" title="تعليمات Agent 1" description="فقرات مرتّبة تحدّد سلوك المساعد. راجع النص التنفيذي ثم انشر إصدارًا واضحًا."
    status={dirty ? <span className="rounded-md bg-warning-subtle px-2 py-1 text-2xs text-warning-text">مسودة غير منشورة</span> : null}
    actions={<><Button icon={<History />} onClick={() => { setHistoryOpen(true); setSelected(null); void loadHistory(); }}>سجل الإصدارات</Button><Button icon={<Eye />} onClick={() => setPreview(true)} disabled={loading}>معاينة</Button><Button variant="primary" icon={<Upload />} disabled={loading || busy || !dirty} onClick={() => setReview(true)}>نشر التعليمات</Button></>} />;
  if (loading) return <PageShell className="gap-5">{header}<Panel padding="lg"><div className="grid min-h-48 place-items-center"><Spinner label="جارٍ تحميل التعليمات" /></div></Panel></PageShell>;
  if (!baseKey) return <PageShell className="gap-5">{header}<Panel padding="lg"><p role="alert">{error}</p><Button onClick={() => void load()} className="mt-4">إعادة المحاولة</Button></Panel></PageShell>;
  const estimated = count.result?.total.precision !== "exact";
  const delta = count.result && publishedCount && count.result.basis.key === publishedCount.basis.key && count.result.total.method === publishedCount.total.method ? count.result.total.tokens - publishedCount.total.tokens : null;
  return <PageShell className="gap-5">
    {header}
    <Panel padding="none"><div className="grid grid-cols-2 divide-x divide-x-reverse divide-border-subtle md:grid-cols-4">
      <Metric label="الإصدار المنشور" value={current ? `v${current.revision}` : "لا يوجد"} detail={current ? current.actorName : "المساعد يعمل دون تعليمات عامة"} />
      <Metric label="الفقرات المفعّلة في المسودة" value={`${active} / ${sections.length}`} detail="الترتيب هو ترتيب قراءة النموذج" />
      <Metric label="Input Tokens · المسودة" value={count.result ? `${estimated ? "≈ " : ""}${number(count.result.total.tokens)}` : "…"} detail={count.result ? estimated ? "تقديري · ليس استهلاكًا فعليًا" : "دقيق لطلب التعليمات فقط" : "جارٍ العدّ"} />
      <Metric label="آخر نشر" value={date(current?.createdAt)} detail={current?.enabled ? "التعليمات المنشورة مفعّلة" : current ? "السياسة المنشورة معطّلة" : "لم يُحفظ أي محتوى بعد"} />
    </div></Panel>
    {error ? <div role="alert" className="rounded-lg border border-danger-border bg-danger-subtle px-4 py-3 text-sm text-danger-text">{error}{conflict ? <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => { if (window.confirm("تحميل أحدث إصدار يستبدل مسودتك الحالية. متابعة؟")) void load(); }}>تحميل أحدث إصدار</Button><Button size="sm" onClick={() => { setHistoryOpen(true); void loadHistory(); }}>مراجعة السجل مع الاحتفاظ بالمسودة</Button></div> : null}</div> : null}
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Switch checked={enabled} onCheckedChange={setEnabled} disabled={busy} aria-label="تفعيل سياسة التعليمات في المسودة" /><div><p className="text-sm font-medium">تطبيق التعليمات العامة</p><p className="mt-0.5 text-2xs text-fg-tertiary">التغيير لا يسري إلا بعد النشر. عند التعطيل لا تُرسل هذه السياسة.</p></div></div><Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={count.refresh}>تحديث العدّ</Button></div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-fg-tertiary" aria-hidden />فقرات التعليمات</h2><span className="text-2xs text-fg-tertiary">{count.basis?.modelName ? `العدّ حسب الرئيسي: ${count.basis.modelName}` : "لا يوجد نموذج رئيسي للعدّ الدقيق"}</span></div>
    <DndContext id="agent-1-instruction-order" sensors={sensors} collisionDetection={closestCenter} accessibility={{ screenReaderInstructions: { draggable: "اضغط مساحة لالتقاط الفقرة، ثم السهم لأعلى أو لأسفل، ومساحة للتثبيت أو Escape للإلغاء." }, announcements: { onDragStart: () => "بدأ ترتيب الفقرة.", onDragOver: ({ over }) => over ? `الموضع ${sections.findIndex((section) => section.id === over.id) + 1}` : undefined, onDragEnd: () => "تم ترتيب الفقرات في المسودة.", onDragCancel: () => "أُلغي الترتيب." } }}
      onDragEnd={({ active: dragged, over }) => { if (busy || !over || dragged.id === over.id) return; setSections((previous) => arrayMove(previous, previous.findIndex((section) => section.id === dragged.id), previous.findIndex((section) => section.id === over.id))); }}>
      <SortableContext items={sections.map((section) => section.id)} strategy={verticalListSortingStrategy}><div className="space-y-4">{sections.map((section, index) => <InstructionSectionCard key={section.id} section={section} position={index + 1} last={index === sections.length - 1} count={count.section(section.id)}
        dirty={JSON.stringify(section) !== JSON.stringify(baseSections.find((item) => item.id === section.id)) || baseSections.findIndex((item) => item.id === section.id) !== index} collapsed={collapsed.has(section.id)} busy={busy}
        update={(patch) => setSections((previous) => previous.map((item) => item.id === section.id ? { ...item, ...patch } : item))}
        toggleCollapsed={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(section.id)) next.delete(section.id); else next.add(section.id); return next; })}
        duplicate={() => add(section.id)} remove={() => { if ([section.title, section.description, section.body].some((text) => text.trim())) setDeleting(section.id); else setSections((previous) => previous.filter((item) => item.id !== section.id)); }} move={(direction) => move(section.id, direction)} />)}</div></SortableContext>
    </DndContext>
    <Button variant="outline" block icon={<Plus />} disabled={busy || sections.length >= INSTRUCTION_LIMITS.sections} onClick={() => add()}>إضافة فقرة</Button>
    <div className="flex flex-wrap justify-between gap-2 text-2xs leading-relaxed text-fg-quaternary"><span>{count.failure ?? "العدّ يخص التعليمات فقط، وليس كامل المحادثة. الأرقام الفردية لا تُجمع بدل عدّ النص الكامل."}</span><span dir="ltr">{number(instructionBytes(compiled.text))} / 32,768 bytes · Compiler V1</span></div>
    <NativeCountDisclosure method={count.result?.total.method} />
    {count.result?.total.method === "utf8-estimate-v1" ? <p className="text-2xs text-fg-tertiary">لا يوفّر هذا المسار عدّادًا رسميًا متاحًا. المعروض تقريب UTF-8، وقد يختلف عن ترميز النموذج الفعلي؛ فشل العدّ لا يمنع النشر.</p> : count.result?.total.method === "anthropic-count-tokens" ? <p className="text-2xs text-fg-tertiary">عدّ Anthropic رسمي لكنه موصوف من المزوّد كتقدير. يتضمّن تأطير الطلب ورسالة اختبار قصيرة للعدّ فقط؛ لا تُولّد إجابة.</p> : count.result ? <p className="text-2xs text-fg-tertiary">OpenAI input_tokens: عدّ دقيق لطلب بلا محادثة، يحتوي التعليمات وتأطير API. لا يعني ذلك دقة تكلفة طلب المستخدم الكامل.</p> : null}

    <Drawer open={preview} onOpenChange={setPreview}><DrawerContent dir="rtl" size="lg"><DrawerHeader title="معاينة التعليمات" description="هذا هو النص الذي سينتج عن المسودة؛ المعاينة لا تغيّر المساعد الحي." /><DrawerBody><InstructionPreview sections={sections} text={compiled.text} /><div className="mt-4 break-all text-2xs text-fg-quaternary" dir="ltr">SHA-256: {count.result?.compiledHash ?? "جارٍ حساب البصمة…"}</div></DrawerBody></DrawerContent></Drawer>
    <Dialog open={review} onOpenChange={(open) => { if (!busy) setReview(open); }}><DialogContent dir="rtl"><DialogHeader title="نشر إصدار جديد" description="الطلبات الجارية تحتفظ بإصدارها. الطلبات التالية فقط تقرأ هذا الإصدار." /><DialogBody>
      <div className="space-y-3 py-3 text-sm"><p>الإصدار: <b dir="ltr">v{current?.revision ?? 0} → v{(current?.revision ?? 0) + 1}</b></p><p>{active} فقرة مفعّلة · السياسة {enabled ? "مفعّلة" : "معطّلة"}</p><p>Input Tokens: {count.result ? `${estimated ? "≈ " : ""}${number(count.result.total.tokens)}` : "العدّ غير متاح — لا يمنع النشر"}</p><p className="text-fg-tertiary">الفرق عن المنشور: {delta === null ? "غير متاح على أساس موحّد" : `${estimated || publishedCount?.total.precision === "estimated" ? "≈ " : ""}${delta > 0 ? "+" : ""}${number(delta)} tokens`}</p>
      {validation ? <p role="alert" className="rounded-md bg-warning-subtle p-3 text-warning-text">{validation}</p> : null}{error && !conflict ? <p role="alert" className="text-danger-text">{error}</p> : null}</div>
    </DialogBody><DialogFooter><Button disabled={busy} onClick={() => setReview(false)}>إلغاء</Button><Button variant="primary" icon={<Check />} loading={busy} disabled={Boolean(validation) || conflict} onClick={() => void publish()}>تأكيد النشر</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}><DialogContent dir="rtl" size="sm"><DialogHeader title="حذف هذه الفقرة؟" description="ستُحذف من المسودة فقط. الإصدارات المنشورة تبقى محفوظة في السجل." /><DialogFooter><Button onClick={() => setDeleting(null)}>إلغاء</Button><Button variant="destructive" onClick={() => { setSections((previous) => previous.filter((item) => item.id !== deleting)); setDeleting(null); }}>حذف الفقرة</Button></DialogFooter></DialogContent></Dialog>
    <Drawer open={historyOpen} onOpenChange={setHistoryOpen}><DrawerContent dir="rtl" size="lg"><DrawerHeader title={selected ? `الإصدار ${selected.revision}` : "سجل الإصدارات"} description="إصدارات غير قابلة للتعديل. الاستعادة تنشئ مسودة؛ لا تعيد نشر التاريخ تلقائيًا." /><DrawerBody>
      {selected ? <><Button size="sm" variant="ghost" onClick={() => setSelected(null)} className="mb-4">العودة للسجل</Button><p className="mb-4 text-xs text-fg-tertiary">{date(selected.createdAt)} · {selected.actorName} · {selected.activeSections} فقرة مفعّلة</p><p className="mb-4 text-xs text-fg-tertiary">Input Tokens: {selectedCount ? `${selectedCount.total.precision === "estimated" ? "≈ " : ""}${number(selectedCount.total.tokens)} · ${selectedCount.basis.modelName ?? "لا يوجد نموذج رئيسي"}` : selectedCountFailed ? "العدّ غير متاح حاليًا؛ المعاينة والاستعادة متاحتان." : "جارٍ العدّ…"} · حسب الرئيسي الحالي</p><NativeCountDisclosure method={selectedCount?.total.method} /><InstructionPreview sections={selected.sections} text={selected.instructions} legacy={selected.legacy} /><p dir="ltr" className="mt-4 break-all text-2xs text-fg-quaternary">SHA-256: {selected.compiledHash}</p></> : <div className="space-y-2">
        {historyError ? <div role="alert"><p className="text-sm text-danger-text">{historyError}</p><Button size="sm" onClick={() => void loadHistory()}>إعادة المحاولة</Button></div> : null}
        {!historyBusy && historyRows.length === 0 && !historyError ? <p className="py-10 text-center text-sm text-fg-tertiary">لا توجد إصدارات منشورة بعد.</p> : null}
        {historyRows.map((revision) => <button key={revision.revisionId} type="button" onClick={() => setSelected(revision)} className="focus-ring flex w-full items-start justify-between gap-3 rounded-lg border border-border-subtle p-4 text-start hover:bg-hover"><div><p className="text-sm font-semibold">الإصدار {revision.revision}{revision.revision === current?.revision ? " · الحالي" : ""}</p><p className="mt-1 text-xs text-fg-tertiary">{date(revision.createdAt)} · {revision.actorName}</p><p className="mt-2 text-2xs text-fg-quaternary">{revision.activeSections} فقرة مفعّلة · {revision.legacy ? "نص سابق" : "فقرات منظّمة"} · {revision.enabled ? "مفعّل" : "معطّل"}</p><p className="mt-1 text-2xs text-fg-quaternary">{revisionSummary(revision)}</p></div><span className="shrink-0 text-2xs text-fg-tertiary" dir="ltr">≈ {number(Math.ceil(instructionBytes(revision.instructions) / 3))} tokens</span></button>)}
        {historyBusy ? <Spinner label="جارٍ تحميل السجل" /> : historyBefore ? <Button block onClick={() => void loadHistory(historyBefore)}>إصدارات أقدم</Button> : null}
        {historyRows.length ? <p className="pt-2 text-2xs text-fg-quaternary">أرقام السجل تقديرات للنص التنفيذي، وليست استهلاكًا مسجّلًا عند النشر.</p> : null}
      </div>}
    </DrawerBody>{selected ? <DrawerFooter><Button icon={<History />} onClick={() => dirty ? setRestoring(selected) : restore(selected)}>استعادة كمسودة</Button></DrawerFooter> : null}</DrawerContent></Drawer>
    <Dialog open={restoring !== null} onOpenChange={(open) => { if (!open) setRestoring(null); }}><DialogContent dir="rtl" size="sm"><DialogHeader title="استبدال المسودة الحالية؟" description="لديك تعديلات غير منشورة. الاستعادة تستبدلها ولا تغيّر الإصدار الحي." /><DialogFooter><Button onClick={() => setRestoring(null)}>إلغاء</Button><Button variant="primary" onClick={() => { if (restoring) restore(restoring); }}>استعادة كمسودة</Button></DialogFooter></DialogContent></Dialog>
  </PageShell>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="min-w-0 px-4 py-4"><p className="text-2xs text-fg-tertiary">{label}</p><p className="mt-2 break-words text-sm font-semibold tnum">{value}</p><p className="mt-1.5 text-2xs leading-relaxed text-fg-quaternary">{detail}</p></div>; }
function revisionSummary(revision: InstructionAdminRevision) {
  if (revision.revision === 1) return "النشر الأول";
  const { added, removed, changed, reordered, enabledChanged } = revision.summary;
  return [added ? `${added} مضافة` : null, removed ? `${removed} محذوفة` : null, changed ? `${changed} معدّلة` : null, reordered ? "ترتيب جديد" : null, enabledChanged ? "تغيير حالة السياسة" : null].filter(Boolean).join(" · ") || "المحتوى دون تغيير";
}
function NativeCountDisclosure({ method }: { method?: InstructionTokenResult["total"]["method"] }) {
  return method === "openai-input-tokens" || method === "anthropic-count-tokens"
    ? <p className="text-2xs leading-relaxed text-fg-quaternary">يُرسل نص التعليمات إلى عدّاد رموز المزوّد المهيّأ لحساب العدد فقط؛ لا يُرسل الوصف الإداري ولا تُولّد إجابة.</p>
    : null;
}
