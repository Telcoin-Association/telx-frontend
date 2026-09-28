// Mirrors `PoolMetrics` in the backend's lib/metrics.ts. The backend derives these per pool
// and serves them on each grouped pool as `metrics`.

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

// Freshness of one grouped backend response. `fetchedAt` and `indexedAt` are unix milliseconds.
// All three are null when the backend served the legacy array shape.
export type SubgraphMeta = {
  fetchedAt: number | null;
  indexedAt: number | null;
  hasIndexingErrors: boolean | null;
};

// Backend group names, one per grouped route.
export type SubgraphGroup = "uniswap-base" | "uniswap-polygon" | "uniswap-ethereum" | "balancer" | "quickswap";

// Freshness across every group loaded for the page: the oldest `fetchedAt`/`indexedAt`,
// `hasIndexingErrors` true when any group reports errors, and the per-group values.
// A group that was not requested or failed to load is absent from `sources`.
export type DataFreshness = SubgraphMeta & {
  sources: Partial<Record<SubgraphGroup, SubgraphMeta>>;
};
