import { fetchGroupedSubgraph, GroupedPool, GroupedSubgraphData } from "./fetchGroupedSubgraph";
import { miningContract } from "./normalizeMiningContracts";
import { DataFreshness, SubgraphGroup, SubgraphMeta } from "@/types/PoolMetrics";

type ById = Record<string, GroupedPool>;

const norm = (v?: string) => v?.trim().toLowerCase() ?? "";

export type GroupedSubgraphResult = {
  quickswapById: ById;
  uniswapById: ById;
  balancerById: ById;
  meta: DataFreshness;
};

// module-level cache (persists while tab is alive)
let cache: (GroupedSubgraphResult & { key: string; ts: number }) | null = null;

// track inflight requests by key
const inflight = new Map<string, Promise<GroupedSubgraphResult>>();

const DEFAULT_TTL_MS = 60 * 1000; // 1 min (tweak)

function buildKey(contracts: miningContract[]) {
  // Cache key based on pools list (stable)
  const pools = contracts
    .map((c) => `${c.protocol}:${c.blockchain ?? ""}:${norm(c.pool)}`)
    .sort()
    .join("|");
  return pools;
}

const minNonNull = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? Math.min(...present) : null;
};

export function combineSubgraphMeta(sources: Partial<Record<SubgraphGroup, SubgraphMeta>>): DataFreshness {
  const metas = Object.values(sources) as SubgraphMeta[];
  const flags = metas.map((m) => m.hasIndexingErrors).filter((v): v is boolean => v !== null);
  return {
    fetchedAt: minNonNull(metas.map((m) => m.fetchedAt)),
    indexedAt: minNonNull(metas.map((m) => m.indexedAt)),
    hasIndexingErrors: flags.length ? flags.some(Boolean) : null,
    sources,
  };
}

export async function prefetchGroupedSubgraph(
  contracts: miningContract[],
  ttlMs: number = DEFAULT_TTL_MS
): Promise<GroupedSubgraphResult> {
  const key = buildKey(contracts);
  const now = Date.now();

  // return cached if still fresh
  if (cache && cache.key === key && now - cache.ts < ttlMs) {
    const { quickswapById, uniswapById, balancerById, meta } = cache;
    return { quickswapById, uniswapById, balancerById, meta };
  }

  if (inflight.has(key)) {
    return inflight.get(key)!;
  }

  const request = load(contracts).then((result) => {
    cache = { ...result, key, ts: now };
    return result;
  });
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

async function load(contracts: miningContract[]): Promise<GroupedSubgraphResult> {
  const wants = (protocol: string, blockchain?: string) =>
    contracts.some((c) => c.protocol === protocol && (!blockchain || c.blockchain === blockchain) && c.fetchSubgraph);

  // The backend serves every pool of a group, so a group is fetched when any of its pools wants subgraph data.
  const requested: Record<SubgraphGroup, boolean> = {
    quickswap: wants("quickswap"),
    "uniswap-base": wants("uniswap", "base"),
    "uniswap-polygon": wants("uniswap", "polygon"),
    "uniswap-ethereum": wants("uniswap", "ethereum"),
    balancer: wants("balancer"),
  };
  const groups = Object.keys(requested) as SubgraphGroup[];

  // Fetch in parallel (faster)
  const settled = await Promise.allSettled(
    groups.map((group) => (requested[group] ? fetchGroupedSubgraph(group) : Promise.resolve(null)))
  );

  const results: Partial<Record<SubgraphGroup, GroupedSubgraphData>> = {};
  const sources: Partial<Record<SubgraphGroup, SubgraphMeta>> = {};
  settled.forEach((res, i) => {
    if (res.status === "fulfilled" && res.value) {
      results[groups[i]] = res.value;
      sources[groups[i]] = res.value.meta;
    } else if (res.status === "rejected") {
      console.error(`Grouped subgraph fetch failed for ${groups[i]}`, res.reason);
    }
  });

  const byIdOf = (group: SubgraphGroup): ById => results[group]?.byId ?? {};

  const prefixById = (byId: ById, chain: string): ById =>
    Object.fromEntries(Object.entries(byId).map(([id, value]) => [`${chain}:${id}`, value]));

  const uniswapById: ById = {
    ...prefixById(byIdOf("uniswap-base"), "base"),
    ...prefixById(byIdOf("uniswap-polygon"), "polygon"),
    ...prefixById(byIdOf("uniswap-ethereum"), "ethereum"),
  };

  return {
    quickswapById: byIdOf("quickswap"),
    uniswapById,
    balancerById: byIdOf("balancer"),
    meta: combineSubgraphMeta(sources),
  };
}
