"use client";

/**
 * BannerEditor
 * -------------
 * Side panel for editing a single SponsoredBanner.
 *
 * The editor adapts to `banner.bannerType`:
 *
 *   - "full":  Shows only Image Upload + Image Positioner + Enabled toggle.
 *              Title/subtitle are hidden because the full-banner layout
 *              embeds all text inside the image itself.
 *
 *   - "split": Shows the full editor: Image Upload + Positioner + Title +
 *              Subtitle + Enabled toggle (the original layout).
 *
 * The Banner Type selector at the top lets the admin switch between modes
 * instantly. Switching type patches the store, which re-renders the editor
 * and the live preview.
 *
 * Architecture: controlled component — reads `banner`, emits patches via
 * `onPatch`. No local state beyond title/subtitle draft inputs (to avoid
 * caret jumps during typing).
 */

import { useCallback, useState } from "react";
import { X, Save, ImageIcon, LayoutGrid, LayoutPanelTop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SponsoredBanner,
  BannerImageTransform,
  BannerType,
  BANNER_TRANSFORM_DEFAULT,
} from "@/lib/admin/banner-model";
import { UploadArea } from "./UploadArea";
import { ImagePositioner } from "./ImagePositioner";

interface Props {
  banner: SponsoredBanner | null;
  onPatch: (id: string, patch: Partial<SponsoredBanner>) => void;
  onClose: () => void;
}

const TYPE_OPTIONS: {
  value: BannerType;
  label: string;
  description: string;
  icon: typeof LayoutGrid;
}[] = [
  {
    value: "full",
    label: "بانر كامل",
    description: "صورة واحدة تملأ الإطار بالكامل — كل النص داخل الصورة",
    icon: LayoutPanelTop,
  },
  {
    value: "split",
    label: "بانر مقسّم",
    description: "صورة على جانب + عنوان ووصف قابلين للتعديل",
    icon: LayoutGrid,
  },
];

export function BannerEditor({ banner, onPatch, onClose }: Props) {
  // Local draft state so typing in inputs feels instant (no debounce flicker).
  // We sync to the store on every change via onPatch, but inputs read from
  // local state to avoid caret jumps.
  const [title, setTitle] = useState(banner?.title ?? "");
  const [subtitle, setSubtitle] = useState(banner?.subtitle ?? "");

  // Re-sync local state when banner changes (e.g. user selects another row)
  const bannerId = banner?.id;
  const [lastSyncedId, setLastSyncedId] = useState<string | null>(bannerId ?? null);
  if (bannerId && bannerId !== lastSyncedId) {
    setTitle(banner.title);
    setSubtitle(banner.subtitle);
    setLastSyncedId(bannerId);
  }

  const onTransformChange = useCallback(
    (next: BannerImageTransform) => {
      if (!banner) return;
      onPatch(banner.id, { transform: next });
    },
    [banner, onPatch]
  );

  if (!banner) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="grid place-items-center rounded-full bg-muted p-4">
          <Save className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">اختر بانرًا للتعديل</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          اضغط على أي بطاقة في القائمة لفتحها هنا، أو ارفع صورة جديدة من قسم الرفع.
        </p>
      </div>
    );
  }

  const isFull = banner.bannerType === "full";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">محرر البانر</h3>
          <p className="text-xs text-muted-foreground">
            الموضع #{banner.displayOrder} · {isFull ? "بانر كامل" : "بانر مقسّم"}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          {/* ---------- Banner Type selector ---------- */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              نوع البانر
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = banner.bannerType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onPatch(banner.id, { bannerType: opt.value })}
                    className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-right transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`h-4 w-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                      />
                      <span className="text-sm font-medium text-foreground">{opt.label}</span>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {opt.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---------- Upload section (always shown) ---------- */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              صورة البانر
            </h4>
            <UploadArea
              currentImage={banner.image}
              onUploaded={(dataUrl) =>
                onPatch(banner.id, {
                  image: dataUrl,
                  transform: { ...BANNER_TRANSFORM_DEFAULT },
                })
              }
              onClear={() =>
                onPatch(banner.id, {
                  image: "",
                  transform: { ...BANNER_TRANSFORM_DEFAULT },
                })
              }
            />
          </section>

          {/* ---------- Image positioning (always shown when image exists) ---------- */}
          {banner.image && (
            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                ضبط الموضع
              </h4>
              <ImagePositioner
                imageSrc={banner.image}
                gradient={banner.gradient}
                value={banner.transform}
                onChange={onTransformChange}
                previewWidth={320}
                // For full banners, the image fills the entire frame — show the
                // full-frame safe area. For split, the default 42% panel overlay applies.
                fullFrame={isFull}
              />
            </section>
          )}

          {/* ---------- Split-only fields: Title + Subtitle ---------- */}
          {!isFull && (
            <>
              <section className="space-y-2">
                <Label htmlFor="banner-title" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  العنوان
                </Label>
                <Input
                  id="banner-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    onPatch(banner.id, { title: e.target.value });
                  }}
                  placeholder="مثال: مراجعة الأحياء"
                  dir="rtl"
                  maxLength={60}
                />
              </section>

              <section className="space-y-2">
                <Label htmlFor="banner-subtitle" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  الوصف
                </Label>
                <Textarea
                  id="banner-subtitle"
                  value={subtitle}
                  onChange={(e) => {
                    setSubtitle(e.target.value);
                    onPatch(banner.id, { subtitle: e.target.value });
                  }}
                  placeholder="مثال: ملخص شامل للفصول الأربعة"
                  dir="rtl"
                  rows={3}
                  maxLength={120}
                />
              </section>
            </>
          )}

          {/* ---------- Full-banner hint ---------- */}
          {isFull && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 text-xs text-blue-600 dark:text-blue-400">
              <ImageIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                في البانر الكامل، كل النص والعلامة التجارية وزر الإجراء تكون
                مصمّمة داخل الصورة نفسها. ارفع صورة جاهزة بالأبعاد الموصى بها.
              </span>
            </div>
          )}

          {/* ---------- Enabled toggle (always shown) ---------- */}
          <section className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="banner-enabled" className="text-sm font-medium text-foreground">
                تفعيل البانر
              </Label>
              <p className="text-xs text-muted-foreground">
                البانرات المعطّلة لا تظهر في الكاروسيل
              </p>
            </div>
            <Switch
              id="banner-enabled"
              checked={banner.enabled}
              onCheckedChange={(checked) =>
                onPatch(banner.id, { enabled: checked })
              }
            />
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
