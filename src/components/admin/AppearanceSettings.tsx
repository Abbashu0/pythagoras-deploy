"use client";

/**
 * AppearanceSettings
 * --------------------
 * Comprehensive slider-based editor for the four global material-card
 * appearance settings:
 *
 *   1. Card Height              (160–340 px, step 10, default 213)
 *   2. Fade Intensity           (0–100%,   step 5,  default 72%)
 *   3. Global Text Scale        (80–140%,  step 5,  default 100%)
 *   4. Text Vertical Position   (-100..+100, step 5, default 0)
 *
 * Controlled component pattern (parent owns the draft):
 *   - `committed` — the values currently saved in the store.
 *   - `draft`     — the working values being dragged (null = no changes
 *                   yet, the parent falls back to `committed`).
 *   - `onDraftChange` fires on every slider drag → parent uses the
 *     latest draft to render the live `MaterialCardPreview`.
 *   - `onSave`    commits the draft to the store (parent calls
 *                  `store.setMaterialsSettings(draft)` and shows a toast).
 *   - `onReset`   discards the draft (parent sets it back to null).
 *
 * The Save/Reset bar only appears when the draft differs from the
 * committed values. A green "تم حفظ إعدادات المظهر" banner shows for
 * 2s after Save.
 *
 * Each slider has tick marks positioned with the same pixel-perfect
 * formula CarouselSettings uses (`left: calc(pct% - pct*0.16px + 8px)`).
 */

import { useCallback, useState } from "react";
import { Save, RotateCcw, Check, SlidersHorizontal } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { MaterialsSettings } from "@/lib/admin/content-store";

interface Props {
  /** Currently-saved settings from the store. */
  committed: MaterialsSettings;
  /** Working draft (null when there are no unsaved changes). */
  draft: MaterialsSettings | null;
  /** Fires whenever a slider moves — parent updates the live preview. */
  onDraftChange: (next: MaterialsSettings) => void;
  /** Commits the draft to the store. */
  onSave: () => void;
  /** Discards the draft and falls back to `committed`. */
  onReset: () => void;
}

const SUCCESS_DISPLAY_MS = 2000;

/** Per-slider config — converts between stored value and slider value. */
interface SliderConfig {
  key: keyof MaterialsSettings;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  /** Convert stored value → slider value (e.g. 0.72 → 72). */
  toSlider: (v: number) => number;
  /** Convert slider value → stored value (e.g. 72 → 0.72). */
  toStored: (v: number) => number;
  /** Format the slider value for the big number display. */
  format: (v: number) => string;
  /** Tick-mark interval (in slider units). */
  tickStep: number;
}

const SLIDERS: SliderConfig[] = [
  {
    key: "cardHeight",
    label: "ارتفاع البطاقة",
    description: "ارتفاع كل بطاقة مادة بالبكسل.",
    min: 160,
    max: 340,
    step: 10,
    toSlider: (v) => v,
    toStored: (v) => v,
    format: (v) => `${v}px`,
    tickStep: 30,
  },
  {
    key: "fadeIntensity",
    label: "شدة التعتيم",
    description: "تدرج أسود أسفل البطاقة لتحسين وضوح العنوان فوق الصور.",
    min: 0,
    max: 100,
    step: 5,
    toSlider: (v) => Math.round(v * 100),
    toStored: (v) => v / 100,
    format: (v) => `${v}%`,
    tickStep: 10,
  },
  {
    key: "textScale",
    label: "حجم النص",
    description: "تكبير أو تصغير خط العنوان بشكل موحّد.",
    min: 80,
    max: 140,
    step: 5,
    toSlider: (v) => Math.round(v * 100),
    toStored: (v) => v / 100,
    format: (v) => `${v}%`,
    tickStep: 10,
  },
  {
    key: "textVerticalPosition",
    label: "الموضع العمودي للنص",
    description: "تحريك العنوان لأعلى (+) أو لأسفل (−) داخل البطاقة.",
    min: -100,
    max: 100,
    step: 5,
    toSlider: (v) => v,
    toStored: (v) => v,
    format: (v) => (v > 0 ? `+${v}` : `${v}`),
    tickStep: 50,
  },
];

/** Build the tick-mark positions for a given slider config. */
function buildTicks(cfg: SliderConfig): number[] {
  const ticks: number[] = [];
  for (let v = cfg.min; v <= cfg.max + 1e-6; v += cfg.tickStep) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

export function AppearanceSettings({
  committed,
  draft,
  onDraftChange,
  onSave,
  onReset,
}: Props) {
  const [saved, setSaved] = useState(false);

  // Effective values: draft if there are unsaved changes, otherwise committed.
  const effective: MaterialsSettings = draft ?? committed;

  const hasChanges =
    draft !== null &&
    (draft.cardHeight !== committed.cardHeight ||
      draft.fadeIntensity !== committed.fadeIntensity ||
      draft.textScale !== committed.textScale ||
      draft.textVerticalPosition !== committed.textVerticalPosition);

  const handleFieldChange = useCallback(
    (cfg: SliderConfig, sliderValue: number) => {
      const storedValue = cfg.toStored(sliderValue);
      onDraftChange({ ...effective, [cfg.key]: storedValue });
    },
    [effective, onDraftChange]
  );

  const handleSave = useCallback(() => {
    onSave();
    setSaved(true);
    window.setTimeout(() => setSaved(false), SUCCESS_DISPLAY_MS);
  }, [onSave]);

  return (
    <div className="rounded-xl border bg-card p-4">
      {/* ---------- Header ---------- */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              إعدادات المظهر
            </h3>
            <p className="text-xs text-muted-foreground">
              تنطبق على جميع بطاقات المواد في صفحة الطلاب
            </p>
          </div>
        </div>
        {hasChanges && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            تغييرات غير محفوظة
          </span>
        )}
      </div>

      {/* ---------- Sliders ---------- */}
      <div className="space-y-5">
        {SLIDERS.map((cfg) => {
          const sliderValue = cfg.toSlider(effective[cfg.key]);
          const committedSlider = cfg.toSlider(committed[cfg.key]);
          const changed = sliderValue !== committedSlider;
          const ticks = buildTicks(cfg);
          const range = cfg.max - cfg.min;

          return (
            <div key={cfg.key}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className="text-xs font-semibold text-foreground">
                    {cfg.label}
                  </label>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {cfg.description}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-baseline gap-1">
                  <span
                    className={`text-lg font-bold tabular-nums transition-colors ${
                      changed
                        ? "text-purple-600 dark:text-purple-400"
                        : "text-foreground"
                    }`}
                  >
                    {cfg.format(sliderValue)}
                  </span>
                </div>
              </div>

              <div className="px-1 pb-1 pt-2">
                <Slider
                  value={[sliderValue]}
                  min={cfg.min}
                  max={cfg.max}
                  step={cfg.step}
                  onValueChange={(v) => {
                    if (typeof v[0] === "number") {
                      handleFieldChange(cfg, v[0]);
                    }
                  }}
                  aria-label={cfg.label}
                />

                {/* Tick marks */}
                <div className="relative mt-2 h-4 select-none" dir="ltr">
                  {ticks.map((tickValue) => {
                    const pct = ((tickValue - cfg.min) / range) * 100;
                    const isHighlight =
                      tickValue === sliderValue ||
                      (sliderValue > tickValue - cfg.step / 2 &&
                        sliderValue < tickValue + cfg.step / 2);
                    return (
                      <span
                        key={tickValue}
                        className="absolute top-0 -translate-x-1/2 text-[9px] tabular-nums text-muted-foreground"
                        style={{
                          left: `calc(${pct}% - ${pct * 0.16}px + 8px)`,
                        }}
                      >
                        <span
                          className={`mx-auto mb-0.5 block h-1.5 w-px ${
                            isHighlight ? "bg-purple-500" : "bg-border"
                          }`}
                        />
                        {tickValue}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------- Success message ---------- */}
      {saved && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" />
          تم حفظ إعدادات المظهر
        </div>
      )}

      {/* ---------- Save / Reset bar ---------- */}
      {hasChanges && (
        <div className="admin-save-bar mt-4 flex items-center justify-between gap-3 rounded-lg border bg-background/50 p-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            استعادة
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            className="gap-1.5 text-xs"
          >
            <Save className="h-3.5 w-3.5" />
            حفظ الإعدادات
          </Button>
        </div>
      )}
    </div>
  );
}
