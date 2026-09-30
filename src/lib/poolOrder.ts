import { getMerklRewards } from "@/helpers/poolRewardsDisplay";
import { NETWORK_DISPLAY_ORDER } from "./contracts";

/** The fields a pool list is ordered by: the Merkl fields read by getMerklRewards, the chain and the TVL. */
export type OrderablePool = { blockchain?: string | null; totalLiquidity?: number | null };

// Live campaigns first, then scheduled ones, then everything else (ended, none, or unknown).
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
 * The display order of the pool lists: pools with a live campaign first, highest APR first, then pools with a
 * scheduled campaign, soonest start first, then the rest. Equal pools go by network (Polygon, Base, Ethereum),
 * then by TVL, highest first; pools equal in all of these keep their input order. A campaign whose end has
 * passed at `now` counts as ended, so the order follows the clock as well as the Merkl data.
 */
export function sortPoolsForDisplay<T extends OrderablePool>(pools: readonly T[], now: number): T[] {
  const keyed = pools.map((pool) => ({ pool, key: sortKey(pool, now) }));
  keyed.sort(({ key: a }, { key: b }) => {
    if (a.group !== b.group) return a.group - b.group;
    if (a.group === GROUP_LIVE) {
      const byApr = compareNullsLast(a.apr, b.apr, true);
      if (byApr !== 0) return byApr;
    }
    if (a.group === GROUP_SCHEDULED) {
      const byStart = compareNullsLast(a.start, b.start, false);
      if (byStart !== 0) return byStart;
    }
    if (a.network !== b.network) return a.network - b.network;
    return compareNullsLast(a.tvl, b.tvl, true);
  });
  return keyed.map(({ pool }) => pool);
}
