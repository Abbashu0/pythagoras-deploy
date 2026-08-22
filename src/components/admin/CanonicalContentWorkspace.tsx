"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, ImageIcon, Loader2, Plus, RotateCcw, Save, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AssetPickerDialog } from "@/components/admin/library/AssetPickerDialog";
import type { LibraryAsset } from "@/components/admin/library/library-types";
import type { CanonicalContentSnapshot } from "@/server/canonical-content/contracts";

type Area = "banners" | "materials" | "tools" | "navigation";
type DraftSnapshot = CanonicalContentSnapshot & { banners: Array<CanonicalContentSnapshot["banners"][number] & { isNew?: boolean }> };
type Editable = Record<string, unknown> & { id: string; asset?: { id: string; displayName: string; originalFilename: string; mimeType: string; url: string } | null; isNew?: boolean };

const TITLES: Record<Area, [string, string]> = {
  banners: ["بانرات الصفحة الرئيسية", "إدارة البانرات وإعدادات الانتقال من المصدر القانوني"],
  materials: ["إدارة المواد", "صور المواد وعناوينها ومظهر بطاقاتها"],
  tools: ["إدارة الأدوات", "ترتيب الأدوات والتحكم بإتاحتها"],
  navigation: ["إدارة التنقل", "عناصر شريط التنقل التي يقرأها تطبيق الطالب"],
};

function strip(value: Record<string, unknown>, fields: string[]) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function desired(area: Area, item: Record<string, unknown>) { return strip(item, area === "banners" || area === "materials" ? ["id", "asset", "createdAt", "updatedAt", "revision", "isNew"] : ["id", "createdAt", "updatedAt", "revision"]); }
const fieldClass = "h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-primary";

export function CanonicalContentWorkspace({ area }: { area: Area }) {
  const router = useRouter();
  const [source, setSource] = useState<CanonicalContentSnapshot | null>(null);
  const [draft, setDraft] = useState<DraftSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerId, setPickerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/admin/content", { cache: "no-store" });
      const body = await response.json() as { snapshot?: CanonicalContentSnapshot; code?: string };
      if (!response.ok || !body.snapshot) throw new Error(body.code ?? "تعذر تحميل المحتوى القانوني.");
      setSource(body.snapshot); setDraft(structuredClone(body.snapshot));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل المحتوى."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const currentEntries = draft ? (draft[area] as unknown as Editable[]) : [];
  const originalEntries = source ? (source[area] as unknown as Editable[]) : [];
  const dirty = useMemo(() => Boolean(draft && source) && (JSON.stringify(draft![area]) !== JSON.stringify(source![area]) || (area === "materials" && JSON.stringify(draft!.materialSettings) !== JSON.stringify(source!.materialSettings)) || (area === "banners" && JSON.stringify(draft!.carouselSettings) !== JSON.stringify(source!.carouselSettings))), [area, draft, source]);

  const replaceEntries = (items: Editable[]) => setDraft((current) => current ? ({ ...current, [area]: items } as DraftSnapshot) : current);
  const update = (id: string, patch: Record<string, unknown>) => replaceEntries(currentEntries.map((item) => item.id === id ? { ...item, ...patch } : item));
  const reorder = (id: string, direction: -1 | 1) => {
    const items = [...currentEntries].sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder));
    const index = items.findIndex((item) => item.id === id); const other = index + direction;
    if (index < 0 || other < 0 || other >= items.length) return;
    const order = Number(items[index].displayOrder); items[index] = { ...items[index], displayOrder: Number(items[other].displayOrder) }; items[other] = { ...items[other], displayOrder: order }; replaceEntries(items);
  };
  const addBanner = () => {
    if (area !== "banners" || !draft) return;
    const next = Math.max(0, ...draft.banners.map((item) => item.displayOrder)) + 1;
    setDraft({ ...draft, banners: [...draft.banners, { id: `new-${crypto.randomUUID()}`, bannerType: "FULL", title: "بانر جديد", subtitle: "", iconKey: "image", gradient: "linear-gradient(135deg, #4f9cff, #2a6fcc)", assetId: null, asset: null, status: "ARCHIVED", displayOrder: next, offsetX: 0, offsetY: 0, scale: 1, createdAt: 0, updatedAt: 0, revision: 0, isNew: true }] });
  };
  const chooseAsset = (asset: LibraryAsset) => {
    if (!pickerId) return;
    update(pickerId, { assetId: asset.id, asset: { id: asset.id, displayName: asset.displayName, originalFilename: asset.originalFilename, mimeType: asset.mimeType, url: `/api/content/assets/${asset.id}` } });
  };

  const save = async () => {
    if (!source || !draft || !dirty) return;
    setSaving(true); setError(null);
    try {
      const initialItems: Array<Record<string, unknown>> = [];
      for (const item of currentEntries) {
        const original = originalEntries.find((candidate) => candidate.id === item.id);
        if (!original || JSON.stringify(item) !== JSON.stringify(original)) initialItems.push({ resourceType: area === "banners" ? "banner" : area === "materials" ? "material" : area === "tools" ? "tool" : "navigation", resourceId: item.id, expectedRevision: original ? original.revision : 0, operation: original ? "UPDATE" : "CREATE", desired: desired(area, item) });
      }
      if (area === "materials" && JSON.stringify(draft.materialSettings) !== JSON.stringify(source.materialSettings)) initialItems.push({ resourceType: "materials.settings", resourceId: "global", expectedRevision: source.materialSettings.revision, operation: "UPDATE", desired: strip(draft.materialSettings as unknown as Record<string, unknown>, ["id", "updatedAt", "revision"]) });
      if (area === "banners" && JSON.stringify(draft.carouselSettings) !== JSON.stringify(source.carouselSettings)) initialItems.push({ resourceType: "carousel.settings", resourceId: "global", expectedRevision: source.carouselSettings.revision, operation: "UPDATE", desired: { autoSlideInterval: draft.carouselSettings.autoSlideInterval } });
      const response = await fetch("/api/admin/content/change-sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `تحديث ${TITLES[area][0]}`, description: "تعديلات محفوظة للمراجعة قبل النشر.", initialItems }) });
      const body = await response.json() as { changeSet?: { changeSet: { id: string } }; code?: string };
      if (!response.ok || !body.changeSet) throw new Error(body.code ?? "تعذر حفظ التعديلات.");
      router.push(`/admin/review/${body.changeSet.changeSet.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إنشاء مسودة المراجعة."); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>;
  if (!draft || !source) return <div className="p-8"><p className="rounded-2xl bg-destructive/10 p-4 text-destructive">{error ?? "المحتوى غير متاح."}</p><Button className="mt-4" onClick={() => void load()}>إعادة المحاولة</Button></div>;
  const pending = (id: string, resourceType: string) => source.pendingResourceKeys.includes(`${resourceType}:${id}`);

  return <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8" dir="rtl">
    <header className="flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between">
      <div><p className="text-xs font-semibold text-primary">المحتوى القانوني · SQLite</p><h1 className="mt-1 text-2xl font-black">{TITLES[area][0]}</h1><p className="mt-1 text-sm text-muted-foreground">{TITLES[area][1]}</p></div>
      <div className="flex flex-wrap gap-2">{area === "banners" ? <Button variant="outline" onClick={addBanner}><Plus className="ml-2 h-4 w-4"/>بانر جديد</Button> : null}<Button variant="outline" disabled={!dirty || saving} onClick={() => setDraft(structuredClone(source))}><RotateCcw className="ml-2 h-4 w-4"/>تراجع</Button><Button disabled={!dirty || saving} onClick={() => void save()}>{saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin"/> : <Save className="ml-2 h-4 w-4"/>}حفظ كمسودة مراجعة</Button></div>
    </header>
    {source.state.runtimeSourceMode === "LEGACY" ? <div className="rounded-2xl border border-amber-400/35 bg-amber-400/10 p-4 text-sm text-amber-800 dark:text-amber-200">لوحة الإدارة تستخدم المحتوى القانوني الآن، بينما تطبيق الطالب ما زال يقرأ بيانات المتصفح القديمة حتى ينشر OWNER قرار التحويل.</div> : null}
    {error ? <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
    <section className="grid gap-4 lg:grid-cols-2">
      {[...currentEntries].sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder)).map((item, index) => {
        const type = area === "banners" ? "banner" : area === "materials" ? "material" : area === "tools" ? "tool" : "navigation";
        const active = area === "navigation" ? Boolean(item.enabled) : area === "banners" ? item.status === "ACTIVE" : Boolean(item.available);
        return <article key={item.id} className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3">{area === "banners" || area === "materials" ? <div className="grid h-16 w-20 flex-none place-items-center overflow-hidden rounded-xl bg-muted">{item.asset ? <img src={`/api/admin/assets/${item.asset.id}/content`} alt="" className="h-full w-full object-cover"/> : <ImageIcon className="h-5 w-5 text-muted-foreground"/>}</div> : null}<div className="min-w-0"><h2 className="truncate font-bold">{String(item.title ?? item.label ?? "عنصر")}</h2><p className="text-xs text-muted-foreground">الترتيب {String(item.displayOrder)} · revision {String(item.revision)}</p></div></div><div className="flex gap-1"><Button size="icon" variant="ghost" disabled={index === 0} onClick={() => reorder(item.id, -1)}><ArrowUp className="h-4 w-4"/></Button><Button size="icon" variant="ghost" disabled={index === currentEntries.length - 1} onClick={() => reorder(item.id, 1)}><ArrowDown className="h-4 w-4"/></Button></div></div>
          {pending(item.id, type) ? <span className="mb-3 inline-flex rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-700">له مسودة قيد المراجعة</span> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span className="text-xs text-muted-foreground">الاسم</span><input className={fieldClass} value={String(item.title ?? item.label ?? "")} onChange={(event) => update(item.id, area === "banners" ? { title: event.target.value } : { label: event.target.value })}/></label>
            {area === "materials" ? <label className="space-y-1"><span className="text-xs text-muted-foreground">الاسم الإنجليزي</span><input className={fieldClass} value={String(item.englishTitle ?? "")} onChange={(event) => update(item.id, { englishTitle: event.target.value })}/></label> : null}
            {area === "banners" ? <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">الوصف</span><input className={fieldClass} value={String(item.subtitle ?? "")} onChange={(event) => update(item.id, { subtitle: event.target.value })}/></label> : null}
            <label className="space-y-1"><span className="text-xs text-muted-foreground">الأيقونة</span><input className={fieldClass} value={String(item.iconKey ?? "")} onChange={(event) => update(item.id, { iconKey: event.target.value })}/></label>
            {area === "banners" || area === "materials" ? <div className="flex items-end gap-2"><Button type="button" variant="outline" className="flex-1" onClick={() => setPickerId(item.id)}><ImageIcon className="ml-2 h-4 w-4"/>اختيار صورة</Button>{item.assetId ? <Button type="button" size="icon" variant="ghost" onClick={() => update(item.id, { assetId: null, asset: null })}><X className="h-4 w-4"/></Button> : null}</div> : null}
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3"><span className="text-xs text-muted-foreground">{area === "navigation" ? "إظهار في شريط التنقل" : area === "banners" ? "حالة البانر" : "متاح للطالب"}</span><Button size="sm" variant={active ? "default" : "outline"} onClick={() => update(item.id, area === "navigation" ? { enabled: !item.enabled } : area === "banners" ? { status: item.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" } : { available: !item.available })}>{area === "banners" && active ? <Archive className="ml-2 h-4 w-4"/> : null}{active ? "مفعّل" : "غير مفعّل"}</Button></div>
        </article>;
      })}
    </section>
    {area === "materials" ? <section className="rounded-2xl border bg-card p-5"><h2 className="font-bold">مظهر بطاقات المواد</h2><div className="mt-4 grid gap-3 md:grid-cols-4">{([['fadeIntensity','شدة التعتيم',0,1,0.01],['textVerticalPosition','موضع النص',-100,100,1],['textScale','حجم النص',0.8,1.4,0.01],['cardHeight','ارتفاع البطاقة',160,340,1]] as const).map(([key,label,min,max,step]) => <label key={key} className="space-y-1"><span className="text-xs text-muted-foreground">{label}</span><input type="number" min={min} max={max} step={step} className={fieldClass} value={draft.materialSettings[key]} onChange={(event) => setDraft((current) => current ? ({ ...current, materialSettings: { ...current.materialSettings, [key]: Number(event.target.value) } }) : current)}/></label>)}</div></section> : null}
    {area === "banners" ? <section className="rounded-2xl border bg-card p-5"><h2 className="font-bold">إعدادات العرض التلقائي</h2><label className="mt-4 block max-w-sm space-y-1"><span className="text-xs text-muted-foreground">المدة بالمللي ثانية</span><input type="number" min={1000} max={120000} step={1000} className={fieldClass} value={draft.carouselSettings.autoSlideInterval} onChange={(event) => setDraft((current) => current ? ({ ...current, carouselSettings: { ...current.carouselSettings, autoSlideInterval: Number(event.target.value) } }) : current)}/></label></section> : null}
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Send className="h-4 w-4"/>الحفظ ينشئ Change Set فقط؛ لن يرى الطالب التعديل قبل اعتماد OWNER ونشره.</div>
    <AssetPickerDialog open={Boolean(pickerId)} onOpenChange={(open) => { if (!open) setPickerId(null); }} onSelect={chooseAsset}/>
  </div>;
}
