import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import {
  contractsErrorSelector,
  contractsLoadingSelector,
  failedAttemptsSelector,
  fetchAllContractData,
  hasFetchedDataSelector,
  loadedAtSelector,
  LOAD_RETRY_DELAYS_MS,
} from "@/redux/slices/contractsSlice";

/** How old the pool data on screen may get before a background refresh: the cadence the crons write at. */
export const POOL_REFRESH_INTERVAL_MS = 5 * 60_000;

/** How often a visible tab checks whether its pool data is due for a refresh. */
export const POOL_REFRESH_CHECK_MS = 60_000;

/**
 * Keeps an open tab's pool data current. While the tab is visible, pool data older than
 * POOL_REFRESH_INTERVAL_MS is reloaded in the background, and a hidden tab that becomes visible again
 * refreshes at once if it is due. A refresh waits while a load is in flight or a failed load still has a
 * retry to come (AppLayout retries after each of LOAD_RETRY_DELAYS_MS). Once those retries are used up the
 * refresh takes over again, so a tab recovers on its own when the data source does. A failed refresh is
 * tried again one interval later rather than on every check.
 */
export function usePoolDataRefresh(address: string | undefined) {
  const dispatch = useAppDispatch();
  const hasFetchedData = useAppSelector(hasFetchedDataSelector);
  const loadedAt = useAppSelector(loadedAtSelector);
  const loading = useAppSelector(contractsLoadingSelector);
  const lastError = useAppSelector(contractsErrorSelector);
  const failedAttempts = useAppSelector(failedAttemptsSelector);
  const retryPending = lastError !== null && failedAttempts <= LOAD_RETRY_DELAYS_MS.length;
  const busy = loading || retryPending;

  // Read inside the timer and listener through refs, so they are not re-registered on every load.
  const latest = useRef({ address, loadedAt, busy });
  latest.current = { address, loadedAt, busy };
  const lastAttemptAt = useRef(0);

  useEffect(() => {
    if (!hasFetchedData) return;

    const refreshIfDue = () => {
      if (document.visibilityState !== "visible") return;
      const { address: current, loadedAt: loaded, busy } = latest.current;
      if (busy) return;
      const now = Date.now();
      if (now - Math.max(loaded ?? 0, lastAttemptAt.current) < POOL_REFRESH_INTERVAL_MS) return;
      lastAttemptAt.current = now;
      dispatch(fetchAllContractData({ address: current, background: true }));
    };

    const timer = setInterval(refreshIfDue, POOL_REFRESH_CHECK_MS);
    document.addEventListener("visibilitychange", refreshIfDue);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfDue);
    };
  }, [hasFetchedData, dispatch]);
}
