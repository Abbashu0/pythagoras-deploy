import type { LucideIcon } from "lucide-react";
import type { StatusKey } from "../status/status-registry";

/* ============================================================================
   Navigation model
   ---------------------------------------------------------------------------
   The sidebar is entirely config-driven: it knows nothing about providers,
   models or Pi. A consuming app supplies `NavSection[]` and the shell renders
   groups, nesting, badges and states from that.

   Why this matters for Pythagoras specifically: the admin will keep growing
   (Agent 2, Second Brain, Improvement System, more subjects). Navigation has to
   be data, not JSX, or every new area becomes a component edit.
   ========================================================================== */

export interface NavBadge {
  /** Numeric count — pending reviews, dead-lettered jobs. */
  count?: number;
  /** A state that needs attention, rendered as a dot rather than a number. */
  status?: StatusKey;
  /** Short text badge — "قريبًا", "تجريبي". */
  label?: string;
  tone?: "neutral" | "accent" | "warning" | "danger" | "future";
}

export interface NavItem {
  key: string;
  label: string;
  /** Optional Latin secondary label for technical destinations. */
  labelEn?: string;
  href: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  /** Nested, data-driven children. */
  children?: NavItem[];
  /** Not yet available. Rendered visibly disabled with a reason. */
  disabled?: boolean;
  disabledReason?: string;
  /** Keyboard sequence shown in the command palette, e.g. "g p". */
  shortcut?: string;
  /** Extra search terms for the command palette. */
  keywords?: string[];
  /** Hide from the sidebar but keep it reachable from the palette. */
  hidden?: boolean;
}

export interface NavSection {
  key: string;
  /** Section label. Omit for the top-level group above the first divider. */
  label?: string;
  items: NavItem[];
  /** Collapsible section, collapsed by default. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

/** Flattens a nav tree into a lookup, used by breadcrumbs and the palette. */
export function flattenNav(sections: NavSection[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (items: NavItem[]) => {
    for (const item of items) {
      out.push(item);
      if (item.children) walk(item.children);
    }
  };
  for (const section of sections) walk(section.items);
  return out;
}

/** Resolves the active item and its ancestor chain for a pathname. */
export function resolveNavTrail(
  sections: NavSection[],
  pathname: string,
): { section: NavSection; trail: NavItem[] } | null {
  interface Match {
    section: NavSection;
    trail: NavItem[];
    length: number;
  }

  const candidates: Match[] = [];

  const matches = (href: string) =>
    Boolean(href) &&
    href !== "#" &&
    (pathname === href || pathname.startsWith(`${href}/`));

  for (const section of sections) {
    const walk = (items: NavItem[], ancestors: NavItem[]) => {
      for (const item of items) {
        const trail = [...ancestors, item];
        if (matches(item.href)) {
          candidates.push({ section, trail, length: item.href.length });
        }
        if (item.children?.length) walk(item.children, trail);
      }
    };
    walk(section.items, []);
  }

  if (candidates.length === 0) return null;

  // Longest href wins, so /lab/ai/models beats /lab/ai.
  candidates.sort((a, b) => b.length - a.length);
  const best = candidates[0];
  return { section: best.section, trail: best.trail };
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (!item.href || item.href === "#") return false;
  if (pathname === item.href) return true;
  if (pathname.startsWith(`${item.href}/`)) return true;
  return (item.children ?? []).some((c) => isNavItemActive(c, pathname));
}
