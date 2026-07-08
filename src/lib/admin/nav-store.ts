"use client";

/**
 * NavStore — single source of truth for the student app's bottom-nav
 * items, edited from the admin panel at `/admin/navigation`.
 *
 * Responsibilities:
 *   - Hold the ordered list of NavItem objects.
 *   - Persist the list to localStorage under
 *     `pythagoras-admin-nav-items` (the student app reads from there).
 *   - Surface QuotaExceededError via `lastStorageError`.
 *   - Emit change events so React components can subscribe via
 *     `useSyncExternalStore` (see `useNavStore` hook).
 *
 * Activity log:
 *   - History is NOT stored here. The admin dashboard has a SHARED
 *     activity log (one `pythagoras-admin-history` localStorage key)
 *     managed by `AdminStore`. We delegate to
 *     `adminStore.appendHistoryEntry(...)` for every mutation so all
 *     admin sub-systems show up in the same `ActivityHistory` panel.
 *
 * Architecture notes:
 *   - Plain JS class (not React state) so business logic stays out of
 *     UI components. Same pattern as `AdminStore`.
 *   - The constructor does NOT load from localStorage — `loadFromStorage()`
 *     is called from a `useEffect` in the admin page (client-only,
 *     after hydration) to avoid SSR/client hydration mismatches.
 *   - When the backend arrives, swap the localStorage persistence layer
 *     for API calls. The public method signatures stay the same.
 */

import {
  ActivityAction,
  ACTIVITY_LABELS,
} from "./activity-model";
import { getAdminStore } from "./admin-store";

const NAV_KEY = "pythagoras-admin-nav-items";

export interface NavItem {
  id: string;
  label: string;
  /** Icon key from the student app's icon set. */
  icon: string;
  enabled: boolean;
  order: number;
}

export type NavItemInput = Omit<NavItem, "id">;

export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { id: "home", label: "الرئيسية", icon: "home", enabled: true, order: 0 },
  { id: "materials", label: "المواد", icon: "book", enabled: true, order: 1 },
  { id: "tools", label: "الأدوات", icon: "toolbox", enabled: true, order: 2 },
  { id: "lectures", label: "المحاضرات", icon: "play", enabled: true, order: 3 },
  { id: "settings", label: "الإعدادات", icon: "settings", enabled: true, order: 4 },
];

export interface NavSnapshot {
  navItems: NavItem[];
  lastStorageError: string | null;
}

type Listener = () => void;

class NavStore {
  private navItems: NavItem[] = [];
  private listeners: Set<Listener> = new Set();
  private hasLoadedFromStorage = false;

  lastStorageError: string | null = null;

  private snapshot: NavSnapshot = {
    navItems: [],
    lastStorageError: null,
  };

  constructor() {
    this.rebuildSnapshot();
  }

  loadFromStorage(): boolean {
    if (this.hasLoadedFromStorage) return this.navItems.length > 0;
    this.hasLoadedFromStorage = true;
    if (typeof window === "undefined") return false;
    try {
      const stored = localStorage.getItem(NAV_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as NavItem[];
        this.navItems = parsed
          .map((item) => ({ ...DEFAULT_NAV_ITEMS[0], ...item }))
          .sort((a, b) => a.order - b.order);
      } else {
        this.navItems = DEFAULT_NAV_ITEMS.map((i) => ({ ...i }));
      }
      this.persist();
      this.emit();
      return this.navItems.length > 0;
    } catch {
      this.navItems = DEFAULT_NAV_ITEMS.map((i) => ({ ...i }));
      this.persist();
      this.emit();
      return true;
    }
  }

  // ---------- Subscription ----------
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    this.rebuildSnapshot();
    this.listeners.forEach((l) => l());
  }

  private rebuildSnapshot() {
    this.snapshot = {
      navItems: this.navItems,
      lastStorageError: this.lastStorageError,
    };
  }

  getSnapshot = (): NavSnapshot => this.snapshot;

  getServerSnapshot = (): NavSnapshot => this.snapshot;

  // ---------- Persistence ----------
  private persist() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify(this.navItems));
      this.lastStorageError = null;
    } catch (err) {
      const isQuota =
        err instanceof DOMException &&
        (err.name === "QuotaExceededError" ||
          err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          err.code === 22 ||
          err.code === 1014);
      this.lastStorageError = isQuota
        ? "امتلأت مساحة التخزين المحلية."
        : `خطأ في الحفظ: ${err instanceof Error ? err.message : String(err)}`;
      console.warn("[NavStore] persist failed:", this.lastStorageError, err);
    }
  }

  // ---------- Shared activity logging ----------
  /**
   * Push a history entry through AdminStore's shared channel. The
   * AdminStore owns the activity array, the cap, the persistence, and
   * the emit cycle — we just supply the field values.
   */
  private logActivity(
    action: ActivityAction,
    itemLabel: string,
    changeSummary?: string[]
  ) {
    getAdminStore().appendHistoryEntry({
      action,
      label: ACTIVITY_LABELS[action],
      bannerTitle: `التنقل: ${itemLabel}`,
      thumbnail: "",
      changeSummary,
    });
  }

  // ---------- Mutations ----------
  /**
   * Commit a nav item edit: apply the patch AND log exactly ONE "edited"
   * entry with a human-readable Arabic change summary.
   *
   * `changeSummary` is a list of Arabic strings describing what changed,
   * e.g. ["التسمية: من 'الرئيسية' إلى 'الصفحة الرئيسية'"]. Stored on the
   * shared history entry and shown in the UI.
   */
  commitNavEdit(
    id: string,
    patch: Partial<Omit<NavItem, "id" | "order">>,
    changeSummary: string[]
  ) {
    let target: NavItem | undefined;
    this.navItems = this.navItems.map((item) => {
      if (item.id !== id) return item;
      const updated: NavItem = { ...item, ...patch };
      target = updated;
      return updated;
    });
    if (target) {
      this.logActivity("edited", target.label, changeSummary);
    }
    this.persist();
    this.emit();
  }

  /**
   * Swap a nav item's order with its neighbor in the given direction
   * ("up" = earlier, "down" = later). Logs a "reordered" entry.
   */
  moveNavItem(id: string, direction: "up" | "down") {
    const sorted = [...this.navItems].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    this.navItems = this.navItems.map((item) => {
      if (item.id === a.id) return { ...item, order: b.order };
      if (item.id === b.id) return { ...item, order: a.order };
      return item;
    });
    this.navItems.sort((x, y) => x.order - y.order);
    this.logActivity("reordered", a.label);
    this.persist();
    this.emit();
  }
}

let navStoreInstance: NavStore | null = null;

export function getNavStore(): NavStore {
  if (!navStoreInstance) {
    navStoreInstance = new NavStore();
  }
  return navStoreInstance;
}
