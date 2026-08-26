"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, BookOpen, Library, Save, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { MaterialQuestionBankAdminWorkspace, MaterialQuestionBankLayoutContent, MaterialQuestionBankNodeContent } from "@/server/material-question-bank";

export function ArabicQuestionBankPresetWorkspace({ workspace, layout, busy, readOnly, dirty, message, onLayoutChange, onSave, onSubmit }: {
  workspace: MaterialQuestionBankAdminWorkspace;
  layout: MaterialQuestionBankLayoutContent;
  busy: boolean;
  readOnly: boolean;
  dirty: boolean;
  message: string | null;
  onLayoutChange: (layout: MaterialQuestionBankLayoutContent) => void;
  onSave: () => void;
  onSubmit: () => void;
}) {
  const byKey = new Map(layout.nodes.map((node) => [node.nodeKey, node]));
  const literature = byKey.get("arabic-literature");
  const grammar = byKey.get("arabic-grammar");
  const topics = layout.nodes.filter((node) => node.parentId === grammar?.id).sort(orderNodes);
  const packages = new Map(workspace.packages.map((item) => [item.id, item]));
  const updateBank = (id: string, patch: Partial<MaterialQuestionBankNodeContent>) => onLayoutChange({ ...layout, nodes: layout.nodes.map((node) => node.id === id ? normalizeBankAssignment({ ...node, ...patch }) : node) });

  return <main className="mx-auto w-full max-w-[1240px] space-y-5 p-4 sm:p-6 lg:p-8" dir="rtl">
    <header className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><Link href="/admin/materials" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" />إدارة المواد</Link><p className="mt-4 text-[10px] font-bold tracking-[.18em] text-primary">PRODUCT-DEFINED QUESTION BANK</p><h1 className="mt-2 text-2xl font-black">بنك أسئلة اللغة العربية</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">الهيكل معتمد من المنتج: الأدب يدخل مباشرة، والقواعد تظهر للطالب كمبدّل بين الموضوعات. هنا تدير فقط ربط حزم الأسئلة داخل الخانات الثابتة.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href="/admin/library"><Library className="h-4 w-4" />مكتبة الأصول</Link></Button>{workspace.workflow ? <Button variant="outline" asChild><Link href={`/admin/review/${workspace.workflow.id}`}><ShieldCheck className="h-4 w-4" />فتح المراجعة</Link></Button> : null}<Button disabled={busy || readOnly || !dirty} onClick={onSave}><Save className="h-4 w-4" />حفظ المسودة</Button><Button variant="secondary" disabled={busy || readOnly || !workspace.workflow?.editable} onClick={onSubmit}><Send className="h-4 w-4" />إرسال للمراجعة</Button></div></div>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px]"><Badge>{workspace.published ? `منشور · revision ${workspace.canonicalRevision}` : "خط أساس ثابت غير منشور بعد"}</Badge>{workspace.workflow ? <Badge>{workflowLabel(workspace.workflow.status)} · {workspace.workflow.itemCount} عنصر</Badge> : null}{dirty ? <Badge tone="amber">تغييرات محلية غير محفوظة</Badge> : null}</div>
      {message ? <p className="mt-4 rounded-xl bg-muted/60 p-3 text-xs">{message}</p> : null}
    </header>

    <section className="rounded-3xl border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3 border-b pb-5"><div><h2 className="text-xl font-black">الأدب</h2><p className="mt-1 text-sm text-muted-foreground">بنك مباشر يستخدم كل أسئلة الحزمة المرتبطة افتراضيًا.</p></div><Badge>خانة حزمة ثابتة</Badge></div>{literature ? <AssignmentCard node={literature} workspace={workspace} packages={packages} readOnly={readOnly} onChange={(patch) => updateBank(literature.id, patch)} /> : null}</section>

    <section className="rounded-3xl border bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3 border-b pb-5"><div><h2 className="text-xl font-black">القواعد</h2><p className="mt-1 text-sm text-muted-foreground">تظهر للطالب كمبدّل بين الموضوعات. يفتح افتراضيًا أول موضوع متاح بحسب هذا الترتيب.</p></div><Badge>تسعة موضوعات ثابتة</Badge></div><div className="mt-5 grid gap-4 lg:grid-cols-2">{topics.map((node) => <AssignmentCard key={node.id} node={node} workspace={workspace} packages={packages} readOnly={readOnly} onChange={(patch) => updateBank(node.id, patch)} />)}</div></section>
    <section className="rounded-2xl border border-dashed bg-muted/25 p-4 text-xs leading-6 text-muted-foreground">البنية والهوية والترتيب وطريقة العرض جزء من إعداد المنتج ولا تُحرَّر من الإدارة. ربط الحزمة فقط يمر عبر مسودة ثم مراجعة OWNER ثم النشر.</section>
  </main>;
}

function AssignmentCard({ node, workspace, packages, readOnly, onChange }: { node: MaterialQuestionBankNodeContent; workspace: MaterialQuestionBankAdminWorkspace; packages: Map<string, MaterialQuestionBankAdminWorkspace["packages"][number]>; readOnly: boolean; onChange: (patch: Partial<MaterialQuestionBankNodeContent>) => void }) {
  const selectedPackage = node.packageId ? packages.get(node.packageId) : null;
  const taxonomy = workspace.taxonomy.filter((item) => item.packageId === node.packageId);
  const taxonomyLabel = node.taxonomyNodeId ? taxonomy.find((item) => item.id === node.taxonomyNodeId)?.breadcrumb ?? "تصنيف غير متاح" : null;
  const crossSubject = selectedPackage && selectedPackage.subjectKey !== workspace.material.subjectKey;
  return <article className="mt-5 rounded-2xl border bg-background p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-primary/10 p-2 text-primary"><BookOpen className="h-4 w-4" /></span><div><h3 className="font-black">{node.label}</h3><p className="mt-1 text-xs text-muted-foreground">{selectedPackage ? "حزمة مرتبطة" : "غير مربوط"}</p></div></div><Badge tone={selectedPackage ? "default" : "amber"}>{selectedPackage ? "مربوط" : "غير مربوط"}</Badge></div><div className="mt-4 space-y-4"><Field label="حزمة الأسئلة"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={readOnly} value={node.packageId ?? ""} onChange={(event) => onChange({ packageId: event.target.value || null, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeId: null, includeDescendants: null })}><option value="">لم يتم ربط حزمة</option>{workspace.packages.map((item) => <option key={item.id} value={item.id} disabled={!item.published}>{item.title} · {item.subjectLabel} · {item.questionCount} سؤال{item.published ? "" : " · غير منشورة"}</option>)}</select></Field>{selectedPackage ? <div className="grid gap-2 rounded-xl bg-muted/50 p-3 text-xs sm:grid-cols-3"><span>المادة: <strong>{selectedPackage.subjectLabel}</strong></span><span>الأسئلة: <strong>{selectedPackage.questionCount}</strong></span><span>التصنيفات: <strong>{selectedPackage.taxonomyCount}</strong></span></div> : null}{crossSubject ? <p className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-amber-800 dark:text-amber-300"><AlertTriangle className="h-4 w-4 shrink-0" />هذه حزمة من مادة أخرى؛ الربط مسموح وسيظهر داخل اللغة العربية بعد النشر.</p> : null}<Field label="نطاق الأسئلة"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={readOnly || !node.packageId} value={node.targetMode ?? "ALL_PACKAGE_QUESTIONS"} onChange={(event) => onChange({ targetMode: event.target.value as "ALL_PACKAGE_QUESTIONS" | "TAXONOMY_FILTER", taxonomyNodeId: null, includeDescendants: event.target.value === "TAXONOMY_FILTER" ? true : null })}><option value="ALL_PACKAGE_QUESTIONS">كل أسئلة الحزمة</option><option value="TAXONOMY_FILTER">فرع تصنيف محدد</option></select></Field>{node.targetMode === "TAXONOMY_FILTER" ? <div className="space-y-3 rounded-xl border bg-muted/20 p-3"><Field label="فرع التصنيف"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={readOnly} value={node.taxonomyNodeId ?? ""} onChange={(event) => onChange({ taxonomyNodeId: event.target.value || null })}><option value="">اختر فرع التصنيف</option>{taxonomy.map((item) => <option key={item.id} value={item.id}>{item.breadcrumb}</option>)}</select></Field><div className="flex items-center justify-between gap-3"><div><Label>تضمين الفروع التابعة</Label><p className="mt-1 text-[11px] text-muted-foreground">{taxonomyLabel ?? "حدّد الفرع أولًا."}</p></div><Switch checked={Boolean(node.includeDescendants)} disabled={readOnly} onCheckedChange={(includeDescendants) => onChange({ includeDescendants })} /></div></div> : null}</div></article>;
}

function normalizeBankAssignment(node: MaterialQuestionBankNodeContent): MaterialQuestionBankNodeContent { if (!node.packageId) return { ...node, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeId: null, includeDescendants: null }; if (node.targetMode === "ALL_PACKAGE_QUESTIONS") return { ...node, taxonomyNodeId: null, includeDescendants: null }; return { ...node, includeDescendants: node.includeDescendants ?? true }; }
function orderNodes(a: MaterialQuestionBankNodeContent, b: MaterialQuestionBankNodeContent) { return a.displayOrder - b.displayOrder || a.id.localeCompare(b.id); }
function workflowLabel(status: string) { return ({ DRAFT: "مسودة", NEEDS_CHANGES: "تحتاج تعديلات", SUBMITTED: "بانتظار المراجعة", APPROVED: "معتمدة", CONFLICTED: "متعارضة", PUBLISHED: "منشورة" } as Record<string, string>)[status] ?? status; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-2"><Label>{label}</Label>{children}</label>; }
function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "amber" }) { return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone === "amber" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{children}</span>; }
