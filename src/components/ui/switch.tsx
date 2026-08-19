"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * Switch — pixel-perfect toggle rebuilt from scratch.
 *
 * Track: 52×30px, fully rounded.
 * Thumb: 24×24px circle, 3px padding on all sides.
 * ON  → translateX(22px)  (52 - 24 - 3*2 = 22)
 * OFF → translateX(0)
 * Transition: 220ms ease on background-color + transform.
 *
 * All visual state is driven by inline styles + one injected
 * <style> block — no reliance on Tailwind data-variants.
 */

/** Track dimensions */
const TRACK_W = 52;
const TRACK_H = 30;
/** Thumb dimension (square) */
const THUMB = 24;
/** Inner padding (thumb inset from track edge) */
const PAD = 3;
/** Travel distance: TRACK_W - THUMB - PAD*2 */
const TRAVEL = TRACK_W - THUMB - PAD * 2; // = 22

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <>
      <SwitchPrimitive.Root
        data-slot="switch"
        dir="ltr"
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center rounded-full border-none outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        style={{
          width: `${TRACK_W}px`,
          height: `${TRACK_H}px`,
          padding: `${PAD}px`,
          backgroundColor: "rgb(209 213 219)", /* gray-300 unchecked (light) */
          boxSizing: "border-box",
          direction: "ltr", /* Force LTR so thumb starts at left, translateX moves right */
        }}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className="pointer-events-none block rounded-full bg-white transition-transform duration-200 ease-out"
          style={{
            width: `${THUMB}px`,
            height: `${THUMB}px`,
            transform: "translateX(0)",
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          }}
        />
      </SwitchPrimitive.Root>

      {/* Injected style — checked + dark mode overrides */}
      <style>{`
        /* CHECKED */
        [data-slot="switch"][data-state="checked"] {
          background-color: rgb(59 130 246) !important; /* blue-500 */
        }
        [data-slot="switch"][data-state="checked"] [data-slot="switch-thumb"] {
          transform: translateX(${TRAVEL}px) !important;
          background-color: rgb(255 255 255) !important;
        }

        /* DARK — unchecked */
        .dark [data-slot="switch"]:not([data-state="checked"]) {
          background-color: rgb(63 63 70) !important; /* zinc-800 */
        }
        /* DARK — checked */
        .dark [data-slot="switch"][data-state="checked"] {
          background-color: rgb(59 130 246) !important;
        }
        .dark [data-slot="switch"][data-state="checked"] [data-slot="switch-thumb"] {
          background-color: rgb(255 255 255) !important;
        }
      `}</style>
    </>
  )
}

export { Switch }
