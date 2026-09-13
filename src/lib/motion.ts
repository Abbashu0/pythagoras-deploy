/* ============================================================================
   Motion presets.
   Motion in this system exists to explain a transition — never to decorate.
   Durations sit between 120–240ms; travel is small (2–8px); scale changes stay
   above 0.97. Nothing loops except genuine progress indicators.
   ========================================================================== */

import type { Transition, Variants } from "framer-motion";

export const duration = {
  instant: 0,
  fast: 0.12,
  base: 0.16,
  medium: 0.2,
  slow: 0.24,
  slower: 0.32,
} as const;

export const easing = {
  out: [0.16, 0.84, 0.44, 1],
  in: [0.5, 0, 0.75, 0],
  inOut: [0.65, 0, 0.35, 1],
  emphasis: [0.32, 1.06, 0.55, 1],
} as const satisfies Record<string, [number, number, number, number]>;

export const transition = {
  fast: { duration: duration.fast, ease: easing.out },
  base: { duration: duration.base, ease: easing.out },
  medium: { duration: duration.medium, ease: easing.out },
  slow: { duration: duration.slow, ease: easing.out },
  exit: { duration: duration.fast, ease: easing.in },
  /** For layout / size changes where a spring reads better than a curve. */
  layout: { type: "spring", stiffness: 520, damping: 42, mass: 1 },
  /** Sidebar collapse, panel resize. */
  panel: { type: "spring", stiffness: 420, damping: 40, mass: 0.9 },
  /** Tab / segmented indicator travel. */
  indicator: { type: "spring", stiffness: 620, damping: 46, mass: 0.7 },
} as const satisfies Record<string, Transition>;

/* --- Reusable variant sets ------------------------------------------------ */

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transition.base },
  exit: { opacity: 0, transition: transition.exit },
};

/** Rows appearing in a list / table. */
export const rowEnter: Variants = {
  hidden: { opacity: 0, y: -4 },
  visible: { opacity: 1, y: 0, transition: transition.base },
  exit: { opacity: 0, y: -4, transition: transition.exit },
};

/** Content swapping inside a fixed-size container (tabs, state machines). */
export const swap: Variants = {
  hidden: { opacity: 0, y: 3 },
  visible: { opacity: 1, y: 0, transition: transition.medium },
  exit: { opacity: 0, y: -3, transition: transition.exit },
};

/** Bars that dock to the bottom of the viewport (pending changes bar). */
export const dockBottom: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: transition.medium },
  exit: { opacity: 0, y: 8, scale: 0.99, transition: transition.exit },
};

/** Inline status text replaced in place (saved / saving / failed). */
export const statusSwap: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: transition.fast },
  exit: { opacity: 0, y: -4, transition: { duration: duration.fast } },
};

/** Staggered reveal for small groups. Never used on more than ~8 items. */
export function staggerContainer(stagger = 0.03, delay = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren: delay },
    },
  };
}

/** Numeric counters and metric values ticking up on first paint. */
export const countUp: Transition = {
  duration: 0.55,
  ease: easing.out,
};

/** Progress bars completing — slightly slower so completion is legible. */
export const progressFill: Transition = {
  duration: 0.4,
  ease: easing.inOut,
};

/** Chart series drawing in on mount. Recharts consumes ms, not seconds. */
export const chartAnimationMs = 420;
export const chartAnimationEasing = "ease-out" as const;
