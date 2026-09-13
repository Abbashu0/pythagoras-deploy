"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bell,
  Check,
  CircleHelp,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  UserCog,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/cn";
import { IconButton } from "../primitives/button";
import { Kbd, Shortcut } from "../primitives/kbd";
import { Avatar } from "../primitives/avatar";
import { Separator } from "../primitives/separator";
import { Tooltip } from "../primitives/tooltip";
import { StatusDot } from "../status/status-badge";
import type { StatusKey } from "../status/status-registry";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../overlays/menu";
import { useMounted, usePersistentState } from "@/lib/hooks";

/* ============================================================================
   TopBar
   ---------------------------------------------------------------------------
   Restrained by design. It carries location, one search affordance, and the
   handful of global controls that genuinely belong at the app level. Page
   actions live in the PageHeader, not here — putting them in the top bar is how
   admins end up with two competing action rows.

   Fixed at 52px so a sticky page header can sit flush beneath it.
   ========================================================================== */

export interface TopBarProps {
  /** Breadcrumb / location, inline start. */
  location?: React.ReactNode;
  onOpenCommandPalette?: () => void;
  /** Environment indicator: production / staging / local. */
  environment?: EnvironmentIndicatorProps;
  notifications?: React.ReactNode;
  user?: UserMenuProps;
  /** Extra controls before the user menu. */
  children?: React.ReactNode;
  className?: string;
  helpHref?: string;
}

export function TopBar({
  location,
  onOpenCommandPalette,
  environment,
  notifications,
  user,
  children,
  className,
  helpHref,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-[var(--z-topbar)] flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-bg/88 px-4 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">{location}</div>

      {onOpenCommandPalette ? (
        <CommandTrigger onClick={onOpenCommandPalette} />
      ) : null}

      <div className="flex shrink-0 items-center gap-1">
        {environment ? <EnvironmentIndicator {...environment} /> : null}
        {children}
        {notifications}
        {helpHref ? (
          <Tooltip content="المساعدة والتوثيق">
            <IconButton label="المساعدة" size="sm" variant="ghost" asChild>
              <Link href={helpHref}>
                <CircleHelp aria-hidden />
              </Link>
            </IconButton>
          </Tooltip>
        ) : null}
        <ThemeToggle />
        {user ? (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <UserMenu {...user} />
          </>
        ) : null}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------------------
   Command trigger — a search-shaped button, because that is what operators
   reach for. It shows the shortcut so the keyboard path is discoverable.
   ------------------------------------------------------------------------ */

export function CommandTrigger({
  onClick,
  className,
  placeholder = "بحث أو أمر…",
}: {
  onClick: () => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/cmd hidden h-7 items-center gap-2 rounded-md border border-border bg-surface px-2.5 md:flex",
        "text-xs text-fg-quaternary transition-colors",
        "hover:border-border-strong hover:bg-hover hover:text-fg-tertiary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        "w-52 lg:w-64",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-start">{placeholder}</span>
      <Shortcut keys="mod+k" size="sm" muted />
    </button>
  );
}

/* ---------------------------------------------------------------------------
   EnvironmentIndicator
   ------------------------------------------------------------------------ */

export interface EnvironmentIndicatorProps {
  name: string;
  tone?: "production" | "staging" | "local";
  /** Overall platform health, shown as a dot. */
  health?: StatusKey;
  detail?: React.ReactNode;
  href?: string;
}

export function EnvironmentIndicator({
  name,
  tone = "production",
  health,
  detail,
  href,
}: EnvironmentIndicatorProps) {
  const body = (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-2xs font-medium",
        tone === "production" && "border-border bg-inset text-fg-secondary",
        tone === "staging" &&
          "border-warning-border bg-warning-subtle text-warning-text",
        tone === "local" && "border-info-border bg-info-subtle text-info-text",
      )}
    >
      {health ? <StatusDot status={health} size="sm" /> : null}
      {name}
    </span>
  );

  return (
    <Tooltip
      content={
        <span className="block">
          <span className="block font-medium text-fg">البيئة: {name}</span>
          {detail ? (
            <span className="mt-0.5 block text-fg-tertiary">{detail}</span>
          ) : null}
        </span>
      }
    >
      {href ? (
        <Link href={href} className="rounded-full">
          {body}
        </Link>
      ) : (
        body
      )}
    </Tooltip>
  );
}

/* ---------------------------------------------------------------------------
   ThemeToggle
   ------------------------------------------------------------------------ */

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          label="المظهر"
          size="sm"
          variant="ghost"
          className={className}
        >
          {/* Render a stable glyph until mounted to avoid a hydration flip. */}
          {!mounted ? (
            <Monitor aria-hidden />
          ) : resolvedTheme === "dark" ? (
            <Moon aria-hidden />
          ) : (
            <Sun aria-hidden />
          )}
        </IconButton>
      </MenuTrigger>
      <MenuContent className="min-w-40">
        <MenuLabel>المظهر</MenuLabel>
        <MenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <MenuRadioItem value="light">فاتح</MenuRadioItem>
          <MenuRadioItem value="dark">داكن</MenuRadioItem>
          <MenuRadioItem value="system">حسب النظام</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/* ---------------------------------------------------------------------------
   DensityToggle — an operator preference, persisted via the data-density
   attribute the tokens react to.
   ------------------------------------------------------------------------ */

export function DensityToggle() {
  // Persisted through the shared store, so the value survives reloads without
  // an effect that reads localStorage and then re-renders.
  const [density, setDensity] = usePersistentState<"default" | "compact">(
    "pyth-density",
    "default",
  );

  // The tokens react to a data attribute on <html>; keep the DOM in step with
  // the stored preference.
  React.useEffect(() => {
    if (density === "compact") {
      document.documentElement.dataset.density = "compact";
    } else {
      delete document.documentElement.dataset.density;
    }
  }, [density]);

  const apply = (next: "default" | "compact") => setDensity(next);

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="كثافة العرض" size="sm" variant="ghost">
          <Settings aria-hidden />
        </IconButton>
      </MenuTrigger>
      <MenuContent className="min-w-44">
        <MenuLabel>كثافة العرض</MenuLabel>
        <MenuRadioGroup
          value={density}
          onValueChange={(v) => apply(v as "default" | "compact")}
        >
          <MenuRadioItem value="default">مريحة</MenuRadioItem>
          <MenuRadioItem value="compact">مكثّفة</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/* ---------------------------------------------------------------------------
   UserMenu
   ------------------------------------------------------------------------ */

export interface UserMenuProps {
  name: string;
  email?: string;
  role?: string;
  avatarUrl?: string | null;
  items?: {
    key: string;
    label: string;
    icon?: React.ReactNode;
    href?: string;
    onSelect?: () => void;
    danger?: boolean;
    shortcut?: string;
  }[];
  onSignOut?: () => void;
}

export function UserMenu({
  name,
  email,
  role,
  avatarUrl,
  items,
  onSignOut,
}: UserMenuProps) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`حساب ${name}`}
          className={cn(
            "flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors",
            "hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
            "data-[state=open]:bg-hover",
          )}
        >
          <Avatar name={name} src={avatarUrl} size="sm" />
        </button>
      </MenuTrigger>
      <MenuContent className="min-w-56">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={name} src={avatarUrl} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{name}</p>
            {email ? (
              <p
                dir="ltr"
                className="ltr-island truncate font-mono text-[10px] text-fg-quaternary"
              >
                {email}
              </p>
            ) : null}
          </div>
        </div>
        {role ? (
          <div className="px-2 pb-2">
            <span className="inline-flex h-[20px] items-center rounded-full bg-accent-subtle px-2 text-2xs font-medium text-accent-text">
              {role}
            </span>
          </div>
        ) : null}
        <MenuSeparator />
        {(items ?? []).map((item) => (
          <MenuItem
            key={item.key}
            icon={item.icon}
            danger={item.danger}
            shortcut={item.shortcut}
            onSelect={item.onSelect}
          >
            {item.href ? (
              <Link href={item.href} className="block">
                {item.label}
              </Link>
            ) : (
              item.label
            )}
          </MenuItem>
        ))}
        {onSignOut ? (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<LogOut aria-hidden />}
              danger
              onSelect={onSignOut}
            >
              تسجيل الخروج
            </MenuItem>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

/** Default items for the demo user menu — kept here so pages stay declarative. */
export const DEFAULT_USER_MENU_ITEMS: NonNullable<UserMenuProps["items"]> = [
  { key: "profile", label: "الملف الشخصي", icon: <UserCog aria-hidden />, href: "#" },
  { key: "prefs", label: "التفضيلات", icon: <Settings aria-hidden />, href: "#", shortcut: "mod+," },
];

/* ---------------------------------------------------------------------------
   NotificationBell + NotificationCenter live in feedback/notifications.tsx;
   this re-export keeps the top bar's API in one place for consumers.
   ------------------------------------------------------------------------ */

export function TopBarActionHint({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden items-center gap-1.5 text-2xs text-fg-quaternary lg:inline-flex">
      <Check className="size-3" aria-hidden />
      {children}
    </span>
  );
}

export { Bell as BellIcon, Kbd };
