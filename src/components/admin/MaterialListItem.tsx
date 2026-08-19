"use client";

/**
 * MaterialListItem
 * ----------------
 * One row in the reorderable list used by the admin Materials manager.
 *
 * Visual layout (RTL):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ #  [thumb]  Arabic Title / ENGLISH CAPS    [badge] ↑ ↓ ✏   │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The thumbnail is a 16:9 mini-preview of the card's image (or gradient
 * fallback) so the admin can see at a glance which materials have a
 * custom photo vs. which still use the default gradient.
 *
 * Pure presentational component — all mutations are delegated to the
 * parent via callbacks. Apply the `admin-reorder-item` class + a
 * `data-flip-key={item.id}` attribute on the wrapper so the parent's
 * `useFlipReorder` hook can animate reorders.
 */

import { ChevronUp, ChevronDown, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ContentItem } from "@/lib/admin/content-store";

export interface MaterialListItemProps {
  item: ContentItem;
  order: number;
  total: number;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function MaterialListItem({
  item,
  order,
  total,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
}: MaterialListItemProps) {
  const hasImage = !!item.image && item.image.startsWith("data:");
  const gradient = item.gradient || "linear-gradient(135deg, #1a3a5c, #0d1e30)";
  const transform = item.transform || { offsetX: 0, offsetY: 0, scale: 1 };

  return (
    <div
      className={`admin-banner-card admin-reorder-item group relative flex items-center gap-3 rounded-xl border bg-card p-3 transition-all ${
        isSelected
          ? "border-primary ring-1 ring-primary/30"
          : "border-border hover:border-primary/40"
      }`}
    >
      {/* Position number */}
      <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {order + 1}
      </div>

      {/* 16:9 thumbnail + label (click to select) */}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-right"
        title="اضغط للتعديل"
      >
        <span
          className="relative grid h-10 w-[72px] flex-shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted"
          style={hasImage ? undefined : { background: gradient }}
        >
          {hasImage ? (
            <img
              src={item.image}
              alt={item.label}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{
                transform: `translate(${transform.offsetX}%, ${transform.offsetY}%) scale(${transform.scale})`,
                transformOrigin: "center",
              }}
              draggable={false}
            />
          ) : (
            <span className="text-[9px] font-medium uppercase tracking-wider text-white/80">
              {item.englishTitle || item.icon}
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="w-full truncate text-sm font-medium text-foreground">
            {item.label || "—"}
          </span>
          <span className="flex items-center gap-1.5">
            {item.englishTitle && (
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {item.englishTitle}
              </span>
            )}
            <Badge
              variant={item.available ? "default" : "secondary"}
              className={
                item.available
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : ""
              }
            >
              {item.available ? "متاح" : "معطّل"}
            </Badge>
          </span>
        </span>
      </button>

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onMoveUp}
          disabled={order <= 0}
          title="تحريك لأعلى"
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onMoveDown}
          disabled={order >= total - 1}
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
      </div>
    </div>
  );
}
