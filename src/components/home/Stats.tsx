"use client";

import React, { useEffect, useMemo, useState } from "react";
import PoolsHeaderStats from "../stats/PoolsHeaderStats";
import { useAppSelector } from "@/redux/hooks";
import { useNow } from "@/hooks/useNow";
import {
  contractsErrorSelector,
  contractsSelector,
  dataFreshnessSelector,
  failedAttemptsSelector,
  hasFetchedDataSelector,
  LOAD_RETRY_DELAYS_MS,
  subscribedTotal,
  totalFeesSelector,
  totalLiquiditySelector,
  totalVolumeSelector,
} from "@/redux/slices/contractsSlice";
import { DataFreshness, PoolGroup } from "@/types/PoolMetrics";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const INDEXING_LAG_WARNING_MS = 30 * MINUTE_MS;
const STALE_FETCH_WARNING_MS = 30 * MINUTE_MS;

// Names for the stale and failed group lines, in the order they render.
const GROUP_LABELS: Record<PoolGroup, string> = {
  "uniswap-base": "Base",
  "uniswap-polygon": "Polygon",
  "uniswap-ethereum": "Ethereum",
};

// Whole minutes, hours or days, whichever keeps the number small: a feed that stalled for a
// week reads as "7 days", not "10080 min".
export function formatDuration(ms: number): string {
  if (ms >= DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (ms >= HOUR_MS) return `${Math.floor(ms / HOUR_MS)} hr`;
  return `${Math.floor(ms / MINUTE_MS)} min`;
}

// Largest gap between fetch time and indexed block time. Each group is compared with its own
// fetch time, because the oldest fetchedAt and oldest indexedAt can come from different groups.
function indexingLagMs({ sources, ...overall }: DataFreshness): number | null {
  const metas = Object.values(sources);
  let lag: number | null = null;
  for (const meta of metas.length > 0 ? metas : [overall]) {
    if (meta?.fetchedAt == null || meta.indexedAt == null) continue;
    lag = Math.max(lag ?? 0, meta.fetchedAt - meta.indexedAt);
  }
  return lag;
}

// Each group's fetch time, in label order. A group without a fetch time is skipped.
function groupFetchTimes({ sources }: DataFreshness): [PoolGroup, number][] {
  const times: [PoolGroup, number][] = [];
  for (const group of Object.keys(GROUP_LABELS) as PoolGroup[]) {
    const fetchedAt = sources[group]?.fetchedAt;
    if (fetchedAt != null) times.push([group, fetchedAt]);
  }
  return times;
}

// Hover text for the "partial" marker on the header totals while an active group failed to load, or null
// when every group loaded. `failed` lists only groups with an active pool, so each one is missing from the sums.
export function partialTotalsNote(freshness: DataFreshness | null): string | null {
  const failed = freshness?.failed;
  if (!failed?.length) return null;
  const names = (Object.keys(GROUP_LABELS) as PoolGroup[]).filter(group => failed.includes(group)).map(group => GROUP_LABELS[group]);
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Partial total: excludes ${list} pools, whose data is unavailable`;
}

const CHAIN_LABELS: Record<string, string> = { base: "Base", polygon: "Polygon", ethereum: "Ethereum" };

// Hover text for the "partial" marker on the Subscribed Value Locked total alone, for the chains whose pool
// data loaded but whose subscribed value is unavailable (rewards unknown), or null when there are none.
export function subscribedPartialNote(partialChains: readonly string[]): string | null {
  const names = Object.keys(CHAIN_LABELS).filter(chain => partialChains.includes(chain)).map(chain => CHAIN_LABELS[chain]);
  if (names.length === 0) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Partial total: excludes ${list} pools, whose rewards data is unavailable`;
}

function DataFreshnessNote({ freshness }: { freshness: DataFreshness }) {
  const { fetchedAt, failed } = freshness;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (fetchedAt == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(timer);
  }, [fetchedAt]);

  // Date the note by the newest group, not the oldest. A frozen group's numbers are not what the
  // totals show, so its age would misdate them. Each stale group is named on its own line instead.
  const groupTimes = groupFetchTimes(freshness);
  const newest = groupTimes.length > 0 ? Math.max(...groupTimes.map(([, time]) => time)) : fetchedAt;
  const ageMs = newest == null ? null : now - newest;
  const staleGroups = groupTimes.filter(([, time]) => now - time > STALE_FETCH_WARNING_MS);
  const lag = indexingLagMs(freshness);
  const isBehind = lag !== null && lag > INDEXING_LAG_WARNING_MS;
  // An active group that failed to load has no fetch time, so it is named rather than left out.
  const failedGroups = (Object.keys(GROUP_LABELS) as PoolGroup[]).filter((group) => failed?.includes(group));
  if (ageMs === null && !isBehind && failedGroups.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col items-end gap-1 text-xs">
      {ageMs !== null && <p className="text-primary">{ageMs < MINUTE_MS ? "Updated just now" : `Updated ${formatDuration(ageMs)} ago`}</p>}
      {staleGroups.map(([group, time]) => (
        <p key={group} className="text-amber-400">
          {GROUP_LABELS[group]} data is {formatDuration(now - time)} old
        </p>
      ))}
      {failedGroups.map((group) => (
        <p key={group} className="text-amber-400">
          {GROUP_LABELS[group]} data is unavailable
        </p>
      ))}
      {isBehind && <p className="text-amber-400">Chain data is {formatDuration(lag)} behind</p>}
    </div>
  );
}

export default function StatsCards() {
  const totalLiquidity = useAppSelector(totalLiquiditySelector);
  // The subscribed total is computed at the current minute rather than stored at load, so a campaign that
  // ends while the tab is open leaves the total without waiting for the next load.
  const contracts = useAppSelector(contractsSelector);
  const now = useNow();
  const subscribed = useMemo(() => subscribedTotal(Object.values(contracts ?? {}), now), [contracts, now]);
  const totalVolume = useAppSelector(totalVolumeSelector);
  const totalFee = useAppSelector(totalFeesSelector);
  const dataFreshness = useAppSelector(dataFreshnessSelector);
  const lastError = useAppSelector(contractsErrorSelector);
  const failedAttempts = useAppSelector(failedAttemptsSelector);
  const hasFetchedData = useAppSelector(hasFetchedDataSelector);
  const retriesExhausted = lastError !== null && failedAttempts > LOAD_RETRY_DELAYS_MS.length;
  // A null total after a completed load means no pool had a value; only a load still in progress spins.
  const unavailable = retriesExhausted || (hasFetchedData && lastError === null);

  const liquidityData = {
    totalLiquidity: totalLiquidity,
    stakedLiquidity: subscribed.total,
    totalVolume: totalVolume,
    totalFees: totalFee,
  };
  return (
    <>
      {liquidityData && (
        <PoolsHeaderStats
          {...liquidityData}
          unavailable={unavailable}
          partialNote={partialTotalsNote(dataFreshness)}
          stakedPartialNote={subscribedPartialNote(subscribed.partialChains)}
        />
      )}
      {lastError !== null && (
        <p className="mt-2 text-right text-xs text-amber-400">
          {retriesExhausted ? "Pool data could not be loaded. Reload the page to try again." : "Loading pool data failed, retrying"}
        </p>
      )}
      {dataFreshness && <DataFreshnessNote freshness={dataFreshness} />}
    </>
  );
}
