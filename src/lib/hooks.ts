"use client";

import * as React from "react";

/** SSR-safe media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

const noopSubscribe = () => () => {};

/**
 * True once mounted on the client — for anything that must not SSR.
 * Implemented with useSyncExternalStore rather than an effect+setState so the
 * server and client snapshots are explicit and there is no cascading render.
 */
export function useMounted(): boolean {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Copy-to-clipboard with a self-resetting "copied" flag.
 * Falls back to a hidden textarea when the async clipboard is unavailable.
 */
export function useCopyToClipboard(resetAfter = 1600) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = React.useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetAfter);
        return true;
      } catch {
        return false;
      }
    },
    [resetAfter],
  );

  return { copied, copy };
}

/**
 * Global keyboard shortcut. `combo` uses a "mod+k" / "shift+/" grammar where
 * `mod` maps to ⌘ on Apple platforms and Ctrl elsewhere.
 */
export function useHotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options: { enabled?: boolean; allowInInputs?: boolean } = {},
) {
  const { enabled = true, allowInInputs = false } = options;

  // The handler is kept in a ref so the listener is bound once per combo rather
  // than on every render, but the ref is written in an effect (never during
  // render) so it stays safe under concurrent rendering.
  const handlerRef = React.useRef(handler);
  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  React.useEffect(() => {
    if (!enabled) return;

    const parts = combo.toLowerCase().split("+");
    const key = parts[parts.length - 1];
    const needMod = parts.includes("mod");
    const needShift = parts.includes("shift");
    const needAlt = parts.includes("alt");

    const onKeyDown = (event: KeyboardEvent) => {
      if (!allowInInputs) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target?.isContentEditable
        ) {
          return;
        }
      }
      const isApple =
        typeof navigator !== "undefined" &&
        /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
      const mod = isApple ? event.metaKey : event.ctrlKey;

      if (needMod !== mod) return;
      if (needShift !== event.shiftKey) return;
      if (needAlt !== event.altKey) return;
      if (event.key.toLowerCase() !== key) return;

      event.preventDefault();
      handlerRef.current(event);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combo, enabled, allowInInputs]);
}

/** Warns before a browser-level navigation while changes are unsaved. */
export function useUnsavedChangesGuard(dirty: boolean) {
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/**
 * Async action with preserved geometry: `idle → pending → success → idle`.
 * Buttons use this so their width never changes mid-flight.
 */
export type AsyncActionState = "idle" | "pending" | "success" | "error";

export function useAsyncAction(
  action: () => Promise<unknown> | unknown,
  options: { successFor?: number; errorFor?: number } = {},
) {
  const { successFor = 1400, errorFor = 2600 } = options;
  const [state, setState] = React.useState<AsyncActionState>("idle");
  const timer = React.useRef<number | null>(null);
  const inflight = React.useRef(false);

  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const run = React.useCallback(async () => {
    if (inflight.current) return; // duplicate submission guard
    inflight.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    setState("pending");
    try {
      await action();
      setState("success");
      timer.current = window.setTimeout(() => setState("idle"), successFor);
    } catch {
      setState("error");
      timer.current = window.setTimeout(() => setState("idle"), errorFor);
    } finally {
      inflight.current = false;
    }
  }, [action, successFor, errorFor]);

  const reset = React.useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setState("idle");
  }, []);

  return { state, run, reset, isPending: state === "pending" };
}

/** ResizeObserver-backed element size. */
export function useElementSize<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}

/* ---------------------------------------------------------------------------
   usePersistentState
   ---------------------------------------------------------------------------
   Persisted UI preference (sidebar collapsed, density, saved views…).

   localStorage is treated as an external store via useSyncExternalStore rather
   than being read inside an effect. That gives three things an effect cannot:
   the server snapshot is explicit (so hydration is predictable), two components
   reading the same key stay in sync, and there is no render → effect → render
   cascade on every mount.
   ------------------------------------------------------------------------ */

const storeListeners = new Map<string, Set<() => void>>();

function emitStoreChange(key: string) {
  storeListeners.get(key)?.forEach((fn) => fn());
}

function subscribeToKey(key: string, onChange: () => void) {
  let set = storeListeners.get(key);
  if (!set) {
    set = new Set();
    storeListeners.set(key, set);
  }
  set.add(onChange);

  // Also react to writes from other tabs.
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) onChange();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    set?.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePersistentState<T>(key: string, initial: T) {
  const subscribe = React.useCallback(
    (onChange: () => void) => subscribeToKey(key, onChange),
    [key],
  );

  const raw = React.useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null, // server snapshot: always the caller's default
  );

  const value = React.useMemo<T>(() => {
    if (raw == null) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
    // `initial` is intentionally excluded: an inline object literal default
    // would otherwise re-parse on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const setValue = React.useCallback(
    (next: T | ((prev: T) => T)) => {
      let resolved: T;
      try {
        const currentRaw = window.localStorage.getItem(key);
        const current =
          currentRaw != null ? (JSON.parse(currentRaw) as T) : initial;
        resolved =
          typeof next === "function"
            ? (next as (prev: T) => T)(current)
            : next;
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        return;
      }
      emitStoreChange(key);
    },
    [key, initial],
  );

  return [value, setValue] as const;
}

/** Stable id for label/aria wiring. */
export function useId(prefix = "pyth"): string {
  const id = React.useId();
  return `${prefix}${id.replace(/:/g, "")}`;
}

/** Tracks whether a scroll container has scrolled away from its start edge —
 *  used to raise sticky headers only when they actually overlap content. */
export function useScrolled(threshold = 4) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > threshold);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return { ref, scrolled };
}

/**
 * The previous value of a prop or state.
 * Uses the render-time state-adjustment pattern rather than a ref, so the value
 * is available on the *same* render in which it changed and never depends on
 * reading a ref during render.
 */
export function usePrevious<T>(value: T): T | undefined {
  const [pair, setPair] = React.useState<{ prev: T | undefined; current: T }>({
    prev: undefined,
    current: value,
  });
  if (pair.current !== value) {
    setPair({ prev: pair.current, current: value });
  }
  return pair.current !== value ? pair.current : pair.prev;
}

/**
 * Runs `reset` during render whenever `token` changes — the sanctioned way to
 * resynchronise local state with a prop without an effect. Used by dialogs that
 * must clear typed confirmations when they close, and by controlled fields that
 * mirror an external value.
 */
export function useResetOn(token: unknown, reset: () => void) {
  const [seen, setSeen] = React.useState(token);
  if (seen !== token) {
    setSeen(token);
    reset();
  }
}

/**
 * Local state that resynchronises whenever `source` changes identity.
 * Replaces the `useEffect(() => setState(prop), [prop])` anti-pattern.
 */
export function useSyncedState<T>(
  source: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState<T>(source);
  const [seen, setSeen] = React.useState<T>(source);
  if (seen !== source) {
    setSeen(source);
    setValue(source);
  }
  return [value, setValue];
}
