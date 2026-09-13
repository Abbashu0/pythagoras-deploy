"use client";

import { cn } from "@/lib/cn";

/* ============================================================================
   Spinner
   ---------------------------------------------------------------------------
   A ring rather than a chasing dot: it reads as "working" without drawing the
   eye the way a bouncing element does. Sized in the same steps as icons so it
   can replace one without shifting layout.
   ========================================================================== */

const SIZES = {
  xs: "size-3 border-[1.5px]",
  sm: "size-3.5 border-[1.5px]",
  md: "size-4 border-2",
  lg: "size-5 border-2",
  xl: "size-7 border-[2.5px]",
} as const;

export function Spinner({
  size = "md",
  className,
  label,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  /** When provided the spinner announces itself; otherwise it is decorative. */
  label?: string;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className="inline-flex items-center gap-2"
    >
      <span
        className={cn(
          "inline-block shrink-0 animate-spin rounded-full motion-reduce:animate-[pyth-spin_1.6s_linear_infinite]",
          "border-current/25 border-t-current",
          SIZES[size],
          className,
        )}
        style={{ animationDuration: "0.7s" }}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** Full-region loader for panels that have no meaningful skeleton geometry. */
export function LoadingRegion({
  label = "جارٍ التحميل…",
  className,
  size = "lg",
}: {
  label?: string;
  className?: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 flex-col items-center justify-center gap-3 py-10 text-fg-tertiary",
        className,
      )}
    >
      <Spinner size={size} className="text-accent" />
      <p className="text-xs">{label}</p>
    </div>
  );
}

/** Three-dot inline indicator for streaming / thinking states. */
export function LoadingDots({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-[3px]", className)}
      aria-hidden
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 rounded-full bg-current opacity-40"
          style={{
            animation: "pyth-live-dot 1.1s var(--ease-in-out) infinite",
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}
