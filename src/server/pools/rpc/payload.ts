import "server-only";

import type { PoolMetrics } from "@/types/PoolMetrics";

import { dailyRows, hourlyRows, trailing24h } from "./buckets";
import type { PoolData, StoredState } from "./store";
import type { RpcPool } from "../registry";

/**
 * The v3 payload rows, in the Graph-shaped form the client reads (the merged shape of
 * `UniswapGroupedResponseSchema`): the pool entity, 48 hourly rows and up to 95 daily rows, newest first, and
 * the metrics.
 */

export type V3Pool = {
  id: string;
  pool: { id: string; totalValueLockedUSD: number | null; feesUSD: number; createdAtTimestamp?: number };
  poolSnapshots: { pool: { id: string }; periodStartUnix: number; volumeUSD: number; feesUSD: number }[];
  threeMonthLiquidityData: { pool: { id: string }; timestamp: number; tvlUSD: number; volumeUSD: number; feesUSD: number }[];
  metrics: PoolMetrics;
};

export type PayloadInput = {
  pools: readonly RpcPool[];
  state: StoredState;
  data: Readonly<Record<string, PoolData>>;
  /** Time of the last block folded in; the 24h window ends here. */
  asOf: number;
  now: number;
  /**
   * True when `asOf` is too far behind the chain or the clock for a 24h window to mean anything. Volume, fees
   * and window are then null rather than a partial sum.
   */
  lagging: boolean;
};

export function buildPayload({ pools, state, data, asOf, now, lagging }: PayloadInput): V3Pool[] {
  return pools.map(({ id }) => {
    const poolState = state.pools[id];
    const poolData = data[id];
    const createdAt = poolState?.createdAt ?? null;
    const trailing = trailing24h(poolData?.buckets ?? new Map(), asOf);
    const tvlUSD = poolState?.tvlUSD ?? null;

    const metrics: PoolMetrics = {
      tvlUSD,
      volume24h: lagging ? null : trailing.volumeUSD,
      fees24h: lagging ? null : trailing.feesUSD,
      window: lagging ? null : "trailing-24h",
      lastActivityAt: poolState?.lastActivityAt ?? null,
      lastSwapAt: poolState?.lastSwapAt ?? null,
      createdAt,
      rows24h: trailing.swaps,
      computedAt: now,
    };

    return {
      id,
      pool: { id, totalValueLockedUSD: tvlUSD, feesUSD: poolState?.feesUSD ?? 0, ...(createdAt !== null && { createdAtTimestamp: createdAt }) },
      poolSnapshots: hourlyRows(poolData?.buckets ?? new Map(), asOf, createdAt ?? 0).map(row => ({
        pool: { id },
        periodStartUnix: row.periodStartUnix,
        volumeUSD: row.volumeUSD,
        feesUSD: row.feesUSD,
      })),
      threeMonthLiquidityData: dailyRows(poolData?.days ?? new Map(), asOf, createdAt ?? 0, poolState?.tvlBefore?.tvlUSD ?? null).map(row => ({
        pool: { id },
        timestamp: row.timestamp,
        tvlUSD: row.tvlUSD,
        volumeUSD: row.volumeUSD,
        feesUSD: row.feesUSD,
      })),
      metrics,
    };
  });
}
