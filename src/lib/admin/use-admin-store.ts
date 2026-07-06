"use client";

import { useSyncExternalStore } from "react";
import { getAdminStore } from "./admin-store";

/**
 * React hook that subscribes to the admin store.
 *
 * Uses `useSyncExternalStore` so React 18+ can safely tear down and re-render
 * when the store changes. Components reading from this hook never hold their
 * own copy of state — they always see the latest snapshot.
 *
 * Both `getSnapshot` (client) and `getServerSnapshot` (SSR) return the same
 * cached snapshot reference so React doesn't enter an infinite loop.
 */
export function useAdminStore() {
  const store = getAdminStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
}
