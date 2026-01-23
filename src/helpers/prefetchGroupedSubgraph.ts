import { fetchQuickswapGroupedSubgraph } from "./fetchQuickswapGroupedSubgraph";
import { fetchUniswapBaseGroupedSubgraph } from "./fetchUniswapBaseGroupedSubgraph";
import { fetchUniswapPolygonGroupedSubgraph } from "./fetchUniswapPolygonGroupedSubgraph";
import { miningContract } from "./normalizeMiningContracts";

type ById = any;

const norm = (v?: string) => v?.trim().toLowerCase() ?? "";

// ✅ module-level cache (persists while tab is alive)
let cache:
  | {
      key: string;
      quickswapById: ById;
      uniswapById: ById;
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

  // ✅ return cached if still fresh
  if (cache && cache.key === key && now - cache.ts < ttlMs) {
    return { quickswapById: cache.quickswapById, uniswapById: cache.uniswapById };
  }

  const hasQuickswap = contracts.some((c) => c.protocol === "quickswap");
  const hasUniswap = contracts.some((c) => c.protocol === "uniswap");

  const quickswapPoolIds = hasQuickswap
    ? contracts.filter((c) => c.protocol === "quickswap").map((c) => c.pool)
    : [];

  const uniswapBasePoolIds = hasUniswap
    ? contracts.filter((c) => c.protocol === "uniswap" && c.blockchain === "base").map((c) => c.pool)
    : [];

  const uniswapPolygonPoolIds = hasUniswap
    ? contracts.filter((c) => c.protocol === "uniswap" && c.blockchain === "polygon").map((c) => c.pool)
    : [];

  // ✅ Fetch in parallel (faster)
  const [quickswapRes, uniswapBaseRes, uniswapPolygonRes] = await Promise.allSettled([
    quickswapPoolIds.length ? fetchQuickswapGroupedSubgraph(quickswapPoolIds) : Promise.resolve({ byId: {} }),
    uniswapBasePoolIds.length ? fetchUniswapBaseGroupedSubgraph(uniswapBasePoolIds) : Promise.resolve({ byId: {} }),
    uniswapPolygonPoolIds.length ? fetchUniswapPolygonGroupedSubgraph(uniswapPolygonPoolIds) : Promise.resolve({ byIdPolygon: {} }),
  ]);

  const quickswapById: ById =
    quickswapRes.status === "fulfilled" ? quickswapRes.value.byId : {};

  const baseById: ById =
    uniswapBaseRes.status === "fulfilled" ? uniswapBaseRes.value.byId : {};

  const polygonById: ById =
    uniswapPolygonRes.status === "fulfilled" ? uniswapPolygonRes.value.byIdPolygon : {};

  const uniswapById: ById = { ...baseById, ...polygonById };

  cache = { key, quickswapById, uniswapById, ts: now };

  return { quickswapById, uniswapById };
}
