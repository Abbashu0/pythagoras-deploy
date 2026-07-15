"use client";

/**
 * FadeIntensitySettings
 * ----------------------
 * Slider-based editor for the global material-card fade intensity
 * (0–100%, default 72%).
 *
 * Mirrors the CarouselSettings pattern:
 *   - Local `draftPercent` state holds the working value (0–100).
 *   - The Save/Reset bar only appears when the draft differs from the
 *     committed `value` prop.
 *   - On Save, calls `onSave(draftPercent / 100)` — the store persists
 *     the decimal form (0–1) to the `pythagoras-admin-materials-fade`
 *     localStorage key.
 *   - Shows a green "تم حفظ الإعدادات" success banner for 2s.
 *
 * The fade alpha controls the bottom-up black gradient overlay on each
 * material card. Higher = darker bottom, more legible white title text
 * over busy images. The student app reads this same value via
 * `getMaterialsFadeIntensity()` in `data.js`.
 *
 * Tick marks at 0, 10, 20, …, 100% are positioned with the same
 * pixel-perfect formula CarouselSettings uses (`left: calc(pct% -
 * pct*0.16px + 8px)`).
 */

import { useCallback, useEffect, useState } from "react";
import { Save, RotateCcw, Check } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

interface Props {
  /** Current committed fade intensity (0–1). */
  value: number;
  /** Called when the user clicks Save — receives the new value (0–1). */
  onSave: (value: number) => void;
}

const MIN_PERCENT = 0;
const MAX_PERCENT = 100;
const STEP = 1;
const SUCCESS_DISPLAY_MS = 2000;

export function FadeIntensitySettings({ value, onSave }: Props) {
  const committedPercent = Math.round(value * 100);
  const [draftPercent, setDraftPercent] = useState<number>(committedPercent);
  const [saved, setSaved] = useState(false);

  // Re-sync draft when the committed value changes externally.
  useEffect(() => {
    setDraftPercent(committedPercent);
  }, [committedPercent]);

  const hasChanges = draftPercent !== committedPercent;

  const handleSave = useCallback(() => {
    onSave(draftPercent / 100);
    setSaved(true);
    window.setTimeout(() => setSaved(false), SUCCESS_DISPLAY_MS);
  }, [draftPercent, onSave]);

  const handleReset = useCallback(() => {
    setDraftPercent(committedPercent);
  }, [committedPercent]);

  // Tick marks every 10% — 0, 10, 20, …, 100.
  const ticks = Array.from(
    { length: Math.floor((MAX_PERCENT - MIN_PERCENT) / 10) + 1 },
    (_, i) => {
      const pct10 = MIN_PERCENT + i * 10;
      const pct = (i / (Math.floor((MAX_PERCENT - MIN_PERCENT) / 10))) * 100;
      return { value: pct10, pct };
    }
  );

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            شدة تظليل بطاقات المواد
          </h3>
          <p className="text-xs text-muted-foreground">
            تتحكم بدرجة التدرج الأسود أسفل كل بطاقة — كلما زادت، زاد وضوح
            العنوان الأبيض فوق الصور المزدحمة.
          </p>
        </div>
        {/* Big number display — purple when there are unsaved changes */}
        <div className="flex items-baseline gap-1">
          <span
            className={`text-2xl font-bold tabular-nums transition-colors ${
              hasChanges
                ? "text-purple-600 dark:text-purple-400"
                : "text-foreground"
            }`}
          >
            {draftPercent}
          </span>
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>

      {/* Slider — Radix via shadcn wrapper */}
      <div className="px-2 pb-1 pt-3">
        <Slider
          value={[draftPercent]}
          min={MIN_PERCENT}
          max={MAX_PERCENT}
          step={STEP}
          onValueChange={(v) => {
            if (typeof v[0] === "number") setDraftPercent(v[0]);
          }}
          aria-label="شدة تظليل بطاقات المواد"
        />

        {/* Tick marks — positioned to align with each 10% step */}
        <div className="relative mt-2 h-4 select-none" dir="ltr">
          {ticks.map(({ value: tickValue, pct }) => (
            <span
              key={tickValue}
              className="absolute top-0 -translate-x-1/2 text-[9px] tabular-nums text-muted-foreground"
              style={{
                left: `calc(${pct}% - ${pct * 0.16}px + 8px)`,
              }}
            >
              <span
                className={`mx-auto mb-0.5 block h-1.5 w-px ${
                  tickValue === draftPercent ||
                  (draftPercent > tickValue - 5 && draftPercent < tickValue + 5)
                    ? "bg-purple-500"
                    : "bg-border"
                }`}
              />
              {tickValue}
            </span>
          ))}
        </div>
      </div>

      {/* Success message */}
      {saved && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" />
          تم حفظ الإعدادات
        </div>
      )}

      {/* Save / Reset bar — only visible when there are unsaved changes */}
      {hasChanges && (
        <div className="admin-save-bar mt-3 flex items-center justify-between gap-3 rounded-lg border bg-background/50 p-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
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
            حفظ
          </Button>
        </div>
      )}
    </div>
  );
}
