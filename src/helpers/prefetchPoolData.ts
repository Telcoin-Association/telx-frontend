import { fetchPoolGroups, GroupedPool, GroupUnavailableError, PoolGroupData } from "./fetchPoolData";
import { miningContract } from "./normalizeMiningContracts";
import { DataFreshness, PoolDataMeta, PoolGroup } from "@/types/PoolMetrics";

type ById = Record<string, GroupedPool>;

const norm = (v?: string) => v?.trim().toLowerCase() ?? "";

/** Uniswap pool data keyed by `<chain>:<pool id>`, with the freshness of the groups behind the header totals. */
export type PoolDataResult = {
  uniswapById: ById;
  meta: DataFreshness;
};

// module-level cache (persists while tab is alive). Only a load in which every requested group loaded is
// cached, and any other load clears it, so a failed group is asked for again on the next call.
let cache: (PoolDataResult & { key: string; ts: number }) | null = null;

// The last data each group loaded in this tab. A group whose read or request fails on a later load keeps
// this data, so a transient failure during a refetch does not replace values already on screen. A group
// the server reports as unavailable (no data within its age limit) is dropped instead.
const lastLoaded: Partial<Record<PoolGroup, PoolGroupData>> = {};

// track inflight requests by key
const inflight = new Map<string, Promise<PoolDataResult>>();

const DEFAULT_TTL_MS = 60 * 1000; // 1 min (tweak)

function buildKey(contracts: miningContract[]) {
  // Cache key based on pools list (stable)
  const pools = contracts
    .map((c) => `${c.protocol}:${c.blockchain ?? ""}:${norm(c.pool)}`)
    .sort()
    .join("|");
  return pools;
}

/**
 * A group whose Merkl rewards the server could not read keeps, per pool, the rewards the tab loaded earlier,
 * so a refresh during a rewards outage does not wipe an APR or SVL already on screen. Pools with no earlier
 * rewards stay unknown (no `rewards` field).
 */
export function withEarlierRewards(result: PoolGroupData, earlier: PoolGroupData | undefined): PoolGroupData {
  if (!result.rewardsUnavailable || !earlier) return result;
  const list = result.list.map((pool) => {
    if (pool.rewards !== undefined) return pool;
    const previous = earlier.byId[norm(pool.id ?? pool.pool?.id)]?.rewards;
    return previous === undefined ? pool : { ...pool, rewards: previous };
  });
  const byId = Object.fromEntries(list.map((pool) => [norm(pool.id ?? pool.pool?.id), pool]).filter(([id]) => id));
  return { ...result, list, byId };
}

/** Whether any pool of the group has unknown rewards: a Uniswap group always sends `rewards` when it knows them. */
const hasUnknownRewards = (group: PoolGroupData) => group.rewardsUnavailable && group.list.some((pool) => pool.rewards === undefined);

const minNonNull = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? Math.min(...present) : null;
};

export function combinePoolDataMeta(sources: Partial<Record<PoolGroup, PoolDataMeta>>): DataFreshness {
  const metas = Object.values(sources) as PoolDataMeta[];
  const flags = metas.map((m) => m.hasIndexingErrors).filter((v): v is boolean => v !== null);
  return {
    fetchedAt: minNonNull(metas.map((m) => m.fetchedAt)),
    indexedAt: minNonNull(metas.map((m) => m.indexedAt)),
    hasIndexingErrors: flags.length ? flags.some(Boolean) : null,
    sources,
  };
}

export async function prefetchPoolData(
  contracts: miningContract[],
  ttlMs: number = DEFAULT_TTL_MS
): Promise<PoolDataResult> {
  const key = buildKey(contracts);
  const now = Date.now();

  // return cached if still fresh
  if (cache && cache.key === key && now - cache.ts < ttlMs) {
    const { uniswapById, meta } = cache;
    return { uniswapById, meta };
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

const UNISWAP_GROUPS: Record<string, PoolGroup> = {
  base: "uniswap-base",
  polygon: "uniswap-polygon",
  ethereum: "uniswap-ethereum",
};

/** The group that serves a pool, or null for a pool without served data (every protocol but Uniswap v4). */
export function poolGroupOf({ protocol, blockchain }: Pick<miningContract, "protocol" | "blockchain">): PoolGroup | null {
  return protocol === "uniswap" ? (UNISWAP_GROUPS[blockchain] ?? null) : null;
}

/**
 * Loads the wanted groups. Throws when every requested group failed, so the caller's rejected path keeps
 * the data already on screen, retries with backoff and shows its error note. `complete` is false when
 * any group failed or had its rewards unknown; such a result is not cached.
 */
async function load(contracts: miningContract[]): Promise<PoolDataResult & { complete: boolean }> {
  // Every pool of a group comes back together, so a group is requested when any of its pools is listed.
  // Freshness covers only the groups with an active pool: those are the ones behind the header totals, and
  // a chain with only archived pools must not date the active pools' numbers.
  const requested = new Set<PoolGroup>();
  const active = new Set<PoolGroup>();
  for (const contract of contracts) {
    const group = poolGroupOf(contract);
    if (!group) continue;
    requested.add(group);
    if (contract.active) active.add(group);
  }
  const groups = [...requested];

  // One request serves every group
  const fetched = await fetchPoolGroups(groups);

  const results: Partial<Record<PoolGroup, PoolGroupData>> = {};
  const sources: Partial<Record<PoolGroup, PoolDataMeta>> = {};
  let failedCount = 0;
  let rewardsUnknown = false;
  for (const group of groups) {
    const result = fetched[group];
    if (result instanceof Error || !result) {
      failedCount += 1;
      console.error(`Pool data fetch failed for ${group}`, result);
      if (result instanceof GroupUnavailableError) delete lastLoaded[group];
    } else {
      if (result.rewardsUnavailable) rewardsUnknown = true;
      lastLoaded[group] = withEarlierRewards(result, lastLoaded[group]);
    }
  }

  if (groups.length > 0 && failedCount === groups.length) {
    throw new Error(`Pool data could not be loaded (${groups.join(", ")})`);
  }

  // A failed group falls back to the data it last loaded, with that data's own freshness in `sources`.
  // An active group with nothing to show is listed in `failed`, so the header note can name it; one that
  // fell back to earlier data is dated by that data instead.
  const failed: PoolGroup[] = [];
  const rewardsUnavailable: PoolGroup[] = [];
  for (const group of groups) {
    const result = lastLoaded[group];
    if (result) {
      results[group] = result;
      if (active.has(group)) sources[group] = result.meta;
      if (active.has(group) && hasUnknownRewards(result)) rewardsUnavailable.push(group);
    } else if (active.has(group)) {
      failed.push(group);
    }
  }

  const byIdOf = (group: PoolGroup): ById => results[group]?.byId ?? {};

  const prefixById = (byId: ById, chain: string): ById =>
    Object.fromEntries(Object.entries(byId).map(([id, value]) => [`${chain}:${id}`, value]));

  const uniswapById: ById = {
    ...prefixById(byIdOf("uniswap-base"), "base"),
    ...prefixById(byIdOf("uniswap-polygon"), "polygon"),
    ...prefixById(byIdOf("uniswap-ethereum"), "ethereum"),
  };

  const meta = {
    ...combinePoolDataMeta(sources),
    ...(failed.length > 0 ? { failed } : {}),
    ...(rewardsUnavailable.length > 0 ? { rewardsUnavailable } : {}),
  };
  return {
    uniswapById,
    meta,
    complete: failedCount === 0 && !rewardsUnknown,
  };
}
