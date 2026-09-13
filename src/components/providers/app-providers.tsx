"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Direction from "@radix-ui/react-direction";
import { Toaster } from "@/components/admin-ui/feedback/toaster";

/**
 * Single provider stack for the whole lab.
 *
 * - `Direction.Provider dir="rtl"` makes every Radix primitive resolve its
 *   own start/end logic in RTL (menus, sliders, tabs, scroll areas).
 * - `MotionConfig reducedMotion="user"` makes Framer Motion honour the OS
 *   preference without every component checking it.
 * - Tooltips share one provider so hover delay behaves consistently.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      storageKey="pyth-admin-theme"
    >
      <Direction.Provider dir="rtl">
        <MotionConfig reducedMotion="user">
          <Tooltip.Provider delayDuration={320} skipDelayDuration={120}>
            {children}
            <Toaster />
          </Tooltip.Provider>
        </MotionConfig>
      </Direction.Provider>
    </ThemeProvider>
  );
}
