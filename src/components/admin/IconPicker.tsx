"use client";

/**
 * IconPicker — grid of all student-app icons, used by the Navigation,
 * Materials, and Tools managers to choose an icon for an item.
 *
 * Renders the full `APP_ICON_NAMES` set as a responsive grid of buttons.
 * The selected icon gets a primary-tinted ring + background. Clicking an
 * icon calls `onChange(name)` immediately — the parent uses this to
 * update its draft state and mark the editor dirty.
 *
 * Visual design:
 *   - Square buttons, `h-10 w-10`, rounded-md, hover lift.
 *   - Selected: `ring-2 ring-primary bg-primary/10 text-primary`.
 *   - Unselected: `text-muted-foreground hover:bg-muted`.
 *   - SVG glyphs come from `<AppIcon />` — same paths the student app
 *     renders, so what you pick is what students see.
 */

import { Check } from "lucide-react";
import { AppIcon, APP_ICON_NAMES } from "@/lib/admin/app-icons";

interface Props {
  /** Currently selected icon name (controlled). */
  value: string;
  /** Called with the new icon name when the user clicks a glyph. */
  onChange: (name: string) => void;
  /** Disable all buttons (e.g. while a save is in-flight). */
  disabled?: boolean;
}

export function IconPicker({ value, onChange, disabled }: Props) {
  return (
    <div
      className="grid grid-cols-6 gap-2 sm:grid-cols-8"
      role="radiogroup"
      aria-label="اختيار أيقونة"
    >
      {APP_ICON_NAMES.map((name) => {
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
  );
}
