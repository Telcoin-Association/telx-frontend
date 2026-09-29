import { fetchGroupedSubgraphs, GroupedPool, GroupedSubgraphData, GroupUnavailableError } from "./fetchGroupedSubgraph";
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

// module-level cache (persists while tab is alive). Only a load in which every requested group loaded is
// cached, and any other load clears it, so a failed group is asked for again on the next call.
let cache: (GroupedSubgraphResult & { key: string; ts: number }) | null = null;

// The last data each group loaded in this tab. A group whose read or request fails on a later load keeps
// this data, so a transient failure during a refetch does not replace values already on screen. A group
// the server reports as unavailable (no data within its age limit) is dropped instead.
const lastLoaded: Partial<Record<SubgraphGroup, GroupedSubgraphData>> = {};

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

  const request = load(contracts).then(({ complete, ...result }) => {
    cache = complete ? { ...result, key, ts: now } : null;
    return result;
  });
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Loads the wanted groups. Throws when every requested group failed, so the caller's rejected path keeps
 * the data already on screen, retries with backoff and shows its error note. `complete` is false when
 * any group failed; such a result is not cached.
 */
async function load(contracts: miningContract[]): Promise<GroupedSubgraphResult & { complete: boolean }> {
  const wants = (protocol: string, blockchain?: string) =>
    contracts.some((c) => c.protocol === protocol && (!blockchain || c.blockchain === blockchain) && c.fetchSubgraph);

  // Every pool of a group comes back together, so a group is wanted when any of its pools wants subgraph data.
  const requested: Record<SubgraphGroup, boolean> = {
    quickswap: wants("quickswap"),
    "uniswap-base": wants("uniswap", "base"),
    "uniswap-polygon": wants("uniswap", "polygon"),
    "uniswap-ethereum": wants("uniswap", "ethereum"),
    balancer: wants("balancer"),
  };
  const groups = (Object.keys(requested) as SubgraphGroup[]).filter((group) => requested[group]);

  // One request serves every group
  const fetched = await fetchGroupedSubgraphs(groups);

  const results: Partial<Record<SubgraphGroup, GroupedSubgraphData>> = {};
  const sources: Partial<Record<SubgraphGroup, SubgraphMeta>> = {};
  let failedCount = 0;
  for (const group of groups) {
    const result = fetched[group];
    if (result instanceof Error || !result) {
      failedCount += 1;
      console.error(`Grouped subgraph fetch failed for ${group}`, result);
      if (result instanceof GroupUnavailableError) delete lastLoaded[group];
    } else {
      lastLoaded[group] = result;
    }
  }

  if (groups.length > 0 && failedCount === groups.length) {
    throw new Error(`Pool data could not be loaded (${groups.join(", ")})`);
  }

  // A failed group falls back to the data it last loaded, with that data's own freshness in `sources`.
  for (const group of groups) {
    const result = lastLoaded[group];
    if (result) {
      results[group] = result;
      sources[group] = result.meta;
    }
  }

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
    complete: failedCount === 0,
  };
}
