import { fetchGroupedSubgraph } from "./fetchGroupedSubgraph";
import { miningContract } from "./normalizeMiningContracts";

type ById = any | undefined;

const norm = (v?: string) => v?.trim().toLowerCase() ?? "";

// module-level cache (persists while tab is alive)
let cache:
  | {
    key: string;
    quickswapById: ById;
    uniswapById: ById;
    balancerById: ById;
    ts: number;
  }
  | null = null;

const DEFAULT_TTL_MS = 60 * 1000; // 1 min (tweak)

function buildKey(contracts: miningContract[]) {
  // Cache key based on pools list (stable)
  const pools = contracts
    .map((c) => `${c.protocol}:${c.blockchain ?? ""}:${norm(c.pool)}`)
    .sort()
    .join("|");
  return pools;
}

export async function prefetchGroupedSubgraph(
  contracts: miningContract[],
  ttlMs: number = DEFAULT_TTL_MS
) {
  const key = buildKey(contracts);
  const now = Date.now();

  // return cached if still fresh
  if (cache && cache.key === key && now - cache.ts < ttlMs) {
    return { quickswapById: cache.quickswapById, uniswapById: cache.uniswapById };
  }
  const hasQuickswap = contracts.some((c) => c.protocol === "quickswap" && c.fetchSubgraph);
  const hasUniswapBase = contracts.some((c) => c.protocol === "uniswap" && c.blockchain === "base");
  const hasUniswapPolygon = contracts.some((c) => c.protocol === "uniswap" && c.blockchain === "polygon");
  const hasBalancer = contracts.some((c) => c.protocol === "balancer" && c.fetchSubgraph);

  const quickswapPoolIds = hasQuickswap
    ? contracts.filter((c) => c.protocol === "quickswap" && c.fetchSubgraph).map((c) => c.pool)
    : [];

  const uniswapBasePoolIds = hasUniswapBase
    ? contracts.filter((c) => c.protocol === "uniswap" && c.blockchain === "base").map((c) => c.pool)
    : [];

  const uniswapPolygonPoolIds = hasUniswapPolygon
    ? contracts.filter((c) => c.protocol === "uniswap" && c.blockchain === "polygon").map((c) => c.pool)
    : [];

  const balancerPoolIds = hasBalancer
    ? contracts.filter((c) => c.protocol === "balancer" && c.subgraphId && c.fetchSubgraph).map((c) => c.subgraphId)
    : [];

  // Fetch in parallel (faster)
  const [quickswapRes, uniswapBaseRes, uniswapPolygonRes, balancerRes] = await Promise.allSettled([
    quickswapPoolIds.length ? fetchGroupedSubgraph(quickswapPoolIds, "quickswap") : Promise.resolve({ byId: {} }),
    uniswapBasePoolIds.length ? fetchGroupedSubgraph(uniswapBasePoolIds, "uniswapBase") : Promise.resolve({ byId: {} }),
    uniswapPolygonPoolIds.length ? fetchGroupedSubgraph(uniswapPolygonPoolIds, "uniswapPolygon") : Promise.resolve({ byId: {} }),
    balancerPoolIds.length ? fetchGroupedSubgraph(balancerPoolIds as any, "balancer") : Promise.resolve({ byId: {} }),
  ]);

  const quickswapById: ById = quickswapRes.status === "fulfilled" ? quickswapRes.value && quickswapRes.value.byId : {};

  const baseById: ById = uniswapBaseRes.status === "fulfilled" ? uniswapBaseRes.value && uniswapBaseRes.value.byId : {};

  const polygonById: ById = uniswapPolygonRes.status === "fulfilled" ? uniswapPolygonRes.value && uniswapPolygonRes.value.byId : {};

  const balancerById: ById = balancerRes.status === "fulfilled" ? balancerRes.value && balancerRes.value.byId : {};


  const uniswapById: ById = { ...baseById, ...polygonById };


  cache = { key, quickswapById, uniswapById, balancerById, ts: now };

  return { quickswapById, uniswapById, balancerById };
}
