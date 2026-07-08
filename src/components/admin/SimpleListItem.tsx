"use client";

/**
 * SimpleListItem — one row in the reorderable list used by the
 * Navigation, Materials, and Tools managers.
 *
 * Shows: position number, icon, label, available/enabled badge.
 * Actions: Move Up, Move Down, Edit.
 *
 * Pure presentational component — all mutations are delegated to the
 * parent via callbacks. Apply the `admin-reorder-item` class + a
 * `data-flip-key={item.id}` attribute on the wrapper so the parent's
 * `useFlipReorder` hook can animate reorders.
 */

import { ChevronUp, ChevronDown, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/lib/admin/app-icons";

export interface SimpleListItemProps {
  id: string;
  label: string;
  icon: string;
  order: number;
  total: number;
  /** Whether the item is enabled (nav) or available (materials/tools). */
  enabled: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** Optional badge text shown after the label (e.g. "قريبًا" for tools). */
  trailingBadge?: string;
}

export function SimpleListItem({
  id: _id,
  label,
  icon,
  order,
  total,
  enabled,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
  trailingBadge,
}: SimpleListItemProps) {
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

      {/* Icon + label (click to select) */}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-right"
        title="اضغط للتعديل"
      >
        <span
          className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg ${
            enabled
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <AppIcon name={icon} className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="w-full truncate text-sm font-medium text-foreground">
            {label || "—"}
          </span>
          <span className="flex items-center gap-1.5">
            <Badge
              variant={enabled ? "default" : "secondary"}
              className={
                enabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : ""
              }
            >
              {enabled ? "مفعّل" : "معطّل"}
            </Badge>
            {trailingBadge && (
              <Badge variant="outline" className="text-[10px]">
                {trailingBadge}
              </Badge>
            )}
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
