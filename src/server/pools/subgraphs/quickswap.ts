import "server-only";

import { gql } from "@apollo/client";

import { checkPoolsPresent, createGraphClient, runPaginatedQuery, type GraphMeta, type SubgraphFetch } from "../graph";
import type { PoolMetrics, Row } from "../metrics";
import { groupByPoolId, withMetrics, type RawSubgraphData } from "../normalizeSubgraphData";
import { poolsFor, subgraphIdFor } from "../registry";
import type { FetchOptions } from "./options";

type QuickswapData = RawSubgraphData & { _meta?: GraphMeta | null };

export type QuickswapGroup = {
  id: string;
  pool: Row;
  poolSnapshots: Row[];
  threeMonthLiquidityData: Row[];
  metrics: PoolMetrics;
};

const HOURS_48 = 2 * 24 * 60 * 60;
const DAYS_95 = 95 * 24 * 60 * 60; // ~3 months plus a buffer

const QUERY = gql`
  query QuickswapGrouped($poolIds: [String!]!, $historyMinDate: Int!, $cursor: ID!, $first: Int!) {
    pools: pairs(where: { id_in: $poolIds }) {
      id
      reserveUSD
      createdAtTimestamp
    }
    threeMonthLiquidityData: pairDayDatas(
      where: { pairAddress_in: $poolIds, date_gte: $historyMinDate, id_gt: $cursor }
      orderBy: id
      orderDirection: asc
      first: $first
    ) {
      id
      date
      reserveUSD
      dailyVolumeUSD
      poolAddress: pairAddress
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

/**
 * One query for pairs and 95 days of day rows. `poolSnapshots` is the last 48h of those rows.
 * Both lists are newest first. Refreshed hourly.
 */
export async function fetchQuickswapGrouped(options: FetchOptions = {}): Promise<SubgraphFetch<QuickswapGroup>> {
  const label = "QuickSwap";
  const pools = poolsFor("quickswap", "polygon");
  if (pools.length === 0) throw new Error(`${label}: no pools registered`);
  const poolIds = pools.map(pool => pool.id);
  const now = options.now ?? Math.floor(Date.now() / 1000);

  const client = options.client ?? createGraphClient(subgraphIdFor("quickswap", "polygon"));
  const { data, indexedAt, hasIndexingErrors } = await runPaginatedQuery<QuickswapData>(
    client,
    QUERY,
    { poolIds, historyMinDate: now - DAYS_95 },
    "threeMonthLiquidityData",
    label,
  );
  const warnings = checkPoolsPresent(pools, data.pools, label);

  const rows = [...(data.threeMonthLiquidityData ?? [])].sort((a, b) => Number(b.date) - Number(a.date));
  const recent = rows.filter(row => Number(row.date) >= now - HOURS_48);
  const groups = withMetrics(groupByPoolId({ pools: data.pools, poolSnapshots: recent, threeMonthLiquidityData: rows }), "quickswap", now).map(
    ({ id, pool, poolSnapshots, threeMonthLiquidityData, metrics }) => ({
      id,
      pool,
      poolSnapshots,
      threeMonthLiquidityData,
      metrics,
    }),
  );
  return { groups, indexedAt, hasIndexingErrors, warnings };
}
