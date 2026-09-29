import "server-only";

import { gql } from "@apollo/client";

import { checkPoolsPresent, createGraphClient, readMeta, runPaginatedQuery, runQuery, type GraphMeta, type SubgraphFetch } from "../graph";
import type { PoolMetrics, Row } from "../metrics";
import { groupByPoolId, withMetrics, type RawSubgraphData } from "../normalizeSubgraphData";
import { poolsFor, subgraphIdFor, type Chain, type RegistryPool } from "../registry";
import type { FetchOptions } from "./options";

type UniswapData = RawSubgraphData & { _meta?: GraphMeta | null };

export type UniswapHourlyGroup = { id: string; pool: Row; poolSnapshots: Row[]; metrics: PoolMetrics };
export type UniswapDailyGroup = { id: string; pool: Row; threeMonthLiquidityData: Row[] };

const HOURS_48 = 2 * 24 * 60 * 60;
const DAYS_95 = 95 * 24 * 60 * 60; // ~3 months plus a buffer

const HOURLY_QUERY = gql`
  query UniswapHourly($poolIds: [String!]!, $hourlyMinDate: Int!) {
    pools(where: { id_in: $poolIds }) {
      id
      totalValueLockedUSD
      feesUSD
      createdAtTimestamp
    }
    poolSnapshots: poolHourDatas(
      where: { pool_in: $poolIds, periodStartUnix_gte: $hourlyMinDate }
      first: 1000
      orderBy: periodStartUnix
      orderDirection: desc
    ) {
      pool {
        id
      }
      periodStartUnix
      volumeUSD
      feesUSD
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
  query UniswapHistory($poolIds: [String!]!, $historyMinDate: Int!, $cursor: ID!, $first: Int!) {
    pools(where: { id_in: $poolIds }) {
      id
      totalValueLockedUSD
      feesUSD
      createdAtTimestamp
    }
    threeMonthLiquidityData: poolDayDatas(
      where: { pool_in: $poolIds, date_gte: $historyMinDate, id_gt: $cursor }
      first: $first
      orderBy: id
      orderDirection: asc
    ) {
      id
      pool {
        id
      }
      timestamp: date
      tvlUSD
      feesUSD
      volumeUSD
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

function poolsOf(chain: Chain, label: string): RegistryPool[] {
  const pools = poolsFor("uniswap", chain);
  if (pools.length === 0) throw new Error(`${label}: no pools registered`);
  return pools;
}

/** Pools plus 48h of hourly rows (newest first), with derived metrics. Refreshed every 5 minutes. */
export async function fetchUniswapHourly(chain: Chain, options: FetchOptions = {}): Promise<SubgraphFetch<UniswapHourlyGroup>> {
  const label = `Uniswap ${chain} hourly`;
  const pools = poolsOf(chain, label);
  const poolIds = pools.map(pool => pool.id);
  const now = options.now ?? Math.floor(Date.now() / 1000);

  const client = options.client ?? createGraphClient(subgraphIdFor("uniswap", chain));
  const data = await runQuery<UniswapData>(client, HOURLY_QUERY, { poolIds, hourlyMinDate: now - HOURS_48 }, label);
  const warnings = checkPoolsPresent(pools, data.pools, label);

  const groups = withMetrics(groupByPoolId(data), "uniswap", now).map(({ id, pool, poolSnapshots, metrics }) => ({
    id,
    pool,
    poolSnapshots,
    metrics,
  }));
  return { groups, ...readMeta(data), warnings };
}

/** Pools plus 95 days of daily rows, newest first. Refreshed hourly. */
export async function fetchUniswapHistory(chain: Chain, options: FetchOptions = {}): Promise<SubgraphFetch<UniswapDailyGroup>> {
  const label = `Uniswap ${chain} history`;
  const pools = poolsOf(chain, label);
  const poolIds = pools.map(pool => pool.id);
  const now = options.now ?? Math.floor(Date.now() / 1000);

  const client = options.client ?? createGraphClient(subgraphIdFor("uniswap", chain));
  const { data, indexedAt, hasIndexingErrors } = await runPaginatedQuery<UniswapData>(
    client,
    HISTORY_QUERY,
    { poolIds, historyMinDate: now - DAYS_95 },
    "threeMonthLiquidityData",
    label,
  );
  const warnings = checkPoolsPresent(pools, data.pools, label);

  // Paged by id; stored newest first.
  const rows = [...(data.threeMonthLiquidityData ?? [])].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  const groups = groupByPoolId({ pools: data.pools, threeMonthLiquidityData: rows }).map(({ id, pool, threeMonthLiquidityData }) => ({
    id,
    pool,
    threeMonthLiquidityData,
  }));
  return { groups, indexedAt, hasIndexingErrors, warnings };
}
