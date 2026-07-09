"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * Switch — fixed version that uses inline styles for the checked/unchecked
 * states instead of relying on Tailwind's data-[state=...] variants which
 * may not compile correctly in all Tailwind v4 setups.
 *
 * Visual spec:
 *   - Track: 44×24px, rounded-full, border-2 transparent
 *   - Checked: blue background (#3b82f6), thumb translated right
 *   - Unchecked: gray background, thumb at left
 *   - Thumb: 20×20px, white, rounded-full, shadow
 *   - Smooth 200ms transition on both bg and transform
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{
        // Default (unchecked) — gray. Will be overridden by checked style below.
        backgroundColor: "rgb(226 232 240)", // slate-200
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200"
        style={{
          transform: "translateX(0)",
        }}
      />
      {/* Override styles when checked — use a style tag that targets data-state */}
      <style>{`
        [data-slot="switch"][data-state="checked"] {
          background-color: rgb(59 130 246) !important; /* blue-500 */
        }
        [data-slot="switch"][data-state="checked"] [data-slot="switch-thumb"] {
          transform: translateX(20px) !important;
        }
        .dark [data-slot="switch"][data-state="checked"] {
          background-color: rgb(59 130 246) !important;
        }
        .dark [data-slot="switch"][data-state="checked"] [data-slot="switch-thumb"] {
          background-color: white !important;
        }
        .dark [data-slot="switch"]:not([data-state="checked"]) {
          background-color: rgb(39 39 42) !important; /* zinc-800 */
        }
      `}</style>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
