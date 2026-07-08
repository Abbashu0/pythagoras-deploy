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
 */

import {
  ActivityAction,
  ACTIVITY_LABELS,
} from "./activity-model";
import { getAdminStore } from "./admin-store";

export interface ContentItem {
  id: string;
  label: string;
  /** Icon key from the student app's icon set. */
  icon: string;
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

export interface ContentSnapshot {
  items: ContentItem[];
  lastStorageError: string | null;
}

type Listener = () => void;

class ContentStore {
  private storageKey: string;
  private defaults: ContentItem[];
  private logPrefix: string;

  private items: ContentItem[] = [];
  private listeners: Set<Listener> = new Set();
  private hasLoadedFromStorage = false;

  lastStorageError: string | null = null;

  private snapshot: ContentSnapshot = {
    items: [],
    lastStorageError: null,
  };

  constructor(config: ContentStoreConfig) {
    this.storageKey = config.storageKey;
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
          .map((item) => ({
            ...this.defaults[0],
            ...item,
          }))
          .sort((a, b) => a.order - b.order);
      } else {
        this.items = this.defaults.map((i) => ({ ...i }));
      }
      this.persist();
      this.emit();
      return this.items.length > 0;
    } catch {
      this.items = this.defaults.map((i) => ({ ...i }));
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
      items: this.items,
      lastStorageError: this.lastStorageError,
    };
  }

  getSnapshot = (): ContentSnapshot => this.snapshot;
  getServerSnapshot = (): ContentSnapshot => this.snapshot;

  // ---------- Persistence ----------
  private persist() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.items));
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
      console.warn(
        `[ContentStore:${this.storageKey}] persist failed:`,
        this.lastStorageError,
        err
      );
    }
  }

  // ---------- Shared activity logging ----------
  private logActivity(
    action: ActivityAction,
    itemLabel: string,
    changeSummary?: string[]
  ) {
    getAdminStore().appendHistoryEntry({
      action,
      label: ACTIVITY_LABELS[action],
      bannerTitle: `${this.logPrefix}: ${itemLabel}`,
      thumbnail: "",
      changeSummary,
    });
  }

  // ---------- Mutations ----------
  /**
   * Commit a content item edit: apply the patch AND log exactly ONE
   * "edited" entry with a human-readable Arabic change summary.
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
      this.logActivity("edited", target.label, changeSummary);
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
}

// ============================================================
// Materials store (8 subjects)
// ============================================================

const MATERIALS_KEY = "pythagoras-admin-materials";

export const DEFAULT_MATERIALS: ContentItem[] = [
  { id: "islamic", label: "التربية الإسلامية", icon: "islamic", available: true, order: 0 },
  { id: "arabic", label: "اللغة العربية", icon: "arabic", available: true, order: 1 },
  { id: "english", label: "اللغة الإنجليزية", icon: "english", available: true, order: 2 },
  { id: "biology", label: "الأحياء", icon: "biology", available: true, order: 3 },
  { id: "math", label: "الرياضيات", icon: "math", available: true, order: 4 },
  { id: "chemistry", label: "الكيمياء", icon: "chemistry", available: true, order: 5 },
  { id: "physics", label: "الفيزياء", icon: "physics", available: true, order: 6 },
  { id: "french", label: "اللغة الفرنسية", icon: "french", available: false, order: 7 },
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
