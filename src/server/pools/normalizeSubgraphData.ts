import "server-only";

import { deriveMetrics, type MetricsInput, type MetricsProtocol, type PoolMetrics, type Row } from "./metrics";

/** A subgraph response: the requested `pools` plus row lists that point back at them. Any list may be absent. */
export type RawSubgraphData = {
  pools?: Row[] | null;
  poolSnapshots?: Row[] | null;
  threeMonthLiquidityData?: Row[] | null;
  swaps?: Row[] | null;
};

export type GroupedPool = {
  id: string;
  pool: Row;
  poolSnapshots: Row[];
  threeMonthLiquidityData: Row[];
  swaps?: Row[];
};

export type GroupedPoolWithMetrics = GroupedPool & { metrics: PoolMetrics };

function lowerId(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function nestedId(value: unknown): string {
  return value !== null && typeof value === "object" ? lowerId((value as Row).id) : "";
}

// Snapshot and day rows point at their pool through `poolAddress` (quickswap) or `pool.id`; swaps through `poolId.id`.
const snapshotPoolId = (row: Row | null | undefined) => lowerId(row?.poolAddress) || nestedId(row?.pool);
const swapPoolId = (row: Row | null | undefined) => nestedId(row?.poolId);

export function groupByPoolId(raw: RawSubgraphData | null | undefined): GroupedPool[] {
  const map = new Map<string, GroupedPool>();
  const hasSwaps = Array.isArray(raw?.swaps);

  for (const pool of raw?.pools ?? []) {
    const id = lowerId(pool?.id);
    if (!id) continue;

    const group: GroupedPool = { id, pool, poolSnapshots: [], threeMonthLiquidityData: [] };
    if (hasSwaps) group.swaps = [];
    map.set(id, group);
  }

  const attach = (rows: Row[] | null | undefined, key: "poolSnapshots" | "threeMonthLiquidityData" | "swaps", poolIdOf: (row: Row) => string) => {
    // rows for pools that were not requested have no group and are dropped
    for (const row of rows ?? []) map.get(poolIdOf(row))?.[key]?.push(row);
  };

  attach(raw?.poolSnapshots, "poolSnapshots", snapshotPoolId);
  attach(raw?.threeMonthLiquidityData, "threeMonthLiquidityData", snapshotPoolId);
  if (hasSwaps) attach(raw?.swaps, "swaps", swapPoolId);

  return Array.from(map.values());
}

export function withMetrics<G extends MetricsInput>(
  groups: G[],
  protocol: MetricsProtocol,
  now: number = Math.floor(Date.now() / 1000),
): (G & { metrics: PoolMetrics })[] {
  return groups.map(group => ({ ...group, metrics: deriveMetrics(protocol, group, now) }));
}
