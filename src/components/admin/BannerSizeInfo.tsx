"use client";

/**
 * BannerSizeInfo
 * ---------------
 * Compact Popover trigger (an Info icon) that reveals the recommended
 * banner export sizes for both "full" and "split" banner types.
 *
 * Used in the admin dashboard as a small inline hint next to headings or
 * the upload area, so the user can quickly look up the exact pixel
 * dimensions without leaving the page.
 */

import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  RECOMMENDED_BANNER_FULL,
  RECOMMENDED_BANNER_SPLIT,
} from "@/lib/admin/banner-model";

interface Props {
  /** Optional className for the trigger button. */
  className?: string;
}

export function BannerSizeInfo({ className }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${className ?? ""}`}
          title="الأحجام الرسمية للبانرات"
        >
          <Info className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-3"
        dir="rtl"
      >
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-foreground">
            الأحجام الرسمية للبانرات
          </h4>
          <p className="text-[11px] text-muted-foreground">
            صدّر الصور بدقة 2× retina لوضوح أعلى.
          </p>
        </div>

        <div className="space-y-2.5">
          {/* Full banner — blue card */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                بانر كامل
              </span>
              <span className="text-[10px] text-muted-foreground">Full</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  العرض
                </div>
                <div className="font-semibold text-foreground">
                  {RECOMMENDED_BANNER_FULL.width}px
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  الارتفاع
                </div>
                <div className="font-semibold text-foreground">
                  {RECOMMENDED_BANNER_FULL.height}px
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  النسبة
                </div>
                <div className="font-semibold text-foreground">
                  {RECOMMENDED_BANNER_FULL.aspectRatio}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  الجودة
                </div>
                <div className="font-semibold text-foreground">
                  {RECOMMENDED_BANNER_FULL.retinaScale}× retina
                </div>
              </div>
            </div>
          </div>

          {/* Split banner — purple card */}
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
                بانر مقسّم
              </span>
              <span className="text-[10px] text-muted-foreground">Split</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  العرض
                </div>
                <div className="font-semibold text-foreground">
                  {RECOMMENDED_BANNER_SPLIT.width}px
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  الارتفاع
                </div>
                <div className="font-semibold text-foreground">
                  {RECOMMENDED_BANNER_SPLIT.height}px
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  النسبة
                </div>
                <div className="font-semibold text-foreground">
                  {RECOMMENDED_BANNER_SPLIT.aspectRatio}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  الجودة
                </div>
                <div className="font-semibold text-foreground">
                  {RECOMMENDED_BANNER_SPLIT.retinaScale}× retina
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Compression note */}
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          يتم ضغط الصور تلقائياً عند الرفع لتوفير مساحة التخزين، مع الحفاظ على
          جودة عالية عند حجم العرض الفعلي.
        </p>
      </PopoverContent>
    </Popover>
  );
}
