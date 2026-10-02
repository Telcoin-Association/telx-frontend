import { positionsChainFor, type Position } from "@/lib/positions";
import { isClosedButSubscribed, positionStatus } from "@/lib/positionView";

/** Networks in the order the app lists them everywhere: Polygon, then Base, then Ethereum. */
const NETWORK_ORDER = ["polygon", "base", "ethereum"] as const;

type Group<P> = { pool: P & { blockchain?: string | null }; positions: readonly Pick<Position, "liquidity" | "isSubscribed">[] };

/**
 * A pool group needs the visitor's attention when it holds liquidity, or when a position is closed but still
 * subscribed and so still has an Unsubscribe action.
 */
export function hasActivePositions(positions: Group<unknown>["positions"]): boolean {
  return positions.some(position => positionStatus(position) !== "closed" || isClosedButSubscribed(position));
}

const networkRank = (blockchain: string | null | undefined) => {
  const rank = NETWORK_ORDER.indexOf(positionsChainFor(blockchain ?? "") as (typeof NETWORK_ORDER)[number]);
  return rank === -1 ? NETWORK_ORDER.length : rank;
};

/**
 * Splits the wallet's pool groups into the ones with live positions and the ones holding only closed positions.
 * Live groups run by network, then by value, largest first, with unpriced groups after priced ones. Closed-only
 * groups run by network, for a section that stays collapsed until asked for.
 */
export function orderPortfolioGroups<P, G extends Group<P>>(groups: readonly G[], valueOf: (group: G) => number | null): { active: G[]; closed: G[] } {
  const byNetwork = (a: G, b: G) => networkRank(a.pool.blockchain) - networkRank(b.pool.blockchain);
  const active = groups.filter(group => hasActivePositions(group.positions));
  const closed = groups.filter(group => !hasActivePositions(group.positions));
  const value = new Map(active.map(group => [group, valueOf(group)]));
  active.sort((a, b) => byNetwork(a, b) || (value.get(b) ?? -1) - (value.get(a) ?? -1));
  closed.sort(byNetwork);
  return { active, closed };
}

export { NETWORK_ORDER };
