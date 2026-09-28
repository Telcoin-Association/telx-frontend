import "server-only";

import poolJson from "@/data/pool.json";
import type { SubgraphGroup } from "@/types/PoolMetrics";

/**
 * The server's pool registry, derived from src/data/pool.json so that the UI and the data pipeline read
 * one list. A pool is fetched when it has `fetchSubgraph: true`; `active` decides whether a missing pool
 * fails its group's cron. The only data pool.json does not carry is which subgraph serves each
 * protocol/chain, kept in SUBGRAPH_SOURCES below.
 */

export type Protocol = "uniswap" | "balancer" | "quickswap";
export type Chain = "base" | "polygon" | "ethereum";
export type Group = SubgraphGroup;

export type RegistryPool = {
  protocol: Protocol;
  chain: Chain;
  id: string; // lowercase: the v4 pool id for uniswap, the subgraph pool id for balancer, the pair address for quickswap
  name: string;
  active: boolean;
};

/** The Graph subgraph id per `<protocol>:<chain>`. */
export const SUBGRAPH_SOURCES: Readonly<Record<string, { subgraphId: string }>> = {
  "uniswap:base": { subgraphId: "Gqm2b5J85n1bhCyDMpGbtbVn4935EvvdyHdHrx3dibyj" },
  "uniswap:polygon": { subgraphId: "CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND" },
  "uniswap:ethereum": { subgraphId: "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G" },
  "balancer:polygon": { subgraphId: "H9oPAbXnobBRq1cB3HDmbZ1E8MWQyJYQjT1QDJMrdbNp" },
  "quickswap:polygon": { subgraphId: "6K19ca6rG5cDS7ZPdfVbEtgUAT3B7wjqTu6wpyXvqNJJ" },
};

/** The fields of a pool.json entry the registry reads. */
export type PoolJsonEntry = {
  attributes: {
    name: string;
    protocol: string | null;
    blockchain: string;
    pool_address: string;
    subgraph_id: string | null;
    active: boolean;
    fetchSubgraph: boolean;
  };
};

/**
 * Registry pools from pool.json entries. Throws when a pool that asks for subgraph data has no subgraph
 * source for its protocol/chain or no id, so a bad pool.json edit fails the build instead of a cron.
 */
export function buildRegistry(entries: readonly PoolJsonEntry[]): RegistryPool[] {
  return entries
    .filter(({ attributes }) => attributes.fetchSubgraph === true)
    .map(({ attributes }) => {
      const source = `${attributes.protocol}:${attributes.blockchain}`;
      if (!SUBGRAPH_SOURCES[source]) {
        throw new Error(`pool.json: ${attributes.name} has fetchSubgraph but no subgraph source for ${source}`);
      }
      const id = (attributes.protocol === "balancer" ? attributes.subgraph_id : attributes.pool_address)?.trim().toLowerCase();
      if (!id) {
        throw new Error(`pool.json: ${attributes.name} has fetchSubgraph but no pool id`);
      }
      return {
        protocol: attributes.protocol as Protocol,
        chain: attributes.blockchain as Chain,
        id,
        name: attributes.name,
        active: attributes.active,
      };
    });
}

export const registryPools: readonly RegistryPool[] = buildRegistry(poolJson as PoolJsonEntry[]);

export const GROUPS = ["uniswap-base", "uniswap-polygon", "uniswap-ethereum", "balancer", "quickswap"] as const satisfies readonly Group[];

const GROUP_SOURCES: Record<Group, { protocol: Protocol; chain: Chain }> = {
  "uniswap-base": { protocol: "uniswap", chain: "base" },
  "uniswap-polygon": { protocol: "uniswap", chain: "polygon" },
  "uniswap-ethereum": { protocol: "uniswap", chain: "ethereum" },
  balancer: { protocol: "balancer", chain: "polygon" },
  quickswap: { protocol: "quickswap", chain: "polygon" },
};

/** All registry pools of a protocol/chain group (active and archived), one entry per id, active when any entry is. */
export function poolsFor(protocol: Protocol, chain: Chain): RegistryPool[] {
  const byId = new Map<string, RegistryPool>();
  for (const pool of registryPools) {
    if (pool.protocol !== protocol || pool.chain !== chain) continue;
    const seen = byId.get(pool.id);
    byId.set(pool.id, seen ? { ...seen, active: seen.active || pool.active } : pool);
  }
  return [...byId.values()];
}

/** Unique lowercase pool ids of a protocol/chain group. */
export function poolIdsFor(protocol: Protocol, chain: Chain): string[] {
  return poolsFor(protocol, chain).map(pool => pool.id);
}

export function subgraphIdFor(protocol: Protocol, chain: Chain): string {
  const subgraphId = SUBGRAPH_SOURCES[`${protocol}:${chain}`]?.subgraphId;
  if (!subgraphId) {
    throw new Error(`No subgraph registered for ${protocol}:${chain}`);
  }
  return subgraphId;
}

/** Balancer and QuickSwap have a single group each, whatever the chain. */
export function groupOf(protocol: Protocol, chain: Chain): Group {
  return protocol === "uniswap" ? `uniswap-${chain}` : protocol;
}

export function protocolChainOf(group: Group): { protocol: Protocol; chain: Chain } {
  return { ...GROUP_SOURCES[group] };
}

/** Groups with at least one registry pool, in GROUPS order. */
export function fetchedGroups(): Group[] {
  return GROUPS.filter(group => {
    const { protocol, chain } = protocolChainOf(group);
    return poolsFor(protocol, chain).length > 0;
  });
}
