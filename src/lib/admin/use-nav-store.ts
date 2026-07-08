"use client";
import { useSyncExternalStore } from "react";
import { getNavStore } from "./nav-store";

export function useNavStore() {
  const store = getNavStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
}
