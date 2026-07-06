"use client";

/**
 * BannerEditor
 * -------------
 * Side panel for editing a single SponsoredBanner.
 *
 * Editable fields (per spec):
 *   - Image (via UploadArea + ImagePositioner)
 *   - Title
 *   - Subtitle
 *   - Enabled / Disabled (Switch)
 *
 * Everything else (id, displayOrder, destination, transform, timestamps) is
 * managed by the store or hidden from this v1.
 *
 * The editor is a controlled component: it reads `banner` and emits patches
 * via `onPatch`. The parent wires those patches to `adminStore.updateBanner`.
 */

import { useCallback, useState } from "react";
import { X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SponsoredBanner,
  BannerImageTransform,
  BANNER_TRANSFORM_DEFAULT,
} from "@/lib/admin/banner-model";
import { UploadArea } from "./UploadArea";
import { ImagePositioner } from "./ImagePositioner";

interface Props {
  banner: SponsoredBanner | null;
  onPatch: (id: string, patch: Partial<SponsoredBanner>) => void;
  onClose: () => void;
}

export function BannerEditor({ banner, onPatch, onClose }: Props) {
  // Local draft state so typing in inputs feels instant (no debounce flicker).
  // We sync to the store on every change via onPatch, but inputs read from
  // local state to avoid caret jumps.
  const [title, setTitle] = useState(banner?.title ?? "");
  const [subtitle, setSubtitle] = useState(banner?.subtitle ?? "");

  // Re-sync local state when banner changes (e.g. user selects another row)
  // Using key= on the parent is the canonical React way, but to be defensive:
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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">محرر البانر</h3>
          <p className="text-xs text-muted-foreground">
            الموضع #{banner.displayOrder}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          {/* Upload section */}
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

          {/* Image positioning */}
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
              />
            </section>
          )}

          {/* Title */}
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

          {/* Subtitle */}
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

          {/* Enabled toggle */}
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
