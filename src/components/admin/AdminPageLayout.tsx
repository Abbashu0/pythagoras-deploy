"use client";

/**
 * AdminPageLayout — shared chrome for the admin sub-pages
 * (`/admin/navigation`, `/admin/materials`, `/admin/tools`).
 *
 * Renders the same 3-column layout the Banners manager uses, but
 * factored out so the new managers don't duplicate the back-button /
 * title / theme-toggle / activity-history boilerplate.
 *
 * Layout (desktop, RTL — 12-col grid):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  [→ لوحة التحكم]   "title"            [☀ / ☾ toggle]              │
 *   │                    "subtitle"                                     │
 *   ├──────────────────────┬─────────────────────┬──────────────────────┤
 *   │  col-span-5          │  col-span-4         │  col-span-3 (sticky) │
 *   │  {list}              │  {editor}           │  ActivityHistory     │
 *   ├──────────────────────┴─────────────────────┴──────────────────────┤
 *   │  {preview} — full-width strip at the bottom                       │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Theme handling: identical to `/admin` and `/admin/banners` — subscribe
 * to AdminStore, read `adminTheme` from the snapshot, sync the `dark`
 * class on `<html>` via an effect. The toggle button calls
 * `store.setAdminTheme(...)`.
 *
 * The `loadStore` prop is called once on mount so the page can wire up
 * whatever store(s) it needs (its own list store + the shared AdminStore
 * for the activity log + theme). Each store is idempotent on repeat
 * `loadFromStorage()` calls.
 */

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Moon, Sun, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActivityHistory } from "@/components/admin/ActivityHistory";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";

interface Props {
  title: string;
  subtitle: string;
  /**
   * Called once on mount (client-only, after hydration). The page uses
   * this to load its own list store AND the shared AdminStore (so the
   * activity history + theme are available). All stores are idempotent
   * on repeat calls.
   */
  loadStore: () => void;
  /** Optional storage error message — surfaces a warning banner. */
  storageError?: string | null;
  /** Left column — the reorderable list of items. */
  list: ReactNode;
  /** Middle column — the editor panel. */
  editor: ReactNode;
  /** Bottom strip — the live preview (full-width). */
  preview: ReactNode;
}

export function AdminPageLayout({
  title,
  subtitle,
  loadStore,
  storageError,
  list,
  editor,
  preview,
}: Props) {
  const router = useRouter();
  const { adminTheme } = useAdminStore();
  const store = getAdminStore();

  // Mount: load persisted state for both the page's own store and the
  // shared AdminStore (theme + activity history). Idempotent.
  useEffect(() => {
    loadStore();
    store.loadFromStorage();
  }, [loadStore, store]);

  // External system sync: apply theme to <html>. No setState inside
  // (pure DOM mutation) so this satisfies react-hooks/set-state-in-effect.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", adminTheme === "dark");
  }, [adminTheme]);

  const handleToggleTheme = () => {
    store.setAdminTheme(adminTheme === "dark" ? "light" : "dark");
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Top bar: back + title + theme toggle ---------- */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push("/admin")}
            className="h-9 w-fit gap-1.5 text-xs"
          >
            <ArrowRight className="h-4 w-4" />
            لوحة التحكم
          </Button>

          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleTheme}
          aria-label={
            adminTheme === "dark" ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"
          }
          title={adminTheme === "dark" ? "وضع فاتح" : "وضع داكن"}
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
        >
          {adminTheme === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* ---------- Storage error warning ---------- */}
      {storageError && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-destructive">
              تحذير: تعذّر الحفظ
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-destructive/80">
              {storageError}
            </p>
          </div>
        </div>
      )}

      {/* ---------- Main 3-column grid ---------- */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: list */}
        <section className="col-span-12 space-y-5 lg:col-span-5">{list}</section>

        {/* Middle: editor */}
        <section className="col-span-12 lg:col-span-4">{editor}</section>

        {/* Right: activity history (sticky) */}
        <section className="col-span-12 lg:col-span-3">
          <div className="lg:sticky lg:top-6">
            <ActivityHistory />
          </div>
        </section>
      </div>

      {/* ---------- Bottom: live preview ---------- */}
      <section className="mt-8">{preview}</section>
    </div>
  );
}
