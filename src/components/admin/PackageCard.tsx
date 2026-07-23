"use client";

/**
 * PackageCard — premium card for displaying a Content Package.
 *
 * Design inspired by: Figma file cards, Linear project cards.
 *
 * Displays:
 *   - Package name + icon + color accent
 *   - Subject + Section + Topic
 *   - Question count + Resource count
 *   - Status badge (draft/review/ready/published/archived/hidden)
 *   - Schema version + package version
 *   - Last modified + Last published
 *   - Validation status indicator
 *   - Quick actions (open, duplicate, archive, delete)
 *
 * Interactions:
 *   - Click card → open package workspace (M4)
 *   - Hover → show quick actions
 *   - Selected → highlighted border
 */

import { useRouter } from "next/navigation";
import {
  Package as PackageIcon,
  FileQuestion,
  Image as ImageIcon,
  MoreVertical,
  Copy,
  Archive,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Package as PackageType, PackageStatus } from "@/lib/entities";

interface Props {
  pkg: PackageType;
  subjectName?: string;
  sectionName?: string;
  isSelected?: boolean;
  onSelect?: () => void;
  onDuplicate?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}

const STATUS_CONFIG: Record<PackageStatus, { label: string; color: string; bg: string }> = {
  draft: { label: "مسودة", color: "text-gray-500", bg: "bg-gray-500/10 border-gray-500/20" },
  review: { label: "مراجعة", color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/20" },
  ready: { label: "جاهز", color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/20" },
  published: { label: "منشور", color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20" },
  archived: { label: "مؤرشف", color: "text-gray-400", bg: "bg-gray-500/5 border-gray-500/10" },
  hidden: { label: "مخفي", color: "text-red-500", bg: "bg-red-500/10 border-red-500/20" },
};

export function PackageCard({
  pkg,
  subjectName,
  sectionName,
  isSelected,
  onSelect,
  onDuplicate,
  onArchive,
  onDelete,
}: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const status = STATUS_CONFIG[pkg.status] || STATUS_CONFIG.draft;

  const handleOpen = () => {
    if (onSelect) onSelect();
    router.push(`/admin/content/${pkg.id}`);
  };

  return (
    <div
      onClick={handleOpen}
      className={cn(
        "group relative cursor-pointer rounded-2xl border-2 bg-card p-5 transition-all hover:shadow-lg hover:-translate-y-0.5",
        isSelected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/30"
      )}
    >
      {/* Color accent strip */}
      <div
        className="absolute right-0 top-0 h-full w-1.5 rounded-r-2xl"
        style={{ backgroundColor: pkg.color || "#6366f1" }}
      />

      {/* Header: icon + name + menu */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl text-white shadow-sm"
            style={{ backgroundColor: pkg.color || "#6366f1" }}
          >
            <PackageIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-foreground">{pkg.name}</h3>
            <p className="truncate text-[11px] text-muted-foreground">
              {subjectName || "—"} {sectionName ? `· ${sectionName}` : ""}
            </p>
          </div>
        </div>

        {/* Quick menu */}
        <div className="relative flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              className="absolute left-0 top-8 z-20 w-36 rounded-lg border bg-card shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {onDuplicate && (
                <button
                  onClick={() => { onDuplicate(); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
                >
                  <Copy className="h-3.5 w-3.5" /> تكرار
                </button>
              )}
              {onArchive && (
                <button
                  onClick={() => { onArchive(); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
                >
                  <Archive className="h-3.5 w-3.5" /> أرشفة
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => { onDelete(); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> حذف
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <FileQuestion className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium tabular-nums text-foreground">{pkg.questionCount || 0}</span>
          <span className="text-[10px] text-muted-foreground">سؤال</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium tabular-nums text-foreground">{pkg.resourceCount || 0}</span>
          <span className="text-[10px] text-muted-foreground">مورد</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">
            {pkg.updatedAt ? new Date(pkg.updatedAt).toLocaleDateString("ar-EG", { day: "2-digit", month: "short" }) : "—"}
          </span>
        </div>
      </div>

      {/* Footer: status + validation */}
      <div className="mt-3 flex items-center justify-between border-t pt-3">
        <Badge variant="outline" className={cn("text-[9px]", status.bg, status.color)}>
          {status.label}
        </Badge>
        <div className="flex items-center gap-2">
          {pkg.validationStatus === "valid" && (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          )}
          {pkg.validationStatus === "invalid" && (
            <AlertCircle className="h-3.5 w-3.5 text-red-500" />
          )}
          <span className="text-[9px] text-muted-foreground">v{pkg.version || 1}</span>
        </div>
      </div>
    </div>
  );
}
