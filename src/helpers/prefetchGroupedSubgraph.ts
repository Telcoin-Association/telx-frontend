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

const UNISWAP_GROUPS: Record<string, SubgraphGroup> = {
  base: "uniswap-base",
  polygon: "uniswap-polygon",
  ethereum: "uniswap-ethereum",
};

/** The group that serves a pool, or null for a protocol without grouped pool data. */
export function subgraphGroupOf({ protocol, blockchain }: Pick<miningContract, "protocol" | "blockchain">): SubgraphGroup | null {
  if (protocol === "quickswap" || protocol === "balancer") return protocol;
  if (protocol === "uniswap") return UNISWAP_GROUPS[blockchain] ?? null;
  return null;
}

/**
 * Loads the wanted groups. Throws when every requested group failed, so the caller's rejected path keeps
 * the data already on screen, retries with backoff and shows its error note. `complete` is false when
 * any group failed; such a result is not cached.
 */
async function load(contracts: miningContract[]): Promise<GroupedSubgraphResult & { complete: boolean }> {
  // Every pool of a group comes back together, so a group is requested when any of its pools wants
  // subgraph data. Freshness covers only the groups with an active pool: those are the ones behind the
  // header totals, and a group kept for archived pools must not date the active pools' numbers.
  const requested = new Set<SubgraphGroup>();
  const active = new Set<SubgraphGroup>();
  for (const contract of contracts) {
    const group = contract.fetchSubgraph ? subgraphGroupOf(contract) : null;
    if (!group) continue;
    requested.add(group);
    if (contract.active) active.add(group);
  }
  const groups = [...requested];

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
  // An active group with nothing to show is listed in `failed`, so the header note can name it; one that
  // fell back to earlier data is dated by that data instead.
  const failed: SubgraphGroup[] = [];
  for (const group of groups) {
    const result = lastLoaded[group];
    if (result) {
      results[group] = result;
      if (active.has(group)) sources[group] = result.meta;
    } else if (active.has(group)) {
      failed.push(group);
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

  const meta = combineSubgraphMeta(sources);
  return {
    quickswapById: byIdOf("quickswap"),
    uniswapById,
    balancerById: byIdOf("balancer"),
    meta: failed.length > 0 ? { ...meta, failed } : meta,
    complete: failedCount === 0,
  };
}
