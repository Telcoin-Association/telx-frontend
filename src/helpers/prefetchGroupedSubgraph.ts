import { fetchGroupedSubgraphs, GroupedPool, GroupedSubgraphData } from "./fetchGroupedSubgraph";
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

async function load(contracts: miningContract[]): Promise<GroupedSubgraphResult> {
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
  // A failed group is missing from `sources`; an active one is listed here so the header note can name it
  const failed: SubgraphGroup[] = [];
  for (const group of groups) {
    const result = fetched[group];
    if (result instanceof Error || !result) {
      console.error(`Grouped subgraph fetch failed for ${group}`, result);
      if (active.has(group)) failed.push(group);
    } else {
      results[group] = result;
      if (active.has(group)) sources[group] = result.meta;
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
  };
}
