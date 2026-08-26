"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, BookOpen, Boxes, FolderTree, LayoutGrid, Library, Loader2, Plus, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
  MaterialQuestionBankAdminWorkspace,
  MaterialQuestionBankLayoutContent,
  MaterialQuestionBankNodeContent,
  MaterialQuestionBankPackageOption,
} from "@/server/material-question-bank";

type ApiBody = { workspace?: MaterialQuestionBankAdminWorkspace; workflow?: MaterialQuestionBankAdminWorkspace["workflow"]; id?: string; code?: string };

export function MaterialQuestionBankWorkspace({ subjectKey }: { subjectKey: string }) {
  const [workspace, setWorkspace] = useState<MaterialQuestionBankAdminWorkspace | null>(null);
  const [layout, setLayout] = useState<MaterialQuestionBankLayoutContent | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/material-question-bank/${encodeURIComponent(subjectKey)}`, { cache: "no-store" });
      const body = await response.json() as ApiBody;
      if (!response.ok || !body.workspace) throw new Error(body.code);
      setWorkspace(body.workspace); setLayout(structuredClone(body.workspace.layout)); setDirty(false);
      setSelectedId((current) => body.workspace!.layout.nodes.some((node) => node.id === current) ? current : body.workspace!.layout.nodes[0]?.id ?? null);
    } catch { setMessage("تعذّر تحميل مساحة تخطيط بنك الأسئلة لهذه المادة."); }
    finally { setLoading(false); }
  }, [subjectKey]);
  useEffect(() => { void load(); }, [load]);

  const selected = layout?.nodes.find((node) => node.id === selectedId) ?? null;
  const readOnly = Boolean(workspace?.workflow && !workspace.workflow.editable);
  const packageMap = useMemo(() => new Map(workspace?.packages.map((item) => [item.id, item]) ?? []), [workspace?.packages]);
  const taxonomy = workspace?.taxonomy.filter((item) => item.packageId === selected?.packageId) ?? [];
  const warnings = layout && workspace ? crossSubjectWarnings(layout, workspace.material.subjectKey, workspace.material.label, workspace.packages) : [];

  const updateLayout = (next: MaterialQuestionBankLayoutContent) => { setLayout(next); setDirty(true); };
  const updateNode = (id: string, patch: Partial<MaterialQuestionBankNodeContent>) => {
    if (!layout || readOnly) return;
    updateLayout({ ...layout, nodes: layout.nodes.map((node) => node.id === id ? normalizeNodePatch({ ...node, ...patch }) : node) });
  };

  const addNode = async (nodeType: "GROUP" | "BANK") => {
    if (!layout || readOnly) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/material-question-bank/${encodeURIComponent(subjectKey)}/ids`, { method: "POST" });
      const body = await response.json() as ApiBody;
      if (!response.ok || !body.id) throw new Error(body.code);
      const siblings = layout.nodes.filter((node) => node.parentId === null);
      const base = { id: body.id, nodeKey: `${nodeType === "GROUP" ? "group" : "bank"}-${body.id.slice(0, 8)}`, label: nodeType === "GROUP" ? "مجموعة جديدة" : "بنك جديد", nodeType, parentId: null, displayOrder: Math.max(0, ...siblings.map((node) => node.displayOrder)) + 1, enabled: true };
      const node: MaterialQuestionBankNodeContent = nodeType === "GROUP"
        ? { ...base, nodeType, groupPresentation: "CARDS", packageId: null, targetMode: null, taxonomyNodeId: null, includeDescendants: null }
        : { ...base, nodeType, groupPresentation: null, packageId: null, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeId: null, includeDescendants: null };
      updateLayout({ ...layout, nodes: [...layout.nodes, node] }); setSelectedId(node.id);
    } catch { setMessage("تعذّر إنشاء هوية عقدة جديدة."); }
    finally { setBusy(false); }
  };

  const removeNode = (id: string) => {
    if (!layout || readOnly || workspace?.publishedNodeIds.includes(id)) return;
    if (layout.nodes.some((node) => node.parentId === id)) { setMessage("انقل العقد التابعة أو احذفها أولًا."); return; }
    updateLayout({ ...layout, nodes: layout.nodes.filter((node) => node.id !== id) }); setSelectedId(null);
  };

  const save = async () => {
    if (!layout || readOnly) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/material-question-bank/${encodeURIComponent(subjectKey)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout }) });
      const body = await response.json() as ApiBody;
      if (!response.ok || !body.workflow) throw new Error(body.code);
      setMessage("حُفظ التخطيط داخل Change Set دون نشره للطالب."); await load();
    } catch (error) { setMessage(error instanceof Error && error.message ? `تعذّر الحفظ (${error.message}).` : "تعذّر حفظ التخطيط."); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!workspace?.workflow?.editable || dirty) { setMessage(dirty ? "احفظ التغييرات أولًا ثم أرسلها للمراجعة." : "لا توجد مسودة قابلة للإرسال."); return; }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/material-question-bank/${encodeURIComponent(subjectKey)}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: workspace.workflow.revision }) });
      const body = await response.json() as { code?: string };
      if (!response.ok) throw new Error(body.code);
      setMessage("أُرسلت المسودة إلى مراجعة OWNER."); await load();
    } catch { setMessage("تعذّر إرسال التخطيط للمراجعة."); }
    finally { setBusy(false); }
  };

  if (loading) return <main className="grid min-h-[65vh] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></main>;
  if (!workspace || !layout) return <main className="p-8" dir="rtl"><p className="rounded-2xl bg-destructive/10 p-4 text-destructive">{message ?? "التخطيط غير متاح."}</p></main>;

  return <main className="mx-auto w-full max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8" dir="rtl">
    <header className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><Link href="/admin/materials" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" /> إدارة المواد</Link><p className="mt-4 text-[10px] font-bold tracking-[.18em] text-primary">MATERIAL QUESTION BANK</p><h1 className="mt-2 text-2xl font-black">بنك أسئلة {workspace.material.label}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">ركّب حزم الأسئلة المنشورة داخل تجربة المادة. الحفظ ينشئ مسودة، والنشر يبقى بيد OWNER.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href="/admin/library"><Library className="h-4 w-4" /> مكتبة الأصول</Link></Button>{workspace.workflow ? <Button variant="outline" asChild><Link href={`/admin/review/${workspace.workflow.id}`}><ShieldCheck className="h-4 w-4" /> فتح المراجعة</Link></Button> : null}<Button disabled={busy || readOnly || !dirty} onClick={() => void save()}><Save className="h-4 w-4" /> حفظ المسودة</Button><Button variant="secondary" disabled={busy || readOnly || !workspace.workflow?.editable} onClick={() => void submit()}><Send className="h-4 w-4" /> إرسال للمراجعة</Button></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px]"><Badge>{workspace.published ? `منشور · revision ${workspace.canonicalRevision}` : "لم يُنشر تخطيط بعد"}</Badge>{workspace.workflow ? <Badge>{workflowLabel(workspace.workflow.status)} · {workspace.workflow.itemCount} عنصر</Badge> : null}{dirty ? <Badge tone="amber">تغييرات محلية غير محفوظة</Badge> : null}</div>
      {message ? <p className="mt-4 rounded-xl bg-muted/60 p-3 text-xs">{message}</p> : null}
    </header>

    {warnings.map((warning) => <div key={warning.nodeId} className="flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-6 text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warning.message}</div>)}

    <section className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)_360px]">
      <aside className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b p-4"><h2 className="font-bold">بنية البنك</h2><p className="mt-1 text-[11px] text-muted-foreground">هوية مستقرة وترتيب صريح لكل عقدة.</p><div className="mt-3 grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={busy || readOnly} onClick={() => void addNode("GROUP")}><FolderTree className="h-4 w-4" /> مجموعة</Button><Button size="sm" variant="outline" disabled={busy || readOnly} onClick={() => void addNode("BANK")}><BookOpen className="h-4 w-4" /> بنك</Button></div></div>
        <div className="max-h-[660px] space-y-2 overflow-y-auto p-3">{layout.nodes.length ? hierarchy(layout.nodes).map(({ node, depth }) => <button key={node.id} type="button" onClick={() => setSelectedId(node.id)} className={`flex w-full items-center gap-2 rounded-xl border p-3 text-right transition ${selectedId === node.id ? "border-primary bg-primary/5" : "border-transparent bg-muted/35 hover:border-primary/30"}`} style={{ paddingRight: `${12 + depth * 18}px` }}><span className="rounded-lg bg-background p-1.5">{node.nodeType === "GROUP" ? <FolderTree className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs">{node.label}</strong><small className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">{node.nodeKey} · {node.displayOrder}</small></span>{!node.enabled ? <span className="text-[9px] text-muted-foreground">معطّل</span> : null}</button>) : <p className="p-8 text-center text-xs text-muted-foreground">ابدأ بإضافة بنك مباشر أو مجموعة بطاقات.</p>}</div>
      </aside>

      <section className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2"><Field label="نمط جذر التجربة"><Segment options={[{ value: "CARDS", label: "بطاقات" }, { value: "DIRECT", label: "دخول مباشر" }]} value={layout.rootPresentation} disabled={readOnly} onChange={(value) => updateLayout({ ...layout, rootPresentation: value as "CARDS" | "DIRECT" })} /></Field><div className="rounded-xl bg-muted/40 p-3 text-xs leading-6 text-muted-foreground">DIRECT يتطلب بنكًا واحدًا مفعّلًا في الجذر عند النشر. CARDS يدعم بنوكًا ومجموعات متعددة.</div></div>
        <div className="my-5 border-t" />
        {selected ? <NodeEditor node={selected} nodes={layout.nodes} packages={workspace.packages} taxonomy={taxonomy} readOnly={readOnly} published={workspace.publishedNodeIds.includes(selected.id)} onChange={(patch) => updateNode(selected.id, patch)} onRemove={() => removeNode(selected.id)} /> : <div className="grid min-h-[420px] place-items-center text-center"><div><Boxes className="mx-auto h-10 w-10 text-primary/50" /><p className="mt-3 text-sm font-bold">اختر عقدة لتحريرها</p><p className="mt-1 text-xs text-muted-foreground">أو أنشئ مجموعة/بنكًا جديدًا.</p></div></div>}
      </section>

      <aside className="rounded-2xl border bg-[#080c13] p-4 text-white"><div className="flex items-center gap-2"><LayoutGrid className="h-4 w-4 text-cyan-400" /><div><h2 className="text-sm font-bold">معاينة البنية</h2><p className="text-[10px] text-slate-400">لا تعرض أسئلة وهمية</p></div></div><div className="mt-4"><StructurePreview layout={layout} packages={packageMap} /></div></aside>
    </section>
  </main>;
}

function NodeEditor({ node, nodes, packages, taxonomy, readOnly, published, onChange, onRemove }: { node: MaterialQuestionBankNodeContent; nodes: MaterialQuestionBankNodeContent[]; packages: MaterialQuestionBankPackageOption[]; taxonomy: MaterialQuestionBankAdminWorkspace["taxonomy"]; readOnly: boolean; published: boolean; onChange: (patch: Partial<MaterialQuestionBankNodeContent>) => void; onRemove: () => void }) {
  const parents = nodes.filter((candidate) => candidate.nodeType === "GROUP" && candidate.id !== node.id && !isDescendant(candidate.id, node.id, nodes));
  const pack = packages.find((item) => item.id === node.packageId);
  return <div className="space-y-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-black">{node.nodeType === "GROUP" ? "تحرير المجموعة" : "تحرير البنك"}</h2><p className="mt-1 font-mono text-[9px] text-muted-foreground">{node.id}</p></div><Button size="sm" variant="ghost" className="text-destructive" disabled={readOnly || published} onClick={onRemove}><Trash2 className="h-4 w-4" /> حذف</Button></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="العنوان"><Input value={node.label} disabled={readOnly} onChange={(event) => onChange({ label: event.target.value })} /></Field><Field label="المفتاح الدلالي"><Input dir="ltr" value={node.nodeKey} disabled={readOnly || published} onChange={(event) => onChange({ nodeKey: event.target.value.toLowerCase() })} /></Field><Field label="العقدة الأم"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={readOnly} value={node.parentId ?? ""} onChange={(event) => onChange({ parentId: event.target.value || null })}><option value="">الجذر</option>{parents.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><Field label="الترتيب"><Input type="number" min={1} max={10000} value={node.displayOrder} disabled={readOnly} onChange={(event) => onChange({ displayOrder: Math.max(1, Number(event.target.value) || 1) })} /></Field></div>
    <div className="flex items-center justify-between rounded-xl border p-3"><div><Label>مفعّل</Label><p className="mt-1 text-[10px] text-muted-foreground">العقد المنشورة تُعطّل بدل حذفها.</p></div><Switch checked={node.enabled} disabled={readOnly} onCheckedChange={(enabled) => onChange({ enabled })} /></div>
    {node.nodeType === "GROUP" ? <Field label="طريقة عرض المجموعة"><Segment options={[{ value: "CARDS", label: "بطاقات" }, { value: "SWITCHER", label: "مبدّل" }]} value={node.groupPresentation ?? "CARDS"} disabled={readOnly} onChange={(value) => onChange({ groupPresentation: value as "CARDS" | "SWITCHER" })} /></Field> : <div className="space-y-5 rounded-2xl border bg-muted/20 p-4"><Field label="حزمة الأسئلة"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={readOnly} value={node.packageId ?? ""} onChange={(event) => onChange({ packageId: event.target.value || null, taxonomyNodeId: null, targetMode: "ALL_PACKAGE_QUESTIONS", includeDescendants: null })}><option value="">فتحة فارغة — اختر لاحقًا</option>{packages.map((item) => <option key={item.id} value={item.id} disabled={!item.published}>{item.title} · {item.subjectLabel} · {item.questionCount} سؤال{item.published ? "" : ` · ${workflowLabel(item.workflow?.status ?? "DRAFT")}`}</option>)}</select>{pack && !pack.published ? <p className="mt-2 text-[11px] text-amber-600">هذه الحزمة غير منشورة ولا يمكن ربطها قبل اكتمال Change Set الخاص بها. <Link className="underline" href={`/admin/review/${pack.workflow?.id}`}>فتح المراجعة</Link></p> : null}</Field><Field label="نطاق الأسئلة"><Segment options={[{ value: "ALL_PACKAGE_QUESTIONS", label: "كل أسئلة الحزمة" }, { value: "TAXONOMY_FILTER", label: "فرع تصنيف" }]} value={node.targetMode ?? "ALL_PACKAGE_QUESTIONS"} disabled={readOnly || !node.packageId} onChange={(value) => onChange({ targetMode: value as "ALL_PACKAGE_QUESTIONS" | "TAXONOMY_FILTER", taxonomyNodeId: null, includeDescendants: value === "TAXONOMY_FILTER" ? true : null })} /></Field>{node.targetMode === "TAXONOMY_FILTER" ? <><Field label="عقدة التصنيف"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={readOnly} value={node.taxonomyNodeId ?? ""} onChange={(event) => onChange({ taxonomyNodeId: event.target.value || null })}><option value="">اختر عقدة</option>{taxonomy.map((item) => <option key={item.id} value={item.id}>{item.breadcrumb}</option>)}</select></Field><div className="flex items-center justify-between rounded-xl border p-3"><Label>تضمين العقد التابعة</Label><Switch checked={Boolean(node.includeDescendants)} disabled={readOnly} onCheckedChange={(includeDescendants) => onChange({ includeDescendants })} /></div></> : null}</div>}
  </div>;
}

function StructurePreview({ layout, packages }: { layout: MaterialQuestionBankLayoutContent; packages: Map<string, MaterialQuestionBankPackageOption> }) {
  const roots = layout.nodes.filter((node) => node.parentId === null && node.enabled).sort(orderNodes);
  if (!roots.length) return <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-xs text-slate-400">لا توجد عقد مفعّلة بعد.</div>;
  return <div className="space-y-3">{roots.map((node) => <PreviewNode key={node.id} node={node} all={layout.nodes} packages={packages} />)}</div>;
}
function PreviewNode({ node, all, packages }: { node: MaterialQuestionBankNodeContent; all: MaterialQuestionBankNodeContent[]; packages: Map<string, MaterialQuestionBankPackageOption> }) {
  const children = all.filter((item) => item.parentId === node.id && item.enabled).sort(orderNodes);
  const pack = node.packageId ? packages.get(node.packageId) : null;
  return <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-3"><div className="flex items-center gap-2"><span className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300">{node.nodeType === "GROUP" ? <FolderTree className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}</span><div className="min-w-0"><strong className="block truncate text-xs">{node.label}</strong><small className="mt-1 block truncate text-[9px] text-slate-400">{node.nodeType === "GROUP" ? node.groupPresentation : pack ? `${pack.title} · ${node.targetMode === "TAXONOMY_FILTER" ? "فرع محدد" : "كل الأسئلة"}` : "فتحة قيد التجهيز"}</small></div></div>{children.length ? <div className="mt-3 space-y-2 border-r border-slate-700 pr-3">{children.map((child) => <PreviewNode key={child.id} node={child} all={all} packages={packages} />)}</div> : null}</div>;
}

function normalizeNodePatch(node: MaterialQuestionBankNodeContent): MaterialQuestionBankNodeContent {
  if (node.nodeType === "GROUP") return { ...node, groupPresentation: node.groupPresentation ?? "CARDS", packageId: null, targetMode: null, taxonomyNodeId: null, includeDescendants: null };
  if (node.targetMode === "ALL_PACKAGE_QUESTIONS") return { ...node, groupPresentation: null, taxonomyNodeId: null, includeDescendants: null };
  return { ...node, groupPresentation: null, includeDescendants: node.includeDescendants ?? true };
}
function hierarchy(nodes: MaterialQuestionBankNodeContent[]) { const result: Array<{ node: MaterialQuestionBankNodeContent; depth: number }> = []; const visit = (parentId: string | null, depth: number) => nodes.filter((node) => node.parentId === parentId).sort(orderNodes).forEach((node) => { result.push({ node, depth }); visit(node.id, depth + 1); }); visit(null, 0); return result; }
function orderNodes(a: MaterialQuestionBankNodeContent, b: MaterialQuestionBankNodeContent) { return a.displayOrder - b.displayOrder || a.id.localeCompare(b.id); }
function isDescendant(candidateId: string, nodeId: string, nodes: MaterialQuestionBankNodeContent[]) { let current = nodes.find((node) => node.id === candidateId); while (current?.parentId) { if (current.parentId === nodeId) return true; current = nodes.find((node) => node.id === current?.parentId); } return false; }
function crossSubjectWarnings(layout: MaterialQuestionBankLayoutContent, subjectKey: string, materialLabel: string, packages: MaterialQuestionBankPackageOption[]) { const byId = new Map(packages.map((item) => [item.id, item])); return layout.nodes.flatMap((node) => { const pack = node.packageId ? byId.get(node.packageId) : null; return pack && pack.subjectKey !== subjectKey ? [{ nodeId: node.id, message: `الحزمة «${pack.title}» مصنفة ضمن ${pack.subjectLabel}، لكنها ستظهر داخل بنك ${materialLabel} وفق هذا التوزيع. هذا مسموح ويحتاج مراجعة واعية.` }] : []; }); }
function workflowLabel(status: string) { return ({ DRAFT: "مسودة", NEEDS_CHANGES: "تحتاج تعديلات", SUBMITTED: "بانتظار المراجعة", APPROVED: "معتمدة", CONFLICTED: "متعارضة", PUBLISHED: "منشورة" } as Record<string, string>)[status] ?? status; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-2"><Label>{label}</Label>{children}</label>; }
function Segment({ options, value, disabled, onChange }: { options: Array<{ value: string; label: string }>; value: string; disabled: boolean; onChange: (value: string) => void }) { return <div className="grid grid-cols-2 gap-2">{options.map((option) => <button type="button" disabled={disabled} key={option.value} onClick={() => onChange(option.value)} className={`rounded-xl border p-3 text-xs font-bold transition ${value === option.value ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/30"} disabled:opacity-60`}>{option.label}</button>)}</div>; }
function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "amber" }) { return <span className={`rounded-full px-2.5 py-1 font-semibold ${tone === "amber" ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"}`}>{children}</span>; }
