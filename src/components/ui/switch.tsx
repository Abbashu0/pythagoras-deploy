"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

/**
 * Switch — clean, from-scratch implementation.
 *
 * No Tailwind data-variants. All visual states are controlled via
 * inline styles + a single injected <style> block so there's zero
 * ambiguity about what renders.
 *
 * Visual spec:
 *   Track: 36×20px (compact, not stretched), rounded-full
 *   Thumb: 14×14px circle, white, with subtle shadow
 *   Checked: blue track (#3b82f6), thumb translated right (18px)
 *   Unchecked: gray track (#d1d5db in light / #3f3f46 in dark), thumb at left (2px)
 *   Transition: 200ms on background-color and transform
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <>
      <SwitchPrimitive.Root
        data-slot="switch"
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        style={{
          width: "36px",
          height: "20px",
          padding: "0",
          backgroundColor: "rgb(209 213 219)", /* gray-300 (unchecked, light) */
        }}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className="pointer-events-none block rounded-full bg-white shadow-md transition-transform duration-200"
          style={{
            width: "14px",
            height: "14px",
            margin: "0 2px",
            transform: "translateX(0)",
          }}
        />
      </SwitchPrimitive.Root>

      {/* Injected style block — overrides for checked + dark mode */}
      <style>{`
        /* CHECKED state */
        [data-slot="switch"][data-state="checked"] {
          background-color: rgb(59 130 246) !important;
        }
        [data-slot="switch"][data-state="checked"] [data-slot="switch-thumb"] {
          transform: translateX(16px) !important;
        }

        /* DARK mode */
        .dark [data-slot="switch"]:not([data-state="checked"]) {
          background-color: rgb(63 63 70) !important;
        }
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
