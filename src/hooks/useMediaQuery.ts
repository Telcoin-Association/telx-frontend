import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `sm` breakpoint: below it, lists switch to their narrow layouts. */
export const NARROW_QUERY = "(max-width: 639.98px)";

/**
 * Whether `query` matches, following changes such as a rotated phone. The server and a browser without
 * `matchMedia` read false, so the first paint uses the wide layout and the client switches after hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
