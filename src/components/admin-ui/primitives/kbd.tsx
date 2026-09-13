"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/* ============================================================================
   Kbd / Shortcut
   ---------------------------------------------------------------------------
   Keyboard hints always render left-to-right ("⌘ K", not "K ⌘") even inside
   an RTL row, because the glyph order encodes the physical chord.
   ========================================================================== */

const GLYPHS: Record<string, string> = {
  mod: "⌘",
  cmd: "⌘",
  meta: "⌘",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  enter: "↵",
  return: "↵",
  esc: "Esc",
  escape: "Esc",
  tab: "⇥",
  space: "Space",
  backspace: "⌫",
  delete: "⌦",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  slash: "/",
  comma: ",",
  period: ".",
};

/**
 * Platform detection for the modifier glyph. Read through
 * useSyncExternalStore so the server renders ⌘ deterministically and the client
 * corrects it during hydration without an effect-driven second render.
 */
const subscribeNoop = () => () => {};

function useIsApple() {
  return React.useSyncExternalStore(
    subscribeNoop,
    () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    () => true,
  );
}

export function Kbd({
  children,
  size = "md",
  className,
  ...props
}: React.ComponentPropsWithoutRef<"kbd"> & { size?: "sm" | "md" }) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        "inline-flex select-none items-center justify-center rounded-[4px] border border-border-subtle",
        "bg-inset font-sans font-medium text-fg-tertiary shadow-[inset_0_-1px_0_0_var(--border)]",
        size === "sm"
          ? "h-[16px] min-w-[16px] px-1 text-[10px]"
          : "h-[19px] min-w-[19px] px-1.5 text-2xs",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

/**
 * Shortcut — renders a chord string such as "mod+k" or "g p" into keycaps.
 * Space-separated segments are sequences; `+`-joined are simultaneous.
 */
export function Shortcut({
  keys,
  size = "md",
  className,
  muted = false,
}: {
  keys: string;
  size?: "sm" | "md";
  className?: string;
  muted?: boolean;
}) {
  const isApple = useIsApple();

  const render = (token: string) => {
    const lower = token.toLowerCase();
    if (lower === "mod") return isApple ? "⌘" : "Ctrl";
    if (lower === "alt") return isApple ? "⌥" : "Alt";
    return GLYPHS[lower] ?? token.toUpperCase();
  };

  const sequences = keys.trim().split(/\s+/);

  return (
    <span
      dir="ltr"
      className={cn(
        "inline-flex items-center gap-1",
        muted && "opacity-70",
        className,
      )}
    >
      {sequences.map((seq, i) => (
        <React.Fragment key={`${seq}-${i}`}>
          {i > 0 ? (
            <span className="px-px text-2xs text-fg-quaternary">ثم</span>
          ) : null}
          <span className="inline-flex items-center gap-[3px]">
            {seq.split("+").map((part) => (
              <Kbd key={part} size={size}>
                {render(part)}
              </Kbd>
            ))}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}
