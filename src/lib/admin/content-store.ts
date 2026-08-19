"use client";

/**
 * ContentStore — generic store for ordered + toggleable admin lists.
 *
 * Used today by:
 *   - Materials manager (`/admin/materials`) — 8 subjects.
 *   - Tools manager (`/admin/tools`) — 5 tools.
 *
 * Both have the SAME shape:
 *   { id, label, icon, available, order }
 *
 * so they share a single store class. Each instance is bound to its own
 * localStorage key + default items + activity log "subject" prefix.
 *
 * Architecture mirrors `NavStore` / `AdminStore`:
 *   - Plain JS class, not React state.
 *   - `loadFromStorage()` called from a useEffect (client-only).
 *   - Activity log entries are routed through AdminStore's shared
 *     `appendHistoryEntry(...)` so every admin sub-system shows up in
 *     the same `ActivityHistory` panel.
 *   - When the backend arrives, swap localStorage for API calls.
 *
 * Global materials appearance settings
 * --------------------------------------
 * The materials store also owns FOUR global card-appearance settings
 * that apply to every material card in the student app:
 *
 *   - fadeIntensity        (0..1, default 0.72)
 *     Bottom-up black overlay alpha — higher = darker bottom = more
 *     legible white title text over busy images.
 *
 *   - textVerticalPosition (-100..+100, default 0)
     Vertical offset of the title block. 0 = vertically centered,
 *   +100 = top, -100 = bottom.
 *
 *   - textScale            (0.8..1.4, default 1)
 *     Multiplier applied to the title font sizes.
 *
 *   - cardHeight           (160..340 px, default 213)
 *     Fixed pixel height of every material card.
 *
 * All four are persisted together as a single JSON object under
 * `<storageKey>-settings` (e.g. `pythagoras-admin-materials-settings`).
 * The legacy `<storageKey>-fade` plain-string key is read ONCE on load
 * for backward compatibility (then ignored in favor of the new JSON).
 */

import {
  ActivityAction,
  ACTIVITY_LABELS,
} from "./activity-model";
import { getAdminStore } from "./admin-store";
import type { BannerImageTransform } from "./banner-model";
import { getImageSync, preloadAllImages } from "./image-db";

export interface ContentItem {
  id: string;
  /** Arabic title shown on the card (e.g. "الأحياء"). */
  label: string;
  /** English title in caps (e.g. "BIOLOGY"). Optional. */
  englishTitle?: string;
  /** Icon key from the student app's icon set. Kept for compatibility
   *  with older code that still renders an icon glyph. The new student
   *  materials page renders an image instead. */
  icon: string;
  /** Data URL of the uploaded card image. Empty string = use the
   *  gradient fallback. NOTE: in localStorage this field is stripped to
   *  "" when `imageKey` is set (the actual image data lives in
   *  IndexedDB). The in-memory copy is hydrated from IndexedDB. */
  image?: string;
  /** IndexedDB key for the image (e.g. "mat-biology"). When this is
   *  set, the student app looks up the image from IndexedDB instead of
   *  reading `image` directly. Keeps localStorage tiny. */
  imageKey?: string;
  /** Fallback CSS background (gradient) shown when no image is uploaded. */
  gradient?: string;
  /** Saved image positioning (drag + zoom) chosen in the admin image
   *  positioner. Same shape as SponsoredBanner.transform so we can reuse
   *  the ImagePositioner component. */
  transform?: BannerImageTransform;
  available: boolean;
  order: number;
}

export type ContentItemInput = Omit<ContentItem, "id">;

export interface ContentStoreConfig {
  /** localStorage key — where the list is persisted. */
  storageKey: string;
  /** Default items used on first visit (or when storage is corrupt). */
  defaults: ContentItem[];
  /**
   * Short Arabic word used as a prefix in activity log titles so the
   * shared history can distinguish "مواد: الأحياء" from "أدوات: بومودورو".
   */
  logPrefix: string;
}

/**
 * Global material-card appearance settings. All four fields are
 * persisted together as JSON under `<storageKey>-settings`.
 */
export interface MaterialsSettings {
  /** Bottom-up black overlay alpha (0..1). */
  fadeIntensity: number;
  /** Vertical offset of the title block (-100..+100). 0 = centered. */
  textVerticalPosition: number;
  /** Title font scale multiplier (0.8..1.4). */
  textScale: number;
  /** Fixed card height in px (160..340). */
  cardHeight: number;
}

export const DEFAULT_MATERIALS_SETTINGS: MaterialsSettings = {
  fadeIntensity: 0.72,
  textVerticalPosition: 0,
  textScale: 1,
  cardHeight: 213,
};

/** Clamp a number to [min, max]. NaN/Infinity → min. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export interface ContentSnapshot {
  items: ContentItem[];
  /** Global appearance settings — see `MaterialsSettings` doc. */
  fadeIntensity: number;
  textVerticalPosition: number;
  textScale: number;
  cardHeight: number;
  lastStorageError: string | null;
}

type Listener = () => void;

class ContentStore {
  private storageKey: string;
  /**
   * Legacy localStorage key that previously held the fade intensity as
   * a plain decimal string ("0.72"). Kept ONLY for one-time migration
   * — we now persist all four settings together under `settingsStorageKey`.
   */
  private fadeStorageKey: string;
  /** Combined JSON key for all four appearance settings. */
  private settingsStorageKey: string;
  private defaults: ContentItem[];
  private logPrefix: string;

  private items: ContentItem[] = [];

  // ---- Global appearance settings (defaults match the student app) ----
  fadeIntensity: number = DEFAULT_MATERIALS_SETTINGS.fadeIntensity;
  textVerticalPosition: number = DEFAULT_MATERIALS_SETTINGS.textVerticalPosition;
  textScale: number = DEFAULT_MATERIALS_SETTINGS.textScale;
  cardHeight: number = DEFAULT_MATERIALS_SETTINGS.cardHeight;

  private listeners: Set<Listener> = new Set();
  private hasLoadedFromStorage = false;

  lastStorageError: string | null = null;

  private snapshot: ContentSnapshot = {
    items: [],
    fadeIntensity: DEFAULT_MATERIALS_SETTINGS.fadeIntensity,
    textVerticalPosition: DEFAULT_MATERIALS_SETTINGS.textVerticalPosition,
    textScale: DEFAULT_MATERIALS_SETTINGS.textScale,
    cardHeight: DEFAULT_MATERIALS_SETTINGS.cardHeight,
    lastStorageError: null,
  };

  constructor(config: ContentStoreConfig) {
    this.storageKey = config.storageKey;
    this.fadeStorageKey = `${config.storageKey}-fade`;
    this.settingsStorageKey = `${config.storageKey}-settings`;
    this.defaults = config.defaults.map((i) => ({ ...i }));
    this.logPrefix = config.logPrefix;
    this.rebuildSnapshot();
  }

  loadFromStorage(): boolean {
    if (this.hasLoadedFromStorage) return this.items.length > 0;
    this.hasLoadedFromStorage = true;
    if (typeof window === "undefined") return false;
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as ContentItem[];
        this.items = parsed
          .map((item) => {
            const merged = { ...this.defaults[0], ...item };
            // SANITIZER: drop large data URLs (they live in IndexedDB).
            if (
              typeof merged.image === "string" &&
              merged.image.startsWith("data:") &&
              merged.image.length > 1000
            ) {
              merged.image = "";
            }
            // HYDRATION: resolve imageKey from IndexedDB cache.
            if (merged.imageKey && (!merged.image || merged.image.length === 0)) {
              const dataUrl = getImageSync(merged.imageKey);
              if (dataUrl) merged.image = dataUrl;
            }
            return merged;
          })
          .sort((a, b) => a.order - b.order);
      } else {
        this.items = this.defaults.map((i) => ({ ...i }));
      }
      // Load all four appearance settings from the combined JSON key.
      // Falls back to the legacy `-fade` plain-string key for migration
      // when the new key hasn't been written yet.
      this.loadSettingsFromStorage();
      this.persist();
      this.persistSettings();
      this.emit();
      return this.items.length > 0;
    } catch {
      this.items = this.defaults.map((i) => ({ ...i }));
      this.persist();
      this.persistSettings();
      this.emit();
      return true;
    }
  }

  /**
   * Asynchronously hydrate item images from IndexedDB.
   * Call after loadFromStorage() on admin pages so list cards + the
   * editor + live preview can render uploaded images.
   */
  async hydrateImagesFromIDB(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      await preloadAllImages();
      let changed = false;
      this.items = this.items.map((item) => {
        if (item.imageKey && (!item.image || item.image.length === 0)) {
          const dataUrl = getImageSync(item.imageKey);
          if (dataUrl) {
            changed = true;
            return { ...item, image: dataUrl };
          }
        }
        return item;
      });
      if (changed) this.emit();
    } catch (e) {
      console.warn(`[ContentStore:${this.storageKey}] hydrateImagesFromIDB failed:`, e);
    }
  }

  /**
   * Read the combined appearance-settings JSON from localStorage and
   * populate the four `*Settings` fields. Handles three cases:
   *
   *   1. New JSON key present → parse + clamp each field.
   *   2. Legacy `-fade` plain-string key present (and new key absent)
   *      → migrate just the fadeIntensity value.
   *   3. Neither key present → keep the in-memory defaults.
   */
  private loadSettingsFromStorage() {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(this.settingsStorageKey);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as Partial<MaterialsSettings>;
        if (parsed) {
          if (
            typeof parsed.fadeIntensity === "number" &&
            Number.isFinite(parsed.fadeIntensity)
          ) {
            this.fadeIntensity = clamp(parsed.fadeIntensity, 0, 1);
          }
          if (
            typeof parsed.textVerticalPosition === "number" &&
            Number.isFinite(parsed.textVerticalPosition)
          ) {
            this.textVerticalPosition = clamp(
              parsed.textVerticalPosition,
              -100,
              100
            );
          }
          if (
            typeof parsed.textScale === "number" &&
            Number.isFinite(parsed.textScale)
          ) {
            this.textScale = clamp(parsed.textScale, 0.8, 1.4);
          }
          if (
            typeof parsed.cardHeight === "number" &&
            Number.isFinite(parsed.cardHeight)
          ) {
            this.cardHeight = clamp(Math.round(parsed.cardHeight), 160, 340);
          }
        }
        return;
      }
      // Migration: read the legacy plain-string fade key.
      const fadeRaw = localStorage.getItem(this.fadeStorageKey);
      if (fadeRaw !== null) {
        const fadeVal = Number.parseFloat(fadeRaw);
        if (Number.isFinite(fadeVal)) {
          this.fadeIntensity = clamp(fadeVal, 0, 1);
        }
      }
    } catch {
      /* noop — keep defaults if settings JSON is unreadable */
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
      items: this.items,
      fadeIntensity: this.fadeIntensity,
      textVerticalPosition: this.textVerticalPosition,
      textScale: this.textScale,
      cardHeight: this.cardHeight,
      lastStorageError: this.lastStorageError,
    };
  }

  getSnapshot = (): ContentSnapshot => this.snapshot;
  getServerSnapshot = (): ContentSnapshot => this.snapshot;

  // ---------- Persistence ----------
  private persist() {
    if (typeof window === "undefined") return;
    try {
      // CRITICAL: Strip image DATA URLs from items before saving to
      // localStorage. The image data lives in IndexedDB (via imageKey).
      const itemsForStorage = this.items.map((item) => {
        if (item.imageKey) return { ...item, image: "" };
        if (
          typeof item.image === "string" &&
          item.image.startsWith("data:") &&
          item.image.length > 1000
        ) {
          return { ...item, image: "" };
        }
        return item;
      });
      localStorage.setItem(this.storageKey, JSON.stringify(itemsForStorage));
      this.lastStorageError = null;
    } catch (err) {
      const isQuota =
        err instanceof DOMException &&
        (err.name === "QuotaExceededError" ||
          err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          err.code === 22 ||
          err.code === 1014);

      // Recovery: clear the key and retry with sanitized data.
      if (isQuota) {
        try {
          localStorage.removeItem(this.storageKey);
          const itemsForStorage = this.items.map((item) => {
            if (item.imageKey) return { ...item, image: "" };
            if (
              typeof item.image === "string" &&
              item.image.startsWith("data:") &&
              item.image.length > 1000
            ) {
              return { ...item, image: "" };
            }
            return item;
          });
          localStorage.setItem(this.storageKey, JSON.stringify(itemsForStorage));
          this.lastStorageError = null;
          console.info(`[ContentStore:${this.storageKey}] Recovery successful after quota error.`);
          return;
        } catch (recoveryErr) {
          console.error(`[ContentStore:${this.storageKey}] Recovery write also failed:`, recoveryErr);
        }
      }

      this.lastStorageError = isQuota
        ? "امتلأت مساحة التخزين المحلية."
        : `خطأ في الحفظ: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(
        `[ContentStore:${this.storageKey}] persist failed:`,
        this.lastStorageError,
        err
      );
    }
  }

  /**
   * Persist all four appearance settings to the combined JSON key.
   * The student app reads this same JSON via `getMaterialsSettings()`
   * so admin changes take effect for students on next page load.
   */
  private persistSettings() {
    if (typeof window === "undefined") return;
    try {
      const settings: MaterialsSettings = {
        fadeIntensity: this.fadeIntensity,
        textVerticalPosition: this.textVerticalPosition,
        textScale: this.textScale,
        cardHeight: this.cardHeight,
      };
      localStorage.setItem(
        this.settingsStorageKey,
        JSON.stringify(settings)
      );
    } catch (err) {
      console.warn(
        `[ContentStore:${this.settingsStorageKey}] persist failed:`,
        err
      );
    }
  }

  // ---------- Shared activity logging ----------
  /**
   * Append one activity history entry via the shared AdminStore channel.
   *
   * `thumbnail` should be the material's image data URL (or gradient
   * fallback) for image-affecting changes so the ActivityHistory panel
   * can show a preview thumbnail. For settings changes (no specific
   * material), pass an empty string — the panel will fall back to the
   * action icon.
   */
  private logActivity(
    action: ActivityAction,
    itemLabel: string,
    changeSummary?: string[],
    thumbnail: string = ""
  ) {
    getAdminStore().appendHistoryEntry({
      action,
      label: ACTIVITY_LABELS[action],
      bannerTitle: `${this.logPrefix}: ${itemLabel}`,
      thumbnail,
      changeSummary,
    });
  }

  // ---------- Mutations ----------
  /**
   * Commit a content item edit: apply the patch AND log exactly ONE
   * "edited" entry with a human-readable Arabic change summary. The
   * activity entry's thumbnail is the material's image (or gradient
   * fallback) so the history panel can show what changed.
   */
  commitContentEdit(
    id: string,
    patch: Partial<Omit<ContentItem, "id" | "order">>,
    changeSummary: string[]
  ) {
    let target: ContentItem | undefined;
    this.items = this.items.map((item) => {
      if (item.id !== id) return item;
      const updated: ContentItem = { ...item, ...patch };
      target = updated;
      return updated;
    });
    if (target) {
      const thumbnail = target.imageKey
        ? `idb:${target.imageKey}`
        : target.gradient || "";
      this.logActivity("edited", target.label, changeSummary, thumbnail);
    }
    this.persist();
    this.emit();
  }

  /**
   * Swap a content item's order with its neighbor in the given
   * direction ("up" = earlier, "down" = later). Logs a "reordered" entry.
   */
  moveContentItem(id: string, direction: "up" | "down") {
    const sorted = [...this.items].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[swapIdx];
    this.items = this.items.map((item) => {
      if (item.id === a.id) return { ...item, order: b.order };
      if (item.id === b.id) return { ...item, order: a.order };
      return item;
    });
    this.items.sort((x, y) => x.order - y.order);
    this.logActivity("reordered", a.label);
    this.persist();
    this.emit();
  }

  /**
   * Merge a partial set of appearance settings into the current values,
   * persist them, and log ONE "settings" activity entry listing every
   * changed field with from→to details. Emits a snapshot update so
   * subscribers re-render with the new values.
   *
   * All values are clamped to their valid ranges before being applied.
   */
  setMaterialsSettings(settings: Partial<MaterialsSettings>) {
    const prev: MaterialsSettings = {
      fadeIntensity: this.fadeIntensity,
      textVerticalPosition: this.textVerticalPosition,
      textScale: this.textScale,
      cardHeight: this.cardHeight,
    };

    const next: MaterialsSettings = {
      fadeIntensity:
        settings.fadeIntensity !== undefined
          ? clamp(settings.fadeIntensity, 0, 1)
          : prev.fadeIntensity,
      textVerticalPosition:
        settings.textVerticalPosition !== undefined
          ? clamp(settings.textVerticalPosition, -100, 100)
          : prev.textVerticalPosition,
      textScale:
        settings.textScale !== undefined
          ? clamp(settings.textScale, 0.8, 1.4)
          : prev.textScale,
      cardHeight:
        settings.cardHeight !== undefined
          ? clamp(Math.round(settings.cardHeight), 160, 340)
          : prev.cardHeight,
    };

    this.fadeIntensity = next.fadeIntensity;
    this.textVerticalPosition = next.textVerticalPosition;
    this.textScale = next.textScale;
    this.cardHeight = next.cardHeight;

    // Build a human-readable Arabic change summary listing only the
    // fields that actually changed, with from→to details.
    const changeSummary: string[] = [];
    if (prev.fadeIntensity !== next.fadeIntensity) {
      changeSummary.push(
        `شدة التعتيم: من ${Math.round(prev.fadeIntensity * 100)}% إلى ${Math.round(next.fadeIntensity * 100)}%`
      );
    }
    if (prev.textVerticalPosition !== next.textVerticalPosition) {
      changeSummary.push(
        `الموضع العمودي للنص: من ${prev.textVerticalPosition} إلى ${next.textVerticalPosition}`
      );
    }
    if (prev.textScale !== next.textScale) {
      changeSummary.push(
        `حجم النص: من ${Math.round(prev.textScale * 100)}% إلى ${Math.round(next.textScale * 100)}%`
      );
    }
    if (prev.cardHeight !== next.cardHeight) {
      changeSummary.push(
        `ارتفاع البطاقة: من ${prev.cardHeight}px إلى ${next.cardHeight}px`
      );
    }

    this.persistSettings();

    if (changeSummary.length > 0) {
      // No thumbnail for global settings changes — the activity panel
      // will show the ⏱️ "settings" action icon instead.
      this.logActivity("settings", "إعدادات المظهر", changeSummary, "");
    }
    this.emit();
  }

  /**
   * Backward-compatible wrapper for `setMaterialsSettings({ fadeIntensity })`.
   * Kept so older callers (and any future code that only cares about
   * the fade overlay) can still call this method. Internally it routes
   * through the combined settings JSON.
   */
  setFadeIntensity(value: number) {
    this.setMaterialsSettings({ fadeIntensity: value });
  }
}

// ============================================================
// Materials store (8 subjects)
// ============================================================

const MATERIALS_KEY = "pythagoras-admin-materials";

export const DEFAULT_MATERIALS: ContentItem[] = [
  { id: "islamic", label: "التربية الإسلامية", englishTitle: "ISLAMIC", icon: "islamic", available: true, order: 0, image: "", gradient: "linear-gradient(135deg, #1a5c3a, #0d3a24)", transform: { offsetX: 0, offsetY: 0, scale: 1 } },
  { id: "arabic", label: "اللغة العربية", englishTitle: "ARABIC", icon: "arabic", available: true, order: 1, image: "", gradient: "linear-gradient(135deg, #8b4513, #5c2e0a)", transform: { offsetX: 0, offsetY: 0, scale: 1 } },
  { id: "english", label: "اللغة الإنجليزية", englishTitle: "ENGLISH", icon: "english", available: true, order: 2, image: "", gradient: "linear-gradient(135deg, #1e3a8a, #0f1e4a)", transform: { offsetX: 0, offsetY: 0, scale: 1 } },
  { id: "biology", label: "الأحياء", englishTitle: "BIOLOGY", icon: "biology", available: true, order: 3, image: "", gradient: "linear-gradient(135deg, #166534, #0a3d20)", transform: { offsetX: 0, offsetY: 0, scale: 1 } },
  { id: "math", label: "الرياضيات", englishTitle: "MATHEMATICS", icon: "math", available: true, order: 4, image: "", gradient: "linear-gradient(135deg, #7c2d12, #4a1a08)", transform: { offsetX: 0, offsetY: 0, scale: 1 } },
  { id: "chemistry", label: "الكيمياء", englishTitle: "CHEMISTRY", icon: "chemistry", available: true, order: 5, image: "", gradient: "linear-gradient(135deg, #581c87, #2e0a4a)", transform: { offsetX: 0, offsetY: 0, scale: 1 } },
  { id: "physics", label: "الفيزياء", englishTitle: "PHYSICS", icon: "physics", available: true, order: 6, image: "", gradient: "linear-gradient(135deg, #0c4a6e, #062840)", transform: { offsetX: 0, offsetY: 0, scale: 1 } },
  { id: "french", label: "اللغة الفرنسية", englishTitle: "FRENCH", icon: "french", available: false, order: 7, image: "", gradient: "linear-gradient(135deg, #1e40af, #0a1e5a)", transform: { offsetX: 0, offsetY: 0, scale: 1 } },
];

let materialsStoreInstance: ContentStore | null = null;

export function getMaterialsStore(): ContentStore {
  if (!materialsStoreInstance) {
    materialsStoreInstance = new ContentStore({
      storageKey: MATERIALS_KEY,
      defaults: DEFAULT_MATERIALS,
      logPrefix: "مواد",
    });
  }
  return materialsStoreInstance;
}

// ============================================================
// Tools store (5 tools)
// ============================================================

const TOOLS_KEY = "pythagoras-admin-tools";

export const DEFAULT_TOOLS: ContentItem[] = [
  { id: "spaced", label: "التكرار المتباعد", icon: "repeat", available: false, order: 0 },
  { id: "pomodoro", label: "بومودورو", icon: "timer", available: false, order: 1 },
  { id: "notebook", label: "دفتري", icon: "notebook", available: false, order: 2 },
  { id: "assistants", label: "المساعدون الأذكياء", icon: "brain", available: false, order: 3 },
  { id: "lectures", label: "المحاضرات", icon: "lectures", available: false, order: 4 },
];

let toolsStoreInstance: ContentStore | null = null;

export function getToolsStore(): ContentStore {
  if (!toolsStoreInstance) {
    toolsStoreInstance = new ContentStore({
      storageKey: TOOLS_KEY,
      defaults: DEFAULT_TOOLS,
      logPrefix: "أدوات",
    });
  }
  return toolsStoreInstance;
}
