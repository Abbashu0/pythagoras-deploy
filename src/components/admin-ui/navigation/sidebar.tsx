"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Star,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { allowAdminNavigation } from "@/lib/admin-navigation-guard";
import { transition } from "@/lib/motion";
import { usePersistentState } from "@/lib/hooks";
import { Tooltip } from "../primitives/tooltip";
import { ScrollArea } from "../primitives/scroll-area";
import { CountBadge, StatusDot } from "../status/status-badge";
import { IconButton } from "../primitives/button";
import { Shortcut } from "../primitives/kbd";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "../overlays/menu";
import {
  flattenNav,
  isNavItemActive,
  resolveNavTrail,
  type NavBadge,
  type NavItem,
  type NavSection,
} from "./nav-config";

/* ============================================================================
   Sidebar
   ---------------------------------------------------------------------------
   Persistent, collapsible, config-driven. It is the operator's map of the
   platform, so it optimises for *recognition over recall*: section labels stay
   visible, the active trail is unambiguous, and counts that need attention
   surface without a red-alert aesthetic.

   Collapsed mode is a real mode, not a squeeze: labels are replaced by tooltips,
   nested groups become flyouts, and the rail stays exactly 56px so the content
   area's width is predictable.

   Pinning exists because an operator working on the AI platform for a week
   should not scroll past المحتوى every time.
   ========================================================================== */

interface SidebarContextValue {
  collapsed: boolean;
  pinned: string[];
  togglePin: (key: string) => void;
  pathname: string;
  currentItemKey: string | null;
}

const SidebarContext = React.createContext<SidebarContextValue>({
  collapsed: false,
  pinned: [],
  togglePin: () => {},
  pathname: "",
  currentItemKey: null,
});

const NAV_GROUP_HEADER_CLASS =
  "flex w-full items-center gap-1 rounded-[5px] px-2 py-1 text-start transition-colors hover:bg-hover";

export interface SidebarProps {
  sections: NavSection[];
  pathname: string;
  /** Product mark / workspace switcher at the top. */
  header?: React.ReactNode;
  /** Account, theme toggle, help at the bottom. */
  footer?: React.ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  /** Enable pin/favourite affordances. */
  pinnable?: boolean;
}

export function Sidebar({
  sections,
  pathname,
  header,
  footer,
  collapsed: collapsedProp,
  onCollapsedChange,
  className,
  pinnable = true,
}: SidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = usePersistentState(
    "pyth-sidebar-collapsed",
    false,
  );
  const collapsed = collapsedProp ?? internalCollapsed;
  const setCollapsed = (v: boolean) => {
    setInternalCollapsed(v);
    onCollapsedChange?.(v);
  };

  const [pinned, setPinned] = usePersistentState<string[]>(
    "pyth-sidebar-pinned",
    [],
  );

  const togglePin = React.useCallback(
    (key: string) =>
      setPinned((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
      ),
    [setPinned],
  );

  const allItems = React.useMemo(
    () => sections.flatMap((section) => flattenNav([section])),
    [sections],
  );
  const pinnedItems = React.useMemo(
    () => pinned.map((k) => allItems.find((i) => i.key === k)).filter(Boolean) as NavItem[],
    [pinned, allItems],
  );

  const ctx = React.useMemo(
    () => ({
      collapsed,
      pinned,
      togglePin: pinnable ? togglePin : () => {},
      pathname,
      currentItemKey: resolveNavTrail(sections, pathname)?.trail.at(-1)?.key ?? null,
    }),
    [collapsed, pinned, togglePin, pathname, pinnable, sections],
  );

  return (
    <SidebarContext.Provider value={ctx}>
      <motion.aside
        animate={{
          width: collapsed
            ? "var(--sidebar-w-collapsed)"
            : "var(--sidebar-w)",
        }}
        initial={false}
        transition={transition.panel}
        data-collapsed={collapsed || undefined}
        className={cn(
          "z-[var(--z-sidebar)] flex h-dvh shrink-0 flex-col border-e border-border bg-surface",
          className,
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex h-topbar shrink-0 items-center gap-2 border-b border-border",
            collapsed ? "justify-center px-2" : "px-3",
          )}
        >
          {header}
        </div>

        {/* Navigation */}
        <ScrollArea className="min-h-0 flex-1" viewportClassName="px-2 py-2.5">
          {pinnedItems.length > 0 && !collapsed ? (
            <div className="mb-2">
              <SectionLabel collapsed={collapsed} icon={<Star className="size-3" aria-hidden />}>
                مثبّت
              </SectionLabel>
              <ul className="space-y-px">
                {pinnedItems.map((item) => (
                  <li key={`pin-${item.key}`}>
                    <NavRow item={item} depth={0} />
                  </li>
                ))}
              </ul>
              <div className="my-2 h-px bg-separator" />
            </div>
          ) : null}

          {sections.map((section, si) => (
            <SectionBlock
              key={section.key}
              section={section}
              isFirst={si === 0}
            />
          ))}
        </ScrollArea>

        {/* Footer */}
        <div
          className={cn(
            "shrink-0 border-t border-border",
            collapsed ? "px-2 py-2" : "px-2 py-2",
          )}
        >
          {footer}
          <div className={cn("mt-1 flex", collapsed ? "justify-center" : "justify-start")}>
            <Tooltip
              content={
                <span className="flex items-center gap-2">
                  {collapsed ? "توسيع الشريط" : "تصغير الشريط"}
                  <Shortcut keys="mod+b" size="sm" />
                </span>
              }
              side={collapsed ? "left" : "top"}
            >
              <IconButton
                label={collapsed ? "توسيع الشريط الجانبي" : "تصغير الشريط الجانبي"}
                size="sm"
                variant="ghost"
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? (
                  <PanelRightOpen aria-hidden />
                ) : (
                  <PanelRightClose aria-hidden />
                )}
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </motion.aside>
    </SidebarContext.Provider>
  );
}

/* ---------------------------------------------------------------------------
   Section
   ------------------------------------------------------------------------ */

function useNavDisclosure(
  storageKey: string,
  defaultOpen: boolean,
  containsActive: boolean,
  pathname: string,
) {
  const [open, setOpen] = usePersistentState(storageKey, defaultOpen);
  const [collapsedAtPath, setCollapsedAtPath] = React.useState<string | null>(null);
  // Reveal a newly visited route, while allowing its ancestors to be folded
  // explicitly without changing the current page.
  const expanded = open || (containsActive && collapsedAtPath !== pathname);
  const toggle = () => {
    setOpen(!expanded);
    setCollapsedAtPath(expanded ? pathname : null);
  };
  return [expanded, toggle] as const;
}

function SectionBlock({
  section,
  isFirst,
}: {
  section: NavSection;
  isFirst: boolean;
}) {
  const { collapsed, pathname } = React.useContext(SidebarContext);
  const containsActive = section.items.some((i) => isNavItemActive(i, pathname));
  const [sectionExpanded, toggleSection] = useNavDisclosure(
    `pyth-nav-section:${section.key}`,
    !(section.defaultCollapsed ?? false),
    containsActive,
    pathname,
  );
  const expanded = collapsed || !section.collapsible || sectionExpanded;
  const childrenId = React.useId();

  const visible = section.items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;

  return (
    <div className={cn(!isFirst && "mt-3")}>
      {section.label ? (
        section.collapsible ? (
          <button
            type="button"
            id={`${childrenId}-trigger`}
            onClick={toggleSection}
            aria-expanded={expanded}
            aria-controls={childrenId}
            className={cn(
              "group/sec",
              NAV_GROUP_HEADER_CLASS,
              collapsed && "sr-only",
            )}
          >
            <span className="eyebrow flex-1">{section.label}</span>
            <ChevronDown
              className={cn(
                "size-3 text-fg-quaternary transition-transform duration-[var(--dur-base)]",
                !expanded && "-rotate-90 rtl:rotate-90",
              )}
              aria-hidden
            />
          </button>
        ) : (
          <SectionLabel collapsed={collapsed}>{section.label}</SectionLabel>
        )
      ) : null}

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.ul
            id={childrenId}
            aria-labelledby={section.collapsible && section.label ? `${childrenId}-trigger` : undefined}
            initial={section.collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition.base}
            className={cn(
              "space-y-px overflow-hidden",
              section.collapsible && section.label && !collapsed && "ms-3 border-s border-border ps-2",
            )}
          >
            {visible.map((item) => (
              <li key={item.key} className="relative">
                {section.collapsible && section.label && !collapsed ? (
                  <span aria-hidden className={cn(
                    "absolute start-[-0.5rem] h-px w-2 bg-border",
                    item.children?.length ? "top-3" : "top-4",
                  )} />
                ) : null}
                <NavRow item={item} depth={0} />
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SectionLabel({
  children,
  collapsed,
  icon,
}: {
  children: React.ReactNode;
  collapsed: boolean;
  icon?: React.ReactNode;
}) {
  if (collapsed) {
    return <div className="mx-auto my-2 h-px w-6 bg-separator" aria-hidden />;
  }
  return (
    <div className="eyebrow flex items-center gap-1.5 px-2 pb-1 pt-1">
      {icon}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Rows
   ------------------------------------------------------------------------ */

function NavRow({ item, depth }: { item: NavItem; depth: number }) {
  const { collapsed, pinned, togglePin, pathname, currentItemKey } =
    React.useContext(SidebarContext);
  const active = isNavItemActive(item, pathname);
  const hasChildren = (item.children?.length ?? 0) > 0;
  const groupHeader = hasChildren && !collapsed;
  const selected = !hasChildren && currentItemKey === item.key;
  const [groupExpanded, toggleGroup] = useNavDisclosure(
    `pyth-nav-group:${item.key}`,
    false,
    active,
    pathname,
  );
  const expanded = hasChildren && groupExpanded;
  const childrenId = React.useId();

  const Icon = item.icon;
  const isPinned = pinned.includes(item.key);

  const body = (
    <>
      {!groupHeader && (Icon ? (
        <Icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            selected ? "text-accent-text" : "text-fg-tertiary",
          )}
          aria-hidden
        />
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      ))}

      {!collapsed ? (
        <>
          <span className={cn("min-w-0 flex-1 truncate", groupHeader && "eyebrow")}>{item.label}</span>
          <BadgeSlot badge={item.badge} disabled={item.disabled} />
          {hasChildren ? (
            <ChevronDown
              className={cn(
                "size-3 shrink-0 text-fg-quaternary transition-transform duration-[var(--dur-base)]",
                !expanded && "-rotate-90 rtl:rotate-90",
              )}
              aria-hidden
            />
          ) : null}
        </>
      ) : item.badge?.count ? (
        <span
          aria-hidden
          className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-accent"
        />
      ) : item.badge?.status ? (
        <span className="absolute end-1 top-1">
          <StatusDot status={item.badge.status} size="sm" />
        </span>
      ) : null}
    </>
  );

  const rowClass = cn(
    "group/nav relative",
    groupHeader
      ? NAV_GROUP_HEADER_CLASS
      : "flex w-full items-center gap-2.5 rounded-md text-start text-sm font-medium transition-colors duration-[var(--dur-fast)]",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]",
    !groupHeader && (collapsed ? "h-9 justify-center px-0" : "h-8 px-2"),
    depth > 0 && !collapsed && !hasChildren && "h-[30px]",
    item.disabled
      ? "cursor-not-allowed text-disabled-fg"
      : groupHeader
        ? undefined
        : selected
        ? "bg-selected text-fg"
        : active
          ? "text-fg hover:bg-hover"
          : "text-fg-secondary hover:bg-hover hover:text-fg",
  );

  const rowNode =
    item.disabled || item.href === "#" ? (
      <span className={rowClass} aria-disabled title={item.disabledReason}>
        {body}
      </span>
    ) : collapsed && hasChildren ? (
      <Menu modal={false}>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={item.label}
            aria-haspopup="menu"
            className={rowClass}
          >
            {body}
          </button>
        </MenuTrigger>
        <MenuContent side="left" align="start" aria-label={item.label}>
          <MenuLabel>{item.label}</MenuLabel>
          <CollapsedNavItems items={item.children ?? []} />
        </MenuContent>
      </Menu>
    ) : hasChildren ? (
      <button
        type="button"
        id={`${childrenId}-trigger`}
        onClick={toggleGroup}
        className={rowClass}
        aria-expanded={expanded}
        aria-controls={childrenId}
      >
        {body}
      </button>
    ) : (
      <Link
        href={item.href}
        className={rowClass}
        aria-current={selected ? "page" : undefined}
      >
        {body}
      </Link>
    );

  const wrapped = collapsed && !hasChildren ? (
    <Tooltip
      side="left"
      content={
        <span className="flex items-center gap-2">
          <span>{item.label}</span>
          {item.badge?.count ? (
            <CountBadge value={item.badge.count} tone="accent" />
          ) : null}
          {item.disabled && item.disabledReason ? (
            <span className="text-fg-quaternary">· {item.disabledReason}</span>
          ) : null}
        </span>
      }
    >
      {rowNode}
    </Tooltip>
  ) : (
    rowNode
  );

  return (
    <>
      <div className="group/wrap relative">
        {/* Only the current destination receives a marker; ancestors are groups. */}
        {selected && !collapsed ? (
          <span
            aria-hidden
            className="absolute inset-y-1 start-0 z-10 w-[2px] rounded-full bg-accent"
          />
        ) : null}
        {wrapped}
        {!collapsed && !hasChildren && !item.disabled && item.href !== "#" ? (
          <button
            type="button"
            aria-label={isPinned ? `إزالة ${item.label} من المثبّت` : `تثبيت ${item.label}`}
            onClick={(e) => {
              e.preventDefault();
              togglePin(item.key);
            }}
            className={cn(
              "absolute end-1 top-1/2 -translate-y-1/2 rounded-[4px] p-1 text-fg-quaternary",
              "opacity-0 transition-opacity hover:bg-hover-strong hover:text-fg-secondary",
              "focus-visible:opacity-100 group-hover/wrap:opacity-100",
              isPinned && "opacity-100 text-accent-text",
              item.badge ? "hidden group-hover/wrap:block" : null,
            )}
          >
            {isPinned ? (
              <PinOff className="size-3" aria-hidden />
            ) : (
              <Pin className="size-3" aria-hidden />
            )}
          </button>
        ) : null}
      </div>

      {hasChildren && !collapsed ? (
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.ul
              id={childrenId}
              aria-labelledby={`${childrenId}-trigger`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={transition.base}
              className="relative ms-3 my-0.5 space-y-px overflow-hidden border-s border-border ps-2"
            >
              {item.children!
                .filter((c) => !c.hidden)
                .map((child) => (
                  <li key={child.key} className="relative">
                    <span aria-hidden className={cn(
                      "absolute start-[-0.5rem] h-px w-2 bg-border",
                      child.children?.length ? "top-3" : "top-[15px]",
                    )} />
                    <NavRow item={child} depth={depth + 1} />
                  </li>
                ))}
            </motion.ul>
          ) : null}
        </AnimatePresence>
      ) : null}
    </>
  );
}

function CollapsedNavItems({
  items,
}: {
  items: NavItem[];
}) {
  const router = useRouter();
  const { currentItemKey } = React.useContext(SidebarContext);
  const visibleItems = items.filter((item) => !item.hidden);
  return (
    <>
      {visibleItems.map((item) => {
        const Icon = item.icon;
        if (item.disabled || item.href === "#") {
          return (
            <MenuItem
              key={item.key}
              disabled
              icon={Icon ? <Icon aria-hidden /> : undefined}
              hint={item.disabledReason}
            >
              {item.label}
            </MenuItem>
          );
        }
        if (item.children?.length) {
          return (
            <MenuSub key={item.key}>
              <MenuSubTrigger icon={Icon ? <Icon aria-hidden /> : undefined}>
                {item.label}
              </MenuSubTrigger>
              <MenuSubContent aria-label={item.label}>
                <MenuLabel>{item.label}</MenuLabel>
                <CollapsedNavItems items={item.children} />
              </MenuSubContent>
            </MenuSub>
          );
        }
        return (
          <MenuItem
            key={item.key}
            icon={Icon ? <Icon aria-hidden /> : undefined}
            aria-current={currentItemKey === item.key ? "page" : undefined}
            className={currentItemKey === item.key ? "bg-selected text-fg" : undefined}
            onSelect={() => { if (allowAdminNavigation(item.href)) router.push(item.href); }}
          >
            {item.label}
          </MenuItem>
        );
      })}
    </>
  );
}

function BadgeSlot({
  badge,
  disabled,
}: {
  badge?: NavBadge;
  disabled?: boolean;
}) {
  if (!badge) return null;
  if (badge.status) {
    return (
      <span className="shrink-0">
        <StatusDot status={badge.status} size="sm" />
      </span>
    );
  }
  if (badge.count != null) {
    return (
      <CountBadge
        value={badge.count}
        tone={badge.tone === "future" ? "future" : (badge.tone ?? "neutral")}
        className="shrink-0"
      />
    );
  }
  if (badge.label) {
    return (
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium",
          disabled || badge.tone === "future"
            ? "bg-future-subtle text-future-text"
            : badge.tone === "warning"
              ? "bg-warning-subtle text-warning-text"
              : badge.tone === "danger"
                ? "bg-danger-subtle text-danger-text"
                : "bg-neutral-subtle text-fg-tertiary",
        )}
      >
        {badge.label}
      </span>
    );
  }
  return null;
}

/* ---------------------------------------------------------------------------
   SidebarBrand — product mark used as the sidebar header.
   ------------------------------------------------------------------------ */

export function SidebarBrand({
  collapsed,
  name = "فيثاغورس",
  subtitle = "لوحة التحكم",
  href = "/",
  mark,
  trailing,
}: {
  collapsed?: boolean;
  name?: string;
  subtitle?: string;
  href?: string;
  mark?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <Link
        href={href}
        className={cn(
          "flex min-w-0 items-center gap-2.5 rounded-md",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-accent text-on-accent">
          {mark ?? <PythagorasMark />}
        </span>
        {!collapsed ? (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight text-fg">
              {name}
            </span>
            <span className="block truncate text-2xs leading-tight text-fg-quaternary">
              {subtitle}
            </span>
          </span>
        ) : null}
      </Link>
      {!collapsed && trailing ? (
        <span className="ms-auto shrink-0">{trailing}</span>
      ) : null}
    </div>
  );
}

/** A right-triangle mark: the theorem, not a generic sparkle. */
function PythagorasMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none">
      <path
        d="M3.2 12.8V4.4L11.6 12.8H3.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M4.9 11.1V12.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.2 11.1H4.9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
