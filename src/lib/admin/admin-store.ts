"use client";

/**
 * AdminStore — the single source of truth for the Sponsored Carousel admin dashboard.
 *
 * Responsibilities:
 *   - Hold the list of SponsoredBanner objects (max 5).
 *   - Hold the ActivityHistoryEntry log (newest first).
 *   - Persist both to localStorage so reloads don't lose work.
 *   - Emit change events so React components can subscribe.
 *
 * Architecture notes:
 *   - This is a plain JS class (not React state) so business logic stays out of
 *     UI components. Components subscribe via `useSyncExternalStore` (see
 *     `useAdminStore` hook in admin-store-hook.ts).
 *   - When the backend arrives, swap the localStorage persistence layer for
 *     API calls. The public method signatures (add, update, delete, move,
 *     duplicate) stay the same, so UI components won't change.
 */

import {
  BannerInput,
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

type Listener = () => void;

class AdminStore {
  private banners: SponsoredBanner[] = [];
  private history: ActivityHistoryEntry[] = [];
  private listeners: Set<Listener> = new Set();
  // Cached snapshot — useSyncExternalStore requires getSnapshot to return a
  // stable reference when nothing has changed, otherwise it loops forever.
  private snapshot: {
    banners: SponsoredBanner[];
    history: ActivityHistoryEntry[];
    canAddMore: boolean;
  } = { banners: [], history: [], canAddMore: true };

  constructor() {
    if (typeof window !== "undefined") {
      this.load();
    } else {
      this.rebuildSnapshot();
    }
  }

  private rebuildSnapshot() {
    this.snapshot = {
      banners: this.banners,
      history: this.history,
      canAddMore: this.banners.length < MAX_BANNERS,
    };
  }

  // ---------- Persistence ----------
  private load() {
    try {
      const b = localStorage.getItem(BANNERS_KEY);
      const h = localStorage.getItem(HISTORY_KEY);
      this.banners = b ? (JSON.parse(b) as SponsoredBanner[]) : this.seedBanners();
      this.history = h ? (JSON.parse(h) as ActivityHistoryEntry[]) : [];
      // Ensure sorted by displayOrder
      this.banners.sort((a, b) => a.displayOrder - b.displayOrder);
      this.rebuildSnapshot();
      this.persist();
    } catch {
      this.banners = this.seedBanners();
      this.history = [];
      this.rebuildSnapshot();
    }
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(BANNERS_KEY, JSON.stringify(this.banners));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      // localStorage might be full (large data URLs) — fail silently
    }
    this.rebuildSnapshot();
  }

  private seedBanners(): SponsoredBanner[] {
    // Same 5 dummy banners used by the student app, so the dashboard starts
    // with something concrete to edit. These get overwritten by the student
    // app's data when the backend arrives.
    const seeds: BannerInput[] = [
      { title: "مراجعة الأحياء", subtitle: "ملخص شامل للفصول الأربعة مع نماذج وزارية", iconKey: "biology", gradient: "linear-gradient(135deg, oklch(58% 0.13 145), oklch(48% 0.10 165))", destination: "tests-biology", enabled: true, displayOrder: 1, image: "" },
      { title: "دورة الرياضيات", subtitle: "تفاضل وتكامل شرح كامل بمستوى السادس علمي", iconKey: "math", gradient: "linear-gradient(135deg, oklch(60% 0.16 25), oklch(50% 0.18 15))", destination: "tests-math", enabled: true, displayOrder: 2, image: "" },
      { title: "كورس الكيمياء", subtitle: "التفاعلات والحسابات الكيميائية بأسلوب مبسّط", iconKey: "chemistry", gradient: "linear-gradient(135deg, oklch(62% 0.14 280), oklch(52% 0.16 270))", destination: "tests-chemistry", enabled: true, displayOrder: 3, image: "" },
      { title: "دورة الفيزياء", subtitle: "الميكانيك والكهرباء بحلول مسائل خطوة بخطوة", iconKey: "physics", gradient: "linear-gradient(135deg, oklch(60% 0.14 220), oklch(50% 0.16 240))", destination: "tests-physics", enabled: true, displayOrder: 4, image: "" },
      { title: "كورس المعلم", subtitle: "جلسات مكثفة مع نخبة من المعلمين قبل الامتحان", iconKey: "lectures", gradient: "linear-gradient(135deg, oklch(60% 0.18 350), oklch(50% 0.16 340))", destination: "tests", enabled: true, displayOrder: 5, image: "" },
    ];
    return seeds.map(makeBanner);
  }

  // ---------- Subscription ----------
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.rebuildSnapshot();
    this.listeners.forEach((l) => l());
  }

  getSnapshot = (): {
    banners: SponsoredBanner[];
    history: ActivityHistoryEntry[];
    canAddMore: boolean;
  } => {
    return this.snapshot;
  };

  getServerSnapshot = (): {
    banners: SponsoredBanner[];
    history: ActivityHistoryEntry[];
    canAddMore: boolean;
  } => {
    // Server has no localStorage — return empty stable snapshot.
    return this.snapshot;
  };

  // ---------- Activity logging ----------
  private log(action: ActivityAction, bannerTitle: string) {
    const entry: ActivityHistoryEntry = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      action,
      label: ACTIVITY_LABELS[action],
      bannerTitle,
    };
    this.history = [entry, ...this.history].slice(0, 200); // cap at 200
    this.persist();
  }

  // ---------- Mutations ----------
  addBanner(input: BannerInput): SponsoredBanner | null {
    if (this.banners.length >= MAX_BANNERS) return null;
    const nextOrder =
      this.banners.length === 0
        ? 1
        : Math.max(...this.banners.map((b) => b.displayOrder)) + 1;
    const banner = makeBanner({ ...input, displayOrder: nextOrder });
    this.banners = [...this.banners, banner];
    this.banners.sort((a, b) => a.displayOrder - b.displayOrder);
    this.log("uploaded", banner.title || "بدون عنوان");
    this.emit();
    return banner;
  }

  updateBanner(id: string, patch: Partial<BannerInput>) {
    this.banners = this.banners.map((b) => {
      if (b.id !== id) return b;
      const updated: SponsoredBanner = {
        ...b,
        ...patch,
        transform: { ...b.transform, ...(patch.transform || {}) },
        updatedAt: new Date().toISOString(),
      };
      // Detect enable/disable transition for logging
      if (patch.enabled === true && b.enabled === false) {
        this.log("enabled", updated.title);
      } else if (patch.enabled === false && b.enabled === true) {
        this.log("disabled", updated.title);
      }
      return updated;
    });
    // Generic "edited" log only if something other than enabled changed
    const hasNonEnableChange = Object.keys(patch).some(
      (k) => k !== "enabled" && k !== "transform"
    );
    if (hasNonEnableChange) {
      const target = this.banners.find((b) => b.id === id);
      this.log("edited", target?.title || "بدون عنوان");
    }
    this.persist();
    this.emit();
  }

  deleteBanner(id: string) {
    const target = this.banners.find((b) => b.id === id);
    if (!target) return;
    this.banners = this.banners.filter((b) => b.id !== id);
    // Re-sequence displayOrder to be contiguous 1..N
    this.banners = this.banners
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((b, i) => ({ ...b, displayOrder: i + 1 }));
    this.log("deleted", target.title);
    this.persist();
    this.emit();
  }

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
    this.log("duplicated", source.title);
    this.persist();
    this.emit();
    return copy;
  }

  moveBanner(id: string, direction: "up" | "down") {
    const sorted = [...this.banners].sort((a, b) => a.displayOrder - b.displayOrder);
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
    this.log("reordered", a.title);
    this.persist();
    this.emit();
  }

  clearHistory() {
    this.history = [];
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

export type { SponsoredBanner, BannerImageTransform } from "./banner-model";
export { BANNER_TRANSFORM_DEFAULT, MAX_BANNERS, RECOMMENDED_BANNER } from "./banner-model";
export type { ActivityHistoryEntry, ActivityAction } from "./activity-model";
