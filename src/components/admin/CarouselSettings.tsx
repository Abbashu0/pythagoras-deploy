"use client";

/**
 * CarouselSettings
 * -----------------
 * Slider-based editor for the carousel auto-slide interval (5–30 seconds).
 *
 * Implements the same pending-save pattern as BannerEditor:
 *   - Local `draftSeconds` state holds the working value.
 *   - The Save/Reset bar only appears when the draft differs from the
 *     committed `interval` prop.
 *   - On Save, calls `onSave(draftSeconds * 1000)` (ms).
 *   - Shows a green "تم حفظ الإعدادات" success banner for 2s after save.
 *
 * The slider has tick marks at every integer second (5, 6, ..., 30). Each
 * tick is positioned with a pixel-perfect formula:
 *
 *     left: calc(${pct}% - ${pct * 0.16}px + 8px)
 *
 * Where `pct` = (sec - MIN) / (MAX - MIN) * 100. The `pct * 0.16` term
 * compensates for the thumb's width (16px) so the tick aligns with the
 * thumb's CENTER, not its left edge. The `+ 8px` centers the 1px tick line
 * on the thumb's center when pct=0 (so the first tick isn't clipped at
 * the left edge of the slider track).
 */

import { useCallback, useEffect, useState } from "react";
import { Save, RotateCcw, Check } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

interface Props {
  /** Current committed interval (ms). */
  interval: number;
  /** Called when the user clicks Save — receives the new interval in ms. */
  onSave: (ms: number) => void;
}

const MIN_SECONDS = 5;
const MAX_SECONDS = 30;
const SUCCESS_DISPLAY_MS = 2000;

export function CarouselSettings({ interval, onSave }: Props) {
  const committedSeconds = Math.round(interval / 1000);
  const [draftSeconds, setDraftSeconds] = useState<number>(committedSeconds);
  const [saved, setSaved] = useState(false);

  // Re-sync draft when the committed interval changes externally.
  useEffect(() => {
    setDraftSeconds(committedSeconds);
  }, [committedSeconds]);

  const hasChanges = draftSeconds !== committedSeconds;

  const handleSave = useCallback(() => {
    onSave(draftSeconds * 1000);
    setSaved(true);
    window.setTimeout(() => setSaved(false), SUCCESS_DISPLAY_MS);
  }, [draftSeconds, onSave]);

  const handleReset = useCallback(() => {
    setDraftSeconds(committedSeconds);
  }, [committedSeconds]);

  // Build tick mark positions for every integer second in range.
  const ticks = Array.from(
    { length: MAX_SECONDS - MIN_SECONDS + 1 },
    (_, i) => {
      const sec = MIN_SECONDS + i;
      const pct = (i / (MAX_SECONDS - MIN_SECONDS)) * 100;
      return { sec, pct };
    }
  );

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            إعدادات الكاروسيل
          </h3>
          <p className="text-xs text-muted-foreground">
            مدة عرض كل بانر قبل الانتقال للتالي
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
            {draftSeconds}
          </span>
          <span className="text-sm text-muted-foreground">ثانية</span>
        </div>
      </div>

      {/* Slider — Radix via shadcn wrapper */}
      <div className="px-2 pb-1 pt-3">
        <Slider
          value={[draftSeconds]}
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          step={1}
          onValueChange={(v) => {
            if (typeof v[0] === "number") setDraftSeconds(v[0]);
          }}
          aria-label="مدة عرض البانر بالثواني"
        />

        {/* Tick marks — positioned to align with each integer second */}
        <div className="relative mt-2 h-4 select-none" dir="ltr">
          {ticks.map(({ sec, pct }) => (
            <span
              key={sec}
              className="absolute top-0 -translate-x-1/2 text-[9px] tabular-nums text-muted-foreground"
              style={{
                left: `calc(${pct}% - ${pct * 0.16}px + 8px)`,
              }}
            >
              <span
                className={`mx-auto mb-0.5 block h-1.5 w-px ${
                  sec === draftSeconds
                    ? "bg-purple-500"
                    : "bg-border"
                }`}
              />
              {sec}
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
