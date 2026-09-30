import { useSyncExternalStore } from "react";

/** How often the shared clock ticks. Campaign starts and ends show on screen at most this late. */
export const CLOCK_TICK_MS = 60_000;

// The time rounded down to the tick, so every read within one tick returns the same value, as
// useSyncExternalStore requires of a snapshot.
const tickNow = () => Math.floor(Date.now() / CLOCK_TICK_MS) * CLOCK_TICK_MS;

// One interval serves every subscriber, so a list with many rows adds no timers per row.
const listeners = new Set<() => void>();
let current = tickNow();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    current = tickNow();
    timer = setInterval(() => {
      current = tickNow();
      listeners.forEach((notify) => notify());
    }, CLOCK_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// With no subscribers the interval is stopped, so a first read computes the time afresh.
const getSnapshot = () => (timer === null ? tickNow() : current);

/**
 * The current time in unix ms, rounded down to the minute, re-rendering the caller once a minute. Components that compare a date with
 * the clock (a campaign that ends while the tab is open) read the time here so they update on their own,
 * without waiting for the next data load.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
