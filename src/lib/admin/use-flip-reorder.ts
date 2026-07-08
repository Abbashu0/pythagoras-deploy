"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * useFlipReorder — animates DOM reordering of children using the FLIP
 * technique (First-Last-Invert-Play).
 *
 *   1. FIRST: read each child's bounding rect BEFORE the DOM update.
 *      (We stash these positions in a ref keyed by `data-flip-key`.)
 *   2. LAST:  read each child's bounding rect AFTER the DOM update.
 *      (React has already committed the new order by the time this
 *      layout effect runs.)
 *   3. INVERT: apply a `transform: translate(dx, dy)` that visually
 *      restores each child to its FIRST position — so the user sees
 *      no jump to the new position.
 *   4. PLAY:  in a `requestAnimationFrame`, drop the invert transform
 *      and add a `transition: transform <duration>ms` so the browser
 *      smoothly animates from the inverted (old) position to the
 *      natural (new) position.
 *
 * IMPORTANT: this hook uses `useLayoutEffect` (NOT useEffect) for the
 * FIRST + INVERT phases so the inverted position is applied BEFORE the
 * browser paints — otherwise the user would see a flash at the new
 * position before the animation kicks in. The PLAY phase runs inside
 * `requestAnimationFrame`, which fires after paint, so the transition
 * is visible.
 *
 * Each animated child MUST have a `data-flip-key` attribute. We track
 * positions by that key, so element identity survives reordering (React
 * can re-mount DOM nodes if keys change, but `data-flip-key` lets us
 * match the same logical item across renders).
 *
 * Animation is SKIPPED on the first render — there's no previous
 * position snapshot to compare against, so we just record positions
 * and bail.
 *
 * @example
 *   const containerRef = useRef<HTMLUListElement>(null);
 *   useFlipReorder(containerRef, items.map(i => i.id));
 *   return (
 *     <ul ref={containerRef}>
 *       {items.map(item => (
 *         <li key={item.id} data-flip-key={item.id}>...</li>
 *       ))}
 *     </ul>
 *   );
 *
 * @param containerRef  ref to the parent element whose children animate.
 * @param items         dependency array — whenever this changes (e.g. when
 *                      the order of item ids changes), we re-run the FLIP
 *                      animation. Pass a stable signature (e.g. array of
 *                      ids) so identity changes only happen on real
 *                      reorders.
 * @param duration      animation duration in ms. Default 300.
 */
export function useFlipReorder<T>(
  containerRef: React.RefObject<HTMLElement | null>,
  items: T[],
  duration = 300
) {
  // Map of data-flip-key → last known bounding rect (FIRST positions).
  const prevPositionsRef = useRef<Map<string, DOMRect>>(new Map());
  // First-render flag — skip animation when there's no prior snapshot.
  const isFirstRenderRef = useRef(true);
  // Track the active cleanup timer so we can cancel it on re-entry.
  const cleanupTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Collect current child positions (LAST positions).
    const children = Array.from(
      container.querySelectorAll<HTMLElement>("[data-flip-key]")
    );
    const currentPositions = new Map<string, DOMRect>();
    for (const child of children) {
      const key = child.getAttribute("data-flip-key");
      if (!key) continue;
      currentPositions.set(key, child.getBoundingClientRect());
    }

    // Skip animation on first render — just record positions and bail.
    // This avoids a spurious animation from (0,0) on mount.
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      prevPositionsRef.current = currentPositions;
      return;
    }

    const prev = prevPositionsRef.current;
    const playQueue: Array<() => void> = [];

    // FIRST + INVERT phase: for each current child, compute the delta
    // from its previous position and apply an inverse transform.
    // This must happen synchronously before paint (which is why we're
    // in useLayoutEffect) so the user never sees the un-inverted new
    // position.
    for (const child of children) {
      const key = child.getAttribute("data-flip-key");
      if (!key) continue;
      const prevRect = prev.get(key);
      const currRect = currentPositions.get(key);
      if (!prevRect || !currRect) continue;

      const dx = prevRect.left - currRect.left;
      const dy = prevRect.top - currRect.top;
      // No delta → no animation needed for this child.
      if (dx === 0 && dy === 0) continue;

      // INVERT: visually move child back to its previous position.
      // `transition: none` ensures the transform applies instantly
      // (no easing from the previous animation).
      child.style.transition = "none";
      child.style.transform = `translate(${dx}px, ${dy}px)`;

      // PLAY (deferred to next frame): remove the invert transform
      // and add a transition so the browser animates from the
      // inverted (old) position to the natural (new) position.
      playQueue.push(() => {
        child.style.transition = `transform ${duration}ms ease`;
        child.style.transform = "";
      });
    }

    if (playQueue.length > 0) {
      // Double-rAF ensures the INVERT transform has been committed by
      // the compositor before we transition it away. A single rAF is
      // usually enough but the double-rAF pattern is more robust
      // across browsers.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          for (const play of playQueue) play();
        });
      });
    }

    // Save current positions for the next run.
    prevPositionsRef.current = currentPositions;

    // Cleanup: clear inline transition/transform after the animation
    // finishes so future style changes aren't blocked by a stale
    // inline transition. Also cancel any previous pending cleanup
    // timer so we don't wipe styles mid-animation on rapid reorders.
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
    }
    cleanupTimerRef.current = window.setTimeout(() => {
      for (const child of children) {
        // Only clear if we set them — checking first avoids clobbering
        // any consumer-authored inline styles.
        if (child.style.transform === "") {
          child.style.transition = "";
        }
      }
      cleanupTimerRef.current = null;
    }, duration + 60);

    return () => {
      if (cleanupTimerRef.current !== null) {
        window.clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    };
    // We pass `[items]` (NOT spreading `items`) as the dependency array.
    // Spreading would change the array SIZE between renders (e.g. from []
    // to [5 items] when data loads from localStorage), which React rejects
    // with "changed size between renders". Wrapping in a single-element
    // array keeps the dependency array size constant at 1, while still
    // re-running the effect whenever `items` changes by reference.
  }, [items]);
}
