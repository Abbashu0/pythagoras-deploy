"use client";

import { useMemo, useState } from "react";
import { Archive, Copy, ImageIcon, LayoutGrid, LayoutPanelTop, Plus, RotateCcw, X } from "lucide-react";
import { AdminBannerCard } from "@/components/admin/AdminBannerCard";
import { CarouselSettings } from "@/components/admin/CarouselSettings";
import { IconPicker } from "@/components/admin/IconPicker";
import { ImagePositioner } from "@/components/admin/ImagePositioner";
import { LiveCarouselPreview } from "@/components/admin/LiveCarouselPreview";
import { AssetPickerDialog } from "@/components/admin/library/AssetPickerDialog";
import type { LibraryAsset } from "@/components/admin/library/library-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SponsoredBanner } from "@/lib/admin/banner-model";
import type { CanonicalBanner } from "@/server/canonical-content/contracts";
import { CanonicalWorkspaceFrame, PendingBadge } from "./CanonicalWorkspaceFrame";
import { type DraftBanner, useCanonicalContentDraft } from "./useCanonicalContentDraft";

const MAX_ACTIVE_BANNERS = 5;

function previewBanner(banner: DraftBanner): SponsoredBanner {
  return {
    id: banner.id,
    bannerType: banner.bannerType.toLowerCase() as SponsoredBanner["bannerType"],
    image: banner.asset ? `/api/admin/assets/${encodeURIComponent(banner.asset.id)}/content` : "",
    gradient: banner.gradient,
    iconKey: banner.iconKey,
    title: banner.title,
    subtitle: banner.subtitle,
    enabled: banner.status === "ACTIVE",
    status: banner.status === "ACTIVE" ? "active" : "archived",
    displayOrder: banner.displayOrder,
    transform: { offsetX: banner.offsetX, offsetY: banner.offsetY, scale: banner.scale },
    createdAt: new Date(banner.createdAt || Date.now()).toISOString(),
    updatedAt: new Date(banner.updatedAt || Date.now()).toISOString(),
  };
}

export function CanonicalBannersWorkspace() {
  const workspace = useCanonicalContentDraft("banners");
  const { draft, setDraft, source } = workspace;
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);

  const banners = useMemo(() => [...(draft?.banners ?? [])].sort((a, b) => a.displayOrder - b.displayOrder), [draft?.banners]);
  const active = banners.filter((banner) => banner.status === "ACTIVE");
  const archived = banners.filter((banner) => banner.status === "ARCHIVED");
  const effectiveSelectedId = selectedId === undefined || (selectedId !== null && !banners.some((banner) => banner.id === selectedId)) ? banners[0]?.id ?? null : selectedId;
  const selected = banners.find((banner) => banner.id === effectiveSelectedId) ?? null;

  const updateBanner = (id: string, patch: Partial<DraftBanner>) => setDraft((current) => current ? ({ ...current, banners: current.banners.map((banner) => banner.id === id ? { ...banner, ...patch } : banner) }) : current);
  const moveBanner = (id: string, direction: -1 | 1, collection: DraftBanner[]) => {
    const index = collection.findIndex((banner) => banner.id === id);
    const other = index + direction;
    if (index < 0 || other < 0 || other >= collection.length) return;
    const firstOrder = collection[index].displayOrder;
    const secondOrder = collection[other].displayOrder;
    setDraft((current) => current ? ({ ...current, banners: current.banners.map((banner) => banner.id === id ? { ...banner, displayOrder: secondOrder } : banner.id === collection[other].id ? { ...banner, displayOrder: firstOrder } : banner) }) : current);
  };
  const addBanner = (copy?: DraftBanner) => {
    if (!draft) return;
    const id = `draft-${crypto.randomUUID()}`;
    const displayOrder = Math.max(0, ...draft.banners.map((banner) => banner.displayOrder)) + 1;
    const created: DraftBanner = copy ? { ...structuredClone(copy), id, title: `${copy.title || "بانر"} — نسخة`, status: "ARCHIVED", displayOrder, createdAt: 0, updatedAt: 0, revision: 0, isNew: true } : {
      id, bannerType: "FULL", title: "بانر جديد", subtitle: "", iconKey: "image", gradient: "linear-gradient(135deg, #4f9cff, #2a6fcc)", assetId: null, asset: null, status: "ARCHIVED", displayOrder, offsetX: 0, offsetY: 0, scale: 1, createdAt: 0, updatedAt: 0, revision: 0, isNew: true,
    };
    setDraft({ ...draft, banners: [...draft.banners, created] });
    setSelectedId(id);
  };

  return <CanonicalWorkspaceFrame
    title="بانرات الصفحة الرئيسية"
    subtitle="استوديو البانرات: ترتيب، تحرير بصري، معاينة حية، ثم مراجعة ونشر."
    source={source}
    loading={workspace.loading}
    saving={workspace.saving}
    dirty={workspace.dirty}
    error={workspace.error}
    onReset={workspace.reset}
    onSave={() => void workspace.save("تحديث بانرات الصفحة الرئيسية")}
    actions={<Button variant="outline" onClick={() => addBanner()}><Plus className="ml-2 h-4 w-4"/>بانر جديد</Button>}
  >
    {draft ? <>
      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 space-y-5 xl:col-span-5">
          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="flex items-center justify-between border-b p-4"><div><h2 className="text-sm font-bold">مكتبة البانرات</h2><p className="mt-1 text-[11px] text-muted-foreground">{active.length} من {MAX_ACTIVE_BANNERS} بانرات نشطة</p></div>{active.length >= MAX_ACTIVE_BANNERS ? <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[10px] font-bold text-amber-700">الحد مكتمل</span> : null}</div>
            <div className="space-y-2 p-3">
              {active.map((banner, index) => <div key={banner.id} data-flip-key={banner.id} className="space-y-1"><AdminBannerCard banner={previewBanner(banner)} position={index + 1} total={active.length} isSelected={banner.id === effectiveSelectedId} onSelect={() => setSelectedId(banner.id)} onMoveUp={() => moveBanner(banner.id, -1, active)} onMoveDown={() => moveBanner(banner.id, 1, active)} onDuplicate={() => addBanner(banner)} onArchive={() => updateBanner(banner.id, { status: "ARCHIVED" })}/><PendingBadge visible={Boolean(source?.pendingResourceKeys.includes(`banner:${banner.id}`))}/></div>)}
              {active.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">لا توجد بانرات نشطة.</p> : null}
            </div>
          </div>
          {archived.length ? <div className="rounded-2xl border bg-card p-3"><div className="mb-3 flex items-center gap-2"><Archive className="h-4 w-4 text-muted-foreground"/><h2 className="text-sm font-bold">الأرشيف</h2><span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{archived.length}</span></div><div className="space-y-2">{archived.map((banner) => <button key={banner.id} type="button" onClick={() => setSelectedId(banner.id)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-right ${selectedId === banner.id ? "border-primary ring-1 ring-primary/30" : "hover:bg-muted/30"}`}><span className="grid h-11 w-16 place-items-center overflow-hidden rounded-lg text-[10px] text-white" style={{ background: banner.gradient }}>{banner.asset ? <img src={`/api/admin/assets/${banner.asset.id}/content`} alt="" className="h-full w-full object-cover"/> : banner.bannerType}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{banner.title || "بانر بلا عنوان"}</strong><span className="text-[10px] text-muted-foreground">ARCHIVED · الترتيب {banner.displayOrder}</span></span><PendingBadge visible={Boolean(source?.pendingResourceKeys.includes(`banner:${banner.id}`))}/><RotateCcw className="h-4 w-4 text-muted-foreground"/></button>)}</div></div> : null}
        </section>
        <section className="col-span-12 space-y-5 xl:col-span-7">
          <CanonicalBannerEditor banner={selected} activeCount={active.length} onClose={() => setSelectedId(null)} onChange={(patch) => selected && updateBanner(selected.id, patch)} onDuplicate={() => selected && addBanner(selected)}/>
          <div className="rounded-2xl border bg-card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">معاينة حية</h2><span className="text-[10px] text-muted-foreground">تقرأ المسودة غير المحفوظة</span></div><div className="flex justify-center overflow-x-auto rounded-xl bg-[#070a10] p-5"><LiveCarouselPreview banner={selected ? previewBanner(selected) : null} allBanners={active.map(previewBanner)}/></div><p className="mt-3 text-center text-[11px] text-muted-foreground">FULL وSPLIT والصورة والموضع والنص تظهر هنا قبل إنشاء Change Set.</p></div>
        </section>
      </div>
      <CarouselSettings buffered interval={draft.carouselSettings.autoSlideInterval} onSave={(autoSlideInterval) => setDraft((current) => current ? ({ ...current, carouselSettings: { ...current.carouselSettings, autoSlideInterval } }) : current)}/>
    </> : null}
  </CanonicalWorkspaceFrame>;
}

function CanonicalBannerEditor({ banner, activeCount, onChange, onClose, onDuplicate }: { banner: DraftBanner | null; activeCount: number; onChange: (patch: Partial<CanonicalBanner>) => void; onClose: () => void; onDuplicate: () => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!banner) return <div className="grid min-h-[520px] place-items-center rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">اختر بانرًا من القائمة لفتح المحرر المتخصص.</div>;
  const imageUrl = banner.asset ? `/api/admin/assets/${encodeURIComponent(banner.asset.id)}/content` : "";
  const canActivate = banner.status === "ACTIVE" || activeCount < MAX_ACTIVE_BANNERS;
  const choose = (asset: LibraryAsset) => onChange({ assetId: asset.id, asset: { id: asset.id, displayName: asset.displayName, originalFilename: asset.originalFilename, mimeType: asset.mimeType, url: `/api/content/assets/${asset.id}` } });
  return <div className="overflow-hidden rounded-2xl border bg-card">
    <div className="flex items-center justify-between border-b p-4"><div><h2 className="text-sm font-bold">محرر البانر</h2><p className="mt-1 text-[11px] text-muted-foreground">{banner.isNew ? "بانر جديد — سيحصل على UUIDv7 عند الحفظ" : `هوية ثابتة · revision ${banner.revision}`}</p></div><div className="flex gap-1"><Button variant="ghost" size="icon" title="تكرار كمسودة مؤرشفة" onClick={onDuplicate}><Copy className="h-4 w-4"/></Button><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4"/></Button></div></div>
    <div className="admin-scroll max-h-[720px] space-y-5 overflow-y-auto p-4">
      <section className="space-y-2"><Label className="text-xs font-bold text-muted-foreground">نوع البانر</Label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => onChange({ bannerType: "FULL" })} className={`rounded-xl border p-3 text-right ${banner.bannerType === "FULL" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : ""}`}><LayoutPanelTop className="mb-2 h-4 w-4"/><strong className="text-sm">بانر كامل</strong><p className="mt-1 text-[10px] text-muted-foreground">الصورة تملأ الإطار</p></button><button type="button" onClick={() => onChange({ bannerType: "SPLIT" })} className={`rounded-xl border p-3 text-right ${banner.bannerType === "SPLIT" ? "border-primary bg-primary/5 ring-1 ring-primary/30" : ""}`}><LayoutGrid className="mb-2 h-4 w-4"/><strong className="text-sm">بانر مقسّم</strong><p className="mt-1 text-[10px] text-muted-foreground">صورة مع عنوان ووصف</p></button></div></section>
      <section className="space-y-3"><div className="flex items-center justify-between"><Label className="text-xs font-bold text-muted-foreground">صورة البانر</Label>{banner.asset ? <span className="max-w-[240px] truncate text-[10px] text-muted-foreground">{banner.asset.displayName}</span> : null}</div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setPickerOpen(true)}><ImageIcon className="ml-2 h-4 w-4"/>اختيار من مكتبة الأصول</Button>{banner.asset ? <Button type="button" variant="ghost" onClick={() => onChange({ assetId: null, asset: null })}><X className="ml-2 h-4 w-4"/>إزالة المرجع</Button> : null}</div>{imageUrl ? <ImagePositioner imageSrc={imageUrl} gradient={banner.gradient} value={{ offsetX: banner.offsetX, offsetY: banner.offsetY, scale: banner.scale }} onChange={(value) => onChange(value)} fullFrame={banner.bannerType === "FULL"} minScale={0.5} maxScale={3} maxOffset={50}/> : <div className="grid h-32 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground" style={{ background: banner.gradient }}>لا توجد صورة؛ سيُستخدم التدرّج.</div>}</section>
      {banner.bannerType === "SPLIT" ? <><label className="space-y-2"><Label>العنوان</Label><Input value={banner.title} onChange={(event) => onChange({ title: event.target.value })} maxLength={60}/></label><label className="space-y-2"><Label>الوصف</Label><Textarea value={banner.subtitle} onChange={(event) => onChange({ subtitle: event.target.value })} rows={3} maxLength={120}/></label></> : <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-700 dark:text-blue-300">في وضع FULL لا تُعرض حقول النص داخل التطبيق؛ التصميم المرئي يأتي من الصورة نفسها.</div>}
      <label className="space-y-2"><Label>التدرّج الاحتياطي</Label><Input dir="ltr" value={banner.gradient} onChange={(event) => onChange({ gradient: event.target.value })}/></label>
      <section className="space-y-2"><Label>الأيقونة الاحتياطية</Label><IconPicker value={banner.iconKey} onChange={(iconKey) => onChange({ iconKey })}/></section>
      <section className="flex items-center justify-between rounded-xl border p-3"><div><Label>إظهار البانر</Label><p className="mt-1 text-[11px] text-muted-foreground">الأرشفة هي الإزالة الآمنة من الكاروسيل.</p></div><Switch checked={banner.status === "ACTIVE"} disabled={!canActivate} onCheckedChange={(checked) => onChange({ status: checked ? "ACTIVE" : "ARCHIVED" })}/></section>
      {!canActivate ? <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-700">أرشِف بانرًا نشطًا أولًا؛ الحد الأقصى خمسة.</p> : null}
    </div>
    <AssetPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onSelect={choose}/>
  </div>;
}
