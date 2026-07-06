"use client";

/**
 * AdminBannerCard
 * ----------------
 * One row in the "Current Banners" list.
 *
 * Shows: preview thumbnail, position number, title, enabled badge.
 * Actions: Edit, Move Up, Move Down, Duplicate, Delete.
 *
 * Pure presentational component — all mutations are delegated to the parent
 * via callbacks so this card stays reusable.
 */

import {
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  Pencil,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SponsoredBanner } from "@/lib/admin/banner-model";

interface Props {
  banner: SponsoredBanner;
  position: number;
  total: number;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function AdminBannerCard({
  banner,
  position,
  total,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
}: Props) {
  return (
    <div
      className={`group relative flex items-center gap-4 rounded-xl border bg-card p-3 transition-all ${
        isSelected
          ? "border-primary ring-1 ring-primary/30"
          : "border-border hover:border-primary/40"
      }`}
    >
      {/* Position number */}
      <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {position}
      </div>

      {/* Preview thumbnail */}
      <button
        type="button"
        onClick={onSelect}
        className="relative h-14 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-border"
        style={{
          background:
            banner.image && banner.image.length > 0
              ? undefined
              : banner.gradient || "linear-gradient(135deg, #4f9cff, #2a6fcc)",
        }}
        title="اضغط للتعديل"
      >
        {banner.image && banner.image.length > 0 ? (
          <img
            src={banner.image}
            alt={banner.title}
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              objectPosition: `${50 + banner.transform.offsetX}% ${
                50 + banner.transform.offsetY
              }%`,
              transform: `scale(${banner.transform.scale})`,
              transformOrigin: "center",
            }}
          />
        ) : (
          <div className="grid h-full place-items-center">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="5" y="4.5" width="14" height="17" rx="3" />
              <path d="M9 9.5h6" />
              <path d="M9 13.5h3" />
              <path d="m9.5 17 1.8 1.8L15.5 14.5" />
            </svg>
          </div>
        )}
      </button>

      {/* Title + badges */}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-right"
      >
        <span className="w-full truncate text-sm font-medium text-foreground">
          {banner.title || "بدون عنوان"}
        </span>
        <span className="w-full truncate text-xs text-muted-foreground">
          {banner.subtitle || "بدون وصف"}
        </span>
        <div className="flex items-center gap-1.5">
          <Badge
            variant={banner.enabled ? "default" : "secondary"}
            className={
              banner.enabled
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : ""
            }
          >
            {banner.enabled ? "مفعّل" : "معطّل"}
          </Badge>
          {banner.image && banner.image.length > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              صورة
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              تدرّج
            </Badge>
          )}
        </div>
      </button>

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onMoveUp}
          disabled={position <= 1}
          title="تحريك لأعلى"
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onMoveDown}
          disabled={position >= total}
          title="تحريك لأسفل"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onSelect}
          title="تعديل"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onDuplicate}
          title="تكرار"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          title="حذف"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
