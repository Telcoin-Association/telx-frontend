"use client";

import React, { useEffect, useState } from "react";
import PoolsHeaderStats from "../stats/PoolsHeaderStats";
import { useAppSelector } from "@/redux/hooks";
import {
  contractsErrorSelector,
  dataFreshnessSelector,
  failedAttemptsSelector,
  hasFetchedDataSelector,
  LOAD_RETRY_DELAYS_MS,
  stakedLiquiditySelector,
  totalFeesSelector,
  totalLiquiditySelector,
  totalVolumeSelector,
} from "@/redux/slices/contractsSlice";
import { DataFreshness } from "@/types/PoolMetrics";

const MINUTE_MS = 60_000;
const INDEXING_LAG_WARNING_MS = 30 * MINUTE_MS;

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

function DataFreshnessNote({ freshness }: { freshness: DataFreshness }) {
  const { fetchedAt, hasIndexingErrors } = freshness;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (fetchedAt == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(timer);
  }, [fetchedAt]);

  const ageMinutes = fetchedAt == null ? null : Math.floor((now - fetchedAt) / MINUTE_MS);
  const lag = indexingLagMs(freshness);
  const isBehind = lag !== null && lag > INDEXING_LAG_WARNING_MS;
  if (ageMinutes === null && !isBehind && !hasIndexingErrors) return null;

  return (
    <div className="mt-2 flex flex-col items-end gap-1 text-xs">
      {ageMinutes !== null && <p className="text-primary">{ageMinutes < 1 ? "Updated just now" : `Updated ${ageMinutes} min ago`}</p>}
      {isBehind && <p className="text-amber-400">Subgraph data is {Math.floor(lag / MINUTE_MS)} min behind</p>}
      {hasIndexingErrors && <p className="text-amber-400">Subgraph reported indexing errors</p>}
    </div>
  );
}

export default function StatsCards() {
  const totalLiquidity = useAppSelector(totalLiquiditySelector);
  const stakedLiquidity = useAppSelector(stakedLiquiditySelector);
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
    stakedLiquidity: stakedLiquidity,
    totalVolume: totalVolume,
    totalFees: totalFee,
  };
  return (
    <>
      {liquidityData && <PoolsHeaderStats {...liquidityData} unavailable={unavailable} />}
      {lastError !== null && (
        <p className="mt-2 text-right text-xs text-amber-400">
          {retriesExhausted ? "Pool data could not be loaded. Reload the page to try again." : "Loading pool data failed, retrying"}
        </p>
      )}
      {dataFreshness && <DataFreshnessNote freshness={dataFreshness} />}
    </>
  );
}
