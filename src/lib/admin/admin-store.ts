"use client";

/**
 * AdminStore — the single source of truth for the Sponsored Carousel
 * admin dashboard.
 *
 * Responsibilities:
 *   - Hold the list of SponsoredBanner objects (max 5).
 *   - Hold the ActivityHistoryEntry log (newest first, cap 200).
 *   - Hold admin theme ("light" | "dark").
 *   - Hold carousel autoSlideInterval (ms, default 10000).
 *   - Persist all four to localStorage so reloads don't lose work.
 *   - Surface QuotaExceededError via `lastStorageError` so the UI can warn.
 *   - Emit change events so React components can subscribe via
 *     `useSyncExternalStore`.
 *
 * Architecture notes:
 *   - This is a plain JS class (not React state) so business logic stays
 *     out of UI components. Components subscribe via `useSyncExternalStore`
 *     (see `useAdminStore` hook).
 *   - When the backend arrives, swap the localStorage persistence layer
 *     for API calls. The public method signatures (add, update, delete,
 *     move, duplicate, setAdminTheme, setAutoSlideInterval) stay the same,
 *     so UI components won't change.
 *   - The store singleton is created during SSR (where there's no
 *     localStorage) AND on the client during hydration. To avoid hydration
 *     mismatches, the constructor does NOT load from localStorage — instead
 *     `loadFromStorage()` is called from a `useEffect` in the admin page
 *     (client-only, after hydration).
 */

import {
  BannerInput,
  BannerType,
  SponsoredBanner,
  MAX_BANNERS,
  makeBanner,
  BANNER_TRANSFORM_DEFAULT,
} from "./banner-model";
import {
  ActivityAction,
  ActivityHistoryEntry,
  ACTIVITY_LABELS,
} from "./activity-model";

const BANNERS_KEY = "pythagoras-admin-banners";
const HISTORY_KEY = "pythagoras-admin-history";
const THEME_KEY = "pythagoras-admin-theme";
const CAROUSEL_KEY = "pythagoras-admin-carousel-settings";

const DEFAULT_AUTO_SLIDE_INTERVAL = 10000;
const DEFAULT_ADMIN_THEME: "light" | "dark" = "light";
const HISTORY_CAP = 200;

/**
 * The immutable snapshot returned by `useAdminStore()`.
 *
 * Components read fields off this object; they never mutate it directly.
 * The reference is cached on the store and only changes when state
 * actually changes (so `useSyncExternalStore` doesn't loop forever).
 */
export interface AdminSnapshot {
  banners: SponsoredBanner[];
  history: ActivityHistoryEntry[];
  canAddMore: boolean;
  adminTheme: "light" | "dark";
  autoSlideInterval: number;
  /** Last quota/storage error message, or null if everything is fine. */
  lastStorageError: string | null;
}

type Listener = () => void;

class AdminStore {
  private banners: SponsoredBanner[] = [];
  private history: ActivityHistoryEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private hasLoadedFromStorage = false;

  adminTheme: "light" | "dark" = DEFAULT_ADMIN_THEME;
  autoSlideInterval: number = DEFAULT_AUTO_SLIDE_INTERVAL;

  /**
   * Last quota error message, or null if no error.
   * The admin UI reads this to show a warning banner when localStorage
   * is full.
   */
  lastStorageError: string | null = null;

  // Cached snapshot — useSyncExternalStore requires getSnapshot to return
  // a stable reference when nothing has changed, otherwise it loops
  // forever. We rebuild this object only when state changes.
  private snapshot: AdminSnapshot = {
    banners: [],
    history: [],
    canAddMore: true,
    adminTheme: DEFAULT_ADMIN_THEME,
    autoSlideInterval: DEFAULT_AUTO_SLIDE_INTERVAL,
    lastStorageError: null,
  };

  constructor() {
    // IMPORTANT: do NOT load from localStorage in the constructor.
    // The store singleton is created during SSR (where there's no
    // localStorage) AND on the client during hydration. If we load here,
    // the server snapshot returns 0 banners while the client returns 5 →
    // hydration mismatch.
    //
    // Instead, we start with an empty snapshot (0 banners, default theme,
    // default interval) on BOTH sides so the initial render matches, then
    // call `loadFromStorage()` from a `useEffect` in the admin page
    // (client-only, after hydration).
    this.rebuildSnapshot();
  }

  /**
   * Load banners + history + theme + carousel settings from localStorage.
   * Called once on the client AFTER hydration completes (via useEffect in
   * the admin page).
   *
   * Returns true if banners were loaded (or seeded), false if storage was
   * empty and we didn't seed (shouldn't happen — we always seed on first
   * visit).
   */
  loadFromStorage(): boolean {
    if (this.hasLoadedFromStorage) return this.banners.length > 0;
    this.hasLoadedFromStorage = true;
    if (typeof window === "undefined") return false;
    try {
      // 1. Theme
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark") {
        this.adminTheme = t;
      }

      // 2. Carousel settings
      const c = localStorage.getItem(CAROUSEL_KEY);
      if (c) {
        try {
          const parsed = JSON.parse(c) as { autoSlideInterval?: unknown };
          if (
            parsed &&
            typeof parsed.autoSlideInterval === "number" &&
            Number.isFinite(parsed.autoSlideInterval) &&
            parsed.autoSlideInterval > 0
          ) {
            this.autoSlideInterval = parsed.autoSlideInterval;
          }
        } catch {
          /* ignore malformed carousel settings */
        }
      }

      // 3. Banners (with migration for older shapes)
      const b = localStorage.getItem(BANNERS_KEY);
      if (b) {
        const parsed = JSON.parse(b) as SponsoredBanner[];
        // Migrate older banners that don't have a `bannerType` field yet —
        // treat them as "split" (the original layout) since they have
        // title/subtitle/icon set up for the split layout.
        // Banners without a `transform` get the default transform.
        this.banners = parsed.map((banner) => ({
          ...banner,
          bannerType: (banner.bannerType ?? "split") as BannerType,
          transform: banner.transform || { ...BANNER_TRANSFORM_DEFAULT },
        }));
        this.banners.sort((a, b2) => a.displayOrder - b2.displayOrder);
      } else {
        // First visit — seed with the default 5 banners so the dashboard
        // isn't empty on first load.
        this.banners = this.seedBanners();
      }

      // 4. History
      const h = localStorage.getItem(HISTORY_KEY);
      if (h) {
        this.history = JSON.parse(h) as ActivityHistoryEntry[];
      }

      // Persist — writes migrated banner shapes back + ensures all four
      // keys exist (useful when upgrading an older install that doesn't
      // have theme/carousel keys yet).
      this.persist();
      this.emit();
      return this.banners.length > 0;
    } catch {
      this.banners = this.seedBanners();
      this.persist();
      this.emit();
      return true;
    }
  }

  private seedBanners(): SponsoredBanner[] {
    // Same 5 dummy banners used by the student app, so the dashboard
    // starts with something concrete to edit. These get overwritten by
    // the student app's data when the backend arrives.
    // All seeds are "split" type (they have title/subtitle/icon).
    const seeds: BannerInput[] = [
      {
        bannerType: "split",
        title: "مراجعة الأحياء",
        subtitle: "ملخص شامل للفصول الأربعة مع نماذج وزارية",
        iconKey: "biology",
        gradient: "linear-gradient(135deg, oklch(58% 0.13 145), oklch(48% 0.10 165))",
        destination: "tests-biology",
        enabled: true,
        displayOrder: 1,
        image: "",
      },
      {
        bannerType: "split",
        title: "دورة الرياضيات",
        subtitle: "تفاضل وتكامل شرح كامل بمستوى السادس علمي",
        iconKey: "math",
        gradient: "linear-gradient(135deg, oklch(60% 0.16 25), oklch(50% 0.18 15))",
        destination: "tests-math",
        enabled: true,
        displayOrder: 2,
        image: "",
      },
      {
        bannerType: "split",
        title: "كورس الكيمياء",
        subtitle: "التفاعلات والحسابات الكيميائية بأسلوب مبسّط",
        iconKey: "chemistry",
        gradient: "linear-gradient(135deg, oklch(62% 0.14 280), oklch(52% 0.16 270))",
        destination: "tests-chemistry",
        enabled: true,
        displayOrder: 3,
        image: "",
      },
      {
        bannerType: "split",
        title: "دورة الفيزياء",
        subtitle: "الميكانيك والكهرباء بحلول مسائل خطوة بخطوة",
        iconKey: "physics",
        gradient: "linear-gradient(135deg, oklch(60% 0.14 220), oklch(50% 0.16 240))",
        destination: "tests-physics",
        enabled: true,
        displayOrder: 4,
        image: "",
      },
      {
        bannerType: "split",
        title: "كورس المعلم",
        subtitle: "جلسات مكثفة مع نخبة من المعلمين قبل الامتحان",
        iconKey: "lectures",
        gradient: "linear-gradient(135deg, oklch(60% 0.18 350), oklch(50% 0.16 340))",
        destination: "tests",
        enabled: true,
        displayOrder: 5,
        image: "",
      },
    ];
    return seeds.map(makeBanner);
  }

  /**
   * Thumbnail for a banner — used in activity log entries.
   * Returns the image data URL when an image is uploaded, otherwise
   * falls back to the gradient string (the UI can use it as a CSS
   * background).
   */
  bannerThumbnail(banner: SponsoredBanner): string {
    return banner.image || banner.gradient;
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
      banners: this.banners,
      history: this.history,
      canAddMore: this.banners.length < MAX_BANNERS,
      adminTheme: this.adminTheme,
      autoSlideInterval: this.autoSlideInterval,
      lastStorageError: this.lastStorageError,
    };
  }

  getSnapshot = (): AdminSnapshot => {
    return this.snapshot;
  };

  getServerSnapshot = (): AdminSnapshot => {
    // Server has no localStorage — return the cached snapshot (which on
    // the server is always the initial empty/default snapshot since
    // loadFromStorage is never called server-side).
    return this.snapshot;
  };

  // ---------- Persistence ----------
  private persist() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(BANNERS_KEY, JSON.stringify(this.banners));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
      localStorage.setItem(THEME_KEY, this.adminTheme);
      localStorage.setItem(
        CAROUSEL_KEY,
        JSON.stringify({ autoSlideInterval: this.autoSlideInterval })
      );
      this.lastStorageError = null;
    } catch (err) {
      // QuotaExceededError — localStorage is full (typically ~5MB).
      // This happens when banner images are too large.
      // We DON'T silently swallow this — surface it to the UI.
      const isQuota =
        err instanceof DOMException &&
        (err.name === "QuotaExceededError" ||
          err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          err.code === 22 ||
          err.code === 1014);
      this.lastStorageError = isQuota
        ? "امتلأت مساحة التخزين المحلية. احذف بانراً قديماً أو استخدم صوراً أصغر."
        : `خطأ في الحفظ: ${err instanceof Error ? err.message : String(err)}`;
      console.warn("[AdminStore] persist failed:", this.lastStorageError, err);
    }
  }

  // ---------- Activity logging ----------
  /**
   * Prepend a new ActivityHistoryEntry to the history array.
   * Cap at HISTORY_CAP entries (newest kept).
   *
   * NOTE: this method only mutates `this.history`. Callers are
   * responsible for calling `persist()` and `emit()` afterwards so the
   * change is saved and subscribers are notified.
   */
  private log(
    action: ActivityAction,
    bannerTitle: string,
    thumbnail: string,
    changeSummary?: string[]
  ) {
    const entry: ActivityHistoryEntry = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      action,
      label: ACTIVITY_LABELS[action],
      bannerTitle,
      thumbnail,
      changeSummary,
    };
    this.history = [entry, ...this.history].slice(0, HISTORY_CAP);
  }

  /**
   * Append an activity history entry from an EXTERNAL store (NavStore,
   * MaterialsStore, ToolsStore). This is the SHARED history channel —
   * every admin sub-system logs through here so a single
   * `ActivityHistory` panel on the right side of the page shows entries
   * from every manager.
   *
   * The caller supplies everything except `id` and `at` (we generate
   * those). The entry is prepended, capped, persisted, and emitted in
   * one shot — callers do NOT need to call `persist()`/`emit()`.
   */
  appendHistoryEntry(
    entry: Omit<ActivityHistoryEntry, "id" | "at">
  ) {
    const fullEntry: ActivityHistoryEntry = {
      ...entry,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
    };
    this.history = [fullEntry, ...this.history].slice(0, HISTORY_CAP);
    this.persist();
    this.emit();
  }

  // ---------- Mutations ----------
  /**
   * Add a new banner. Logs an "uploaded" entry with the banner's thumbnail.
   * Returns the new banner, or null if MAX_BANNERS has been reached.
   */
  addBanner(input: BannerInput): SponsoredBanner | null {
    if (this.banners.length >= MAX_BANNERS) return null;
    const nextOrder =
      this.banners.length === 0
        ? 1
        : Math.max(...this.banners.map((b) => b.displayOrder)) + 1;
    const banner = makeBanner({ ...input, displayOrder: nextOrder });
    this.banners = [...this.banners, banner];
    this.banners.sort((a, b) => a.displayOrder - b.displayOrder);
    this.log(
      "uploaded",
      banner.title || "بدون عنوان",
      this.bannerThumbnail(banner)
    );
    this.persist();
    this.emit();
    return banner;
  }

  /**
   * Apply a patch to a banner WITHOUT logging anything.
   *
   * Use this for live preview — when the user is dragging the image
   * positioner or typing in a text field, we want the banner to update
   * in real-time without spamming the activity log with one entry per
   * keystroke. The eventual "edited" log entry is created by
   * `commitBannerEdit` when the user finishes editing.
   */
  updateBannerSilent(id: string, patch: Partial<BannerInput>) {
    let changed = false;
    this.banners = this.banners.map((b) => {
      if (b.id !== id) return b;
      changed = true;
      const updated: SponsoredBanner = {
        ...b,
        ...patch,
        transform: { ...b.transform, ...(patch.transform || {}) },
        updatedAt: new Date().toISOString(),
      };
      return updated;
    });
    if (changed) {
      this.persist();
      this.emit();
    }
  }

  /**
   * Commit a banner edit: apply the patch AND log exactly ONE "edited"
   * entry with a human-readable change summary.
   *
   * Use this when the user finishes editing (e.g. on blur, on dialog
   * close, on "Save" button click). Pair with `updateBannerSilent` for
   * the live-preview phase.
   *
   * `changeSummary` is a list of Arabic strings describing what changed,
   * e.g. ["العنوان: من 'أ' إلى 'ب'", "تم تعديل الصورة"]. These are
   * stored on the history entry and shown in the UI.
   */
  commitBannerEdit(
    id: string,
    patch: Partial<BannerInput>,
    changeSummary: string[]
  ) {
    let target: SponsoredBanner | undefined;
    this.banners = this.banners.map((b) => {
      if (b.id !== id) return b;
      const updated: SponsoredBanner = {
        ...b,
        ...patch,
        transform: { ...b.transform, ...(patch.transform || {}) },
        updatedAt: new Date().toISOString(),
      };
      target = updated;
      return updated;
    });
    if (target) {
      this.log(
        "edited",
        target.title || "بدون عنوان",
        this.bannerThumbnail(target),
        changeSummary
      );
    }
    this.persist();
    this.emit();
  }

  /**
   * Delete a banner by id. Logs a "deleted" entry with the banner's
   * thumbnail. Re-sequences displayOrder to be contiguous 1..N.
   */
  deleteBanner(id: string) {
    const target = this.banners.find((b) => b.id === id);
    if (!target) return;
    this.banners = this.banners.filter((b) => b.id !== id);
    this.banners = this.banners
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((b, i) => ({ ...b, displayOrder: i + 1 }));
    this.log("deleted", target.title || "بدون عنوان", this.bannerThumbnail(target));
    this.persist();
    this.emit();
  }

  /**
   * Duplicate a banner by id. The copy gets "(نسخة)" appended to the
   * title and is added at the end. Logs a "duplicated" entry with the
   * source banner's thumbnail.
   * Returns the new banner, or null if MAX_BANNERS has been reached or
   * the source wasn't found.
   */
  duplicateBanner(id: string): SponsoredBanner | null {
    if (this.banners.length >= MAX_BANNERS) return null;
    const source = this.banners.find((b) => b.id === id);
    if (!source) return null;
    const nextOrder =
      this.banners.length === 0
        ? 1
        : Math.max(...this.banners.map((b) => b.displayOrder)) + 1;
    const copy = makeBanner({
      ...source,
      title: `${source.title} (نسخة)`,
      displayOrder: nextOrder,
      transform: { ...source.transform },
    });
    this.banners = [...this.banners, copy];
    this.banners.sort((a, b) => a.displayOrder - b.displayOrder);
    this.log("duplicated", source.title || "بدون عنوان", this.bannerThumbnail(source));
    this.persist();
    this.emit();
    return copy;
  }

  /**
   * Swap a banner's displayOrder with its neighbor in the given
   * direction ("up" = earlier, "down" = later). Logs a "reordered"
   * entry with the moved banner's thumbnail.
   */
  moveBanner(id: string, direction: "up" | "down") {
    const sorted = [...this.banners].sort(
      (a, b) => a.displayOrder - b.displayOrder
    );
    const idx = sorted.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    // Swap displayOrder
    this.banners = this.banners.map((banner) => {
      if (banner.id === a.id) return { ...banner, displayOrder: b.displayOrder };
      if (banner.id === b.id) return { ...banner, displayOrder: a.displayOrder };
      return banner;
    });
    this.banners.sort((x, y) => x.displayOrder - y.displayOrder);
    this.log("reordered", a.title || "بدون عنوان", this.bannerThumbnail(a));
    this.persist();
    this.emit();
  }

  /**
   * Empty the activity history array. Persists + emits.
   * Banners are NOT affected.
   */
  clearHistory() {
    this.history = [];
    this.persist();
    this.emit();
  }

  // ---------- Theme ----------
  /**
   * Set the admin dashboard theme ("light" or "dark").
   * No-op if the value is unchanged. Persists to THEME_KEY.
   */
  setAdminTheme(theme: "light" | "dark") {
    if (this.adminTheme === theme) return;
    this.adminTheme = theme;
    this.persist();
    this.emit();
  }

  // ---------- Carousel settings ----------
  /**
   * Set the carousel auto-slide interval (ms).
   *
   * Only logs an activity entry if the value ACTUALLY changed — this
   * prevents spamming the history when the user drags a slider and
   * releases at the same value.
   *
   * The log entry uses action="settings", bannerTitle="إعدادات الكاروسيل",
   * thumbnail="" (no banner involved), and a change summary describing
   * the old → new duration in seconds.
   */
  setAutoSlideInterval(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    if (this.autoSlideInterval === ms) return;
    const oldSec = Math.round(this.autoSlideInterval / 1000);
    const newSec = Math.round(ms / 1000);
    this.autoSlideInterval = ms;
    this.log(
      "settings",
      "إعدادات الكاروسيل",
      "",
      [`مدة التقليب: من ${oldSec} ثانية إلى ${newSec} ثانية`]
    );
    this.persist();
    this.emit();
  }
}

// Singleton — one store per browser tab
let storeInstance: AdminStore | null = null;

export function getAdminStore(): AdminStore {
  if (!storeInstance) {
    storeInstance = new AdminStore();
  }
  return storeInstance;
}

// Re-exports so consumers can `import { ... } from "@/lib/admin/admin-store"`
// without reaching into the model files directly.
export type { SponsoredBanner, BannerImageTransform, BannerInput, BannerType } from "./banner-model";
export {
  BANNER_TRANSFORM_DEFAULT,
  MAX_BANNERS,
  RECOMMENDED_BANNER_FULL,
  RECOMMENDED_BANNER_SPLIT,
  DEFAULT_BANNER_TYPE,
  makeBanner,
} from "./banner-model";
export type { ActivityHistoryEntry, ActivityAction } from "./activity-model";
export { ACTIVITY_LABELS, ACTIVITY_ICONS } from "./activity-model";
export type { AdminSnapshot };
