"use client";

/**
 * Admin Dashboard — Sponsored Carousel Manager
 * ============================================
 *
 * Standalone internal tool at /admin. NOT linked anywhere in the student app.
 *
 * Layout (desktop-optimized, RTL):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Header: "Sponsored Carousel Manager" + subtitle                 │
 *   ├───────────────────────────┬──────────────────┬───────────────────┤
 *   │  Current Banners list     │  Banner Editor   │  Activity History │
 *   │  (with all actions)       │  (or upload)     │  (newest first)   │
 *   │                           │                  │                   │
 *   │  + Upload new banner      │  + Live preview  │                   │
 *   │    area below the list    │    of edited     │                   │
 *   │                           │    banner        │                   │
 *   ├───────────────────────────┴──────────────────┴───────────────────┤
 *   │  Recommended banner size info (always visible)                   │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * State:
 *   - Single source of truth: AdminStore (subscribed via useAdminStore).
 *   - Local UI state only: selected banner id, delete-target id, draft inputs.
 *
 * Scalability:
 *   - The 3-column layout can grow to host more managers (News, Announcements,
 *     etc.) by adding new sections — no redesign needed.
 *   - Store methods (addBanner, updateBanner, deleteBanner, moveBanner,
 *     duplicateBanner) are the contract with the future backend.
 */

import { useState } from "react";
import { ImagePlus, Layers, Info } from "lucide-react";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";
import {
  MAX_BANNERS,
  RECOMMENDED_BANNER,
  BANNER_TRANSFORM_DEFAULT,
  BannerInput,
} from "@/lib/admin/banner-model";
import { AdminBannerCard } from "@/components/admin/AdminBannerCard";
import { UploadArea } from "@/components/admin/UploadArea";
import { BannerEditor } from "@/components/admin/BannerEditor";
import { LiveCarouselPreview } from "@/components/admin/LiveCarouselPreview";
import { ActivityHistory } from "@/components/admin/ActivityHistory";
import { DeleteConfirmDialog } from "@/components/admin/DeleteConfirmDialog";

export default function AdminPage() {
  const { banners, history, canAddMore } = useAdminStore();
  const store = getAdminStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const selectedBanner = banners.find((b) => b.id === selectedId) || null;
  const deleteBannerObj = banners.find((b) => b.id === deleteTarget) || null;

  const sortedBanners = [...banners].sort((a, b) => a.displayOrder - b.displayOrder);

  const handlePatch = (id: string, patch: Partial<Parameters<typeof store.updateBanner>[1]>) => {
    store.updateBanner(id, patch);
  };

  const handleUploadNew = (dataUrl: string) => {
    if (!canAddMore) return;
    const input: BannerInput = {
      image: dataUrl,
      gradient: "linear-gradient(135deg, #4f9cff, #2a6fcc)",
      iconKey: "tests",
      title: "بانر جديد",
      subtitle: "أدخل الوصف هنا",
      destination: "tests",
      enabled: true,
      displayOrder: 99, // store will assign real order
      transform: { ...BANNER_TRANSFORM_DEFAULT },
    };
    const created = store.addBanner(input);
    if (created) {
      setSelectedId(created.id);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8">
      {/* ---------- Header ---------- */}
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center rounded-xl bg-primary/10 p-2.5 text-primary">
            <Layers className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Sponsored Carousel Manager
            </h1>
            <p className="text-sm text-muted-foreground">
              إدارة بانرات الصفحة الرئيسية الترويجية
            </p>
          </div>
        </div>
      </header>

      {/* ---------- Main 3-column grid ---------- */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Banner list + upload */}
        <section className="col-span-12 lg:col-span-5 space-y-5">
          <div className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">البانرات الحالية</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {banners.length} / {MAX_BANNERS}
                </span>
              </div>
            </div>
            <div className="space-y-2 p-3">
              {sortedBanners.length === 0 ? (
                <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                  <ImagePlus className="h-8 w-8 opacity-30" />
                  لا توجد بانرات بعد. ارفع أول صورة بالأسفل.
                </div>
              ) : (
                sortedBanners.map((banner, idx) => (
                  <AdminBannerCard
                    key={banner.id}
                    banner={banner}
                    position={idx + 1}
                    total={sortedBanners.length}
                    isSelected={banner.id === selectedId}
                    onSelect={() => setSelectedId(banner.id)}
                    onMoveUp={() => store.moveBanner(banner.id, "up")}
                    onMoveDown={() => store.moveBanner(banner.id, "down")}
                    onDuplicate={() => store.duplicateBanner(banner.id)}
                    onDelete={() => setDeleteTarget(banner.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Upload new banner */}
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <ImagePlus className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">رفع بانر جديد</h2>
            </div>
            {canAddMore ? (
              <UploadArea onUploaded={handleUploadNew} />
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-xs text-amber-600 dark:text-amber-400">
                وصلت إلى الحد الأقصى ({MAX_BANNERS} بانرات). احذف بانرًا لإضافة جديد.
              </div>
            )}
          </div>
        </section>

        {/* Middle: Editor + live preview */}
        <section className="col-span-12 lg:col-span-4 space-y-5">
          <div className="rounded-xl border bg-card overflow-hidden" style={{ minHeight: 480 }}>
            <BannerEditor
              banner={selectedBanner}
              onPatch={handlePatch}
              onClose={() => setSelectedId(null)}
            />
          </div>

          {/* Live carousel preview — same proportions as student app */}
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">معاينة حية</h2>
              <span className="text-[10px] text-muted-foreground">
                بنفس أبعاد كاروسيل الطلاب
              </span>
            </div>
            <div className="flex justify-center py-4 bg-muted/20 rounded-lg">
              <LiveCarouselPreview banners={sortedBanners} width={366} />
            </div>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              هذه معاينة مطابقة لما يراه الطلاب في الصفحة الرئيسية.
            </p>
          </div>
        </section>

        {/* Right: Activity history */}
        <section className="col-span-12 lg:col-span-3">
          <ActivityHistory />
        </section>
      </div>

      {/* ---------- Recommended banner size (always visible) ---------- */}
      <section className="mt-8 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="grid place-items-center rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
            <Info className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              الحجم الرسمي للبانر
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              استخدم هذه الأبعاد عند تصميم البانرات. الصور ستحافظ على نسبة الأبعاد دون تمديد.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">العرض</div>
                <div className="text-sm font-semibold text-foreground">
                  {RECOMMENDED_BANNER.width}px
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">الارتفاع</div>
                <div className="text-sm font-semibold text-foreground">
                  {RECOMMENDED_BANNER.height}px
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">نسبة الأبعاد</div>
                <div className="text-sm font-semibold text-foreground">
                  {RECOMMENDED_BANNER.aspectRatio}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">الجودة</div>
                <div className="text-sm font-semibold text-foreground">
                  {RECOMMENDED_BANNER.retinaScale}× retina
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Delete confirmation dialog ---------- */}
      <DeleteConfirmDialog
        banner={deleteBannerObj}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) {
            store.deleteBanner(deleteTarget);
            if (selectedId === deleteTarget) setSelectedId(null);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
