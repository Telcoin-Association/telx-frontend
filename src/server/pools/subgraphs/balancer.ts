import "server-only";

import { gql } from "@apollo/client";

import {
  PageLimitError,
  checkPoolsPresent,
  createGraphClient,
  readMeta,
  runPaginatedQuery,
  runQuery,
  type Freshness,
  type GraphClient,
  type GraphMeta,
  type SubgraphFetch,
} from "../graph";
import type { PoolMetrics, Row } from "../metrics";
import { groupByPoolId, withMetrics, type RawSubgraphData } from "../normalizeSubgraphData";
import { poolsFor, subgraphIdFor, type RegistryPool } from "../registry";
import type { FetchOptions } from "./options";

type BalancerData = RawSubgraphData & { _meta?: GraphMeta | null };

export type BalancerHourlyGroup = {
  id: string;
  pool: Row;
  poolSnapshots: Row[];
  metrics: PoolMetrics;
};
export type BalancerDailyGroup = { id: string; pool: Row; threeMonthLiquidityData: Row[] };

const DAY = 24 * 60 * 60;
const DAYS_95 = 95 * DAY; // ~3 months plus a buffer

const POOL_FIELDS = `
  id
  address
  totalLiquidity
  totalSwapFee
  swapFee
  createTime
`;

const HOURLY_QUERY = gql`
  query BalancerHourly($poolIds: [String!]!, $snapshotMinDate: Int!, $swapMinDate: Int!, $cursor: ID!, $first: Int!) {
    pools(where: { id_in: $poolIds }) {
      ${POOL_FIELDS}
    }
    poolSnapshots(where: { timestamp_gte: $snapshotMinDate, pool_in: $poolIds }, orderBy: timestamp, orderDirection: asc, first: 1000) {
      timestamp
      swapFees
      swapVolume
      pool {
        address
        id
      }
    }
    swaps(where: { poolId_in: $poolIds, timestamp_gte: $swapMinDate, id_gt: $cursor }, first: $first, orderBy: id, orderDirection: asc) {
      id
      timestamp
      valueUSD
      poolId {
        id
      }
    }
    _meta {
      block {
        number
        timestamp
      }
      hasIndexingErrors
    }
  }
`;

/** HOURLY_QUERY without the swaps selection, for when a day has more swaps than the page cap allows. */
const SNAPSHOTS_QUERY = gql`
  query BalancerSnapshots($poolIds: [String!]!, $snapshotMinDate: Int!) {
    pools(where: { id_in: $poolIds }) {
      ${POOL_FIELDS}
    }
    poolSnapshots(where: { timestamp_gte: $snapshotMinDate, pool_in: $poolIds }, orderBy: timestamp, orderDirection: asc, first: 1000) {
      timestamp
      swapFees
      swapVolume
      pool {
        address
        id
      }
    }
    _meta {
      block {
        number
        timestamp
      }
      hasIndexingErrors
    }
  }
`;

const HISTORY_QUERY = gql`
  query BalancerHistory($poolIds: [String!]!, $historyMinDate: Int!, $cursor: ID!, $first: Int!) {
    pools(where: { id_in: $poolIds }) {
      ${POOL_FIELDS}
    }
    threeMonthLiquidityData: poolSnapshots(
      where: { timestamp_gte: $historyMinDate, pool_in: $poolIds, id_gt: $cursor }
      orderBy: id
      orderDirection: asc
      first: $first
    ) {
      id
      timestamp
      liquidity
      swapVolume
      swapFees
      pool {
        address
        id
      }
    }
    _meta {
      block {
        number
        timestamp
      }
      hasIndexingErrors
    }
  }
`;

function poolsOf(label: string): RegistryPool[] {
  const pools = poolsFor("balancer", "polygon");
  if (pools.length === 0) throw new Error(`${label}: no pools registered`);
  return pools;
}

/**
 * Pools and daily snapshots with every swap of the last 24h, paged by id. When the swaps overflow the
 * page cap, the snapshots are fetched without swaps and a warning is returned; `swaps` is then absent,
 * so the metrics fall back to interpolating the daily snapshots (`trailing-24h-interpolated`).
 */
async function fetchHourlyData(
  client: GraphClient,
  variables: { poolIds: string[]; snapshotMinDate: number; swapMinDate: number },
  label: string,
): Promise<Freshness & { data: BalancerData; warnings: string[] }> {
  try {
    const result = await runPaginatedQuery<BalancerData>(client, HOURLY_QUERY, variables, "swaps", label);
    return { ...result, warnings: [] };
  } catch (err) {
    if (!(err instanceof PageLimitError)) throw err;
    const { poolIds, snapshotMinDate } = variables;
    const data = await runQuery<BalancerData>(client, SNAPSHOTS_QUERY, { poolIds, snapshotMinDate }, label);
    return {
      data,
      ...readMeta(data),
      warnings: [`${label}: too many swaps in the last 24h to page through; metrics interpolated from daily snapshots`],
    };
  }
}

/**
 * Pools, daily snapshots since two UTC days ago, and every swap of the last 24h (paged by id, so a
 * busy day is not cut at 1,000 swaps), with derived metrics. Refreshed every 5 minutes.
 */
export async function fetchBalancerHourly(options: FetchOptions = {}): Promise<SubgraphFetch<BalancerHourlyGroup>> {
  const label = "Balancer hourly";
  const pools = poolsOf(label);
  const poolIds = pools.map(pool => pool.id);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const startOfUtcDay = Math.floor(now / DAY) * DAY;

  const client = options.client ?? createGraphClient(subgraphIdFor("balancer", "polygon"));
  const { data, indexedAt, hasIndexingErrors, warnings } = await fetchHourlyData(
    client,
    { poolIds, snapshotMinDate: startOfUtcDay - 2 * DAY, swapMinDate: now - DAY },
    label,
  );
  warnings.push(...checkPoolsPresent(pools, data.pools, label));

  // Swaps only feed the metrics; storing a busy day's swaps would bloat the data hash and every read.
  const groups = withMetrics(groupByPoolId(data), "balancer", now).map(({ id, pool, poolSnapshots, metrics }) => ({ id, pool, poolSnapshots, metrics }));
  return { groups, indexedAt, hasIndexingErrors, warnings };
}

/** Pools plus 95 days of daily snapshots, oldest first. Refreshed hourly. */
export async function fetchBalancerHistory(options: FetchOptions = {}): Promise<SubgraphFetch<BalancerDailyGroup>> {
  const label = "Balancer history";
  const pools = poolsOf(label);
  const poolIds = pools.map(pool => pool.id);
  const now = options.now ?? Math.floor(Date.now() / 1000);

  const client = options.client ?? createGraphClient(subgraphIdFor("balancer", "polygon"));
  const { data, indexedAt, hasIndexingErrors } = await runPaginatedQuery<BalancerData>(
    client,
    HISTORY_QUERY,
    { poolIds, historyMinDate: now - DAYS_95 },
    "threeMonthLiquidityData",
    label,
  );
  const warnings = checkPoolsPresent(pools, data.pools, label);

  // Paged by id; stored oldest first.
  const rows = [...(data.threeMonthLiquidityData ?? [])].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const groups = groupByPoolId({ pools: data.pools, threeMonthLiquidityData: rows }).map(({ id, pool, threeMonthLiquidityData }) => ({
    id,
    pool,
    threeMonthLiquidityData,
  }));
  return { groups, indexedAt, hasIndexingErrors, warnings };
}
