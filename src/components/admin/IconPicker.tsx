"use client";

/**
 * IconPicker — searchable, categorized grid of all student-app icons.
 *
 * Features:
 *   - Search box (filter by name)
 *   - Category chips (الكل / تنقل / تعليم / أدوات / وقت / تواصل / وسائط /
 *     ملفات / أشخاص / حالة / مهام / متنوع / مواد دراسية)
 *   - Scrollable grid (max-height 320px)
 *   - Count badge showing X / total visible icons
 *   - Empty state when search returns no matches
 */

import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import {
  AppIcon,
  APP_ICON_NAMES,
  ICON_CATEGORIES,
} from "@/lib/admin/app-icons";

interface Props {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}

export function IconPicker({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const normalizedQuery = query.trim().toLowerCase().replace(/[-_]/g, "");

  const filteredCategories = useMemo(() => {
    const cats =
      activeCategory === "all"
        ? ICON_CATEGORIES
        : ICON_CATEGORIES.filter((c) => c.id === activeCategory);

    return cats
      .map((cat) => ({
        ...cat,
        iconNames: cat.iconNames.filter((name) => {
          if (!normalizedQuery) return true;
          const normalizedName = name.toLowerCase().replace(/[-_]/g, "");
          return normalizedName.includes(normalizedQuery);
        }),
      }))
      .filter((cat) => cat.iconNames.length > 0);
  }, [activeCategory, normalizedQuery]);

  const totalVisible = filteredCategories.reduce(
    (sum, cat) => sum + cat.iconNames.length,
    0
  );

  return (
    <div className="space-y-3">
      {/* ---------- Search + count ---------- */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن أيقونة (مثال: book, clock, play)…"
            disabled={disabled}
            className="h-8 w-full rounded-md border border-border bg-background pr-8 pl-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
            dir="rtl"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute left-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="مسح البحث"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <span className="flex-shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] tabular-nums text-muted-foreground">
          {totalVisible} / {APP_ICON_NAMES.length}
        </span>
      </div>

      {/* ---------- Category chips ---------- */}
      <div className="flex flex-wrap gap-1.5">
        <CategoryChip
          label="الكل"
          count={APP_ICON_NAMES.length}
          active={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
          disabled={disabled}
        />
        {ICON_CATEGORIES.map((cat) => (
          <CategoryChip
            key={cat.id}
            label={cat.label}
            count={cat.iconNames.length}
            active={activeCategory === cat.id}
            onClick={() => setActiveCategory(cat.id)}
            disabled={disabled}
          />
        ))}
      </div>

      {/* ---------- Grid (scrollable) ---------- */}
      <div
        className="max-h-[320px] space-y-4 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-3"
        role="radiogroup"
        aria-label="اختيار أيقونة"
      >
        {filteredCategories.length === 0 ? (
          <div className="grid place-items-center gap-2 py-8 text-center text-xs text-muted-foreground">
            <Search className="h-6 w-6 opacity-30" />
            لا توجد أيقونات مطابقة لـ «{query}»
          </div>
        ) : (
          filteredCategories.map((cat) => (
            <div key={cat.id} className="space-y-2">
              {!normalizedQuery && (
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat.label}
                  </h4>
                  <span className="text-[9px] tabular-nums text-muted-foreground/70">
                    {cat.iconNames.length}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                {cat.iconNames.map((name) => {
                  const isSelected = value === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={name}
                      title={name}
                      disabled={disabled}
                      onClick={() => onChange(name)}
                      className={`relative grid h-10 w-10 place-items-center rounded-md border transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/40"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
                      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <AppIcon name={name} className="h-5 w-5" />
                      {isSelected && (
                        <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface CategoryChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
  disabled,
}: CategoryChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-1 text-[9px] tabular-nums ${
          active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
