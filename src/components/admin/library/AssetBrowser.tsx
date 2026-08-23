"use client";

import { FileSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssetPreview } from "./AssetPreview";
import { formatBytes, formatDate, formatDimensions } from "./format";
import { MEDIA_KIND_LABELS, type LibraryAsset } from "./library-types";

export function AssetBrowser({
  assets,
  view,
  onSelectAsset,
}: {
  assets: LibraryAsset[];
  view: "grid" | "list";
  onSelectAsset: (asset: LibraryAsset) => void;
}) {
  if (view === "grid") {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => onSelectAsset(asset)}
            className="group overflow-hidden rounded-2xl border bg-card text-right shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <AssetPreview asset={asset} className="aspect-[16/10] w-full" />
            <div className="space-y-2.5 p-4">
              <div>
                <h3 className="truncate text-sm font-bold text-foreground" dir="auto" title={asset.displayName}>{asset.displayName}</h3>
                <p className="mt-1 truncate text-[11px] text-muted-foreground" dir="auto" title={asset.originalFilename}>{asset.originalFilename}</p>
              </div>
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span className="rounded-full bg-muted px-2 py-1">{MEDIA_KIND_LABELS[asset.mediaKind]}</span>
                <span>{formatBytes(asset.byteSize)}</span>
              </div>
              <QuestionPackageBadge asset={asset} />
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="hidden grid-cols-[minmax(220px,2fr)_110px_100px_110px_minmax(120px,1fr)_160px] gap-4 border-b bg-muted/35 px-5 py-3 text-[11px] font-semibold text-muted-foreground lg:grid">
        <span>الملف</span><span>النوع</span><span>الحجم</span><span>الأبعاد</span><span>الرافع</span><span>تاريخ الرفع</span>
      </div>
      <div className="divide-y">
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => onSelectAsset(asset)}
            className={cn(
              "grid w-full items-center gap-4 px-4 py-3 text-right transition hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
              "grid-cols-[56px_minmax(0,1fr)] lg:grid-cols-[minmax(220px,2fr)_110px_100px_110px_minmax(120px,1fr)_160px] lg:px-5",
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <AssetPreview asset={asset} className="h-12 w-14 flex-shrink-0 rounded-lg" sizes="56px" />
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-foreground" dir="auto" title={asset.displayName}>{asset.displayName}</div>
                <div className="mt-1 truncate text-[10px] text-muted-foreground" dir="auto" title={asset.originalFilename}>{asset.originalFilename}</div>
              </div>
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground lg:contents">
              <span className="block lg:inline">
                {MEDIA_KIND_LABELS[asset.mediaKind]}
                <QuestionPackageBadge asset={asset} compact />
              </span>
              <span className="block lg:inline">{formatBytes(asset.byteSize)}</span>
              <span className="hidden lg:inline">{formatDimensions(asset.width, asset.height)}</span>
              <span className="hidden truncate lg:inline" title={asset.creator.displayName}>{asset.creator.displayName}</span>
              <span className="hidden lg:inline">{formatDate(asset.createdAt)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuestionPackageBadge({ asset, compact = false }: { asset: LibraryAsset; compact?: boolean }) {
  const inspection = asset.questionPackageInspection;
  if (!inspection || inspection.status === "GENERIC_JSON") return null;
  const valid = inspection.status === "VALID";
  const warning = inspection.status === "VALID_WITH_WARNINGS";
  const className = valid
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : warning
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "bg-destructive/10 text-destructive";
  const label = inspection.status === "UNSUPPORTED_VERSION"
    ? "حزمة أسئلة بإصدار غير مدعوم"
    : valid
      ? "حزمة أسئلة صالحة"
      : warning
        ? "حزمة أسئلة مع تحذيرات"
        : "حزمة أسئلة غير صالحة";
  return <span className={cn("inline-flex w-fit rounded-full px-2 py-1 text-[10px] font-semibold", compact ? "mt-1" : "", className)}>{label}</span>;
}

export function AssetBrowserEmpty({ filtered }: { filtered: boolean }) {
  return (
    <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed bg-card/50 p-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><FileSearch className="h-6 w-6" /></div>
        <h2 className="mt-4 text-base font-bold text-foreground">{filtered ? "لا توجد نتائج مطابقة" : "مكتبة المحتوى فارغة"}</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">{filtered ? "جرّب تغيير عبارة البحث أو نوع الملف." : "ارفع أول ملف ليُحفظ بأمان في التخزين المحلي الدائم."}</p>
      </div>
    </div>
  );
}
