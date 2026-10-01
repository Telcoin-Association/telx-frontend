import { getMerklRewards, getSubscribedValue } from "@/helpers/poolRewardsDisplay";
import { NETWORK_DISPLAY_ORDER } from "./contracts";

/** The fields a pool list is ordered, sorted and filtered by: the Merkl fields read by getMerklRewards, the chain and the figures. */
export type OrderablePool = {
  blockchain?: string | null;
  totalLiquidity?: number | null;
  dailyVolumeUSD?: number | null;
  fees24hr?: number | null;
};

// Within a network: live campaigns first, then scheduled ones, then everything else (ended, none, or unknown).
const GROUP_LIVE = 0;
const GROUP_SCHEDULED = 1;
const GROUP_OTHER = 2;

const networkRank = (chain: string | null | undefined) => {
  const rank = NETWORK_DISPLAY_ORDER.indexOf((chain ?? "").toLowerCase());
  return rank === -1 ? NETWORK_DISPLAY_ORDER.length : rank;
};

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Orders two numbers with nulls last: ascending, or descending with `descending`. */
function compareNullsLast(a: number | null, b: number | null, descending: boolean): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return descending ? b - a : a - b;
}

function sortKey(pool: OrderablePool, now: number) {
  const merkl = getMerklRewards(pool, now);
  const group = merkl.status === "LIVE" ? GROUP_LIVE : merkl.status === "SOON" ? GROUP_SCHEDULED : GROUP_OTHER;
  return { group, apr: merkl.apr, start: merkl.campaignStart, network: networkRank(pool.blockchain), tvl: finite(pool.totalLiquidity) };
}

/**
 * The default order of the pool lists: by network (Polygon, Base, Ethereum), and within a network pools with a
 * live campaign first, highest APR first, then pools with a scheduled campaign, soonest start first, then the
 * rest, each by TVL, highest first. Pools equal in all of these keep their input order. A campaign whose end has
 * passed at `now` counts as ended, so the order follows the clock as well as the Merkl data.
 */
export function sortPoolsForDisplay<T extends OrderablePool>(pools: readonly T[], now: number): T[] {
  const keyed = pools.map((pool) => ({ pool, key: sortKey(pool, now) }));
  keyed.sort(({ key: a }, { key: b }) => {
    if (a.network !== b.network) return a.network - b.network;
    if (a.group !== b.group) return a.group - b.group;
    if (a.group === GROUP_LIVE) {
      const byApr = compareNullsLast(a.apr, b.apr, true);
      if (byApr !== 0) return byApr;
    }
    if (a.group === GROUP_SCHEDULED) {
      const byStart = compareNullsLast(a.start, b.start, false);
      if (byStart !== 0) return byStart;
    }
    return compareNullsLast(a.tvl, b.tvl, true);
  });
  return keyed.map(({ pool }) => pool);
}

/** The columns a visitor can sort the Pools page by. */
export const POOL_SORT_KEYS = ["tvl", "svl", "volume", "fees", "apr"] as const;
export type PoolSortKey = (typeof POOL_SORT_KEYS)[number];
export type PoolSort = { key: PoolSortKey; direction: "desc" | "asc" };

/** A pool's figure for `key` at `now`, or null when unknown. SVL and APR count only while a campaign is live. */
export function poolSortValue(pool: OrderablePool, key: PoolSortKey, now: number): number | null {
  switch (key) {
    case "tvl":
      return finite(pool.totalLiquidity);
    case "volume":
      return finite(pool.dailyVolumeUSD);
    case "fees":
      return finite(pool.fees24hr);
    case "svl": {
      const subscribed = getSubscribedValue(pool, now);
      return subscribed.kind === "value" ? subscribed.usd : null;
    }
    case "apr": {
      const merkl = getMerklRewards(pool, now);
      return merkl.status === "LIVE" ? merkl.apr : null;
    }
  }
}

/**
 * The pools by a visitor's chosen column, highest or lowest first, with unknown values last either way. Pools with
 * equal values keep the default order, so the default order is applied first.
 */
export function sortPoolsBy<T extends OrderablePool>(pools: readonly T[], sort: PoolSort, now: number): T[] {
  const ordered = sortPoolsForDisplay(pools, now).map((pool) => ({ pool, value: poolSortValue(pool, sort.key, now) }));
  ordered.sort((a, b) => compareNullsLast(a.value, b.value, sort.direction === "desc"));
  return ordered.map(({ pool }) => pool);
}

/** The chains the Pools page filters by, in the networks' display order, with "all" for no filter. */
export const POOL_CHAIN_FILTERS = ["all", "polygon", "base", "ethereum"] as const;
export type PoolChainFilter = (typeof POOL_CHAIN_FILTERS)[number];
export type PoolFilters = { chain: PoolChainFilter; liveOnly: boolean };

/** The pools on the chosen chain, and only those with a live campaign at `now` when `liveOnly` is set. */
export function filterPools<T extends OrderablePool>(pools: readonly T[], filters: PoolFilters, now: number): T[] {
  return pools.filter(
    (pool) =>
      (filters.chain === "all" || (pool.blockchain ?? "").toLowerCase() === filters.chain) &&
      (!filters.liveOnly || getMerklRewards(pool, now).status === "LIVE"),
  );
}
