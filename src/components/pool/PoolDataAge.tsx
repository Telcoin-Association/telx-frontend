"use client";

import React from "react";
import { useAppSelector } from "@/redux/hooks";
import {
  contractsErrorSelector,
  dataFreshnessSelector,
  failedAttemptsSelector,
  LOAD_RETRY_DELAYS_MS,
  refreshErrorSelector,
} from "@/redux/slices/contractsSlice";
import { poolGroupOf } from "@/helpers/prefetchPoolData";
import { isArchivedPool } from "@/lib/archivedPool";
import { useNow } from "@/hooks/useNow";
import { formatDuration, STALE_FETCH_WARNING_MS } from "@/components/home/Stats";

type PoolForAge = { protocol?: string; blockchain?: string; active?: boolean };

/**
 * How old a pool page's live figures are, from the fetch time of the pool's own chain data rather than the
 * time the page loaded, since a chain can fall back to older data. Past STALE_FETCH_WARNING_MS the age turns
 * amber, and while refreshes are failing the page says its figures may be out of date. Archived pools have
 * no live figures, so they show nothing.
 */
export default function PoolDataAge({ pool }: { pool: PoolForAge }) {
  const freshness = useAppSelector(dataFreshnessSelector);
  const refreshError = useAppSelector(refreshErrorSelector);
  const lastError = useAppSelector(contractsErrorSelector);
  const failedAttempts = useAppSelector(failedAttemptsSelector);
  const now = useNow();

  if (isArchivedPool(pool)) return null;
  const group = poolGroupOf({ protocol: pool.protocol ?? "", blockchain: pool.blockchain ?? "" });
  const fetchedAt = group ? freshness?.sources?.[group]?.fetchedAt ?? null : null;
  const refreshFailing = refreshError !== null || (lastError !== null && failedAttempts > 0);
  if (fetchedAt === null && !refreshFailing) return null;

  const age = fetchedAt === null ? null : Math.max(now - fetchedAt, 0);
  const stale = age !== null && age > STALE_FETCH_WARNING_MS;
  const retrying = lastError !== null && failedAttempts <= LOAD_RETRY_DELAYS_MS.length;

  return (
    <div className="flex flex-col gap-1 px-4 text-xs md:px-0" data-testid="pool-data-age">
      {age !== null && (
        <p className={stale ? "text-amber-400" : "text-primary"}>{age < 60_000 ? "Updated just now" : `Updated ${formatDuration(age)} ago`}</p>
      )}
      {refreshFailing && (
        <p role="status" className="text-amber-400">
          {retrying ? "Refreshing pool data failed, retrying." : "Refreshing pool data failed, so these figures may be out of date."}
        </p>
      )}
    </div>
  );
}
