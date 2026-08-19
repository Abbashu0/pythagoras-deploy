"use client";

/**
 * Admin — Banners management page (/admin/banners)
 * =================================================
 *
 * The full Sponsored-Carousel editor. Previously the only page at /admin,
 * now a sub-page reachable from the dashboard's "بانرات الصفحة الرئيسية" card.
 *
 * Layout (desktop, RTL — 12-col grid):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  [→ لوحة التحكم]   "بانرات الصفحة الرئيسية"      [☀ / ☾ toggle] │
 *   ├──────────────────────┬─────────────────────┬──────────────────────┤
 *   │  col-span-5          │  col-span-4         │  col-span-3 (sticky) │
 *   │  ┌────────────────┐  │  ┌────────────────┐ │  ┌─────────────────┐ │
 *   │  │ Banner list    │  │  │ BannerEditor   │ │  │ ActivityHistory │ │
 *   │  │ (FLIP reorder) │  │  │ (pending save) │ │  │ (newest first)  │ │
 *   │  └────────────────┘  │  └────────────────┘ │  └─────────────────┘ │
 *   │  ┌────────────────┐  │  ┌────────────────┐ │                      │
 *   │  │ Upload area    │  │  │ Live preview   │ │                      │
 *   │  └────────────────┘  │  └────────────────┘ │                      │
 *   ├──────────────────────┴─────────────────────┴──────────────────────┤
 *   │  Carousel Settings (auto-slide interval slider)                   │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * FLIP animation:
 *   - `useFlipReorder(bannerListRef, flipItems, 300)` where
 *     `flipItems = isImageEditing ? [] : sortedBanners`.
 *   - We pass `[]` while the user is dragging the image positioner so the
 *     banner's "First" position is captured AFTER the drag ends — otherwise
 *     the live transform updates would constantly invalidate the snapshot.
 *
 * State:
 *   - selectedId / deleteTarget: pure UI state.
 *   - adminTheme: read reactively from the store subscription (no local
 *     mirror). The Sun/Moon icon and <html> dark class update via the
 *     store's emit cycle — `store.setAdminTheme(...)` is the only setter.
 *   - draftBanner: the editor's pending draft (drives the live preview).
 *   - isImageEditing: forwarded from BannerEditor's ImagePositioner —
 *     disables FLIP while dragging.
 */

import { useRef, useState } from "react";
import {
  ImagePlus,
  AlertTriangle,
  SlidersHorizontal,
  Archive,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";
import {
  MAX_BANNERS,
  MAX_ACTIVE_BANNERS,
  BANNER_TRANSFORM_DEFAULT,
  BannerInput,
  SponsoredBanner,
} from "@/lib/admin/banner-model";
import { AdminBannerCard } from "@/components/admin/AdminBannerCard";
import { UploadArea } from "@/components/admin/UploadArea";
import { BannerEditor } from "@/components/admin/BannerEditor";
import { LiveCarouselPreview } from "@/components/admin/LiveCarouselPreview";

import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";
import { CarouselSettings } from "@/components/admin/CarouselSettings";
import { BannerSizeInfo } from "@/components/admin/BannerSizeInfo";
import { getBannerDimensions } from "@/lib/admin/dimensions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useFlipReorder } from "@/lib/admin/use-flip-reorder";
import { setImage as setImageInDB } from "@/lib/admin/image-db";

export default function AdminBannersPage() {
  const { toast } = useToast();

  const {
    banners,
    canAddMore,
    lastStorageError,
    autoSlideInterval,
  } = useAdminStore();
  const store = getAdminStore();

  // ----- Local UI state -----
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [draftBanner, setDraftBanner] = useState<SponsoredBanner | null>(null);
  const [isImageEditing, setIsImageEditing] = useState(false);

  // Ref to the banner list container — used by the FLIP hook to snapshot
  // child positions before/after reorders.
  const bannerListRef = useRef<HTMLDivElement>(null);

  // ----- Derived data -----
  const sortedBanners = [...banners].sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  const selectedBanner =
    sortedBanners.find((b) => b.id === selectedId) ?? null;
  const deleteBannerObj =
    sortedBanners.find((b) => b.id === deleteTarget) ?? null;

  // ----- FLIP animation -----
  // Pass an empty array while the user is dragging the image positioner —
  // otherwise every transform update would invalidate the "First" snapshot
  // and the next reorder would animate from the wrong position.
  const flipItems = isImageEditing ? [] : sortedBanners;
  useFlipReorder(bannerListRef, flipItems, 300);

  // ----- Mutations (all funnel through the store so persistence + history
  // are guaranteed). Each one surfaces a toast so the user gets feedback. -----
  const handleSave = (
    id: string,
    patch: Partial<BannerInput>,
    changeSummary: string[]
  ) => {
    store.commitBannerEdit(id, patch, changeSummary);
    toast({
      title: "تم حفظ البانر",
      description:
        changeSummary.length > 0
          ? changeSummary[0]
          : "تم تحديث البانر بنجاح.",
    });
  };

  const handleUploadNew = async (dataUrl: string) => {
    if (!canAddMore) return;

    const imageKey = `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await setImageInDB(imageKey, dataUrl);

    const input: BannerInput = {
      bannerType: "full", // new banners default to full-banner mode
      image: "",
      imageKey,
      gradient: "linear-gradient(135deg, #4f9cff, #2a6fcc)",
      iconKey: "tests",
      title: "بانر جديد",
      subtitle: "أدخل الوصف هنا",
      destination: "tests",
      enabled: true,
      displayOrder: 99, // store will assign the real order
      transform: { ...BANNER_TRANSFORM_DEFAULT },
    };
    const created = store.addBanner(input);
    if (created) {
      setSelectedId(created.id);
      toast({
        title: "تم رفع البانر",
        description: "أُضيف بانر جديد بنجاح. يمكنك تعديله الآن.",
      });
    } else {
      toast({
        title: "تعذّر رفع البانر",
        description: `وصلت إلى الحد الأقصى (${MAX_ACTIVE_BANNERS} بانرات نشطة).`,
        variant: "destructive",
      });
    }
  };

  const handleMoveUp = (banner: SponsoredBanner) => {
    store.moveBanner(banner.id, "up");
    toast({ title: "إعادة ترتيب", description: `تم تحريك «${banner.title || "بدون عنوان"}» لأعلى.` });
  };

  const handleMoveDown = (banner: SponsoredBanner) => {
    store.moveBanner(banner.id, "down");
    toast({ title: "إعادة ترتيب", description: `تم تحريك «${banner.title || "بدون عنوان"}» لأسفل.` });
  };

  const handleDuplicate = (banner: SponsoredBanner) => {
    const copy = store.duplicateBanner(banner.id);
    if (copy) {
      toast({
        title: "تم التكرار",
        description: `أُنشئت نسخة من «${banner.title || "بدون عنوان"}».`,
      });
    } else {
      toast({
        title: "تعذّر التكرار",
        description: `وصلت إلى الحد الأقصى (${MAX_ACTIVE_BANNERS} بانرات نشطة).`,
        variant: "destructive",
      });
    }
  };

  const handleDeleteRequest = (banner: SponsoredBanner) => {
    setDeleteTarget(banner.id);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    const target = banners.find((b) => b.id === deleteTarget);
    store.deleteBanner(deleteTarget);
    if (selectedId === deleteTarget) setSelectedId(null);
    setDeleteTarget(null);
    toast({
      title: "تم الحذف",
      description: `حُذف البانر «${target?.title || "بدون عنوان"}».`,
      variant: "destructive",
    });
  };

  const handleCarouselSave = (ms: number) => {
    store.setAutoSlideInterval(ms);
    toast({
      title: "تم حفظ الإعدادات",
      description: `مدة عرض كل بانر: ${Math.round(ms / 1000)} ثانية.`,
    });
  };

  const handleArchive = (banner: SponsoredBanner) => {
    store.archiveBanner(banner.id);
    toast({ title: "تمت الأرشفة", description: `أُرشفة «${banner.title || "بدون عنوان"}».` });
  };

  const handleUnarchive = (banner: SponsoredBanner) => {
    const ok = store.unarchiveBanner(banner.id);
    if (ok) {
      toast({ title: "تمت الاستعادة", description: `استُعيد «${banner.title || "بدون عنوان"}».` });
    } else {
      toast({
        title: "تعذّرت الاستعادة",
        description: `وصلت إلى الحد الأقصى (${MAX_ACTIVE_BANNERS} بانرات نشطة).`,
        variant: "destructive",
      });
    }
  };

  // Active vs archived
  const activeBanners = sortedBanners.filter((b) => b.status !== "archived");
  const archivedBanners = sortedBanners.filter((b) => b.status === "archived");

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Storage error warning ---------- */}
      {lastStorageError && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-destructive">
              تحذير: مساحة التخزين ممتلئة
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-destructive/80">
              {lastStorageError}
              <br />
              التغييرات الأخيرة لم تُحفظ بشكل صحيح. قد تختفي بعض البانرات عند
              إعادة تحميل الصفحة. احذف بانراً غير ضروري أو تأكد من أن الصور
              مضغوطة (يتم الضغط تلقائياً عند الرفع).
            </p>
          </div>
        </div>
      )}

      {/* ---------- Main 2-column grid ---------- */}
      <div className="grid grid-cols-12 gap-6">
        {/* ===== Left: banner list + upload ===== */}
        <section className="col-span-12 space-y-5 lg:col-span-5">
          {/* Banner list */}
          <div className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  البانرات الحالية
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {activeBanners.length} / {MAX_ACTIVE_BANNERS}
                </span>
              </div>
            </div>

            <div ref={bannerListRef} className="space-y-2 p-3">
              {activeBanners.length === 0 ? (
                <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                  <ImagePlus className="h-8 w-8 opacity-30" />
                  لا توجد بانرات نشطة. ارفع أول صورة بالأسفل.
                </div>
              ) : (
                activeBanners.map((banner, idx) => (
                  <div key={banner.id} data-flip-key={banner.id}>
                    <AdminBannerCard
                      banner={banner}
                      position={idx + 1}
                      total={activeBanners.length}
                      isSelected={banner.id === selectedId}
                      onSelect={() => setSelectedId(banner.id)}
                      onMoveUp={() => handleMoveUp(banner)}
                      onMoveDown={() => handleMoveDown(banner)}
                      onDuplicate={() => handleDuplicate(banner)}
                      onArchive={() => handleArchive(banner)}
                      onDelete={() => handleDeleteRequest(banner)}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Upload new banner */}
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <ImagePlus className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                رفع بانر جديد
              </h2>
              <BannerSizeInfo />
            </div>
            {canAddMore ? (
              <UploadArea
                onUploaded={handleUploadNew}
                recommendedDimensions={getBannerDimensions("full")}
                recommendedLabel="بانر كامل"
              />
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-xs text-amber-600 dark:text-amber-400">
                وصلت إلى الحد الأقصى ({MAX_BANNERS} بانرات). احذف بانرًا لإضافة
                جديد.
              </div>
            )}
          </div>
        </section>

        {/* ===== Middle: editor + live preview ===== */}
        <section className="col-span-12 space-y-5 lg:col-span-7">
          {/* Editor */}
          <div
            className="overflow-hidden rounded-xl border bg-card"
            style={{ minHeight: 480 }}
          >
            <BannerEditor
              banner={selectedBanner}
              onSave={handleSave}
              onClose={() => setSelectedId(null)}
              onDraftChange={setDraftBanner}
              onImageEditingChange={setIsImageEditing}
            />
          </div>

          {/* Live carousel preview — same proportions as student app */}
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                معاينة حية
              </h2>
              <span className="text-[10px] text-muted-foreground">
                بنفس أبعاد كاروسيل الطلاب
              </span>
            </div>
            <div className="flex justify-center rounded-lg bg-muted/20 py-4">
              <LiveCarouselPreview
                banner={draftBanner || selectedBanner}
                allBanners={sortedBanners}
              />
            </div>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
              هذه معاينة مطابقة لما يراه الطلاب في الصفحة الرئيسية. التغييرات
              غير المحفوظة تظهر هنا فوراً.
            </p>
          </div>
        </section>

      </div>

      {/* ---------- Archived banners ---------- */}
      {archivedBanners.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              الأرشيف
            </h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {archivedBanners.length}
            </span>
          </div>
          <div className="space-y-2 rounded-xl border bg-card p-3">
            {archivedBanners.map((banner) => (
              <div
                key={banner.id}
                className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2"
              >
                <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
                  {banner.bannerType === "full" ? "F" : "S"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {banner.title || "بدون عنوان"}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {banner.subtitle || "—"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleUnarchive(banner)}
                  className="h-7 gap-1 text-[10px]"
                >
                  <RotateCcw className="h-3 w-3" />
                  استعادة
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteRequest(banner)}
                  className="h-7 gap-1 text-[10px] text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Carousel settings (full-width strip at bottom) ---------- */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            إعدادات الكاروسيل
          </h2>
        </div>
        <CarouselSettings
          interval={autoSlideInterval}
          onSave={handleCarouselSave}
        />
      </section>

      {/* ---------- Delete confirmation dialog ---------- */}
      <DeleteConfirmDialog
        banner={deleteBannerObj}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
