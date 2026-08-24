"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, FileJson, Loader2, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WorkspacePackage { id: string; packageKey: string; title: string; subjectKey: string; language: string; contentRevision: number; bankBrowseMode: string; bankBrowseEntryLabel: string; bankBrowseEntryOrder: number; revision: number }
interface Material { subjectKey: string; label: string; available: boolean }

export function QuestionPackagesWorkspace() {
  const [packages, setPackages] = useState<WorkspacePackage[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/admin/question-packages");
      const body = await response.json() as { packages?: WorkspacePackage[]; materials?: Material[] };
      if (!response.ok || !body.packages || !body.materials) throw new Error();
      setPackages(body.packages); setMaterials(body.materials);
    } catch { setError("تعذّر تحميل مساحة حزم الأسئلة."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  return <main className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8" dir="rtl">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-semibold tracking-[.18em] text-primary">QUESTION CONTENT</p><h1 className="mt-2 text-2xl font-black sm:text-3xl">حزم بنك الأسئلة</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">الحزمة هي حدود المحتوى والترتيب والمادة. كل إنشاء أو استيراد يبدأ كمسودة محكومة ولا يصل إلى الطالب قبل مراجعة OWNER ونشره.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href="/admin/library"><FileJson className="h-4 w-4" /> الاستيراد من المكتبة</Link></Button><Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> حزمة فارغة</Button></div></header>
    {error ? <p className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive">{error}</p> : null}
    {loading ? <div className="grid min-h-72 place-items-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : packages.length ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{packages.map((item) => <article key={item.id} className="rounded-2xl border bg-card p-5"><div className="flex items-start justify-between gap-3"><span className="rounded-xl bg-primary/10 p-2 text-primary"><Boxes className="h-5 w-5" /></span><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold">{item.subjectKey}</span></div><h2 className="mt-4 text-lg font-black" dir="auto">{item.title}</h2><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.packageKey}</p><dl className="mt-4 grid grid-cols-2 gap-2 text-[11px]"><Metric label="مدخل البنك" value={item.bankBrowseEntryLabel} /><Metric label="الترتيب" value={String(item.bankBrowseEntryOrder)} /><Metric label="مراجعة المحتوى" value={String(item.contentRevision)} /><Metric label="مراجعة السجل" value={String(item.revision)} /></dl><p className="mt-4 flex items-center gap-2 border-t pt-4 text-[10px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> حزمة قانونية منشورة عبر Change Set</p></article>)}</section> : <section className="grid min-h-80 place-items-center rounded-3xl border border-dashed bg-card/50 p-8 text-center"><div><Boxes className="mx-auto h-11 w-11 text-primary/60" /><h2 className="mt-4 text-lg font-black">لا توجد حزم قانونية بعد</h2><p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">أنشئ حزمة فارغة للمحتوى اليدوي المستقبلي، أو افتح Asset Library وافحص ملف Question Package صالحًا قبل الاستيراد.</p><div className="mt-5 flex justify-center gap-2"><Button variant="outline" asChild><Link href="/admin/library">فتح المكتبة</Link></Button><Button onClick={() => setCreateOpen(true)}>إنشاء حزمة فارغة</Button></div></div></section>}
    <CreatePackageDialog open={createOpen} materials={materials} packages={packages} onOpenChange={setCreateOpen} onCreated={load} />
  </main>;
}

function CreatePackageDialog({ open, materials, packages, onOpenChange, onCreated }: { open: boolean; materials: Material[]; packages: WorkspacePackage[]; onOpenChange: (open: boolean) => void; onCreated: () => Promise<void> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [key, setKey] = useState(""); const [subject, setSubject] = useState(""); const [mode, setMode] = useState<"ALL_PACKAGE_QUESTIONS" | "TREE">("ALL_PACKAGE_QUESTIONS");
  const suggestedOrder = Math.max(0, ...packages.filter((item) => item.subjectKey === subject).map((item) => item.bankBrowseEntryOrder)) + 1;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/admin/question-packages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, packageKey: key, subjectKey: subject, language: "ar-IQ", bankBrowseMode: mode, bankBrowseEntryKey: key, bankBrowseEntryLabel: title, bankBrowseEntryOrder: suggestedOrder }) });
      const body = await response.json() as { result?: { changeSetId: string }; code?: string };
      if (!response.ok || !body.result) throw new Error(body.code);
      onOpenChange(false); setTitle(""); setKey(""); setSubject(""); await onCreated();
      router.push(`/admin/review/${body.result.changeSetId}`);
    } catch { setError("تعذّر إنشاء المسودة. تحقق من المفتاح والترتيب والمادة."); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent dir="rtl"><DialogHeader className="text-right"><DialogTitle>إنشاء حزمة أسئلة فارغة</DialogTitle><DialogDescription>ينشئ هذا الإجراء عنصر question.package واحدًا داخل DRAFT. لا ينشئ أسئلة ولا ينشر شيئًا.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="عنوان الحزمة"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: قواعد اللغة العربية" /></Field><Field label="المفتاح الدلالي"><Input dir="ltr" value={key} onChange={(event) => setKey(event.target.value.toLowerCase())} placeholder="arabic-grammar" /><p className="mt-1 text-[10px] text-muted-foreground">أحرف إنجليزية صغيرة وأرقام وشرطات فقط؛ يصبح ثابتًا بعد النشر.</p></Field><Field label="المادة"><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={subject} onChange={(event) => setSubject(event.target.value)}><option value="">اختر المادة</option>{materials.map((item) => <option key={item.subjectKey} value={item.subjectKey}>{item.label}</option>)}</select></Field><Field label="نمط التصفح"><div className="grid grid-cols-2 gap-2"><ModeButton active={mode === "ALL_PACKAGE_QUESTIONS"} onClick={() => setMode("ALL_PACKAGE_QUESTIONS")} title="كل أسئلة الحزمة" description="قائمة واحدة مرتبة." /><ModeButton active={mode === "TREE"} onClick={() => setMode("TREE")} title="شجرة تصفح" description="لمسارات متعددة لاحقًا." /></div></Field>{subject ? <p className="rounded-xl bg-muted/40 p-3 text-xs">الترتيب المقترح داخل مادة {subject}: <strong>{suggestedOrder}</strong></p> : null}{error ? <p className="text-xs text-destructive">{error}</p> : null}</div><DialogFooter className="gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button><Button disabled={busy || !title.trim() || !key.trim() || !subject} onClick={() => void submit()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} إنشاء المسودة</Button></DialogFooter></DialogContent></Dialog>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><Label className="mb-2 block">{label}</Label>{children}</div>; }
function ModeButton({ active, onClick, title, description }: { active: boolean; onClick: () => void; title: string; description: string }) { return <button type="button" onClick={onClick} className={`rounded-xl border p-3 text-right ${active ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}><span className="block text-xs font-bold">{title}</span><span className="mt-1 block text-[10px] text-muted-foreground">{description}</span></button>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-muted/35 p-3"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 truncate font-semibold" dir="auto">{value}</dd></div>; }
