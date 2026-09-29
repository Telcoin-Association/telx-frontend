// Per-pool metrics. The pool data crons derive them (src/server/pools/metrics.ts) and
// /api/pools serves them on each grouped pool as `metrics`.

export type MetricsWindow = "trailing-24h" | "trailing-24h-interpolated" | "utc-day";

export type PoolMetrics = {
  tvlUSD: number | null;
  volume24h: number | null;
  fees24h: number | null;
  window: MetricsWindow | null;
  lastActivityAt: number | null; // unix seconds: newest row (any kind) in the fetched window
  lastSwapAt: number | null; // unix seconds: newest row/swap with volume > 0
  createdAt: number | null; // unix seconds, from the pool entity
  rows24h: number;
  computedAt: number; // unix seconds used as "now"
};

// Freshness of one group's pool data. `fetchedAt` and `indexedAt` are unix milliseconds.
// All three are null for the bare array shape, which carries no freshness.
export type SubgraphMeta = {
  fetchedAt: number | null;
  indexedAt: number | null;
  hasIndexingErrors: boolean | null;
};

// Pool data group names, one per protocol/chain subgraph.
export type SubgraphGroup = "uniswap-base" | "uniswap-polygon" | "uniswap-ethereum" | "balancer" | "quickswap";

// Freshness across the groups behind the header totals, those with an active pool: the oldest
// `fetchedAt`/`indexedAt`, `hasIndexingErrors` true when any group reports errors, and the per-group
// values. A group without an active pool, not requested, or failed to load is absent from `sources`.
// `failed` names the groups with an active pool that failed to load; absent or empty means none.
export type DataFreshness = SubgraphMeta & {
  sources: Partial<Record<SubgraphGroup, SubgraphMeta>>;
  failed?: SubgraphGroup[];
};
