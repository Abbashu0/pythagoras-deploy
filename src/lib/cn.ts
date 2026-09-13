import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know about the custom scale keys introduced in
 * theme.css, otherwise `text-md` / `text-2xs` and the `h-control-*` group
 * would not deduplicate correctly against Tailwind's built-ins.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl"],
        },
      ],
      h: [
        {
          h: [
            "control-2xs",
            "control-xs",
            "control-sm",
            "control-md",
            "control-lg",
            "control-xl",
          ],
        },
      ],
      shadow: [{ shadow: ["xs", "sm", "md", "lg", "xl", "none"] }],
    },
  },
});

/** The single class-composition helper for the whole system. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
