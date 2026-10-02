"use client";

import React, { useEffect, useMemo, useState } from "react";
import PoolsHeaderStats from "../stats/PoolsHeaderStats";
import { useAppSelector } from "@/redux/hooks";
import { useNow } from "@/hooks/useNow";
import { getSubscribedValue } from "@/helpers/poolRewardsDisplay";
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
/**
 * How old data may get before the page warns about it, for every chain: how far a chain's newest included block
 * may trail the time its data was written ("behind"), and how long ago the data was written ("old", and the pool
 * page's data age). The pipeline normally runs minutes behind, Base most (it reads Base's `safe` block, and the
 * cron runs every 5 minutes), so a shorter limit flagged ordinary delays. Two hours leaves the warnings for data
 * that has actually stopped updating. `/api/health` keeps its own, shorter limit for monitoring.
 */
export const DATA_WARNING_MS = 2 * HOUR_MS;
export const STALE_FETCH_WARNING_MS = DATA_WARNING_MS;

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

// The chains whose newest included block trails their write time by more than DATA_WARNING_MS, with the lag,
// in label order. Without per-group freshness, the payload's own times stand in, named as "Chain".
function laggingChains({ sources, ...overall }: DataFreshness): [string, number][] {
  const lagOf = (meta: { fetchedAt: number | null; indexedAt: number | null } | undefined) =>
    meta?.fetchedAt == null || meta.indexedAt == null ? null : meta.fetchedAt - meta.indexedAt;
  const groups = Object.keys(GROUP_LABELS) as PoolGroup[];
  if (!groups.some((group) => sources[group])) {
    const lag = lagOf(overall);
    return lag !== null && lag > DATA_WARNING_MS ? [["Chain", lag]] : [];
  }
  const lagging: [string, number][] = [];
  for (const group of groups) {
    const lag = lagOf(sources[group]);
    if (lag !== null && lag > DATA_WARNING_MS) lagging.push([GROUP_LABELS[group], lag]);
  }
  return lagging;
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

/**
 * What the Subscribed Value Locked tile says when its total is empty for a known reason: every active Uniswap
 * pool's rewards were read and none has a live campaign. Null otherwise, so missing data still reads
 * "Unavailable".
 */
export function subscribedEmptyText(contracts: readonly unknown[], now: number): string | null {
  const uniswap = contracts.filter((contract) => (contract as { protocol?: string } | null)?.protocol === "uniswap");
  if (uniswap.length === 0) return null;
  const kinds = uniswap.map((contract) => getSubscribedValue(contract, now).kind);
  return kinds.every((kind) => kind === "none" || kind === "not-started") ? "No live campaign" : null;
}

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
  const behind = laggingChains(freshness);
  // An active group that failed to load has no fetch time, so it is named rather than left out.
  const failedGroups = (Object.keys(GROUP_LABELS) as PoolGroup[]).filter((group) => failed?.includes(group));
  if (ageMs === null && behind.length === 0 && failedGroups.length === 0) return null;

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
      {behind.map(([name, lag]) => (
        <p key={name} className="text-amber-400">
          {name} data is {formatDuration(lag)} behind
        </p>
      ))}
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
          stakedEmptyText={retriesExhausted ? null : subscribedEmptyText(Object.values(contracts ?? {}), now)}
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
